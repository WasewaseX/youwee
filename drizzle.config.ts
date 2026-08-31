import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/src/db/schema.ts',
  out: './server/src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
