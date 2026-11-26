import { describe, expect, it } from 'vitest';
import { clampPlacement, clampZoom, fitScale, scaleAround, type Rect } from '../src/coloring/view/viewport';

const avail: Rect = { left: 20, top: 70, right: 1020, bottom: 670 }; // 1000 x 600
const W = 2000;
const H = 1000;

describe('viewport', () => {
  it('줌은 100% ~ 500% 로 제한된다', () => {
    expect(clampZoom(0.3)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(9)).toBe(5);
  });

  it('맞춤 배율은 그림 전체가 보이는 가장 큰 배율이다', () => {
    expect(fitScale(avail, W, H)).toBe(0.5); // 가로가 먼저 찬다
    expect(fitScale(avail, 1000, 1200)).toBe(0.5); // 세로가 먼저 찬다
  });

  it('그림이 영역보다 작으면 가운데에 놓는다', () => {
    const p = clampPlacement({ scale: 0.5, x: -999, y: 999 }, avail, W, H);
    expect(p.x).toBe(20); // 가로는 꽉 참
    expect(p.y).toBe(70 + (600 - 500) / 2);
  });

  it('확대했을 때 그림 가장자리가 영역 안쪽으로 들어오지 않는다', () => {
    const scale = 2; // 4000 x 2000
    expect(clampPlacement({ scale, x: 500, y: 500 }, avail, W, H)).toEqual({ scale, x: 20, y: 70 });
    expect(clampPlacement({ scale, x: -9999, y: -9999 }, avail, W, H)).toEqual({
      scale,
      x: 1020 - 4000,
      y: 670 - 2000,
    });
    expect(clampPlacement({ scale, x: -300, y: -200 }, avail, W, H)).toEqual({ scale, x: -300, y: -200 });
  });

  it('기준점 아래의 그림 위치를 유지한 채 배율을 바꾼다', () => {
    const before = { scale: 0.5, x: 20, y: 120 };
    const anchor = { x: 400, y: 300 };
    const worldX = (anchor.x - before.x) / before.scale;
    const worldY = (anchor.y - before.y) / before.scale;
    const after = scaleAround(before, anchor.x, anchor.y, 1.5);
    expect(after.scale).toBe(1.5);
    expect(worldX * after.scale + after.x).toBeCloseTo(anchor.x);
    expect(worldY * after.scale + after.y).toBeCloseTo(anchor.y);
  });
});
