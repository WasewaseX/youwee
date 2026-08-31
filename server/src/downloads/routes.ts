import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { type downloadFiles, downloadJobs } from '../db/schema.js';
import { type DownloadJobData, downloadQueue, redis } from '../queue/index.js';

interface SessionPayload {
  userId: string;
  sessionId: string;
  email: string;
}

type Env = {
  Variables: {
    session: SessionPayload;
  };
};

const downloads = new Hono<Env>();

const ALLOWED_FORMATS = ['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'opus'] as const;
const ALLOWED_QUALITIES = [
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
] as const;

const createDownloadSchema = z.object({
  url: z.string().url(),
  format: z.enum(ALLOWED_FORMATS).optional(),
  quality: z.enum(ALLOWED_QUALITIES).optional(),
  subtitleOptions: z.record(z.unknown()).optional(),
  postProcessOptions: z
    .object({
      convert: z.enum(ALLOWED_FORMATS).optional(),
    })
    .optional(),
  parentJobId: z.string().uuid().optional(),
});

downloads.post('/', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const data = createDownloadSchema.parse(body);

    const jobId = crypto.randomUUID();

    await db.insert(downloadJobs).values({
      id: jobId,
      userId: session.userId,
      parentJobId: data.parentJobId,
      url: data.url,
      format: data.format,
      quality: data.quality,
      subtitleOptions: data.subtitleOptions,
      postProcessOptions: data.postProcessOptions,
      status: 'queued',
    });

    const jobData: DownloadJobData = {
      jobId,
      url: data.url,
      format: data.format || 'mp4',
      quality: data.quality || '720p',
      subtitleOptions: data.subtitleOptions,
      postProcessOptions: data.postProcessOptions,
      userId: session.userId,
    };

    await downloadQueue.add('download', jobData, {
      jobId,
      priority: 10,
    });

    return c.json({ id: jobId, status: 'queued' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation failed', details: error.errors }, 400);
    }
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to create download job' },
      500,
    );
  }
});

downloads.get('/', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const status = c.req.query('status');

  const jobs = (await db.query.downloadJobs.findMany({
    where: status
      ? and(eq(downloadJobs.userId, session.userId), eq(downloadJobs.status, status))
      : eq(downloadJobs.userId, session.userId),
    orderBy: [desc(downloadJobs.createdAt)],
    limit,
    offset,
    with: {
      files: true,
    },
  })) as (typeof downloadJobs.$inferSelect & { files: (typeof downloadFiles.$inferSelect)[] })[];

  return c.json(
    jobs.map((job) => ({
      id: job.id,
      url: job.url,
      title: job.title,
      status: job.status,
      format: job.format,
      quality: job.quality,
      progress: job.progress,
      speed: job.speed,
      eta: job.eta,
      errorMessage: job.errorMessage,
      parentJobId: job.parentJobId,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      metadata: job.metadata,
      files: job.files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileSize: f.fileSize,
        mimeType: f.mimeType,
      })),
    })),
  );
});

downloads.get('/:jobId', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const jobId = c.req.param('jobId');

  const job = (await db.query.downloadJobs.findFirst({
    where: and(eq(downloadJobs.id, jobId), eq(downloadJobs.userId, session.userId)),
    with: {
      files: true,
    },
  })) as
    | (typeof downloadJobs.$inferSelect & { files: (typeof downloadFiles.$inferSelect)[] })
    | undefined;

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  return c.json({
    id: job.id,
    url: job.url,
    title: job.title,
    status: job.status,
    format: job.format,
    quality: job.quality,
    subtitleOptions: job.subtitleOptions,
    postProcessOptions: job.postProcessOptions,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    errorMessage: job.errorMessage,
    parentJobId: job.parentJobId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    metadata: job.metadata,
    files: job.files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      fileSize: f.fileSize,
      mimeType: f.mimeType,
    })),
  });
});

downloads.post('/:jobId/cancel', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const jobId = c.req.param('jobId');

  const job = await db.query.downloadJobs.findFirst({
    where: and(eq(downloadJobs.id, jobId), eq(downloadJobs.userId, session.userId)),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  if (!['queued', 'downloading', 'processing', 'uploading'].includes(job.status)) {
    return c.json({ error: 'Job cannot be cancelled' }, 400);
  }

  await db
    .update(downloadJobs)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(downloadJobs.id, jobId));

  await downloadQueue.remove(jobId);

  await redis.publish('job:cancel:commands', JSON.stringify({ jobId }));

  return c.json({ success: true });
});

downloads.get('/:jobId/events', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const jobId = c.req.param('jobId');

  const job = await db.query.downloadJobs.findFirst({
    where: and(eq(downloadJobs.id, jobId), eq(downloadJobs.userId, session.userId)),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const encoder = new TextEncoder();
  let subscribed = false;
  let subscriberClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (!subscriberClosed) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        }
      };

      send({ status: job.status, progress: job.progress, metadata: job.metadata });

      const subscriber = redis.duplicate();
      await subscriber.subscribe(`job:${jobId}:progress`);
      subscribed = true;

      const onMessage = (channel: string, message: string) => {
        if (channel === `job:${jobId}:progress`) {
          try {
            const data = JSON.parse(message);
            send(data);
            if (['completed', 'failed', 'cancelled'].includes(data.status)) {
              cleanup();
            }
          } catch {
            // ignore parse errors
          }
        }
      };

      subscriber.on('message', onMessage);

      const cleanup = async () => {
        if (subscribed && !subscriberClosed) {
          subscriberClosed = true;
          subscriber.off('message', onMessage);
          await subscriber.unsubscribe(`job:${jobId}:progress`);
          await subscriber.quit();
          subscribed = false;
          controller.close();
        }
      };

      c.req.raw.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export { downloads };
