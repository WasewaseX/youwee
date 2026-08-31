import { Queue, Worker, QueueEvents } from "bullmq";
import RedisModule from "ioredis";
const Redis = RedisModule.default || RedisModule;
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { spawn } from "node:child_process";
import { createWriteStream, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { pgTable, uuid, text, varchar, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  lazyConnect: true,
});

const sql = postgres(process.env.DATABASE_URL || "", { max: 5 });
const db = drizzle(sql);

const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: uuid("email").notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  isActive: boolean("is_active").default(true).notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 45 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

const downloadJobs = pgTable("download_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  parentJobId: uuid("parent_job_id"),
  url: text("url").notNull(),
  title: varchar("title", { length: 500 }),
  status: varchar("status", { length: 50 }).notNull().default("queued"),
  priority: integer("priority").default(0).notNull(),
  format: varchar("format", { length: 50 }),
  quality: varchar("quality", { length: 50 }),
  subtitleOptions: jsonb("subtitle_options"),
  postProcessOptions: jsonb("post_process_options"),
  progress: integer("progress").default(0).notNull(),
  speed: varchar("speed", { length: 50 }),
  eta: integer("eta"),
  errorMessage: text("error_message"),
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

const downloadFiles = pgTable("download_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  userId: uuid("user_id").notNull(),
  storageKey: varchar("storage_key", { length: 500 }).notNull(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

const s3 = new S3Client({
  region: process.env.STORAGE_REGION || "auto",
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY || "",
  },
});

const BUCKET = process.env.STORAGE_BUCKET || "youwee-files";
const TEMP_DIR = join(tmpdir(), "youwee-worker");

if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

function updateJobStatus(jobId: string, status: string, updates: Record<string, unknown> = {}) {
  return db.update(downloadJobs)
    .set({ status, ...updates, updatedAt: new Date() })
    .where(eq(downloadJobs.id, jobId));
}

function runYtDlp(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("close", (code) => resolve({ code: code || 0, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

function runFfmpeg(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("close", (code) => resolve({ code: code || 0, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

async function extractMetadata(url: string): Promise<Record<string, unknown>> {
  const { stdout } = await runYtDlp([
    "--dump-json", "--no-download", "--no-warnings", "--js-runtimes", "deno", url,
  ]);
  const data = JSON.parse(stdout.trim().split("\n")[0]);
  return {
    title: data.title,
    duration: data.duration,
    thumbnail: data.thumbnail,
    formats: data.formats?.map((f: Record<string, unknown>) => ({
      formatId: f.format_id, ext: f.ext, resolution: f.resolution,
      fps: f.fps, vcodec: f.vcodec, acodec: f.acodec,
      filesize: f.filesize, quality: f.quality,
    })) || [],
    subtitles: data.subtitles || {},
    automaticCaptions: data.automatic_captions || {},
  };
}

type DownloadJobData = {
  jobId: string; url: string; format: string; quality: string;
  subtitleOptions?: { langs?: string[] } & Record<string, unknown>;
  postProcessOptions?: Record<string, unknown>; userId: string;
};

type MetadataJobData = { jobId: string; url: string; userId: string };

async function downloadVideo(jobData: DownloadJobData): Promise<string> {
  const { jobId, url, format, quality, subtitleOptions, postProcessOptions, userId } = jobData;
  await updateJobStatus(jobId, "downloading", { startedAt: new Date() });
  const tempFile = join(TEMP_DIR, `${jobId}.${format}`);
  const outputTemplate = tempFile.replace(/\.[^.]+$/, ".%(ext)s");
  const ytDlpArgs = [
    "-f", `bestvideo[height<=${quality.replace("p", "")}]+bestaudio/best[height<=${quality.replace("p", "")}]`,
    "--merge-output-format", format, "-o", outputTemplate,
    "--no-warnings", "--js-runtimes", "deno", "--progress", "--newline", url,
  ];
  if (subtitleOptions?.langs) {
    ytDlpArgs.push("--write-subs", "--write-auto-subs", "--sub-langs", subtitleOptions.langs.join(","));
  }
  const { code, stderr } = await runYtDlp(ytDlpArgs);
  if (code !== 0) throw new Error(`yt-dlp failed: ${stderr}`);
  const actualFile = tempFile.replace(/\.[^.]+$/, `.${format}`);
  if (!existsSync(actualFile)) {
    const files = require("fs").readdirSync(TEMP_DIR).filter((f: string) => f.startsWith(jobId));
    if (files.length > 0) return join(TEMP_DIR, files[0]);
    throw new Error("Downloaded file not found");
  }
  await updateJobStatus(jobId, "processing");
  let finalFile = actualFile;
  if (postProcessOptions?.convert) {
    const convertedFile = join(TEMP_DIR, `${jobId}_converted.${postProcessOptions.convert}`);
    await updateJobStatus(jobId, "processing", { progress: 50 });
    const { code } = await runFfmpeg(["-i", actualFile, "-c:v", "libx264", "-c:a", "aac", "-preset", "medium", "-crf", "23", convertedFile]);
    if (code === 0 && existsSync(convertedFile)) { unlinkSync(actualFile); finalFile = convertedFile; }
  }
  const fileSize = require("fs").statSync(finalFile).size;
  const storageKey = `users/${userId}/downloads/${jobId}/${require("path").basename(finalFile)}`;
  const fileStream = require("fs").createReadStream(finalFile);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, Body: fileStream, ContentLength: fileSize, ContentType: "video/mp4" }));
  await db.insert(downloadFiles).values({ jobId, userId, storageKey, fileName: require("path").basename(finalFile), fileSize, mimeType: "video/mp4", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  unlinkSync(finalFile);
  await updateJobStatus(jobId, "completed", { progress: 100, completedAt: new Date() });
  return storageKey;
}

async function processMetadataJob(jobData: { jobId: string; url: string; userId: string }) {
  const { jobId, url, userId } = jobData;
  await updateJobStatus(jobId, "downloading", { startedAt: new Date() });
  try {
    const metadata = await extractMetadata(url);
    await db.update(downloadJobs).set({ status: "completed", title: metadata.title as string, progress: 100, completedAt: new Date() }).where(eq(downloadJobs.id, jobId));
  } catch (error) {
    await db.update(downloadJobs).set({ status: "failed", errorMessage: error instanceof Error ? error.message : "Metadata extraction failed" }).where(eq(downloadJobs.id, jobId));
  }
}

async function init() {
  await redis.connect();

  const { Queue, Worker, QueueEvents } = await import("bullmq");

  const downloadQueue = new Queue("downloads", {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });

  const queueEvents = new QueueEvents("downloads", { connection: redis });

  const metadataWorker = new Worker("downloads", async (job) => {
    if (job.name === "metadata") {
      await processMetadataJob(job.data);
    }
  }, { connection: redis, concurrency: 5 });

  const downloadWorker = new Worker("downloads", async (job) => {
    if (job.name === "download") {
      await downloadVideo(job.data);
    }
  }, { connection: redis, concurrency: 2 });

  metadataWorker.on("completed", (job) => console.log(`Metadata job ${job.id} completed`));
  metadataWorker.on("failed", (job, err) => console.error(`Metadata job ${job?.id} failed:`, err));
  downloadWorker.on("completed", (job) => console.log(`Download job ${job.id} completed`));
  downloadWorker.on("failed", (job, err) => console.error(`Download job ${job?.id} failed:`, err));

  console.log("Youwee workers started");

  process.on("SIGTERM", async () => {
    console.log("Shutting down workers...");
    await metadataWorker.close();
    await downloadWorker.close();
    await redis.quit();
    process.exit(0);
  });
}

await init();