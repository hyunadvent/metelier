import { describe, expect, it } from 'vitest';
import { EXCLUDED } from '../src/editor/exportPainting';
import { groupColors, paintingFromPair } from '../src/editor/fromPair';

/** 흰 종이에 검은 선으로 테두리를 그린 사각형들, 그리고 그 안을 칠한 완성본 */
function pair(width: number, height: number, boxes: { x: number; y: number; w: number; h: number; color: number[] }[]) {
  const lines = new Uint8ClampedArray(width * height * 4).fill(255);
  const colored = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const b of boxes) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const o = (y * width + x) * 4;
        const edge = x < b.x + 2 || x >= b.x + b.w - 2 || y < b.y + 2 || y >= b.y + b.h - 2;
        const c = edge ? [40, 30, 30] : b.color;
        if (edge) lines.set([40, 30, 30], o);
        colored.set(c, o);
      }
    }
  }
  return { lines, colored };
}

describe('선화와 완성본으로 그림 만들기', () => {
  it('칸마다 완성본의 색을 물감으로 쓰고, 같은 색은 한 번호로 묶는다', () => {
    const { lines, colored } = pair(120, 60, [
      { x: 5, y: 5, w: 40, h: 40, color: [255, 216, 102] },
      { x: 60, y: 5, w: 40, h: 40, color: [255, 216, 102] },
    ]);
    const p = paintingFromPair(lines, colored, 120, 60, { threshold: 110, minArea: 10, minPaintable: 50, mergeDistance: 22 });
    // 바탕 + 사각형 둘. 두 사각형은 같은 물감
    expect(p.regions).toHaveLength(3);
    const at = (x: number, y: number) => p.assignment[p.seg.ids[y * 120 + x] - 1];
    expect(at(25, 25)).toBe(at(80, 25));
    expect(p.palette.map((e) => e.color)).toEqual(['#FFFFFF', '#FFD866']);
  });

  it('아주 작은 칸은 칠하지 않는 칸으로 둔다', () => {
    const { lines, colored } = pair(80, 80, [{ x: 30, y: 30, w: 9, h: 9, color: [255, 255, 255] }]);
    const p = paintingFromPair(lines, colored, 80, 80, { threshold: 110, minArea: 10, minPaintable: 60, mergeDistance: 22 });
    const tiny = p.seg.ids[34 * 80 + 34];
    expect(p.assignment[tiny - 1]).toBe(EXCLUDED);
  });

  it('비슷한 색은 묶고, 넓게 쓰인 색이 앞 번호가 된다', () => {
    const { palette, groupOf } = groupColors(
      [
        [250, 250, 250],
        [255, 255, 255],
        [90, 110, 180],
      ],
      [100, 50, 900],
      22,
    );
    expect(palette).toEqual([
      [90, 110, 180],
      [250, 250, 250],
    ]);
    expect(groupOf).toEqual([1, 1, 0]);
  });
});
