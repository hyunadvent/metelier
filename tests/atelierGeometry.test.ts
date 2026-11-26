import { describe, expect, it } from 'vitest';
import { clampToPolygon, easelPlacement, pointInPolygon, roomPlacement } from '../src/atelier/geometry';

const FLOOR = [
  { x: 100, y: 100 },
  { x: 500, y: 100 },
  { x: 600, y: 300 },
  { x: 0, y: 300 },
];

describe('바닥 영역', () => {
  it('안과 밖을 구분한다', () => {
    expect(pointInPolygon({ x: 300, y: 200 }, FLOOR)).toBe(true);
    expect(pointInPolygon({ x: 300, y: 50 }, FLOOR)).toBe(false);
    expect(pointInPolygon({ x: 20, y: 120 }, FLOOR)).toBe(false);
  });

  it('안쪽 점은 그대로 둔다', () => {
    expect(clampToPolygon({ x: 300, y: 200 }, FLOOR)).toEqual({ x: 300, y: 200 });
  });

  it('바깥 점은 가장 가까운 가장자리 안쪽으로 옮긴다', () => {
    const p = clampToPolygon({ x: 300, y: -500 }, FLOOR);
    expect(pointInPolygon(p, FLOOR)).toBe(true);
    expect(p.x).toBeCloseTo(300, 0);
    expect(p.y).toBeCloseTo(101, 0);

    const q = clampToPolygon({ x: 2000, y: 900 }, FLOOR);
    expect(pointInPolygon(q, FLOOR)).toBe(true);
    expect(Math.hypot(q.x - 600, q.y - 300)).toBeLessThan(3);
  });
});

describe('화실 카메라', () => {
  it('장면이 화면을 빈틈없이 채운다', () => {
    for (const [sw, sh, focus] of [
      [1600, 900, 800],
      [600, 900, 0],
      [600, 900, 1672],
      [2400, 600, 500],
    ]) {
      const p = roomPlacement(1672, 941, sw, sh, focus);
      expect(p.x).toBeLessThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(0);
      expect(p.x + 1672 * p.scale).toBeGreaterThanOrEqual(sw - 1e-6);
      expect(p.y + 941 * p.scale).toBeCloseTo(sh); // 바닥이 화면 아래에 붙는다
    }
  });

  it('좁은 화면에서는 캐릭터를 따라 좌우로 움직인다', () => {
    const p = roomPlacement(1672, 941, 600, 941, 836);
    expect(p.scale).toBe(1);
    expect(836 * p.scale + p.x).toBeCloseTo(300); // 캐릭터가 화면 가운데
  });
});

describe('색칠 화면 카메라', () => {
  const focus = { x: 568, y: 318, width: 300, height: 225 };

  it('이젤 부분이 종이 뒤에 같은 크기로 온다', () => {
    const paper = { x: 400, y: 150, width: 800, height: 600 };
    const p = easelPlacement(1672, 941, focus, paper, 1600, 900);
    expect(p.scale).toBeCloseTo(800 / 300);
    expect((focus.x + 150) * p.scale + p.x).toBeCloseTo(800);
    expect((focus.y + 112.5) * p.scale + p.y).toBeCloseTo(450);
  });

  it('어떤 화면에서도 배경이 화면을 빈틈없이 채운다', () => {
    for (const [sw, sh, paper] of [
      [1600, 900, { x: 400, y: 150, width: 800, height: 600 }],
      [600, 800, { x: 24, y: 200, width: 552, height: 414 }],
      [3000, 700, { x: 1200, y: 76, width: 650, height: 488 }],
    ] as const) {
      const p = easelPlacement(1672, 941, focus, paper, sw, sh);
      expect(p.x).toBeLessThanOrEqual(1e-6);
      expect(p.y).toBeLessThanOrEqual(1e-6);
      expect(p.x + 1672 * p.scale).toBeGreaterThanOrEqual(sw - 1e-6);
      expect(p.y + 941 * p.scale).toBeGreaterThanOrEqual(sh - 1e-6);
    }
  });
});
