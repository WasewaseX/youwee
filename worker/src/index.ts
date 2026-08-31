import { type Job, Worker } from 'bullmq';
import RedisModule from 'ioredis';

const Redis = RedisModule.default || RedisModule;

import { type ChildProcess, spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisCommand = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  lazyConnect: true,
});

const redisSubscriber = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  lazyConnect: true,
});

const sql = postgres(process.env.DATABASE_URL || '', { max: 5 });
const db = drizzle(sql);

const _users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const downloadJobs = pgTable('download_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  parentJobId: uuid('parent_job_id'),
  url: text('url').notNull(),
  title: varchar('title', { length: 500 }),
  status: varchar('status', { length: 50 }).notNull().default('queued'),
  priority: integer('priority').default(0).notNull(),
  format: varchar('format', { length: 50 }),
  quality: varchar('quality', { length: 50 }),
  subtitleOptions: jsonb('subtitle_options'),
  postProcessOptions: jsonb('post_process_options'),
  progress: integer('progress').default(0).notNull(),
  speed: varchar('speed', { length: 50 }),
  eta: integer('eta'),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const downloadFiles = pgTable('download_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull(),
  userId: uuid('user_id').notNull(),
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: varchar('mime_type', { length: 100 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.STORAGE_SECRET_KEY || '',
  },
});

const BUCKET = process.env.STORAGE_BUCKET || 'youwee-files';
const TEMP_DIR = join(tmpdir(), 'youwee-worker');

if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

const ALLOWED_FORMATS = new Set(['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'opus']);
const ALLOWED_QUALITIES = new Set([
  '144p',
  '240p',
  '360p',
  '480p',
  '720p',
  '1080p',
  '1440p',
  '2160p',
  '4320p',
  'best',
  'worst',
]);

function getMimeType(format: string): string {
  switch (format) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'opus':
      return 'audio/opus';
    default:
      return 'application/octet-stream';
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const activeProcesses = new Map<string, { ytDlp?: ChildProcess; ffmpeg?: ChildProcess }>();

async function updateJobStatus(
  jobId: string,
  status: string,
  updates: Record<string, unknown> = {},
) {
  await db
    .update(downloadJobs)
    .set({ status, ...updates, updatedAt: new Date() })
    .where(eq(downloadJobs.id, jobId));
  await redisCommand.publish(`job:${jobId}:progress`, JSON.stringify({ status, ...updates }));
}

function runYtDlp(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => resolve({ code: code || 0, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
    return child;
  });
}

function _runFfmpeg(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => resolve({ code: code || 0, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
    return child;
  });
}

async function extractMetadata(url: string): Promise<Record<string, unknown>> {
  const { stdout } = await runYtDlp([
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--js-runtimes',
    'deno',
    url,
  ]);
  const data = JSON.parse(stdout.trim().split('\n')[0]);
  return {
    title: data.title,
    duration: data.duration,
    thumbnail: data.thumbnail,
    formats:
      data.formats?.map((f: Record<string, unknown>) => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.resolution,
        fps: f.fps,
        vcodec: f.vcodec,
        acodec: f.acodec,
        filesize: f.filesize,
        quality: f.quality,
      })) || [],
    subtitles: data.subtitles || {},
    automaticCaptions: data.automatic_captions || {},
  };
}

type DownloadJobData = {
  jobId: string;
  url: string;
  format: string;
  quality: string;
  subtitleOptions?: { langs?: string[] } & Record<string, unknown>;
  postProcessOptions?: { convert?: string } & Record<string, unknown>;
  userId: string;
};

type MetadataJobData = { jobId: string; url: string; userId: string };

async function downloadVideo(jobData: DownloadJobData): Promise<string> {
  const { jobId, url, format, quality, subtitleOptions, postProcessOptions, userId } = jobData;

  if (!ALLOWED_FORMATS.has(format)) {
    throw new Error(`Invalid format: ${format}`);
  }
  if (!ALLOWED_QUALITIES.has(quality)) {
    throw new Error(`Invalid quality: ${quality}`);
  }
  if (postProcessOptions?.convert && !ALLOWED_FORMATS.has(postProcessOptions.convert)) {
    throw new Error(`Invalid conversion format: ${postProcessOptions.convert}`);
  }

  await updateJobStatus(jobId, 'downloading', { startedAt: new Date() });

  const tempFile = join(TEMP_DIR, `${sanitizeFileName(jobId)}.${format}`);
  const outputTemplate = tempFile.replace(/\.[^.]+$/, '.%(ext)s');
  const ytDlpArgs = [
    '-f',
    `bestvideo[height<=${quality.replace('p', '')}]+bestaudio/best[height<=${quality.replace('p', '')}]`,
    '--merge-output-format',
    format,
    '-o',
    outputTemplate,
    '--no-warnings',
    '--js-runtimes',
    'deno',
    '--progress',
    '--newline',
    url,
  ];
  if (subtitleOptions?.langs) {
    ytDlpArgs.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      subtitleOptions.langs.join(','),
    );
  }

  const ytDlpChild = spawn('yt-dlp', ytDlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeProcesses.set(jobId, { ytDlp: ytDlpChild });

  let ytDlpStdout = '';
  let ytDlpStderr = '';
  ytDlpChild.stdout.on('data', (data) => {
    ytDlpStdout += data.toString();
  });
  ytDlpChild.stderr.on('data', (data) => {
    ytDlpStderr += data.toString();
  });

  const ytDlpResult = await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      ytDlpChild.on('close', (code) =>
        resolve({ code: code || 0, stdout: ytDlpStdout, stderr: ytDlpStderr }),
      );
      ytDlpChild.on('error', (err) =>
        resolve({ code: -1, stdout: ytDlpStdout, stderr: err.message }),
      );
    },
  );

  activeProcesses.delete(jobId);

  if (ytDlpResult.code !== 0) throw new Error(`yt-dlp failed: ${ytDlpResult.stderr}`);

  const actualFile = tempFile.replace(/\.[^.]+$/, `.${format}`);
  if (!existsSync(actualFile)) {
    const files = readdirSync(TEMP_DIR).filter((f: string) =>
      f.startsWith(sanitizeFileName(jobId)),
    );
    if (files.length > 0) return join(TEMP_DIR, files[0]);
    throw new Error('Downloaded file not found');
  }

  await updateJobStatus(jobId, 'processing');
  let finalFile = actualFile;
  if (postProcessOptions?.convert) {
    const convertedFile = join(
      TEMP_DIR,
      `${sanitizeFileName(jobId)}_converted.${postProcessOptions.convert}`,
    );
    await updateJobStatus(jobId, 'processing', { progress: 50 });

    const ffmpegChild = spawn(
      'ffmpeg',
      [
        '-i',
        actualFile,
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-preset',
        'medium',
        '-crf',
        '23',
        convertedFile,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    activeProcesses.set(jobId, { ffmpeg: ffmpegChild });

    let ffmpegStdout = '';
    let ffmpegStderr = '';
    ffmpegChild.stdout.on('data', (data) => {
      ffmpegStdout += data.toString();
    });
    ffmpegChild.stderr.on('data', (data) => {
      ffmpegStderr += data.toString();
    });

    const ffmpegResult = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve) => {
        ffmpegChild.on('close', (code) =>
          resolve({ code: code || 0, stdout: ffmpegStdout, stderr: ffmpegStderr }),
        );
        ffmpegChild.on('error', (err) =>
          resolve({ code: -1, stdout: ffmpegStdout, stderr: err.message }),
        );
      },
    );

    activeProcesses.delete(jobId);

    if (ffmpegResult.code === 0 && existsSync(convertedFile)) {
      unlinkSync(actualFile);
      finalFile = convertedFile;
    }
  }

  await updateJobStatus(jobId, 'uploading');
  const fileSize = statSync(finalFile).size;
  const storageKey = `users/${userId}/downloads/${jobId}/${sanitizeFileName(basename(finalFile))}`;
  const fileStream = createReadStream(finalFile);
  const mimeType = getMimeType(postProcessOptions?.convert || format);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: fileStream,
      ContentLength: fileSize,
      ContentType: mimeType,
    }),
  );
  await db.insert(downloadFiles).values({
    jobId,
    userId,
    storageKey,
    fileName: sanitizeFileName(basename(finalFile)),
    fileSize,
    mimeType,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  unlinkSync(finalFile);
  await updateJobStatus(jobId, 'completed', { progress: 100, completedAt: new Date() });
  return storageKey;
}

async function processMetadataJob(jobData: MetadataJobData) {
  const { jobId, url, userId } = jobData;
  await updateJobStatus(jobId, 'downloading', { startedAt: new Date() });
  try {
    const metadata = await extractMetadata(url);
    await db
      .update(downloadJobs)
      .set({
        status: 'completed',
        title: metadata.title as string,
        progress: 100,
        completedAt: new Date(),
        metadata,
      })
      .where(eq(downloadJobs.id, jobId));
    await redisCommand.publish(
      `job:${jobId}:progress`,
      JSON.stringify({ status: 'completed', title: metadata.title, progress: 100, metadata }),
    );
  } catch (error) {
    await db
      .update(downloadJobs)
      .set({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Metadata extraction failed',
      })
      .where(eq(downloadJobs.id, jobId));
    await redisCommand.publish(
      `job:${jobId}:progress`,
      JSON.stringify({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Metadata extraction failed',
      }),
    );
  }
}

async function init() {
  await redisCommand.connect();
  await redisSubscriber.connect();

  const metadataWorker = new Worker(
    'downloads',
    async (job: Job) => {
      if (job.name === 'metadata') {
        await processMetadataJob(job.data);
      }
    },
    { connection: redisCommand, concurrency: 5 },
  );

  const downloadWorker = new Worker(
    'downloads',
    async (job: Job) => {
      if (job.name === 'download') {
        const jobId = job.data.jobId;
        try {
          await downloadVideo(job.data);
        } catch (error) {
          await db
            .update(downloadJobs)
            .set({
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Download failed',
              updatedAt: new Date(),
            })
            .where(eq(downloadJobs.id, jobId));
          await redisCommand.publish(
            `job:${jobId}:progress`,
            JSON.stringify({
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Download failed',
            }),
          );
          throw error;
        } finally {
          activeProcesses.delete(jobId);
        }
      }
    },
    { connection: redisCommand, concurrency: 2 },
  );

  await redisSubscriber.subscribe('job:cancel:commands');
  redisSubscriber.on('message', async (channel, message) => {
    if (channel === 'job:cancel:commands') {
      const { jobId } = JSON.parse(message);
      const procs = activeProcesses.get(jobId);
      if (procs) {
        if (procs.ytDlp && !procs.ytDlp.killed) procs.ytDlp.kill('SIGTERM');
        if (procs.ffmpeg && !procs.ffmpeg.killed) procs.ffmpeg.kill('SIGTERM');
        await updateJobStatus(jobId, 'cancelled');
        activeProcesses.delete(jobId);
      }
    }
  });

  metadataWorker.on('completed', (job) => console.log(`Metadata job ${job.id} completed`));
  metadataWorker.on('failed', (job, err) => console.error(`Metadata job ${job?.id} failed:`, err));
  downloadWorker.on('completed', (job) => console.log(`Download job ${job.id} completed`));
  downloadWorker.on('failed', (job, err) => console.error(`Download job ${job?.id} failed:`, err));

  console.log('Youwee workers started');

  process.on('SIGTERM', async () => {
    console.log('Shutting down workers...');
    for (const [_jobId, procs] of activeProcesses) {
      if (procs.ytDlp && !procs.ytDlp.killed) procs.ytDlp.kill('SIGTERM');
      if (procs.ffmpeg && !procs.ffmpeg.killed) procs.ffmpeg.kill('SIGTERM');
    }
    await metadataWorker.close();
    await downloadWorker.close();
    await redisCommand.quit();
    await redisSubscriber.quit();
    process.exit(0);
  });
}

await init();
