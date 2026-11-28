import { notifyLocalChange, type SyncKind } from './changes';
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

/** 지운 것의 기록. 다른 기기에서도 지워지도록 동기화가 서버에 알린다. */
export interface Tombstone {
  /** "종류:이름표" */
  id: string;
  kind: SyncKind;
  key: string;
  deletedAt: number;
}

/** 저장할 때 고를 수 있는 것 */
export interface WriteOptions {
  /** 동기화가 서버에서 받아 쓰는 중이면 true: 바뀌었다고 알리지 않는다 (다시 올리지 않게) */
  fromSync?: boolean;
}

const DB_NAME = 'metelier';
const DB_VERSION = 3;
const PAINTINGS = 'paintings';
const TOMBSTONES = 'tombstones';
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
      if (!db.objectStoreNames.contains(TOMBSTONES)) db.createObjectStore(TOMBSTONES, { keyPath: 'id' });
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

/** 바뀐 것을 알리고, 다시 살아난 것이면 지운 기록을 없앤다. */
async function changed(kind: SyncKind, key: string, options?: WriteOptions): Promise<void> {
  await run(TOMBSTONES, 'readwrite', (s) => s.delete(`${kind}:${key}`));
  if (!options?.fromSync) notifyLocalChange(kind, key);
}

/** 지운 것을 기록하고 알린다. */
async function removed(kind: SyncKind, key: string, options?: WriteOptions, deletedAt = Date.now()): Promise<void> {
  if (options?.fromSync) {
    await run(TOMBSTONES, 'readwrite', (s) => s.delete(`${kind}:${key}`));
    return;
  }
  const tombstone: Tombstone = { id: `${kind}:${key}`, kind, key, deletedAt };
  await run(TOMBSTONES, 'readwrite', (s) => s.put(tombstone));
  notifyLocalChange(kind, key);
}

export async function saveProgress(record: ProgressRecord, options?: WriteOptions): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.put(record));
  await changed('progress', record.paintingId, options);
}

export async function saveGalleryItem(item: GalleryItem, options?: WriteOptions): Promise<void> {
  await run(GALLERY, 'readwrite', (s) => s.put(item));
  await changed('gallery', item.paintingId, options);
}

export function listProgress(): Promise<ProgressRecord[]> {
  return run<ProgressRecord[]>(PROGRESS, 'readonly', (s) => s.getAll());
}

export async function deleteProgress(paintingId: string, options?: WriteOptions): Promise<void> {
  await run(PROGRESS, 'readwrite', (s) => s.delete(paintingId));
  await removed('progress', paintingId, options);
}

export async function deleteGalleryItem(paintingId: string, options?: WriteOptions): Promise<void> {
  await run(GALLERY, 'readwrite', (s) => s.delete(paintingId));
  await removed('gallery', paintingId, options);
}

export function loadGalleryItem(paintingId: string): Promise<GalleryItem | undefined> {
  return run<GalleryItem | undefined>(GALLERY, 'readonly', (s) => s.get(paintingId));
}

/** 최근에 완성한 작품부터. */
export async function listGallery(): Promise<GalleryItem[]> {
  const items = await run<GalleryItem[]>(GALLERY, 'readonly', (s) => s.getAll());
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveStoredPainting(painting: StoredPainting, options?: WriteOptions): Promise<void> {
  await run(PAINTINGS, 'readwrite', (s) => s.put(painting));
  await changed('painting', painting.id, options);
}

/** 사진 그림 전부 (그림 파일까지). 동기화가 쓴다. */
export function listStoredPaintingsFull(): Promise<StoredPainting[]> {
  return run<StoredPainting[]>(PAINTINGS, 'readonly', (s) => s.getAll());
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
export async function deleteStoredPainting(id: string, options?: WriteOptions): Promise<void> {
  const hadProgress = (await loadProgress(id)) !== undefined;
  await run(PAINTINGS, 'readwrite', (s) => s.delete(id));
  await removed('painting', id, options);
  if (hadProgress) await deleteProgress(id, options);
}

export function listTombstones(): Promise<Tombstone[]> {
  return run<Tombstone[]>(TOMBSTONES, 'readonly', (s) => s.getAll());
}

/** 서버도 지운 것을 알게 되면 기록을 없앤다. */
export async function forgetTombstone(kind: SyncKind, key: string): Promise<void> {
  await run(TOMBSTONES, 'readwrite', (s) => s.delete(`${kind}:${key}`));
}

/**
 * 이 브라우저에 저장한 그림을 모두 지운다 (칠하던 것, 작품집, 사진 그림, 지운 기록).
 * 다른 사람이 같은 브라우저에서 로그인할 때, 앞 사람의 그림이 섞여 올라가지 않게 한다.
 */
export async function clearLocalPaintings(): Promise<void> {
  for (const store of [PROGRESS, GALLERY, PAINTINGS, TOMBSTONES]) await run(store, 'readwrite', (s) => s.clear());
}
