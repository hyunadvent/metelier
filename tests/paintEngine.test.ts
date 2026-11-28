import { describe, expect, it } from 'vitest';
import { PaintEngine, type Rgb } from '../src/coloring/engine/PaintEngine';
import { decodeRegionIds } from '../src/coloring/engine/regionMap';

const W = 40;
const H = 20;
const RED: Rgb = [220, 40, 40];
const BLUE: Rgb = [40, 80, 220];

/** 왼쪽 절반 = 칸 1, 가운데 세로 두 줄 = 칸 없음(0), 오른쪽 = 칸 2. */
function makeEngine(): PaintEngine {
  const ids = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) ids[y * W + x] = x < 19 ? 1 : x < 21 ? 0 : 2;
  }
  return new PaintEngine(W, H, ids);
}

function pixel(engine: PaintEngine, x: number, y: number): number[] {
  const o = (y * W + x) * 4;
  return Array.from(engine.pixels.subarray(o, o + 4));
}

function paintAcross(engine: PaintEngine, color: Rgb | null, radius = 3): void {
  engine.setBrush(color ? { kind: 'paint', color } : { kind: 'erase' });
  engine.setRadius(radius);
  engine.beginStroke(5, 10);
  engine.strokeTo(35, 10);
  engine.endStroke();
}

