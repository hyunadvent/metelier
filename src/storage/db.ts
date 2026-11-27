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

/**
 * 사진으로 만든 색칠 그림. 서버가 없으므로 그림 패키지를 통째로 이 브라우저에 둔다.
 * 이미지는 data URL 문자열이다 (게임이 주소로 바로 읽을 수 있다).
 */
export interface StoredPainting {
  id: string;
  title: string;
  createdAt: number;
  /** meta.json 의 내용 */
  meta: unknown;
  regions: string;
  lines: string;
  reference: string;
  /** 고르는 창에 보여 줄 작은 완성 모습 */
  thumbnail: string;
}

/** 고르는 창에 필요한 것만 */
export type StoredPaintingSummary = Pick<StoredPainting, 'id' | 'title' | 'createdAt' | 'thumbnail'>;

const DB_NAME = 'metelier';
const DB_VERSION = 2;
const PAINTINGS = 'paintings';
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
      if (!db.objectStoreNames.contains(PAINTINGS)) db.createObjectStore(PAINTINGS, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      // 다른 탭이 새 판으로 올리려 하면 길을 비켜 준다
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = null;
      };
      resolve(request.result);
    };
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

export function loadGalleryItem(paintingId: string): Promise<GalleryItem | undefined> {
  return run<GalleryItem | undefined>(GALLERY, 'readonly', (s) => s.get(paintingId));
}

/** 최근에 완성한 작품부터. */
export async function listGallery(): Promise<GalleryItem[]> {
  const items = await run<GalleryItem[]>(GALLERY, 'readonly', (s) => s.getAll());
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveStoredPainting(painting: StoredPainting): Promise<void> {
  await run(PAINTINGS, 'readwrite', (s) => s.put(painting));
}

export function loadStoredPainting(id: string): Promise<StoredPainting | undefined> {
  return run<StoredPainting | undefined>(PAINTINGS, 'readonly', (s) => s.get(id));
}

/** 최근에 만든 그림부터. */
export async function listStoredPaintings(): Promise<StoredPaintingSummary[]> {
  const items = await run<StoredPainting[]>(PAINTINGS, 'readonly', (s) => s.getAll());
  return items
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ id, title, createdAt, thumbnail }) => ({ id, title, createdAt, thumbnail }));
}

/** 그림과 그 그림을 칠하던 저장본을 지운다. 완성해서 작품집에 넣은 것은 남긴다. */
export async function deleteStoredPainting(id: string): Promise<void> {
  await run(PAINTINGS, 'readwrite', (s) => s.delete(id));
  await run(PROGRESS, 'readwrite', (s) => s.delete(id));
}
