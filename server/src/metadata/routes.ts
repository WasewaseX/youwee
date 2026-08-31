import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { downloadJobs } from '../db/schema.js';
import { downloadQueue, type MetadataJobData } from '../queue/index.js';

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

const metadata = new Hono<Env>();

const metadataSchema = z.object({
  url: z.string().url(),
});

metadata.post('/', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const data = metadataSchema.parse(body);

    const jobId = crypto.randomUUID();

    await db.insert(downloadJobs).values({
      id: jobId,
      userId: session.userId,
      url: data.url,
      status: 'queued',
      format: 'metadata',
    });

    const jobData: MetadataJobData = {
      jobId,
      url: data.url,
      userId: session.userId,
    };

    await downloadQueue.add('metadata', jobData, {
      jobId,
    });

    return c.json({ jobId, status: 'queued' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation failed', details: error.errors }, 400);
    }
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to queue metadata job' },
      500,
    );
  }
});

metadata.get('/:jobId', async (c) => {
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

  return c.json({
    id: job.id,
    url: job.url,
    title: job.title,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    metadata: job.metadata,
  });
});

export { metadata };
