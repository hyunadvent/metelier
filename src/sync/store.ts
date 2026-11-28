import type { SyncKind } from '../storage/changes';
import type { RemoteEntry } from './plan';

/** 서버에 있는 것 하나: 목록에 실리는 정보와, 따로 받는 파일 */
export interface RemoteItem extends RemoteEntry {
  /** 작은 정보 (제목, 크기, 꾸밈 자체 등). 지운 것은 null */
  data: unknown;
}

/**
 * 로그인한 사람의 저장 공간. Supabase 와 개발용 가짜 클라우드가 같은 모양을 갖는다.
 * 큰 것(칠한 픽셀, 작품 이미지, 사진 그림 파일)은 파일로, 나머지는 목록의 data 로 둔다.
 */
export interface SyncStore {
  list(): Promise<RemoteItem[]>;
  /** 올린다. 파일이 있으면 파일을 먼저 올리고 목록을 고친다 (목록만 있고 파일이 없는 일이 없게). */
  put(item: { kind: SyncKind; key: string; updatedAt: number; data: unknown }, file: Blob | null): Promise<void>;
  /** 지웠다고 남기고 파일을 지운다 */
  markDeleted(kind: SyncKind, key: string, deletedAt: number): Promise<void>;
  fetchFile(kind: SyncKind, key: string): Promise<Blob>;
}

/**
 * 개발용 가짜 클라우드: 이 브라우저 안의 다른 저장소(IndexedDB "metelier-devcloud")에 둔다.
 * 어디에도 접속하지 않는다. Metelier 의 저장본을 지운 뒤 다시 받아 보면 "다른 기기" 를 흉내 낼 수 있다.
 */
export function devCloudStore(userId: string): SyncStore {
  const DB = 'metelier-devcloud';
  const STORE = 'items';
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () =>
    (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  type Row = RemoteItem & { id: string; owner: string; file: Blob | null };
  const tx = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const request = op(t.objectStore(STORE));
      t.oncomplete = () => resolve(request.result);
      t.onerror = () => reject(t.error);
    });
  };
  const rowId = (kind: SyncKind, key: string) => `${userId}/${kind}/${key}`;
  return {
    async list() {
      const rows = await tx<Row[]>('readonly', (s) => s.getAll());
      return rows.filter((r) => r.owner === userId).map(({ kind, key, updatedAt, deleted, data }) => ({ kind, key, updatedAt, deleted, data }));
    },
    async put(item, file) {
      const row: Row = { ...item, id: rowId(item.kind, item.key), owner: userId, deleted: false, file };
      await tx('readwrite', (s) => s.put(row));
    },
    async markDeleted(kind, key, deletedAt) {
      const row: Row = { id: rowId(kind, key), owner: userId, kind, key, updatedAt: deletedAt, deleted: true, data: null, file: null };
      await tx('readwrite', (s) => s.put(row));
    },
    async fetchFile(kind, key) {
      const row = await tx<Row | undefined>('readonly', (s) => s.get(rowId(kind, key)));
      if (!row?.file) throw new Error(`파일이 없습니다: ${kind}/${key}`);
      return row.file;
    },
  };
}
