import { describe, expect, it } from 'vitest';
import { hintItems, type HintAction } from '../src/atelier3d/hints';

const actions = (items: { action: HintAction }[]) => items.map((i) => i.action);

describe('화실 안내 문구', () => {
  it('서 있을 때는 걷기, 둘러보기, 확대, 점프를 알려 주고 이어 칠할 그림이 있으면 그것도 알려 준다', () => {
    expect(actions(hintItems({ activity: null, touch: true, easelPainting: true }, new Set()))).toEqual([
      'walk',
      'look',
      'zoom',
      'jump',
      'continue',
    ]);
  });

  it('해 본 조작은 빠지고, 다 해 보면 안내가 없다', () => {
    const ctx = { activity: null, touch: false, easelPainting: false } as const;
    expect(actions(hintItems(ctx, new Set<HintAction>(['walk', 'jump'])))).toEqual(['look', 'zoom']);
    expect(hintItems(ctx, new Set<HintAction>(['walk', 'look', 'zoom', 'jump']))).toEqual([]);
  });

  it('이젤에 앉아 있을 때와 차를 마실 때의 안내', () => {
    expect(actions(hintItems({ activity: 'paint', touch: false, easelPainting: false }, new Set()))).toEqual(['pick']);
    expect(hintItems({ activity: 'tea', touch: true, easelPainting: true }, new Set())[0].text).toContain('일어나요');
    expect(hintItems({ activity: 'read', touch: true, easelPainting: true }, new Set<HintAction>(['standUp']))).toEqual([]);
  });
});

describe('안내 기억', () => {
  it('로그인하지 않으면 이번 접속에만 기억하고, 로그인하면 기기에 남긴다', async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const { loadHintsDone, markHintDone, resetSessionHints } = await import('../src/atelier3d/hints');
    resetSessionHints();
    markHintDone('walk', false);
    expect(loadHintsDone(false).has('walk')).toBe(true);
    expect(store.size).toBe(0);
    // 다시 접속: 로그인하지 않았으면 처음부터
    resetSessionHints();
    expect(loadHintsDone(false).size).toBe(0);
    markHintDone('dip', true);
    resetSessionHints();
    expect(loadHintsDone(true).has('dip')).toBe(true);
    expect(loadHintsDone(false).has('dip')).toBe(false);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
