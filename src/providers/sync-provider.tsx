import { useSQLiteContext } from 'expo-sqlite';
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { onLocalChange } from '@/db/inventory';
import { clearLocalData, countPendingChanges, prepareLocalDataForUser, syncOnce } from '@/db/sync';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

/** Wait this long after a local edit before uploading, so quick successive edits go up together. */
const PUSH_DELAY_MS = 1000;

type SyncStatus = {
  state: 'idle' | 'syncing' | 'error';
  error: string | null;
  /** Local changes not uploaded yet. */
  pending: number;
  lastSyncedAt: number | null;
  /** Bumped whenever a sync changed local data; screens reload when it changes. */
  dataVersion: number;
};

type SyncContextValue = SyncStatus & {
  syncNow: () => Promise<void>;
  /** Tries a final sync and returns how many changes would be lost by signing out now. */
  prepareSignOut: () => Promise<number>;
  /** Clears this device's copy of the data and signs out. */
  signOut: () => Promise<void>;
};

const initialStatus: SyncStatus = { state: 'idle', error: null, pending: 0, lastSyncedAt: null, dataVersion: 0 };

const SyncContext = createContext<SyncContextValue>({
  ...initialStatus,
  syncNow: async () => {},
  prepareSignOut: async () => 0,
  signOut: async () => {},
});

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [status, setStatus] = useState<SyncStatus>(initialStatus);
  const running = useRef<Promise<void> | null>(null);
  const runAgain = useRef(false);
  const preparedFor = useRef<string | null>(null);

  const syncNow = useCallback(async () => {
    if (!userId) return;
    if (running.current) {
      // A sync is in flight; run once more afterwards to pick up newer edits.
      runAgain.current = true;
      return running.current;
    }
    const task = (async () => {
      do {
        runAgain.current = false;
        setStatus((s) => ({ ...s, state: 'syncing' }));
        try {
          let reset = false;
          if (preparedFor.current !== userId) {
            await prepareLocalDataForUser(db, userId);
            preparedFor.current = userId;
            reset = true;
          }
          const { pulled } = await syncOnce(db, supabase);
          const pending = await countPendingChanges(db);
          setStatus((s) => ({
            state: 'idle',
            error: null,
            pending,
            lastSyncedAt: Date.now(),
            dataVersion: reset || pulled > 0 ? s.dataVersion + 1 : s.dataVersion,
          }));
        } catch (e) {
          const pending = await countPendingChanges(db);
          const error = e instanceof Error ? e.message : String(e);
          setStatus((s) => ({ ...s, state: 'error', error, pending }));
          runAgain.current = false; // don't hammer a failing connection; next edit/foreground retries
        }
      } while (runAgain.current);
    })();
    running.current = task;
    try {
      await task;
    } finally {
      running.current = null;
    }
  }, [db, userId]);

  // Sync on sign-in, whenever the app returns to the foreground, and shortly after local edits.
  useEffect(() => {
    if (!userId) return;
    syncNow();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribeChanges = onLocalChange(() => {
      countPendingChanges(db).then((pending) => setStatus((s) => ({ ...s, pending })));
      clearTimeout(timer);
      timer = setTimeout(syncNow, PUSH_DELAY_MS);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncNow();
    });

    return () => {
      clearTimeout(timer);
      unsubscribeChanges();
      appState.remove();
    };
  }, [db, userId, syncNow]);

  const prepareSignOut = useCallback(async () => {
    await syncNow();
    return countPendingChanges(db);
  }, [db, syncNow]);

  const signOut = useCallback(async () => {
    await clearLocalData(db);
    preparedFor.current = null;
    setStatus(initialStatus);
    // 'local' only ends this device's session (and works offline).
    await supabase.auth.signOut({ scope: 'local' });
  }, [db]);

  return <SyncContext value={{ ...status, syncNow, prepareSignOut, signOut }}>{children}</SyncContext>;
}

export function useSync() {
  return use(SyncContext);
}
