import type { SyncKind } from '../storage/changes';

/**
 * 동기화 계획: 이 브라우저와 서버에 있는 것을 견주어, 무엇을 올리고 무엇을 받을지 정한다.
 * 같은 것이 양쪽에서 바뀌었으면 나중에 바뀐 쪽을 따른다 (마지막에 쓴 것이 이긴다).
 * 지운 것도 "지운 때" 가 있는 바뀜으로 본다. 그래서 한 기기에서 지우면 다른 기기에서도 지워진다.
 */

/** 이 브라우저에 있는 것 하나 */
export interface LocalEntry {
  kind: SyncKind;
  key: string;
  updatedAt: number;
}

/** 이 브라우저에서 지운 것 하나 */
export interface LocalTombstone {
  kind: SyncKind;
  key: string;
  deletedAt: number;
}

/** 서버에 있는 것 하나 (지운 것은 deleted) */
export interface RemoteEntry {
  kind: SyncKind;
  key: string;
  updatedAt: number;
  deleted: boolean;
}

export type SyncAction =
  /** 이 브라우저의 것을 서버에 올린다 */
  | { type: 'upload'; kind: SyncKind; key: string }
  /** 서버의 것을 받아 이 브라우저에 쓴다 */
  | { type: 'download'; kind: SyncKind; key: string; updatedAt: number }
  /** 서버에서 지워졌으니 이 브라우저에서도 지운다 */
  | { type: 'delete-local'; kind: SyncKind; key: string }
  /** 이 브라우저에서 지웠으니 서버에도 지웠다고 남긴다 */
  | { type: 'delete-remote'; kind: SyncKind; key: string; deletedAt: number }
  /** 지운 기록이 더는 필요 없다 */
  | { type: 'forget-tombstone'; kind: SyncKind; key: string };

const id = (kind: SyncKind, key: string) => `${kind}:${key}`;

/** 받는 차례: 화면에 바로 보이는 것(벽에 거는 작품)부터. 작을수록 먼저 */
const DOWNLOAD_ORDER: Record<SyncKind, number> = { decor: 0, gallery: 1, painting: 2, progress: 3 };

/**
 * 할 일을 실행할 차례로 나눈다.
 * - 받기는 화면에 바로 보이는 것부터, 한 묶음 안에서는 동시에 받아도 된다.
 * - 올리기, 지우기, 기록 정리는 받은 뒤에 차례로 한다.
 */
export function orderActions(actions: SyncAction[]): { downloads: SyncAction[]; rest: SyncAction[] } {
  const downloads = actions.filter((a) => a.type === 'download').sort((a, b) => DOWNLOAD_ORDER[a.kind] - DOWNLOAD_ORDER[b.kind]);
  return { downloads, rest: actions.filter((a) => a.type !== 'download') };
}

export function planSync(local: LocalEntry[], tombstones: LocalTombstone[], remote: RemoteEntry[]): SyncAction[] {
  const live = new Map(local.map((e) => [id(e.kind, e.key), e]));
  const dead = new Map(tombstones.map((t) => [id(t.kind, t.key), t]));
  const server = new Map(remote.map((r) => [id(r.kind, r.key), r]));
  const ids = new Set([...live.keys(), ...dead.keys(), ...server.keys()]);
  const actions: SyncAction[] = [];

  for (const itemId of [...ids].sort()) {
    const l = live.get(itemId);
    const t = dead.get(itemId);
    const r = server.get(itemId);
    const { kind, key } = (l ?? t ?? r)!;
    // 이 브라우저의 상태: 살아 있는 것과 지운 기록이 둘 다 있으면 나중 것을 따른다
    const localDeleted = t !== undefined && (l === undefined || t.deletedAt >= l.updatedAt);
    const localTime = localDeleted ? t.deletedAt : l?.updatedAt;

    if (localTime === undefined) {
      // 이 브라우저에는 없다
      if (r && !r.deleted) actions.push({ type: 'download', kind, key, updatedAt: r.updatedAt });
      continue;
    }
    if (!r) {
      if (localDeleted) actions.push({ type: 'forget-tombstone', kind, key });
      else actions.push({ type: 'upload', kind, key });
      continue;
    }
    if (localTime > r.updatedAt) {
      if (!localDeleted) actions.push({ type: 'upload', kind, key });
      else if (r.deleted) actions.push({ type: 'forget-tombstone', kind, key });
      else actions.push({ type: 'delete-remote', kind, key, deletedAt: localTime });
      continue;
    }
    if (r.updatedAt > localTime) {
      if (r.deleted) {
        if (!localDeleted) actions.push({ type: 'delete-local', kind, key });
        else actions.push({ type: 'forget-tombstone', kind, key });
      } else {
        actions.push({ type: 'download', kind, key, updatedAt: r.updatedAt });
      }
      continue;
    }
    // 같은 때: 이미 같다. 양쪽 다 지웠으면 기록만 정리한다
    if (localDeleted && r.deleted) actions.push({ type: 'forget-tombstone', kind, key });
  }
  return actions;
}
