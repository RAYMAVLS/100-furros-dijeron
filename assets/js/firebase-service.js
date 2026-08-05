import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  get,
  set,
  update,
  remove,
  serverTimestamp,
  onDisconnect
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { firebaseConfig } from "../../config/firebase-config.js";

const configured = Boolean(
  firebaseConfig?.apiKey &&
  !String(firebaseConfig.apiKey).includes("PEGA_AQUI") &&
  firebaseConfig?.databaseURL &&
  !String(firebaseConfig.databaseURL).includes("PEGA_AQUI")
);

let app = null;
let auth = null;
let database = null;

if (configured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  database = getDatabase(app);
}

export function isFirebaseConfigured() {
  return configured;
}

function requireFirebase() {
  if (!configured) {
    throw new Error("Firebase todavía no está configurado. Edita config/firebase-config.js.");
  }
}

export function watchAuth(callback) {
  requireFirebase();
  return onAuthStateChanged(auth, callback);
}

export async function ensureAnonymousUser() {
  requireFirebase();
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export async function hostLogin(email, password) {
  requireFirebase();
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  requireFirebase();
  return signOut(auth);
}

export async function checkAdmin(uid) {
  requireFirebase();
  const snapshot = await get(ref(database, `admins/${uid}`));
  return snapshot.val() === true;
}

export function watchRoom(roomCode, callback, errorCallback) {
  requireFirebase();
  return onValue(ref(database, `rooms/${roomCode}`), snapshot => {
    callback(snapshot.val());
  }, errorCallback);
}

export async function joinRoom(roomCode, name) {
  requireFirebase();
  const user = await ensureAnonymousUser();
  const roomSnapshot = await get(ref(database, `rooms/${roomCode}`));
  if (!roomSnapshot.exists()) {
    throw new Error("La sala todavía no ha sido creada por el organizador.");
  }
  const playerRef = ref(database, `rooms/${roomCode}/players/${user.uid}`);
  const current = await get(playerRef);
  if (roomSnapshot.val()?.meta?.registrationOpen === false && !current.exists()) {
    throw new Error("El registro de esta sala ya está cerrado.");
  }
  const previous = current.val() || {};
  await set(playerRef, {
    ...previous,
    name,
    joinedAt: previous.joinedAt || Date.now(),
    online: true,
    lastSeen: serverTimestamp(),
    captain: previous.captain || false,
    teamId: previous.teamId || null
  });
  await onDisconnect(playerRef).update({ online: false, lastSeen: serverTimestamp() });
  return user;
}

export async function updateOwnPlayer(roomCode, patch) {
  requireFirebase();
  const user = await ensureAnonymousUser();
  await update(ref(database, `rooms/${roomCode}/players/${user.uid}`), patch);
}

export async function submitPlayerRequest(roomCode, requestData) {
  requireFirebase();
  const user = await ensureAnonymousUser();
  await set(ref(database, `rooms/${roomCode}/requests/${user.uid}`), {
    ...requestData,
    createdAt: Date.now()
  });
}

export async function hostSetRoom(roomCode, value) {
  requireFirebase();
  await set(ref(database, `rooms/${roomCode}`), value);
}

export async function hostUpdateRoom(roomCode, patch) {
  requireFirebase();
  await update(ref(database, `rooms/${roomCode}`), patch);
}

export async function hostSetPath(roomCode, path, value) {
  requireFirebase();
  await set(ref(database, `rooms/${roomCode}/${path}`), value);
}

export async function hostUpdatePath(roomCode, path, patch) {
  requireFirebase();
  await update(ref(database, `rooms/${roomCode}/${path}`), patch);
}

export async function hostRemovePath(roomCode, path) {
  requireFirebase();
  await remove(ref(database, `rooms/${roomCode}/${path}`));
}

export function currentUser() {
  return auth?.currentUser || null;
}
