import { describe, expect, it } from 'vitest';
import { DEFAULT_DECOR, normalizeDecor, PICTURE_SLOTS } from '../src/atelier3d/decor';

describe('화실 꾸밈 데이터', () => {
  it('저장된 것이 없으면 기본 꾸밈을 쓴다', () => {
    expect(normalizeDecor(null)).toEqual(DEFAULT_DECOR);
    expect(normalizeDecor('엉뚱한 값')).toEqual(DEFAULT_DECOR);
    expect(Object.keys(DEFAULT_DECOR.pictures).sort()).toEqual([...PICTURE_SLOTS].sort());
  });

  it('바꾼 자리만 반영하고 나머지는 기본값을 유지한다', () => {
    const decor = normalizeDecor({ version: 1, pictures: { 'back-large': { kind: 'painting', paintingId: 'cat-basket' } } });
    expect(decor.pictures['back-large']).toEqual({ kind: 'painting', paintingId: 'cat-basket' });
    expect(decor.pictures['door-far']).toEqual(DEFAULT_DECOR.pictures['door-far']);
  });

  it('잘못된 그림과 모르는 자리는 버린다', () => {
    const decor = normalizeDecor({
      pictures: {
        'back-large': { kind: 'builtin', id: '없는 그림' },
        'back-left': { kind: 'painting', paintingId: '../../etc/passwd' },
        'door-near': 42,
        ceiling: { kind: 'builtin', id: 'meadow' },
      },
    });
    expect(decor).toEqual(DEFAULT_DECOR);
    expect('ceiling' in decor.pictures).toBe(false);
  });

  it('기본 꾸밈을 고쳐도 원본은 바뀌지 않는다', () => {
    const decor = normalizeDecor(null);
    decor.pictures['back-large'] = { kind: 'builtin', id: 'hills' };
    expect(DEFAULT_DECOR.pictures['back-large']).toEqual({ kind: 'builtin', id: 'meadow' });
  });
});
