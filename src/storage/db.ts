import type { PixelEncoding } from './pixelStore';

/** 칠하던 그림의 저장본. 그림마다 하나. */
export interface ProgressRecord {
  paintingId: string;
  width: number;
  height: number;
  data: Blob;
  encoding: PixelEncoding;
  completed: boolean;
  updatedAt: number;
}

/** 완성한 작품. 그림마다 하나이며, 완성 후 고쳐 칠하면 갱신된다. */
export interface GalleryItem {
  paintingId: string;
  title: string;
  image: Blob;
  updatedAt: number;
}

const DB_NAME = 'metelier';
const DB_VERSION = 1;
const PROGRESS = 'progress';
const GALLERY = 'gallery';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS, { keyPath: 'paintingId' });
      if (!db.objectStoreNames.contains(GALLERY)) db.createObjectStore(GALLERY, { keyPath: 'paintingId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = op(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function loadProgress(paintingId: string): Promise<ProgressRecord | undefined> {
  return run<ProgressRecord | undefined>(PROGRESS, 'readonly', (s) => s.get(paintingId));
}

export async function saveProgress(record: ProgressRecord): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(record));
}

export async function saveGalleryItem(item: GalleryItem): Promise<void> {
  await run(GALLERY, 'readwrite', (s) => s.put(item));
}

/** 최근에 완성한 작품부터. */
export async function listGallery(): Promise<GalleryItem[]> {
  const items = await run<GalleryItem[]>(GALLERY, 'readonly', (s) => s.getAll());
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}
