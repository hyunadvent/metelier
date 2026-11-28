import { describe, expect, it } from 'vitest';
import {
  clampOnWall,
  DEFAULT_DECOR,
  findFreeSpot,
  FRAME_BORDER,
  FRAME_INFO,
  FRAME_KINDS,
  GALLERY_WALL,
  MAX_WALL_PICTURES,
  normalizeDecor,
  PICTURE_SLOTS,
  WALL_PICTURE_SIZE,
  wallPictureSize,
} from '../src/atelier3d/decor';

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

  it('화분은 고를 수 있는 종류만 받아들인다', () => {
    expect(normalizeDecor(null).plants['window-stand']).toBe('leafy');
    expect(normalizeDecor({ plants: { 'window-stand': 'cactus' } }).plants['window-stand']).toBe('cactus');
    expect(normalizeDecor({ plants: { 'window-stand': '야자수' } }).plants['window-stand']).toBe('leafy');
    expect(normalizeDecor({ plants: { 'window-stand': 'tulip', balcony: 'cactus' } }).plants).toEqual({ 'window-stand': 'tulip' });
    // 화분만 바꿔 저장해도 액자는 그대로다
    expect(normalizeDecor({ plants: { 'window-stand': 'tulip' } }).pictures).toEqual(DEFAULT_DECOR.pictures);
  });

  it('기본 꾸밈을 고쳐도 원본은 바뀌지 않는다', () => {
    const decor = normalizeDecor(null);
    decor.pictures['back-large'] = { kind: 'builtin', id: 'hills' };
    decor.plants['window-stand'] = 'cactus';
    expect(DEFAULT_DECOR.pictures['back-large']).toEqual({ kind: 'builtin', id: 'meadow' });
    expect(DEFAULT_DECOR.plants['window-stand']).toBe('leafy');
  });
});

describe('그림 벽', () => {
  it('저장된 벽 그림을 읽고, 잘못된 항목은 버린다', () => {
    const wall = normalizeDecor({
      wall: [
        { id: 'w1', paintingId: 'hill-house', frame: 'wood', z: 1, y: 2 },
        { id: 'w2', paintingId: 'photo-abc', frame: '금테', z: 2, y: 2 },
        { id: 'w1', paintingId: 'hill-house', frame: 'wood', z: 3, y: 2 },
        { id: 'w3', paintingId: '../secret', frame: 'wood', z: 1, y: 2 },
        { id: 'w4', paintingId: 'hill-house', frame: 'wood', z: 'a', y: 2 },
        { id: 'w5', paintingId: 'hill-house', frame: 'wood', z: 99, y: -5 },
        '그림',
      ],
    }).wall;
    expect(wall.map((w) => w.id)).toEqual(['w1', 'w2', 'w5']);
    // 모르는 액자는 나무 액자로 본다
    expect(wall[1].frame).toBe('wood');
    // 벽 밖의 자리는 벽 안으로 고친다
    expect(wall[2].z).toBe(GALLERY_WALL.maxZ);
    expect(wall[2].y).toBe(GALLERY_WALL.minY);
  });

  it('저장된 것이 없거나 배열이 아니면 벽은 비어 있다', () => {
    expect(normalizeDecor({}).wall).toEqual([]);
    expect(normalizeDecor({ wall: '그림' }).wall).toEqual([]);
  });

  it('벽 그림은 정해 둔 수까지만 읽는다', () => {
    const many = Array.from({ length: MAX_WALL_PICTURES + 5 }, (_, i) => ({ id: `w${i}`, paintingId: 'hill-house', frame: 'wood', z: 1, y: 2 }));
    expect(normalizeDecor({ wall: many }).wall).toHaveLength(MAX_WALL_PICTURES);
  });

  it('그림 크기는 긴 변을 정해 둔 길이로 하고 비율을 지킨다', () => {
    const wide = wallPictureSize(4 / 3);
    expect(wide.w).toBe(WALL_PICTURE_SIZE);
    expect(wide.h).toBeCloseTo(WALL_PICTURE_SIZE * 0.75);
    const tall = wallPictureSize(0.75);
    expect(tall.w).toBeCloseTo(WALL_PICTURE_SIZE * 0.75);
    expect(tall.h).toBe(WALL_PICTURE_SIZE);
    expect(wallPictureSize(NaN)).toEqual({ w: WALL_PICTURE_SIZE, h: WALL_PICTURE_SIZE });
  });

  it('액자 테두리가 벽 밖으로 나가지 않게 자리를 고친다', () => {
    const w = 0.6;
    const h = 0.4;
    const p = clampOnWall(-100, 100, w, h);
    expect(p.z - (w + FRAME_BORDER) / 2).toBeCloseTo(GALLERY_WALL.minZ);
    expect(p.y + (h + FRAME_BORDER) / 2).toBeCloseTo(GALLERY_WALL.maxY);
    expect(clampOnWall(2, 2, w, h)).toEqual({ z: 2, y: 2 });
  });

  it('새 그림은 다른 액자와 겹치지 않는, 바라던 자리에 가장 가까운 곳에 건다', () => {
    const size = { w: 0.6, h: 0.45 };
    // 빈 벽이면 바라던 자리 그대로
    expect(findFreeSpot([], size.w, size.h, { z: 2, y: 1.95 })).toEqual({ z: 2, y: 1.95 });
    // 바라던 자리에 이미 그림이 있으면 옆으로 비켜 건다
    const taken = [{ z: 2, y: 1.95, ...size }];
    const spot = findFreeSpot(taken, size.w, size.h, { z: 2, y: 1.95 });
    const apartZ = Math.abs(spot.z - 2) >= size.w + FRAME_BORDER;
    const apartY = Math.abs(spot.y - 1.95) >= size.h + FRAME_BORDER;
    expect(apartZ || apartY).toBe(true);
    // 너무 멀리 가지는 않는다
    expect(Math.hypot(spot.z - 2, spot.y - 1.95)).toBeLessThan(1.2);
  });
});

