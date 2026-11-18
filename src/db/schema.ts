import { pgTable, text, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import type { Project } from '../types/plan.ts';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().default(''),
  displayName: text('display_name'),
  keybinds: jsonb('keybinds').$type<Record<string, string>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userModels = pgTable(
  'user_models',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    data: jsonb('data').$type<Project>().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.modelId] })]
);
