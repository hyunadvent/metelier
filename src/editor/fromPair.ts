import type { PaletteEntry } from '../coloring/painting';
import { EXCLUDED, rgbToHex, type Assignment } from './exportPainting';
import { describeRegions, segment, toDarkness, type RegionInfo, type Segmentation } from './segment';

/**
 * 선화와 그것을 칠한 완성본 한 쌍으로 색칠 그림을 만든다.
 * - 칸은 선화에서 나눈다 (선이 닫힌 곳마다 한 칸).
 * - 칸의 물감 색은 완성본에서 그 칸의 가운데 값으로 정한다. 선 가까이는 보지 않는다 (번진 선 색이 섞이지 않게).
 * - 거의 같은 색은 한 물감 번호로 묶는다. 넓게 쓰인 색이 앞 번호다.
 * - 아주 작은 칸(눈의 반짝이 같은 것)은 칠하지 않는 칸으로 남긴다.
 * DOM 과 무관하다.
 */
export interface PairOptions {
  /** 선으로 보는 어두운 정도 (0~255) */
  threshold: number;
  /** 이보다 작은 덩어리는 칸이 되지 않고 이웃 칸에 붙는다 (픽셀 수) */
  minArea: number;
  /** 이보다 작은 칸은 칠하지 않는 칸으로 둔다 (픽셀 수) */
  minPaintable: number;
  /** 이 거리(RGB) 안의 색은 한 물감으로 묶는다 */
  mergeDistance: number;
}

export const DEFAULT_PAIR_OPTIONS: PairOptions = { threshold: 110, minArea: 40, minPaintable: 260, mergeDistance: 22 };

export interface PairPainting {
  width: number;
  height: number;
  darkness: Uint8Array;
  seg: Segmentation;
  regions: RegionInfo[];
  assignment: Assignment[];
  palette: PaletteEntry[];
}

/** 칸마다 완성본의 색 (채널마다 가운데 값). 선과 그 둘레는 뺀다. */
export function regionColors(seg: Segmentation, colored: Uint8ClampedArray | Uint8Array, darkness: Uint8Array, clear = 24): number[][] {
  const hist = new Uint32Array(seg.count * 768);
  const counts = new Uint32Array(seg.count);
  const fallback = new Float64Array(seg.count * 4);
  for (let i = 0; i < seg.ids.length; i++) {
    const id = seg.ids[i];
    if (!id) continue;
    const k = id - 1;
    const o = i * 4;
    fallback[k * 4] += colored[o];
    fallback[k * 4 + 1] += colored[o + 1];
    fallback[k * 4 + 2] += colored[o + 2];
    fallback[k * 4 + 3]++;
    if (darkness[i] > clear) continue;
    counts[k]++;
    hist[k * 768 + colored[o]]++;
    hist[k * 768 + 256 + colored[o + 1]]++;
    hist[k * 768 + 512 + colored[o + 2]]++;
  }
  return Array.from({ length: seg.count }, (_, k) => {
    const n = counts[k];
    if (n === 0) {
      const m = fallback[k * 4 + 3] || 1;
      return [fallback[k * 4] / m, fallback[k * 4 + 1] / m, fallback[k * 4 + 2] / m];
    }
    return [0, 1, 2].map((c) => {
      let seen = 0;
      let v = 0;
      while (v < 255 && seen + hist[k * 768 + c * 256 + v] <= n / 2) seen += hist[k * 768 + c * 256 + v++];
      return v;
    });
  });
}

/** 비슷한 색을 묶어 물감을 정한다. 넓은 칸의 색이 그 물감의 색이 된다. */
export function groupColors(colors: number[][], areas: number[], mergeDistance: number): { palette: number[][]; groupOf: number[] } {
  const order = colors.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  const palette: number[][] = [];
  const area: number[] = [];
  const groupOf = new Array<number>(colors.length).fill(-1);
  for (const i of order) {
    const c = colors[i];
    let best = -1;
    let bestDistance = mergeDistance;
    palette.forEach((p, g) => {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      if (d <= bestDistance) {
        best = g;
        bestDistance = d;
      }
    });
    if (best < 0) {
      best = palette.length;
      palette.push(c.map(Math.round));
      area.push(0);
    }
    area[best] += areas[i];
    groupOf[i] = best;
  }
  // 넓게 쓰인 물감이 앞 번호
  const rank = palette.map((_, g) => g).sort((a, b) => area[b] - area[a]);
  const newIndex = new Array<number>(palette.length);
  rank.forEach((g, r) => (newIndex[g] = r));
  return { palette: rank.map((g) => palette[g]), groupOf: groupOf.map((g) => newIndex[g]) };
}

export function paintingFromPair(
  lines: Uint8ClampedArray | Uint8Array,
  colored: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: PairOptions = DEFAULT_PAIR_OPTIONS,
): PairPainting {
  const darkness = toDarkness(lines);
  const seg = segment(darkness, width, height, { threshold: options.threshold, gapRadius: 0, minArea: options.minArea });
  const regions = describeRegions(seg, width, height, darkness, options.threshold);
  const colors = regionColors(seg, colored, darkness);
  const paintable = regions.map((r) => r.pixels >= options.minPaintable);
  const kept = regions.map((_, i) => i).filter((i) => paintable[i]);
  const { palette, groupOf } = groupColors(
    kept.map((i) => colors[i]),
    kept.map((i) => regions[i].pixels),
    options.mergeDistance,
  );
  const assignment: Assignment[] = regions.map(() => EXCLUDED);
  kept.forEach((i, k) => (assignment[i] = groupOf[k] + 1));
  return {
    width,
    height,
    darkness,
    seg,
    regions,
    assignment,
    palette: palette.map((c, g) => ({ number: g + 1, color: rgbToHex(c) })),
  };
}
