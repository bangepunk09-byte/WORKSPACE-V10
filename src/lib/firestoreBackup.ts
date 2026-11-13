import { initializeApp, getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const firebaseAuth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo: {
      providerId: string | null;
      displayName?: string | null;
      email: string | null;
      photoUrl?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export function subscribeFirebaseAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(firebaseAuth, callback);
}

function sanitizeFirestoreValue(val: unknown): unknown {
  if (val === undefined) return null;
  if (val === null) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val === 'string' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeFirestoreValue(item));
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = sanitizeFirestoreValue(v);
    }
    return out;
  }
  return String(val);
}

type ChunkSection =
  | 'core'
  | 'users'
  | 'tasks'
  | 'conversations'
  | 'messages'
  | 'posts'
  | 'extra'
  | 'uploads';

interface PreparedChunk {
  chunkId: string;
  section: ChunkSection;
  chunkIndex: number;
  payload: Record<string, unknown>;
}

function splitArrayIntoChunks(
  section: ChunkSection,
  key: string,
  items: unknown[],
  maxBytesPerChunk = 450000,
  maxItemsPerChunk = 80
): PreparedChunk[] {
  const cleanItems = Array.isArray(items)
    ? (sanitizeFirestoreValue(items) as unknown[])
    : [];
  if (cleanItems.length === 0) return [];

  const chunks: PreparedChunk[] = [];
  let bucket: unknown[] = [];
  let bucketBytes = 0;

  for (const item of cleanItems) {
    const approxBytes = JSON.stringify(item).length;
    if (
      bucket.length > 0 &&
      (bucket.length >= maxItemsPerChunk || bucketBytes + approxBytes > maxBytesPerChunk)
    ) {
      const idx = chunks.length;
      chunks.push({
        chunkId: `${section}_${key}_${idx}`,
        section,
        chunkIndex: idx,
        payload: { key, records: bucket },
      });
      bucket = [];
      bucketBytes = 0;
    }
    bucket.push(item);
    bucketBytes += approxBytes;
  }

  if (bucket.length > 0) {
    const idx = chunks.length;
    chunks.push({
      chunkId: `${section}_${key}_${idx}`,
      section,
      chunkIndex: idx,
      payload: { key, records: bucket },
    });
  }

  return chunks;
}

function buildChunksFromBackup(backupPayload: any): PreparedChunk[] {
  const data = backupPayload?.data || {};
  const chunks: PreparedChunk[] = [];

  chunks.push({
    chunkId: 'core_0',
    section: 'core',
    chunkIndex: 0,
    payload: sanitizeFirestoreValue({
      workspace: data.workspace || {},
      labels: data.labels || [],
      boards: data.boards || [],
      org_units: data.org_units || [],
      drive_shortcuts: data.drive_shortcuts || [],
      prefs: data.prefs || {},
      sticker_packs: data.sticker_packs || [],
      stickers: data.stickers || [],
      files: data.files || {},
    }) as Record<string, unknown>,
  });

  chunks.push(...splitArrayIntoChunks('users', 'users', data.users || []));
  chunks.push(...splitArrayIntoChunks('users', 'access_requests', data.access_requests || []));
  chunks.push(...splitArrayIntoChunks('users', 'invitations', data.invitations || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'tasks', data.tasks || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'projects', data.projects || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'reminders', data.reminders || []));
  chunks.push(...splitArrayIntoChunks('tasks', 'task_automations', data.task_automations || []));
  chunks.push(...splitArrayIntoChunks('conversations', 'conversations', data.conversations || []));
  chunks.push(...splitArrayIntoChunks('conversations', 'groups', data.groups || []));
  chunks.push(...splitArrayIntoChunks('conversations', 'polls', data.polls || []));
  chunks.push(...splitArrayIntoChunks('messages', 'messages', data.messages || []));
  chunks.push(...splitArrayIntoChunks('posts', 'posts', data.posts || []));
  chunks.push(
    ...splitArrayIntoChunks('extra', 'notifications', data.notifications || []),
    ...splitArrayIntoChunks('extra', 'activity', data.activity || []),
    ...splitArrayIntoChunks('extra', 'audit_logs', data.audit_logs || []),
    ...splitArrayIntoChunks('extra', 'meetings', data.meetings || [])
  );

  // Split uploaded base64 files safely (< 450 KB per chunk)
  const uploadsObj = backupPayload?.uploaded_files_base64 || {};
  const uploadEntries = Object.entries(uploadsObj);
  let uploadBucket: Record<string, string> = {};
  let uploadBytes = 0;
  let uploadIdx = 0;
  for (const [fname, b64] of uploadEntries) {
    if (typeof b64 !== 'string') continue;
    if (b64.length > 500000) continue; // skip single file >500KB in Firestore snapshot to protect 1MB doc limit
    if (uploadBytes > 0 && uploadBytes + b64.length > 450000) {
      chunks.push({
        chunkId: `uploads_${uploadIdx}`,
        section: 'uploads',
        chunkIndex: uploadIdx,
        payload: { uploaded_files_base64: uploadBucket },
      });
      uploadIdx += 1;
      uploadBucket = {};
      uploadBytes = 0;
    }
    uploadBucket[fname] = b64;
    uploadBytes += b64.length;
  }
  if (Object.keys(uploadBucket).length > 0) {
    chunks.push({
      chunkId: `uploads_${uploadIdx}`,
      section: 'uploads',
      chunkIndex: uploadIdx,
      payload: { uploaded_files_base64: uploadBucket },
    });
  }

  return chunks;
}

