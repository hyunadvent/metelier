/**
 * 저장한 것이 바뀌었음을 알리는 곳.
 * - 이 브라우저에서 바뀌면(칠하기, 꾸미기, 사진 그림 등록) 동기화가 듣고 서버에 올린다.
 * - 서버에서 받아 바꾸면 화면이 듣고 다시 그린다.
 */

/** 동기화하는 것의 종류 */
export type SyncKind = 'decor' | 'progress' | 'gallery' | 'painting';
export const SYNC_KINDS: SyncKind[] = ['decor', 'progress', 'gallery', 'painting'];

type LocalListener = (kind: SyncKind, key: string) => void;
type RemoteListener = (kinds: Set<SyncKind>) => void;

const localListeners = new Set<LocalListener>();
const remoteListeners = new Set<RemoteListener>();

/** 이 브라우저에서 무언가를 저장하거나 지웠다 */
export function notifyLocalChange(kind: SyncKind, key: string): void {
  localListeners.forEach((l) => l(kind, key));
}

export function onLocalChange(listener: LocalListener): () => void {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

/** 서버에서 받은 것으로 이 브라우저의 저장본을 바꿨다 */
export function notifyRemoteApplied(kinds: Set<SyncKind>): void {
  if (kinds.size > 0) remoteListeners.forEach((l) => l(kinds));
}

export function onRemoteApplied(listener: RemoteListener): () => void {
  remoteListeners.add(listener);
  return () => remoteListeners.delete(listener);
}
