import { decorUpdatedAt, loadDecor, normalizeDecor, resetDecor, saveDecor } from '../atelier3d/decor';
import { notifyRemoteApplied, onLocalChange, type SyncKind } from '../storage/changes';
import {
  clearLocalPaintings,
  deleteGalleryItem,
  deleteProgress,
  deleteStoredPainting,
  forgetTombstone,
  listGallery,
  listProgress,
  listStoredPaintingsFull,
  listTombstones,
  loadGalleryItem,
  loadProgress,
  loadStoredPainting,
  saveGalleryItem,
  saveProgress,
  saveStoredPainting,
  type StoredPainting,
} from '../storage/db';
import type { PixelEncoding } from '../storage/pixelStore';
import { planSync, type LocalEntry, type SyncAction } from './plan';
import type { RemoteItem, SyncStore } from './store';

export type SyncStatus =
  | { state: 'idle'; lastSyncedAt: number | null }
  | { state: 'syncing'; lastSyncedAt: number | null }
  | { state: 'error'; lastSyncedAt: number | null; message: string };

/** 이 브라우저의 저장본이 누구의 것인지 (마지막으로 동기화한 사람의 ID) */
const OWNER_KEY = 'metelier.syncOwner';
/** 바뀐 뒤 이만큼 기다렸다가 올린다: 칠하는 동안 자꾸 올리지 않게 */
const PUSH_DELAY_MS = 2500;
/** 실패하면 이만큼 뒤에 다시 해 본다 */
const RETRY_MS = 30_000;

/** 사진 그림의 파일 부분 (서버에는 JSON 파일 하나로 둔다) */
type PaintingFiles = Pick<StoredPainting, 'regions' | 'lines' | 'reference' | 'thumbnail'>;

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // 저장할 수 없으면 다음에 다시 확인한다.
  }
}

/**
 * 로그인한 사람의 화실과 그림을 서버와 맞춘다.
 * - 로그인하면 한 번 맞추고, 그 뒤로는 이 브라우저에서 바뀔 때마다(조금 기다렸다가), 창으로 돌아올 때마다 맞춘다.
 * - 처음 로그인하면 로그인 전에 이 브라우저에서 하던 것도 그 사람의 것으로 올린다.
 * - 이 브라우저에 다른 사람의 것이 있으면 (같은 PC 를 함께 쓰는 경우) 먼저 비우고 받는다.
 */
