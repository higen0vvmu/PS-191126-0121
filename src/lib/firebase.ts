import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

let auth: Auth | null = null;
let googleAuthProvider: GoogleAuthProvider | null = null;

try {
  if (firebaseConfig?.apiKey && firebaseConfig?.projectId) {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleAuthProvider = new GoogleAuthProvider();
  }
} catch (err) {
  console.warn('[Plan Studio] Firebase client unavailable in local/offline mode:', err);
}

export { auth, googleAuthProvider };
