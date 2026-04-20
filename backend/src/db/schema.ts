import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  bigint,
  integer,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 16 }).notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const visits = pgTable(
  'visits',
  {
    id: serial('id').primaryKey(),
    ip: varchar('ip', { length: 64 }).notNull(),
    userAgent: text('user_agent'),
    path: varchar('path', { length: 255 }),
    userId: integer('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('visits_created_at_idx').on(t.createdAt),
    ipIdx: index('visits_ip_idx').on(t.ip),
  }),
);

export const conversions = pgTable(
  'conversions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    jobId: varchar('job_id', { length: 32 }).notNull(),
    sourceSize: bigint('source_size', { mode: 'number' }),
    outputSize: bigint('output_size', { mode: 'number' }),
    durationSec: integer('duration_sec'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('conversions_user_idx').on(t.userId),
    createdAtIdx: index('conversions_created_at_idx').on(t.createdAt),
  }),
);

export const downloads = pgTable(
  'downloads',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    jobId: varchar('job_id', { length: 32 }).notNull(),
    filename: varchar('filename', { length: 255 }),
    size: bigint('size', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('downloads_user_idx').on(t.userId),
    createdAtIdx: index('downloads_created_at_idx').on(t.createdAt),
  }),
);

export const transcriptions = pgTable(
  'transcriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    model: varchar('model', { length: 32 }),
    language: varchar('language', { length: 32 }),
    chars: integer('chars'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('transcriptions_user_idx').on(t.userId),
    createdAtIdx: index('transcriptions_created_at_idx').on(t.createdAt),
  }),
);
