import { Queue, QueueEvents } from "bullmq";
import RedisModule from "ioredis";

const Redis = RedisModule.default || RedisModule;

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  lazyConnect: true,
});

await redis.connect();

export const downloadQueue = new Queue("downloads", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const queueEvents = new QueueEvents("downloads", { connection: redis });

export type DownloadJobData = {
  jobId: string;
  url: string;
  format: string;
  quality: string;
  subtitleOptions?: Record<string, unknown>;
  postProcessOptions?: Record<string, unknown>;
  userId: string;
};

export type MetadataJobData = {
  jobId: string;
  url: string;
  userId: string;
};

export { redis };

export async function closeQueue() {
  await downloadQueue.close();
  await redis.quit();
}