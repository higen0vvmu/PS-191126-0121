import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

const hasSqlConfig = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

export const createPool = () => {
  if (!hasSqlConfig) return null;
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const createMockDb = () => {
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: { data?: unknown }) => d?.data ?? {},
    update: async (d: { data?: unknown }) => d?.data ?? {},
    delete: async () => ({}),
  };
  return new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'query'
          ? new Proxy({}, { get: () => noOp })
          : () => ({
              from: () => ({
                where: () => ({
                  orderBy: async () => [],
                  limit: async () => [],
                }),
              }),
              values: () => ({
                onConflictDoUpdate: () => ({
                  returning: async () => [],
                }),
              }),
              set: () => ({
                where: () => ({
                  returning: async () => [],
                }),
              }),
              where: () => ({
                returning: async () => [],
              }),
            }),
    }
  ) as ReturnType<typeof drizzle<typeof schema>>;
};

let dbInstance: ReturnType<typeof drizzle<typeof schema>>;
try {
  const pool = createPool();
  if (pool) {
    dbInstance = drizzle(pool, { schema });
  } else {
    console.info('[Plan Studio] Local mode: SQL_HOST not configured — using browser localStorage.');
    dbInstance = createMockDb();
  }
} catch (err) {
  console.warn('[Plan Studio] PostgreSQL unavailable — falling back to local mock:', err);
  dbInstance = createMockDb();
}

export const db = dbInstance;
