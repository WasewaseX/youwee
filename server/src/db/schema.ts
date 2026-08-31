import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    isActive: boolean('is_active').default(true).notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('sessions_user_id_idx').on(table.userId),
    tokenIdx: uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
    expiresIdx: index('sessions_expires_at_idx').on(table.expiresAt),
  }),
);

// Declare downloadJobs without self-ref first, then add the column
export const downloadJobs = pgTable(
  'download_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    queuedAt: timestamp('queued_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('download_jobs_user_id_idx').on(table.userId),
    parentIdx: index('download_jobs_parent_job_id_idx').on(table.parentJobId),
    statusIdx: index('download_jobs_status_idx').on(table.status),
    createdIdx: index('download_jobs_created_at_idx').on(table.createdAt),
  }),
);

export const downloadFiles = pgTable(
  'download_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => downloadJobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: varchar('mime_type', { length: 100 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    jobIdx: index('download_files_job_id_idx').on(table.jobId),
    userIdx: index('download_files_user_id_idx').on(table.userId),
  }),
);

export const userSettings = pgTable(
  'user_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    theme: varchar('theme', { length: 50 }).default('system').notNull(),
    language: varchar('language', { length: 10 }).default('en').notNull(),
    defaultFormat: varchar('default_format', { length: 50 }).default('mp4').notNull(),
    defaultQuality: varchar('default_quality', { length: 50 }).default('720p').notNull(),
    defaultSubtitleLang: varchar('default_subtitle_lang', { length: 10 }),
    autoEmbedSubtitles: boolean('auto_embed_subtitles').default(false).notNull(),
    sponsorBlockEnabled: boolean('sponsor_block_enabled').default(true).notNull(),
    maxConcurrentDownloads: integer('max_concurrent_downloads').default(1).notNull(),
    downloadPath: varchar('download_path', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (_table) => ({}),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type DownloadJob = typeof downloadJobs.$inferSelect;
export type NewDownloadJob = typeof downloadJobs.$inferInsert;
export type DownloadFile = typeof downloadFiles.$inferSelect;
export type NewDownloadFile = typeof downloadFiles.$inferInsert;
export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;
