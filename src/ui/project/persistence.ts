import { restoreProjectStore, type ProjectStore } from './store.js';

const STORAGE_KEY = 'local-video.editor-session';
const RECOVERY_BACKUP_KEY = 'local-video.editor-session.recovery-backup';
const SESSION_VERSION = 1;

interface PersistedSession {
  version: 1;
  project: unknown;
  catalogRevision: string;
  lastJobId: string | null;
  savedAt: string;
}

export interface RestoredSession {
  store: ProjectStore | null;
  lastJobId: string | null;
  warning: string | null;
}

export async function restoreSession(): Promise<RestoredSession | null> {
  const rawSession = localStorage.getItem(STORAGE_KEY);
  if (!rawSession) return null;
  const session = readSession();
  if (!session) {
    backupRawSession(rawSession);
    return {
      store: null,
      lastJobId: null,
      warning: 'La sesión anterior tenía un formato incompatible. Se conservó una copia de recuperación y se abrió el proyecto publicado.',
    };
  }
  try {
    const store = await restoreProjectStore(session.project, session.catalogRevision);
    return { store, lastJobId: session.lastJobId, warning: null };
  } catch {
    backupSession(session);
    return {
      store: null,
      lastJobId: session.lastJobId,
      warning: 'La sesión anterior no pudo restaurarse. Se conservó una copia de recuperación y se abrió el proyecto publicado.',
    };
  }
}

export function persistStore(store: ProjectStore): void {
  const previous = readSession();
  writeSession({
    version: SESSION_VERSION,
    project: store.project(),
    catalogRevision: store.catalogRevision(),
    lastJobId: previous?.lastJobId ?? null,
    savedAt: new Date().toISOString(),
  });
}

export function persistLastJobId(jobId: string | null): void {
  const session = readSession();
  if (!session) return;
  writeSession({ ...session, lastJobId: jobId, savedAt: new Date().toISOString() });
}

export function readLastJobId(): string | null {
  return readSession()?.lastJobId ?? null;
}

function readSession(): PersistedSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<PersistedSession> | null;
    if (
      parsed?.version !== SESSION_VERSION
      || !parsed.project
      || typeof parsed.catalogRevision !== 'string'
      || typeof parsed.savedAt !== 'string'
      || (parsed.lastJobId !== null && typeof parsed.lastJobId !== 'string')
    ) return null;
    return parsed as PersistedSession;
  } catch {
    return null;
  }
}

function writeSession(session: PersistedSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // La edición sigue funcionando aunque el navegador bloquee o llene localStorage.
  }
}

function backupSession(session: PersistedSession): void {
  backupRawSession(JSON.stringify(session));
}

function backupRawSession(session: string): void {
  try {
    localStorage.setItem(RECOVERY_BACKUP_KEY, session);
  } catch {
    // Si el almacenamiento está lleno, se conserva al menos la clave original.
  }
}