describe('PaintEngine', () => {
  it('누른 칸 안에서만 칠해진다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED);
    expect(pixel(engine, 10, 10)).toEqual([...RED, 255]);
    for (let y = 0; y < H; y++) {
      for (let x = 19; x < W; x++) expect(pixel(engine, x, y)[3]).toBe(0);
    }
    expect(engine.coverage(2)).toBe(0);
  });

  it('칸이 없는 곳에서는 스트로크가 시작되지 않는다', () => {
    const engine = makeEngine();
    engine.setBrush({ kind: 'paint', color: RED });
    expect(engine.beginStroke(20, 10)).toBe(0);
    expect(engine.beginStroke(-5, 10)).toBe(0);
    engine.strokeTo(5, 10);
    expect(engine.takeDirty()).toBeNull();
  });

  it('붓에 색이 없으면 칠해지지 않는다', () => {
    const engine = makeEngine();
    expect(engine.beginStroke(5, 10)).toBe(0);
    expect(engine.takeDirty()).toBeNull();
  });

  it('지나간 부분만, 균일한 색으로 칠해진다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED);
    // 붓 중심선에서 반지름 안쪽은 정확히 같은 색
    for (let x = 5; x < 19; x++) {
      for (let y = 8; y <= 11; y++) expect(pixel(engine, x, y)).toEqual([...RED, 255]);
    }
    // 지나가지 않은 곳은 그대로
    expect(pixel(engine, 10, 2)[3]).toBe(0);
    expect(pixel(engine, 10, 17)[3]).toBe(0);

    const before = engine.pixels.slice();
    paintAcross(engine, RED);
    paintAcross(engine, RED);
    // 여러 번 지나가도 안쪽 색은 변하지 않는다
    for (let x = 5; x < 19; x++) {
      for (let y = 8; y <= 11; y++) {
        const o = (y * W + x) * 4;
        expect(Array.from(engine.pixels.subarray(o, o + 4))).toEqual(Array.from(before.subarray(o, o + 4)));
      }
    }
  });

  it('칠한 칸 위에 다른 색을 덧칠할 수 있다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED);
    paintAcross(engine, BLUE);
    expect(pixel(engine, 10, 10)).toEqual([...BLUE, 255]);
  });

  it('지우개는 칠을 지우고 진행도를 되돌린다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED);
    const painted = engine.coverage(1);
    expect(painted).toBeGreaterThan(0);
    paintAcross(engine, null);
    expect(pixel(engine, 10, 10)[3]).toBe(0);
    expect(engine.coverage(1)).toBe(0);
  });

  it('칸을 모두 칠해야 칠한 칸으로 센다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED, 3);
    expect(engine.isFilled(1)).toBe(false);
    expect(engine.filledCount()).toBe(0);

    paintAcross(engine, RED, 30);
    expect(engine.coverage(1)).toBe(1);
    expect(engine.isFilled(1)).toBe(true);
    expect(engine.filledCount()).toBe(1);
    expect(engine.regionCount).toBe(2);
    expect(engine.fillableCount).toBe(2);
  });

  it('90% 넘게 칠해도 빈 곳이 남아 있으면 칠한 칸이 아니다', () => {
    const engine = makeEngine();
    // 칸 1 (19 x 20) 의 맨 아래 한 줄만 남기고 모두 칠한다: 95%
    const saved = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < 19; x++) saved.set([...RED, 255], (y * W + x) * 4);
    }
    engine.loadPixels(saved);
    expect(engine.coverage(1)).toBeCloseTo(0.95);
    expect(engine.isFilled(1)).toBe(false);

    // 이미 칠한 곳을 한 번 더 지나가도 빈 줄은 메워지지 않는다
    paintAcross(engine, RED, 2);
    expect(engine.isFilled(1)).toBe(false);
    expect(pixel(engine, 5, H - 1)[3]).toBe(0);
  });

  it('한두 픽셀짜리 틈은 스트로크가 끝날 때 주변 색으로 메운다', () => {
    const engine = makeEngine();
    const saved = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < 19; x++) saved.set([...BLUE, 255], (y * W + x) * 4);
    }
    saved.fill(0, (19 * W + 0) * 4, (19 * W + 2) * 4); // 왼쪽 아래 두 픽셀을 비운다
    engine.loadPixels(saved);
    expect(engine.isFilled(1)).toBe(false);

    paintAcross(engine, RED, 2);
    expect(engine.isFilled(1)).toBe(true);
    expect(pixel(engine, 0, 19)).toEqual([...BLUE, 255]);

    // 메운 것도 스트로크와 함께 되돌려진다
    engine.undo();
    expect(engine.isFilled(1)).toBe(false);
    expect(pixel(engine, 0, 19)[3]).toBe(0);
  });

  it('지우개로 지나간 뒤에는 틈을 메우지 않는다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED, 30);
    engine.setBrush({ kind: 'erase' });
    engine.setRadius(0.5);
    engine.beginStroke(3.5, 3.5);
    engine.endStroke();
    expect(engine.isFilled(1)).toBe(false);
  });

  it('선에 가려진 픽셀은 칠하지 않아도 된다', () => {
    const ids = new Uint16Array(W * H).fill(1);
    const hidden = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 30; x < W; x++) hidden[y * W + x] = 1;
    const engine = new PaintEngine(W, H, ids, hidden);
    expect(engine.regionSize[1]).toBe(30 * H);

    engine.setBrush({ kind: 'paint', color: RED });
    engine.setRadius(12);
    engine.beginStroke(2, 10);
    engine.strokeTo(26, 10); // x < 30 은 모두 덮지만 가려진 오른쪽 끝까지는 닿지 않는다
    engine.endStroke();
    expect(pixel(engine, W - 1, 0)[3]).toBe(0);
    expect(engine.isFilled(1)).toBe(true);
  });

  it('바뀐 영역만 알려준다', () => {
    const engine = makeEngine();
    engine.setBrush({ kind: 'paint', color: RED });
    engine.setRadius(2);
    engine.beginStroke(8, 8);
    const dirty = engine.takeDirty();
    expect(dirty).not.toBeNull();
    expect(dirty!.x).toBeGreaterThanOrEqual(5);
    expect(dirty!.x + dirty!.width).toBeLessThanOrEqual(12);
    expect(dirty!.y).toBeGreaterThanOrEqual(5);
    expect(dirty!.y + dirty!.height).toBeLessThanOrEqual(12);
    expect(engine.takeDirty()).toBeNull();
  });

  it('clear 는 모든 칠과 진행도를 지운다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED, 30);
    engine.clear();
    expect(engine.filledCount()).toBe(0);
    expect(engine.pixels.every((v) => v === 0)).toBe(true);
  });

  it('크기가 맞지 않는 칸 ID 맵은 거부한다', () => {
    expect(() => new PaintEngine(4, 4, new Uint16Array(10))).toThrow();
  });
});

describe('되돌리기와 불러오기', () => {
  it('마지막 스트로크를 되돌리고 다시 할 수 있다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED);
    const afterRed = engine.pixels.slice();
    const redCoverage = engine.coverage(1);
    paintAcross(engine, BLUE, 6);
    expect(engine.canUndo).toBe(true);

    expect(engine.undo()).toBe(true);
    expect(Array.from(engine.pixels)).toEqual(Array.from(afterRed));
    expect(engine.coverage(1)).toBe(redCoverage);

    expect(engine.undo()).toBe(true);
    expect(engine.pixels.every((v) => v === 0)).toBe(true);
    expect(engine.coverage(1)).toBe(0);
    expect(engine.undo()).toBe(false);

    expect(engine.redo()).toBe(true);
    expect(Array.from(engine.pixels)).toEqual(Array.from(afterRed));
    expect(engine.redo()).toBe(true);
    expect(pixel(engine, 10, 10)).toEqual([...BLUE, 255]);
    expect(engine.canRedo).toBe(false);
  });

  it('새로 칠하면 다시 하기 기록이 사라진다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED);
    engine.undo();
    expect(engine.canRedo).toBe(true);
    paintAcross(engine, BLUE);
    expect(engine.canRedo).toBe(false);
  });

  it('되돌리면 바뀐 영역을 알려준다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED);
    engine.takeDirty();
    engine.undo();
    expect(engine.takeDirty()).not.toBeNull();
  });

  it('저장한 칠을 불러오면 진행도가 그대로 돌아온다', () => {
    const engine = makeEngine();
    paintAcross(engine, RED, 30);
    const saved = engine.pixels.slice();

    const restored = makeEngine();
    restored.loadPixels(saved);
    expect(restored.filledCount()).toBe(1);
    expect(restored.coverage(1)).toBe(engine.coverage(1));
    expect(restored.canUndo).toBe(false);
    expect(restored.takeDirty()).toEqual({ x: 0, y: 0, width: W, height: H });
    expect(() => restored.loadPixels(new Uint8ClampedArray(8))).toThrow();
  });
});

