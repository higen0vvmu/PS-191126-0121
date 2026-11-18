import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { userModels, users } from './schema.ts';
import type { Project } from '../types/plan.ts';

export interface DbUser {
  id: string;
  uid: string;
  email: string;
  displayName: string | null;
}

const hasSqlConfig = Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME);

// In-memory mock store used when PostgreSQL (SQL_HOST / SQL_DB_NAME) is not configured
const memUsers = new Map<string, DbUser>();
const memModels = new Map<string, Map<string, Project>>();
const memKeybinds = new Map<string, Record<string, string>>();

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName: string | null
): Promise<DbUser> {
  if (!hasSqlConfig) {
    let user = memUsers.get(uid);
    if (!user) {
      user = { id: uid, uid, email, displayName };
      memUsers.set(uid, user);
    } else {
      user.email = email || user.email;
      user.displayName = displayName ?? user.displayName;
    }
    return user;
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.uid, uid))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    return {
      id: row.id,
      uid: row.uid,
      email: row.email,
      displayName: row.displayName,
    };
  }

  const inserted = await db
    .insert(users)
    .values({
      id: uid,
      uid,
      email,
      displayName,
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email,
        displayName,
        updatedAt: new Date(),
      },
    })
    .returning();

  const created = inserted[0];
  if (!created) {
    return { id: uid, uid, email, displayName };
  }
  return {
    id: created.id,
    uid: created.uid,
    email: created.email,
    displayName: created.displayName,
  };
}

export async function listUserModels(userId: string): Promise<Project[]> {
  if (!hasSqlConfig) {
    const map = memModels.get(userId);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
    );
  }

  const rows = await db
    .select()
    .from(userModels)
    .where(eq(userModels.userId, userId))
    .orderBy(desc(userModels.updatedAt));

  return rows.map((row) => row.data);
}

export async function upsertUserModel(
  userId: string,
  project: Project
): Promise<Project> {
  const normalized: Project = {
    ...project,
    updatedAt: project.updatedAt || new Date().toISOString(),
  };

  if (!hasSqlConfig) {
    let map = memModels.get(userId);
    if (!map) {
      map = new Map();
      memModels.set(userId, map);
    }
    map.set(normalized.id, normalized);
    return normalized;
  }

  await db
    .insert(userModels)
    .values({
      userId,
      modelId: normalized.id,
      data: normalized,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userModels.userId, userModels.modelId],
      set: {
        data: normalized,
        updatedAt: new Date(),
      },
    });

  return normalized;
}

export async function deleteUserModel(
  userId: string,
  modelId: string
): Promise<void> {
  if (!hasSqlConfig) {
    memModels.get(userId)?.delete(modelId);
    return;
  }

  await db
    .delete(userModels)
    .where(and(eq(userModels.userId, userId), eq(userModels.modelId, modelId)));
}

export async function getUserKeybinds(
  userId: string
): Promise<Record<string, string> | null> {
  if (!hasSqlConfig) {
    return memKeybinds.get(userId) ?? null;
  }

  const rows = await db
    .select({ keybinds: users.keybinds })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0]?.keybinds ?? null;
}

export async function saveUserKeybinds(
  userId: string,
  keybinds: Record<string, string>
): Promise<Record<string, string>> {
  if (!hasSqlConfig) {
    memKeybinds.set(userId, keybinds);
    return keybinds;
  }

  await db
    .update(users)
    .set({
      keybinds,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return keybinds;
}