export class SyncManager {
  private status: SyncStatus = { state: 'idle', lastSyncedAt: null };
  private running: Promise<void> | null = null;
  private again = false;
  private timer = 0;
  private stopped = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly store: SyncStore,
    private readonly userId: string,
    private readonly onStatus: (status: SyncStatus) => void,
  ) {}

  async start(): Promise<void> {
    const owner = readOwner();
    if (owner && owner !== this.userId) {
      await clearLocalPaintings();
      resetDecor();
      notifyRemoteApplied(new Set<SyncKind>(['decor', 'progress', 'gallery', 'painting']));
    }
    writeOwner(this.userId);
    this.cleanups.push(onLocalChange(() => this.schedule(PUSH_DELAY_MS)));
    const onFocus = () => document.visibilityState === 'visible' && this.schedule(0);
    const onOnline = () => this.schedule(0);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', onOnline);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onFocus));
    this.cleanups.push(() => window.removeEventListener('online', onOnline));
    await this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.cleanups.forEach((c) => c());
  }

  /** 기다리던 것까지 지금 올린다 (로그아웃하기 전에) */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    await this.syncNow();
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.syncNow(), delay);
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.onStatus(status);
  }

  /** 한 번에 하나만 돈다. 도는 중에 또 부르면 끝난 뒤 한 번 더 돈다. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<void> {
    if (this.stopped) return;
    this.setStatus({ state: 'syncing', lastSyncedAt: this.status.lastSyncedAt });
    try {
      const [remote, local, tombstones] = await Promise.all([this.store.list(), this.localEntries(), listTombstones()]);
      const byId = new Map(remote.map((r) => [`${r.kind}:${r.key}`, r]));
      const applied = new Set<SyncKind>();
      for (const action of planSync(local, tombstones, remote)) {
        if (this.stopped) return;
        await this.apply(action, byId.get(`${action.kind}:${action.key}`), applied);
      }
      notifyRemoteApplied(applied);
      this.setStatus({ state: 'idle', lastSyncedAt: Date.now() });
    } catch (e) {
      console.warn('동기화하지 못했습니다.', e);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.setStatus({
        state: 'error',
        lastSyncedAt: this.status.lastSyncedAt,
        message: offline ? '인터넷에 연결되어 있지 않아요' : '저장하지 못했어요. 잠시 뒤 다시 해 볼게요',
      });
      this.schedule(RETRY_MS);
    }
  }

  /** 이 브라우저에 있는 것들과 그 바뀐 때 */
  private async localEntries(): Promise<LocalEntry[]> {
    const [progress, gallery, paintings] = await Promise.all([listProgress(), listGallery(), listStoredPaintingsFull()]);
    const entries: LocalEntry[] = [];
    const decorTime = decorUpdatedAt();
    if (decorTime > 0) entries.push({ kind: 'decor', key: 'main', updatedAt: decorTime });
    progress.forEach((p) => entries.push({ kind: 'progress', key: p.paintingId, updatedAt: p.updatedAt }));
    gallery.forEach((g) => entries.push({ kind: 'gallery', key: g.paintingId, updatedAt: g.updatedAt }));
    paintings.forEach((p) => entries.push({ kind: 'painting', key: p.id, updatedAt: p.createdAt }));
    return entries;
  }

  private async apply(action: SyncAction, remote: RemoteItem | undefined, applied: Set<SyncKind>): Promise<void> {
    const { kind, key } = action;
    switch (action.type) {
      case 'upload':
        await this.upload(kind, key);
        return;
      case 'download':
        if (remote) {
          await this.download(remote);
          applied.add(kind);
        }
        return;
      case 'delete-local':
        await this.deleteLocal(kind, key);
        applied.add(kind);
        return;
      case 'delete-remote':
        await this.store.markDeleted(kind, key, action.deletedAt);
        await forgetTombstone(kind, key);
        return;
      case 'forget-tombstone':
        await forgetTombstone(kind, key);
        return;
    }
  }

  private async upload(kind: SyncKind, key: string): Promise<void> {
    switch (kind) {
      case 'decor':
        await this.store.put({ kind, key, updatedAt: decorUpdatedAt(), data: loadDecor() }, null);
        return;
      case 'progress': {
        const p = await loadProgress(key);
        if (!p) return;
        await this.store.put(
          { kind, key, updatedAt: p.updatedAt, data: { width: p.width, height: p.height, encoding: p.encoding, completed: p.completed } },
          p.data,
        );
        return;
      }
      case 'gallery': {
        const g = await loadGalleryItem(key);
        if (!g) return;
        await this.store.put({ kind, key, updatedAt: g.updatedAt, data: { title: g.title } }, g.image);
        return;
      }
      case 'painting': {
        const p = await loadStoredPainting(key);
        if (!p) return;
        const files: PaintingFiles = { regions: p.regions, lines: p.lines, reference: p.reference, thumbnail: p.thumbnail };
        await this.store.put(
          { kind, key, updatedAt: p.createdAt, data: { title: p.title, createdAt: p.createdAt, meta: p.meta } },
          new Blob([JSON.stringify(files)], { type: 'application/json' }),
        );
        return;
      }
    }
  }

  private async download(remote: RemoteItem): Promise<void> {
    const { kind, key, updatedAt } = remote;
    const data = (remote.data ?? {}) as Record<string, unknown>;
    switch (kind) {
      case 'decor':
        saveDecor(normalizeDecor(remote.data), { updatedAt });
        return;
      case 'progress': {
        const file = await this.store.fetchFile(kind, key);
        await saveProgress(
          {
            paintingId: key,
            width: Number(data.width),
            height: Number(data.height),
            encoding: (data.encoding === 'raw' ? 'raw' : 'gzip') as PixelEncoding,
            completed: data.completed === true,
            data: file,
            updatedAt,
          },
          { fromSync: true },
        );
        return;
      }
      case 'gallery': {
        const file = await this.store.fetchFile(kind, key);
        await saveGalleryItem({ paintingId: key, title: String(data.title ?? ''), image: file, updatedAt }, { fromSync: true });
        return;
      }
      case 'painting': {
        const file = await this.store.fetchFile(kind, key);
        const files = JSON.parse(await file.text()) as PaintingFiles;
        await saveStoredPainting(
          { id: key, title: String(data.title ?? ''), createdAt: updatedAt, meta: data.meta, ...files },
          { fromSync: true },
        );
        return;
      }
    }
  }

  private async deleteLocal(kind: SyncKind, key: string): Promise<void> {
    switch (kind) {
      case 'decor':
        resetDecor();
        return;
      case 'progress':
        await deleteProgress(key, { fromSync: true });
        return;
      case 'gallery':
        await deleteGalleryItem(key, { fromSync: true });
        return;
      case 'painting':
        await deleteStoredPainting(key, { fromSync: true });
        return;
    }
  }
}
