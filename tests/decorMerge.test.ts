import { describe, expect, it } from 'vitest';
import { DEFAULT_DECOR, type AtelierDecor, type WallPicture } from '../src/atelier3d/decor';
import { EMPTY_STAMPS, mergeDecor, normalizeStamps, stampChanges, type StampedDecor } from '../src/atelier3d/decorMerge';

const picture = (id: string, paintingId = `art-${id}`, z = 1): WallPicture => ({ id, paintingId, frame: 'wood', z, y: 1.95 });
const withWall = (wall: WallPicture[], base: AtelierDecor = DEFAULT_DECOR): AtelierDecor => ({ ...base, wall });

/** 기본 꾸밈에서 시작해 next 로 바꾼 기기 */
const device = (next: AtelierDecor, now: number, from: StampedDecor = { decor: DEFAULT_DECOR, stamps: EMPTY_STAMPS }): StampedDecor => ({
  decor: next,
  stamps: stampChanges(from.decor, next, from.stamps, now),
});

describe('꾸밈 합치기', () => {
  it('한 기기에서 건 그림과 다른 기기에서 바꾼 화분이 둘 다 남는다', () => {
    const a = device(withWall([picture('w1')]), 100);
    const b = device({ ...DEFAULT_DECOR, plants: { 'window-stand': 'cactus' } }, 200);
    for (const prefer of ['a', 'b'] as const) {
      const merged = mergeDecor(a, b, prefer, 300);
      expect(merged.decor.plants['window-stand']).toBe('cactus');
      expect(merged.decor.wall.map((p) => p.id)).toEqual(['w1']);
    }
  });

  it('같은 그림을 두 기기에서 옮겼으면 나중에 옮긴 자리를 따른다', () => {
    const start = device(withWall([picture('w1', 'art', 1)]), 100);
    const a = device(withWall([picture('w1', 'art', 2)]), 200, start);
    const b = device(withWall([picture('w1', 'art', 3)]), 300, start);
    expect(mergeDecor(a, b, 'a', 400).decor.wall[0].z).toBe(3);
    expect(mergeDecor(b, a, 'a', 400).decor.wall[0].z).toBe(3);
  });

  it('치운 그림은 다른 기기에서 되살아나지 않는다', () => {
    const start = device(withWall([picture('w1')]), 100);
    const removedHere = device(withWall([]), 200, start);
    expect(removedHere.stamps.removed['wall:w1']).toBe(200);
    expect(mergeDecor(removedHere, start, 'b', 300).decor.wall).toEqual([]);
    expect(mergeDecor(start, removedHere, 'a', 300).decor.wall).toEqual([]);
  });

  it('치운 뒤에 다른 기기에서 그 그림을 옮겼으면 남긴다 (나중 일이 이긴다)', () => {
    const start = device(withWall([picture('w1', 'art', 1)]), 100);
    const removed = device(withWall([]), 200, start);
    const moved = device(withWall([picture('w1', 'art', 5)]), 300, start);
    expect(mergeDecor(removed, moved, 'a', 400).decor.wall.map((p) => p.z)).toEqual([5]);
  });

  it('같은 작품을 두 기기에서 따로 걸면 한 번만 건다', () => {
    const a = device(withWall([picture('w1', 'same-art')]), 100);
    const b = device(withWall([picture('w2', 'same-art')]), 200);
    expect(mergeDecor(a, b, 'a', 300).decor.wall.map((p) => p.id)).toEqual(['w1']);
  });

  it('조각마다의 기록이 없던 예전 꾸밈도 벽 그림을 잃지 않는다', () => {
    const old: StampedDecor = { decor: withWall([picture('w1')]), stamps: EMPTY_STAMPS };
    const other: StampedDecor = { decor: { ...DEFAULT_DECOR, plants: { 'window-stand': 'tulip' } }, stamps: EMPTY_STAMPS };
    const merged = mergeDecor(other, old, 'a', 300);
    expect(merged.decor.wall.map((p) => p.id)).toEqual(['w1']);
    expect(merged.decor.plants['window-stand']).toBe('tulip');
  });

  it('바뀐 조각만 기록한다', () => {
    const before = withWall([picture('w1'), picture('w2')]);
    const after = withWall([picture('w1', 'art-w1', 4), picture('w3')]);
    const stamps = stampChanges(before, after, EMPTY_STAMPS, 500);
    expect(stamps.changed).toEqual({ 'wall:w1': 500, 'wall:w3': 500 });
    expect(stamps.removed).toEqual({ 'wall:w2': 500 });
  });

  it('액자 크기만 바꿔도 바뀐 것으로 기록한다', () => {
    const before = withWall([picture('w1')]);
    const after = withWall([{ ...picture('w1'), size: 'large' }]);
    expect(stampChanges(before, after, EMPTY_STAMPS, 700).changed).toEqual({ 'wall:w1': 700 });
  });

  it('나만의 물감은 나중에 바꾼 기기의 것을 따른다', () => {
    const base: StampedDecor = { decor: DEFAULT_DECOR, stamps: EMPTY_STAMPS };
    const phone = { decor: { ...DEFAULT_DECOR, colors: ['#ff0000'] }, stamps: stampChanges(DEFAULT_DECOR, { ...DEFAULT_DECOR, colors: ['#ff0000'] }, EMPTY_STAMPS, 100) };
    const pc = { decor: { ...DEFAULT_DECOR, colors: ['#00ff00'] }, stamps: stampChanges(DEFAULT_DECOR, { ...DEFAULT_DECOR, colors: ['#00ff00'] }, EMPTY_STAMPS, 200) };
    expect(mergeDecor(phone, pc, 'a').decor.colors).toEqual(['#00ff00']);
    expect(mergeDecor(phone, base, 'b').decor.colors).toEqual(['#ff0000']);
  });

  it('저장된 기록 가운데 이상한 값은 버린다', () => {
    expect(normalizeStamps({ changed: { 'wall:w1': 5, 'wall:../x': 9, 'plant:window-stand': 'a' }, removed: null })).toEqual({
      changed: { 'wall:w1': 5 },
      removed: {},
    });
  });
});