describe('액자 고르기', () => {
  it('고를 수 있는 액자마다 이름과 버튼 색이 있다', () => {
    expect(FRAME_KINDS[0]).toBe('wood');
    for (const kind of FRAME_KINDS) {
      expect(FRAME_INFO[kind].label).toMatch(/액자$/);
      expect(FRAME_INFO[kind].swatch).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('저장된 액자 종류를 그대로 읽는다', () => {
    const wall = normalizeDecor({
      wall: FRAME_KINDS.map((frame, i) => ({ id: 'w' + i, paintingId: 'hill-house', frame, z: 1 + i, y: 2 })),
    }).wall;
    expect(wall.map((w) => w.frame)).toEqual([...FRAME_KINDS]);
  });
});

describe('액자 크기', () => {
  it('작게·크게는 보통보다 작고 크며, 비율은 그대로다', () => {
    const medium = wallPictureSize(4 / 3);
    const small = wallPictureSize(4 / 3, 'small');
    const large = wallPictureSize(4 / 3, 'large');
    expect(small.w).toBeLessThan(medium.w);
    expect(large.w).toBeGreaterThan(medium.w);
    expect(large.w / large.h).toBeCloseTo(4 / 3);
    expect(medium.w).toBe(WALL_PICTURE_SIZE);
  });

  it('저장된 크기를 읽고, 보통이거나 이상한 값이면 크기를 적지 않는다', () => {
    const wall = normalizeDecor({
      wall: [
        { id: 'a', paintingId: 'hill-house', frame: 'wood', size: 'large', z: 1, y: 2 },
        { id: 'b', paintingId: 'hill-house', frame: 'wood', size: 'medium', z: 3, y: 2 },
        { id: 'c', paintingId: 'hill-house', frame: 'wood', size: 'huge', z: 5, y: 2 },
      ],
    }).wall;
    expect(wall.map((w) => w.size)).toEqual(['large', undefined, undefined]);
  });
});