describe('decodeRegionIds', () => {
  it('R | G << 8 로 ID 를 읽는다', () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 7, 0, 0, 255, 44, 1, 0, 255]);
    expect(Array.from(decodeRegionIds(rgba))).toEqual([0, 7, 300]);
  });
});

describe('거의 다 칠하면 나머지를 채운다', () => {
  /** 넓은 칸 1 (가로 200 x 세로 100) 과 작은 칸 2 (오른쪽 아래 4 x 4) */
  const BW = 200;
  const BH = 104;
  function bigEngine(): PaintEngine {
    const ids = new Uint16Array(BW * BH).fill(1);
    for (let y = 100; y < 104; y++) for (let x = 196; x < 200; x++) ids[y * BW + x] = 2;
    return new PaintEngine(BW, BH, ids);
  }
  const at = (engine: PaintEngine, x: number, y: number) => Array.from(engine.pixels.subarray((y * BW + x) * 4, (y * BW + x) * 4 + 4));
  /** 칸 1 을 왼쪽에서부터 columns 줄만 빼고 미리 칠해 둔다 */
  function prepaint(engine: PaintEngine, emptyColumns: number): void {
    const saved = new Uint8ClampedArray(BW * BH * 4);
    for (let y = 0; y < BH; y++) {
      for (let x = emptyColumns; x < BW; x++) if (!(y >= 100 && x >= 196)) saved.set([...BLUE, 255], (y * BW + x) * 4);
    }
    engine.loadPixels(saved);
  }
  const touch = (engine: PaintEngine, color: Rgb, x: number, y: number) => {
    engine.setBrush({ kind: 'paint', color });
    engine.setRadius(1);
    engine.beginStroke(x, y);
    engine.endStroke();
  };

  it('칸을 99% 넘게 칠하면 남은 곳을 가까이 칠한 색으로 채운다', () => {
    const engine = bigEngine();
    prepaint(engine, 1); // 맨 왼쪽 한 줄(약 0.5%)만 빈다
    expect(engine.isFilled(1)).toBe(false);
    touch(engine, BLUE, 100, 50);
    expect(engine.isFilled(1)).toBe(true);
    expect(at(engine, 0, 30)).toEqual([...BLUE, 255]);
  });

  it('99% 에 못 미치면 채우지 않는다', () => {
    const engine = bigEngine();
    prepaint(engine, 4); // 약 2% 가 빈다
    touch(engine, BLUE, 100, 50);
    expect(engine.isFilled(1)).toBe(false);
    expect(at(engine, 0, 30)[3]).toBe(0);
  });

  it('그림 전체를 99% 넘게 칠하면 아직 칠하지 않은 칸을 번호 색으로 채워 끝낸다', () => {
    const engine = bigEngine();
    engine.setRegionColors((region) => (region === 2 ? RED : null));
    prepaint(engine, 0); // 칸 1 은 다 칠했고 작은 칸 2 만 남았다
    expect(engine.filledCount()).toBe(1);
    touch(engine, BLUE, 100, 50);
    expect(engine.filledCount()).toBe(2);
    expect(at(engine, 198, 102)).toEqual([...RED, 255]);
    // 채운 것도 그 스트로크와 함께 되돌려진다
    engine.undo();
    expect(engine.filledCount()).toBe(1);
    expect(at(engine, 198, 102)[3]).toBe(0);
  });

  it('번호 색을 모르면 그림 전체를 채우지 않는다', () => {
    const engine = bigEngine();
    prepaint(engine, 0);
    touch(engine, BLUE, 100, 50);
    expect(engine.isFilled(2)).toBe(false);
  });
});
