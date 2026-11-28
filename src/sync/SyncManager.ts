import { decorUpdatedAt, loadDecor, loadDecorStamps, normalizeDecor, resetDecor, saveDecor } from '../atelier3d/decor';
import { mergeDecor, normalizeStamps, sameStampedDecor, type StampedDecor } from '../atelier3d/decorMerge';
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
import { orderActions, planSync, type LocalEntry, type SyncAction } from './plan';
import type { RemoteItem, SyncStore } from './store';

export type SyncStatus =
  | { state: 'idle'; lastSyncedAt: number | null }
  /** downloading: 서버에서 받을 것이 있어 받는 중 (화면에 "불러오는 중" 을 보여 준다) */
  | { state: 'syncing'; lastSyncedAt: number | null; downloading?: number }
  | { state: 'error'; lastSyncedAt: number | null; message: string };

/** 이 브라우저의 저장본이 누구의 것인지 (마지막으로 동기화한 사람의 ID) */
const OWNER_KEY = 'metelier.syncOwner';
/** 바뀐 뒤 이만큼 기다렸다가 올린다: 칠하는 동안 자꾸 올리지 않게 */
const PUSH_DELAY_MS = 2500;
/** 실패하면 이만큼 뒤에 다시 해 본다 */
const RETRY_MS = 30_000;
/** 한 번에 같이 받는 파일 수 */
const PARALLEL_DOWNLOADS = 4;

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
    if (this.stopped) return;
    const owner = readOwner();
    if (owner && owner !== this.userId) {
      await clearLocalPaintings();
      resetDecor();
      notifyRemoteApplied(new Set<SyncKind>(['decor', 'progress', 'gallery', 'painting']));
    }
    if (this.stopped) return;
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
      const [all, local, tombstones] = await Promise.all([this.store.list(), this.localEntries(), listTombstones()]);
      // 기다리는 동안 멈췄으면 (로그아웃, 화면을 다시 띄움) 받은 것을 쓰지 않는다
      if (this.stopped) return;
      const applied = new Set<SyncKind>();
      // 꾸밈은 한 덩어리로 "나중 것이 이긴다" 가 아니라 조각마다 합친다
      if (await this.syncDecor(all.find((r) => r.kind === 'decor' && r.key === 'main'))) applied.add('decor');
      const remote = all.filter((r) => r.kind !== 'decor');
      const byId = new Map(remote.map((r) => [`${r.kind}:${r.key}`, r]));
      const { downloads, rest } = orderActions(planSync(local.filter((e) => e.kind !== 'decor'), tombstones, remote));
      // 받기: 화면에 보이는 것부터, 몇 개씩 동시에
      if (downloads.length > 0) this.setStatus({ state: 'syncing', lastSyncedAt: this.status.lastSyncedAt, downloading: downloads.length });
      let next = 0;
      const worker = async () => {
        while (next < downloads.length && !this.stopped) {
          const action = downloads[next++];
          await this.apply(action, byId.get(`${action.kind}:${action.key}`), applied);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, downloads.length) }, worker));
      for (const action of rest) {
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

  /**
   * 꾸밈을 서버와 합친다. 조각(화분 자리, 액자 자리, 벽 그림 하나하나)마다 나중에 바꾼 쪽을 따른다.
   * @returns 이 브라우저의 꾸밈이 바뀌었으면 true
   */
  private async syncDecor(remote: RemoteItem | undefined): Promise<boolean> {
    const localTime = decorUpdatedAt();
    const local: StampedDecor = { decor: loadDecor(), stamps: loadDecorStamps() };
    const server: StampedDecor | null =
      remote && !remote.deleted ? { decor: normalizeDecor(remote.data), stamps: normalizeStamps((remote.data as { stamps?: unknown } | null)?.stamps) } : null;
    if (!server) {
      // 서버에 없으면 이 브라우저에서 꾸민 것을 올린다
      if (localTime > 0) await this.store.put({ kind: 'decor', key: 'main', updatedAt: localTime, data: { ...local.decor, stamps: local.stamps } }, null);
      return false;
    }
    if (localTime === 0) {
      // 이 브라우저에서는 꾸민 적이 없다: 서버의 것을 그대로 쓴다
      saveDecor(server.decor, { updatedAt: remote!.updatedAt, stamps: server.stamps });
      return true;
    }
    if (localTime === remote!.updatedAt) return false;
    // 기록이 없는 조각은 나중에 저장한 쪽을 따른다
    const merged = mergeDecor(local, server, localTime > remote!.updatedAt ? 'a' : 'b');
    const localChanged = !sameStampedDecor(merged, local);
    if (sameStampedDecor(merged, server)) {
      saveDecor(server.decor, { updatedAt: remote!.updatedAt, stamps: server.stamps });
      return localChanged;
    }
    const updatedAt = Math.max(Date.now(), localTime + 1, remote!.updatedAt + 1);
    await this.store.put({ kind: 'decor', key: 'main', updatedAt, data: { ...merged.decor, stamps: merged.stamps } }, null);
    saveDecor(merged.decor, { updatedAt, stamps: merged.stamps });
    return localChanged;
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
