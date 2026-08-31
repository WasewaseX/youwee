import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { downloadFiles } from '../db/schema.js';

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

const files = new Hono<Env>();

const s3 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.STORAGE_SECRET_KEY || '',
  },
});

const BUCKET = process.env.STORAGE_BUCKET || 'youwee-files';

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

files.get('/:fileId', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const fileId = c.req.param('fileId');

  const file = await db.query.downloadFiles.findFirst({
    where: and(eq(downloadFiles.id, fileId), eq(downloadFiles.userId, session.userId)),
  });

  if (!file) {
    return c.json({ error: 'File not found' }, 404);
  }

  const safeFileName = sanitizeFileName(file.fileName);

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: file.storageKey,
    ResponseContentDisposition: `attachment; filename="${safeFileName}"`,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  return c.redirect(signedUrl);
});

files.post('/:fileId/upload-url', async (c) => {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const fileId = c.req.param('fileId');

  const file = await db.query.downloadFiles.findFirst({
    where: and(eq(downloadFiles.id, fileId), eq(downloadFiles.userId, session.userId)),
  });

  if (!file) {
    return c.json({ error: 'File not found' }, 404);
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: file.storageKey,
    ContentLength: file.fileSize,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  return c.json({
    url: signedUrl,
    method: 'PUT',
  });
});

export { files };
