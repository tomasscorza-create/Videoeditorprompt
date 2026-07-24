import { restoreProjectStore, type ProjectStore } from './store.js';

const STORAGE_KEY = 'local-video.editor-session';
const SESSION_VERSION = 1;

interface PersistedSession {
  version: 1;
  project: unknown;
  catalogRevision: string;
  lastJobId: string | null;
  savedAt: string;
}

export async function restoreSession(): Promise<{ store: ProjectStore; lastJobId: string | null } | null> {
  const session = readSession();
  if (!session) return null;
  try {
    const store = await restoreProjectStore(session.project, session.catalogRevision);
    return { store, lastJobId: session.lastJobId };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
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
