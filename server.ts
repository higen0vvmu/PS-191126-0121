import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  deleteUserModel,
  getOrCreateUser,
  getUserKeybinds,
  listUserModels,
  saveUserKeybinds,
  upsertUserModel,
} from './src/db/models.ts';
import type { Project } from './src/types/plan.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/models', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const displayName = typeof req.user!.name === 'string' ? req.user!.name : null;
    const user = await getOrCreateUser(uid, email, displayName);
    const [models, keybinds] = await Promise.all([
      listUserModels(user.id),
      getUserKeybinds(user.id),
    ]);
    res.json({ models, keybinds });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load models';
    res.status(500).json({ error: msg });
  }
});

app.put('/api/models/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const displayName = typeof req.user!.name === 'string' ? req.user!.name : null;
    const user = await getOrCreateUser(uid, email, displayName);
    const body = req.body as { project?: Project };
    if (!body?.project || !Array.isArray(body.project.levels)) {
      return res.status(400).json({ error: 'Invalid model payload' });
    }
    const model = await upsertUserModel(user.id, {
      ...body.project,
      id: req.params.id,
    });
    res.json({ model });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to save model';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/models/batch', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const displayName = typeof req.user!.name === 'string' ? req.user!.name : null;
    const user = await getOrCreateUser(uid, email, displayName);
    const body = req.body as { models?: Project[] };
    if (!Array.isArray(body?.models)) {
      return res.status(400).json({ error: 'Invalid batch payload' });
    }
    const saved: Project[] = [];
    for (const proj of body.models) {
      if (proj && proj.id && Array.isArray(proj.levels) && proj.levels.length > 0) {
        saved.push(await upsertUserModel(user.id, proj));
      }
    }
    res.json({ models: saved });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to sync models';
    res.status(500).json({ error: msg });
  }
});

app.delete('/api/models/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const displayName = typeof req.user!.name === 'string' ? req.user!.name : null;
    const user = await getOrCreateUser(uid, email, displayName);
    await deleteUserModel(user.id, req.params.id);
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete model';
    res.status(500).json({ error: msg });
  }
});

app.put('/api/user/keybinds', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const displayName = typeof req.user!.name === 'string' ? req.user!.name : null;
    const user = await getOrCreateUser(uid, email, displayName);
    const body = req.body as { keybinds?: Record<string, string> };
    if (!body?.keybinds || typeof body.keybinds !== 'object') {
      return res.status(400).json({ error: 'Invalid keybinds payload' });
    }
    const saved = await saveUserKeybinds(user.id, body.keybinds);
    res.json({ keybinds: saved });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to save keybinds';
    res.status(500).json({ error: msg });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Plan Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