export async function saveBackupToFirestore(backupPayload: any, customLabel?: string) {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Silakan hubungkan akun Google (Firebase Auth) terlebih dahulu untuk menyimpan ke Cloud.');
  }

  const backupId = `bk_${Date.now()}`;
  const chunks = buildChunksFromBackup(backupPayload);
  const summary = (sanitizeFirestoreValue(backupPayload?.summary || {}) || {}) as Record<string, unknown>;
  const label = (customLabel || `Backup ${new Date().toLocaleString('id-ID')}`).slice(0, 120);
  const workspaceName = String(backupPayload?.workspace_name || 'CIRCLE Workspace').slice(0, 120);

  const backupDocPath = `workspaceBackups/${backupId}`;
  try {
    await setDoc(doc(firestoreDb, 'workspaceBackups', backupId), {
      id: backupId,
      ownerUid: user.uid,
      ownerEmail: (user.email || 'admin@asliri.id').slice(0, 200),
      workspaceName,
      label,
      version: 2,
      chunkCount: chunks.length,
      summary,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, backupDocPath);
  }

  // Write chunks in batches of 200
  for (let i = 0; i < chunks.length; i += 200) {
    const batch = writeBatch(firestoreDb);
    const slice = chunks.slice(i, i + 200);
    for (const chunk of slice) {
      const chunkRef = doc(firestoreDb, 'workspaceBackups', backupId, 'chunks', chunk.chunkId);
      batch.set(chunkRef, {
        backupId,
        ownerUid: user.uid,
        section: chunk.section,
        chunkIndex: chunk.chunkIndex,
        payload: chunk.payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `workspaceBackups/${backupId}/chunks`);
    }
  }

  return { id: backupId, label, chunkCount: chunks.length, summary };
}

export interface CloudBackupRecord {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  workspaceName: string;
  label: string;
  version: number;
  chunkCount: number;
  summary: Record<string, number>;
  createdAtIso: string;
}

export async function listFirestoreBackups(): Promise<CloudBackupRecord[]> {
  const user = firebaseAuth.currentUser;
  if (!user) return [];

  const path = 'workspaceBackups';
  try {
    const isBootstrappedAdmin = user.email === 'bangepunk09@gmail.com' && user.emailVerified;
    const q = isBootstrappedAdmin
      ? query(collection(firestoreDb, 'workspaceBackups'))
      : query(collection(firestoreDb, 'workspaceBackups'), where('ownerUid', '==', user.uid));

    const snap = await getDocs(q);
    const rows: CloudBackupRecord[] = snap.docs.map((d) => {
      const data = d.data() || {};
      const ts = data.createdAt;
      let createdAtIso = new Date().toISOString();
      if (ts instanceof Timestamp) {
        createdAtIso = ts.toDate().toISOString();
      } else if (ts && typeof ts.toDate === 'function') {
        createdAtIso = ts.toDate().toISOString();
      } else if (typeof ts === 'string') {
        createdAtIso = ts;
      }
      return {
        id: d.id,
        ownerUid: String(data.ownerUid || ''),
        ownerEmail: String(data.ownerEmail || ''),
        workspaceName: String(data.workspaceName || 'CIRCLE Workspace'),
        label: String(data.label || d.id),
        version: Number(data.version || 2),
        chunkCount: Number(data.chunkCount || 0),
        summary: (data.summary || {}) as Record<string, number>,
        createdAtIso,
      };
    });
    rows.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function loadBackupFromFirestore(backupId: string) {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Silakan hubungkan akun Google terlebih dahulu.');
  }

  let headerData: any = null;
  const headerPath = `workspaceBackups/${backupId}`;
  try {
    const headerSnap = await getDoc(doc(firestoreDb, 'workspaceBackups', backupId));
    if (!headerSnap.exists()) {
      throw new Error('Snapshot cloud tidak ditemukan.');
    }
    headerData = headerSnap.data();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, headerPath);
  }

  const chunksPath = `workspaceBackups/${backupId}/chunks`;
  let chunkDocs: any[] = [];
  try {
    const isBootstrappedAdmin = user.email === 'bangepunk09@gmail.com' && user.emailVerified;
    const chunksQuery = isBootstrappedAdmin
      ? query(collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'))
      : query(
          collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'),
          where('ownerUid', '==', headerData.ownerUid || user.uid)
        );
    const snap = await getDocs(chunksQuery);
    chunkDocs = snap.docs
      .map((d): Record<string, any> => ({ id: d.id, ...(d.data() as Record<string, any>) }))
      .sort((a, b) => Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, chunksPath);
  }

  const reconstructedData: Record<string, any> = {
    workspace: {},
    users: [],
    labels: [],
    notifications: [],
    tasks: [],
    projects: [],
    boards: [],
    conversations: [],
    groups: [],
    messages: [],
    posts: [],
    org_units: [],
    activity: [],
    reminders: [],
    polls: [],
    task_automations: [],
    audit_logs: [],
    invitations: [],
    drive_shortcuts: [],
    prefs: {},
    access_requests: [],
    sticker_packs: [],
    stickers: [],
    files: {},
    meetings: [],
  };
  const uploadedFilesBase64: Record<string, string> = {};

  for (const ch of chunkDocs) {
    const payload = ch.payload || {};
    if (ch.section === 'core') {
      Object.assign(reconstructedData, payload);
    } else if (ch.section === 'uploads' && payload.uploaded_files_base64) {
      Object.assign(uploadedFilesBase64, payload.uploaded_files_base64);
    } else if (payload.key && Array.isArray(payload.records)) {
      if (!Array.isArray(reconstructedData[payload.key])) {
        reconstructedData[payload.key] = [];
      }
      reconstructedData[payload.key].push(...payload.records);
    }
  }

  return {
    app: 'CIRCLE Workspace',
    version: headerData.version || 2,
    workspace_name: headerData.workspaceName || 'CIRCLE Workspace',
    summary: headerData.summary || {},
    data: reconstructedData,
    uploaded_files_base64: uploadedFilesBase64,
  };
}

export async function deleteFirestoreBackup(backupId: string) {
  const user = firebaseAuth.currentUser;
  if (!user) return;
  const chunksPath = `workspaceBackups/${backupId}/chunks`;
  try {
    const isBootstrappedAdmin = user.email === 'bangepunk09@gmail.com' && user.emailVerified;
    const chunksQuery = isBootstrappedAdmin
      ? query(collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'))
      : query(
          collection(firestoreDb, 'workspaceBackups', backupId, 'chunks'),
          where('ownerUid', '==', user.uid)
        );
    const snap = await getDocs(chunksQuery);
    for (let i = 0; i < snap.docs.length; i += 200) {
      const batch = writeBatch(firestoreDb);
      snap.docs.slice(i, i + 200).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, chunksPath);
  }

  try {
    await deleteDoc(doc(firestoreDb, 'workspaceBackups', backupId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workspaceBackups/${backupId}`);
  }
}
