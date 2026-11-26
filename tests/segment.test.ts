import { describe, expect, it } from 'vitest';
import { clusterColors, describeRegions, meanColors, segment, toDarkness } from '../src/editor/segment';

const W = 60;
const H = 30;

/** 흰 바탕에 테두리와 가운데 세로선(x = 29, 30)을 그린다. gap 을 주면 세로선의 그 y 범위를 비운다. */
function lineArt(gap?: [number, number]): Uint8Array {
  const d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
      const divider = (x === 29 || x === 30) && !(gap && y >= gap[0] && y < gap[1]);
      if (border || divider) d[y * W + x] = 255;
    }
  }
  return d;
}

const OPTIONS = { threshold: 128, gapRadius: 0, minArea: 10 };

describe('segment', () => {
  it('선으로 나뉜 영역을 각각의 칸으로 만든다', () => {
    const seg = segment(lineArt(), W, H, OPTIONS);
    expect(seg.count).toBe(2);
    expect(seg.ids[10 * W + 10]).toBe(1);
    expect(seg.ids[10 * W + 50]).toBe(2);
  });

  it('선 아래를 포함해 모든 픽셀이 가까운 칸에 속한다', () => {
    const seg = segment(lineArt(), W, H, OPTIONS);
    expect(seg.ids.every((id) => id === 1 || id === 2)).toBe(true);
    expect(seg.ids[10 * W + 29]).toBe(1); // 가운데 선의 왼쪽 절반
    expect(seg.ids[10 * W + 30]).toBe(2); // 오른쪽 절반
    expect(seg.ids[0]).toBe(1); // 테두리 아래
  });

  it('선이 끊겨 있으면 칸이 합쳐지고, 틈 메우기를 켜면 다시 나뉜다', () => {
    const art = lineArt([14, 17]); // 3픽셀 틈
    expect(segment(art, W, H, OPTIONS).count).toBe(1);
    expect(segment(art, W, H, { ...OPTIONS, gapRadius: 2 }).count).toBe(2);
  });

  it('너무 작은 칸은 주변 칸에 합친다', () => {
    const art = lineArt();
    // 왼쪽 칸 안에 3 x 3 짜리 닫힌 작은 방을 만든다
    for (let y = 8; y < 13; y++) {
      for (let x = 8; x < 13; x++) {
        if (x === 8 || x === 12 || y === 8 || y === 12) art[y * W + x] = 255;
      }
    }
    expect(segment(art, W, H, { ...OPTIONS, minArea: 1 }).count).toBe(3);
    const seg = segment(art, W, H, OPTIONS);
    expect(seg.count).toBe(2);
    expect(seg.ids[10 * W + 10]).toBe(1);
  });

  it('선이 없으면 그림 전체가 한 칸이다', () => {
    const seg = segment(new Uint8Array(W * H), W, H, OPTIONS);
    expect(seg.count).toBe(1);
    expect(seg.ids.every((id) => id === 1)).toBe(true);
  });

  it('칸이 하나도 없으면 ID 가 모두 0 이다', () => {
    const seg = segment(new Uint8Array(W * H).fill(255), W, H, OPTIONS);
    expect(seg.count).toBe(0);
    expect(seg.ids.every((id) => id === 0)).toBe(true);
  });
});

describe('describeRegions', () => {
  it('번호 자리는 칸 안쪽, 선에서 떨어진 곳이다', () => {
    const art = lineArt();
    const seg = segment(art, W, H, OPTIONS);
    const regions = describeRegions(seg, W, H, art);
    expect(regions).toHaveLength(2);
    for (const r of regions) {
      expect(seg.ids[r.y * W + r.x]).toBe(r.id);
      expect(art[r.y * W + r.x]).toBe(0);
      expect(r.clearance).toBeGreaterThan(8);
    }
    expect(regions[0].pixels + regions[1].pixels).toBe(W * H);
  });
});

describe('toDarkness', () => {
  it('검정은 255, 흰색과 투명은 0', () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
    expect(Array.from(toDarkness(rgba))).toEqual([255, 0, 0]);
  });
});

describe('색 자동 지정', () => {
  it('완성 예시에서 칸의 평균 색을 구하고 비슷한 색끼리 묶는다', () => {
    const art = lineArt();
    const seg = segment(art, W, H, OPTIONS);
    const reference = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const left = i % W < 30;
      reference.set(left ? [200, 40, 40, 255] : [40, 60, 210, 255], i * 4);
    }
    const colors = meanColors(seg, reference, art, 128);
    expect(colors[0].map(Math.round)).toEqual([200, 40, 40]);
    expect(colors[1].map(Math.round)).toEqual([40, 60, 210]);
  });

  it('k-평균: 넓은 묶음이 앞 번호를 받는다', () => {
    const colors = [
      [250, 10, 10],
      [10, 10, 250],
      [240, 20, 20],
      [12, 8, 245],
      [10, 240, 10],
    ];
    const weights = [100, 500, 100, 500, 50];
    const { centers, assignment } = clusterColors(colors, weights, 3);
    expect(centers).toHaveLength(3);
    expect(assignment).toEqual([1, 0, 1, 0, 2]);
    expect(centers[0][2]).toBeGreaterThan(240); // 파랑이 가장 넓다
  });

  it('색 수가 칸 수보다 많으면 칸 수만큼만 만든다', () => {
    const { centers } = clusterColors([[1, 2, 3]], [1], 9);
    expect(centers).toHaveLength(1);
  });
});
