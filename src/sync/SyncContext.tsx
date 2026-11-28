import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getSupabase } from '../auth/supabaseClient';
import { devCloudStore, type SyncStore } from './store';
import { SyncManager, type SyncStatus } from './SyncManager';
import { supabaseStore } from './supabaseStore';

export interface SyncValue {
  /** 로그인하지 않았으면 null */
  status: SyncStatus | null;
  /** 기다리던 것까지 지금 올린다 */
  flush(): Promise<void>;
  /** 지금 한 번 맞춘다 (실패했을 때 "다시 시도") */
  retry(): void;
}

const SyncContext = createContext<SyncValue>({ status: null, flush: async () => {}, retry: () => {} });

/** 로그인한 동안 화실과 그림을 서버와 맞춘다. AuthProvider 안에 둔다. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user, mode } = useAuth();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const managerRef = useRef<SyncManager | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let store: SyncStore | null = null;
    const client = getSupabase();
    if (mode === 'supabase' && client) store = supabaseStore(client, userId);
    else if (mode === 'dev') store = devCloudStore(userId);
    if (!store) return;
    const manager = new SyncManager(store, userId, setStatus);
    managerRef.current = manager;
    void manager.start();
    return () => {
      manager.stop();
      if (managerRef.current === manager) managerRef.current = null;
      setStatus(null);
    };
  }, [userId, mode]);

  const flush = useCallback(async () => {
    await managerRef.current?.flush();
  }, []);
  const retry = useCallback(() => void managerRef.current?.syncNow(), []);
  const value = useMemo(() => ({ status, flush, retry }), [status, flush, retry]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  return useContext(SyncContext);
}

/** 화면에 보여 줄 저장 상태 */
export function describeSync(status: SyncStatus | null, now = Date.now()): string | null {
  if (!status) return null;
  if (status.state === 'syncing') return '저장하는 중…';
  if (status.state === 'error') return status.message;
  if (!status.lastSyncedAt) return '저장 준비 중';
  const seconds = Math.max(0, Math.round((now - status.lastSyncedAt) / 1000));
  if (seconds < 60) return '모두 저장됨 · 방금';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `모두 저장됨 · ${minutes}분 전` : '모두 저장됨';
}
