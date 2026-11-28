import { describe, expect, it } from 'vitest';
import { orderActions, planSync, type LocalEntry, type LocalTombstone, type RemoteEntry } from '../src/sync/plan';
import { describeSync } from '../src/sync/SyncContext';

const local = (key: string, updatedAt: number, kind: LocalEntry['kind'] = 'progress'): LocalEntry => ({ kind, key, updatedAt });
const tomb = (key: string, deletedAt: number, kind: LocalTombstone['kind'] = 'painting'): LocalTombstone => ({ kind, key, deletedAt });
const remote = (key: string, updatedAt: number, deleted = false, kind: RemoteEntry['kind'] = 'progress'): RemoteEntry => ({
  kind,
  key,
  updatedAt,
  deleted,
});
const types = (actions: ReturnType<typeof planSync>) => actions.map((a) => `${a.type} ${a.kind}:${a.key}`);

describe('동기화 계획', () => {
  it('이 브라우저에만 있으면 올리고, 서버에만 있으면 받는다', () => {
    expect(types(planSync([local('a', 10)], [], [remote('b', 20)]))).toEqual(['upload progress:a', 'download progress:b']);
  });

  it('양쪽에 있으면 나중에 바뀐 쪽을 따르고, 같으면 아무것도 하지 않는다', () => {
    expect(types(planSync([local('a', 30)], [], [remote('a', 20)]))).toEqual(['upload progress:a']);
    expect(types(planSync([local('a', 10)], [], [remote('a', 20)]))).toEqual(['download progress:a']);
    expect(planSync([local('a', 20)], [], [remote('a', 20)])).toEqual([]);
  });

  it('받을 때는 서버의 바뀐 때를 그대로 쓴다 (다음에 다시 받지 않게)', () => {
    expect(planSync([], [], [remote('a', 42)])).toEqual([{ type: 'download', kind: 'progress', key: 'a', updatedAt: 42 }]);
  });

  it('이 브라우저에서 지운 것은 서버에도 지웠다고 남긴다', () => {
    const actions = planSync([], [tomb('p', 50)], [remote('p', 20, false, 'painting')]);
    expect(actions).toEqual([{ type: 'delete-remote', kind: 'painting', key: 'p', deletedAt: 50 }]);
  });

  it('지운 뒤에 다른 기기에서 더 나중에 고쳤으면 고친 것을 받는다', () => {
    expect(types(planSync([], [tomb('p', 50)], [remote('p', 80, false, 'painting')]))).toEqual(['download painting:p']);
  });

  it('서버에서 지워졌으면 이 브라우저에서도 지운다. 이 브라우저에서 더 나중에 고쳤으면 다시 올린다', () => {
    expect(types(planSync([local('a', 10)], [], [remote('a', 20, true)]))).toEqual(['delete-local progress:a']);
    expect(types(planSync([local('a', 30)], [], [remote('a', 20, true)]))).toEqual(['upload progress:a']);
  });

  it('서버에서 지운 것이 이 브라우저에 없으면 받지 않는다', () => {
    expect(planSync([], [], [remote('a', 20, true)])).toEqual([]);
  });

  it('더는 필요 없는 지운 기록은 정리한다', () => {
    // 서버에 없던 것을 지웠을 때
    expect(types(planSync([], [tomb('p', 50)], []))).toEqual(['forget-tombstone painting:p']);
    // 서버도 이미 지웠을 때
    expect(types(planSync([], [tomb('p', 50)], [remote('p', 40, true, 'painting')]))).toEqual(['forget-tombstone painting:p']);
    expect(types(planSync([], [tomb('p', 50)], [remote('p', 50, true, 'painting')]))).toEqual(['forget-tombstone painting:p']);
  });

  it('지운 뒤 다시 만들었으면 (살아 있는 것이 더 나중) 올린다', () => {
    expect(types(planSync([local('p', 90, 'painting')], [tomb('p', 50)], [remote('p', 20, false, 'painting')]))).toEqual([
      'upload painting:p',
    ]);
  });

  it('종류가 다르면 이름표가 같아도 다른 것으로 본다', () => {
    expect(types(planSync([local('hill-house', 10, 'progress')], [], [remote('hill-house', 20, false, 'gallery')]))).toEqual([
      'download gallery:hill-house',
      'upload progress:hill-house',
    ]);
  });
});

describe('저장 상태 글', () => {
  it('로그인하지 않았으면 보여 주지 않는다', () => {
    expect(describeSync(null)).toBeNull();
  });

  it('하는 중, 실패, 마지막으로 저장한 때를 알려 준다', () => {
    const now = 1_000_000;
    expect(describeSync({ state: 'syncing', lastSyncedAt: null }, now)).toBe('저장하는 중…');
    expect(describeSync({ state: 'error', lastSyncedAt: null, message: '인터넷에 연결되어 있지 않아요' }, now)).toBe('인터넷에 연결되어 있지 않아요');
    expect(describeSync({ state: 'idle', lastSyncedAt: now - 5_000 }, now)).toBe('모두 저장됨 · 방금');
    expect(describeSync({ state: 'idle', lastSyncedAt: now - 5 * 60_000 }, now)).toBe('모두 저장됨 · 5분 전');
  });
});

describe('받는 차례', () => {
  it('벽에 거는 작품부터 받고, 올리기와 지우기는 받은 뒤에 한다', () => {
    const actions = planSync(
      [local('mine', 50)],
      [],
      [remote('p1', 10), remote('art', 10, false, 'gallery'), remote('photo', 10, false, 'painting'), remote('mine', 20, true)],
    );
    const { downloads, rest } = orderActions(actions);
    expect(downloads.map((a) => `${a.kind}:${a.key}`)).toEqual(['gallery:art', 'painting:photo', 'progress:p1']);
    expect(rest.map((a) => a.type)).toEqual(['upload']);
  });
});
