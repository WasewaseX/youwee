interface RateLimitStore {
  [key: string]: { count: number; resetAt: number };
}

const stores: { [key: string]: RateLimitStore } = {};

function getStore(name: string): RateLimitStore {
  if (!stores[name]) {
    stores[name] = {};
  }
  return stores[name];
}

function cleanupStore(store: RateLimitStore) {
  const now = Date.now();
  for (const key of Object.keys(store)) {
    if (store[key].resetAt < now) {
      delete store[key];
    }
  }
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const storeName = `ratelimit_${maxRequests}_${windowMs}`;
  const store = getStore(storeName);

  return async (c: any, next: () => Promise<void>) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';

    const key = `${c.req.path}:${ip}`;
    const now = Date.now();

    cleanupStore(store);

    const entry = store[key];
    if (!entry || entry.resetAt < now) {
      store[key] = { count: 1, resetAt: now + windowMs };
    } else {
      entry.count++;
      if (entry.count > maxRequests) {
        return c.json({ error: 'Too many requests. Please try again later.' }, 429);
      }
    }

    await next();
  };
}
