import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let firebaseConfig: { projectId?: string } | null = null;
try {
  const configPath = path.resolve(__dirname, '../../firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (err) {
  console.warn('[Plan Studio] Unable to read firebase-applet-config.json:', err);
}

let adminAuth: Auth | null = null;
try {
  if (!getApps().length && firebaseConfig?.projectId) {
    initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
  if (getApps().length) {
    adminAuth = getAuth();
  }
} catch (err) {
  console.warn('[Plan Studio] Firebase Admin unavailable in local mode:', err);
}

export { adminAuth };
