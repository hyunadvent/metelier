// 사진 한 장을 색칠 그림으로 바꾼다: 만화풍으로 다듬기 → 색 묶기 → 칸 나누기 → 선화와 번호.
// 모든 계산은 브라우저 안에서 하며, 사진을 어디에도 보내지 않는다.
import type { PaletteEntry } from '../coloring/painting';
import { describeRegions, type RegionInfo, type Segmentation } from '../editor/segment';
import { absorb, bilateral, components, modeFilter, quantize, toLab, upscaleLabels } from './imageOps';

export interface PhotoOptions {
  /** 물감 색의 수 (번호의 수) */
  colors: number;
  /** 칸의 수가 이보다 많으면 작은 칸부터 합친다 */
  maxRegions: number;
  /** 결과 그림의 긴 변 (픽셀). 색칠 화면의 칠 해상도다. */
  outputSize: number;
  /** 색을 묶을 때 쓰는 작업 크기의 긴 변 (픽셀). 작을수록 빠르다. */
  workSize: number;
  /** 다듬는 세기 (0~3). 클수록 자잘한 무늬가 사라지고 면이 평평해진다. */
  smoothing: number;
}

export const DEFAULT_PHOTO_OPTIONS: PhotoOptions = {
  colors: 14,
  maxRegions: 160,
  outputSize: 2048,
  workSize: 1024,
  smoothing: 2,
};

export interface PhotoPainting {
  width: number;
  height: number;
  /** 픽셀마다 칸 번호 (1..regions.length). 모든 픽셀이 어느 칸에 속한다. */
  seg: Segmentation;
  /** 선화: 픽셀마다 선의 진하기 (0~255) */
  darkness: Uint8Array;
  /** 칸마다 번호 자리와 크기 */
  regions: RegionInfo[];
  /** 칸마다 칠할 물감 번호 (regions 와 같은 순서) */
  assignment: number[];
  /** 번호와 색. 넓게 쓰이는 색이 앞 번호다. */
  palette: PaletteEntry[];
  /** 만화풍으로 다듬은 사진 (작업 크기). 변환 과정을 보여 줄 때 쓴다. */
  smoothed: { width: number; height: number; rgba: Uint8ClampedArray };
}

export type PhotoStage = 'smooth' | 'colors' | 'regions' | 'lines';

/** 긴 변이 size 가 되도록 맞춘 크기 */
export function fitSize(width: number, height: number, size: number): { width: number; height: number } {
  const scale = size / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 색을 묶을 때 색상·채도의 차이를 밝기 차이보다 이만큼 더 크게 본다.
 * 사진은 한 가지 색조의 밝기 변화가 넓은 면적을 차지하기 쉬워서, 그대로 묶으면
 * 비슷한 색의 명암만 여러 번호가 되고 작지만 눈에 띄는 색(초록 잎, 분홍 꽃)은 번호를 얻지 못한다.
 */
const CHROMA_WEIGHT = 1.7;

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** 칸 경계를 따라 일정한 굵기의 선을 그린다. 경계에서 만들므로 모든 칸이 닫혀 있다. */
function drawLines(ids: Int32Array | Uint16Array, width: number, height: number, halfWidth: number): Uint8Array {
  const alpha = new Float32Array(width * height);
  const reach = Math.ceil(halfWidth + 1);
  const splat = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(width - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(height - 1, Math.ceil(cy + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.min(1, Math.max(0, halfWidth - d + 0.5));
        const i = y * width + x;
        if (a > alpha[i]) alpha[i] = a;
      }
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = ids[y * width + x];
      if (x + 1 < width && ids[y * width + x + 1] !== id) splat(x + 1, y + 0.5);
      if (y + 1 < height && ids[(y + 1) * width + x] !== id) splat(x + 0.5, y + 1);
    }
  }
  const darkness = new Uint8Array(width * height);
  for (let i = 0; i < darkness.length; i++) darkness[i] = Math.round(alpha[i] * 255);
  return darkness;
}

/**
 * 사진을 색칠 그림으로 바꾼다.
 * @param rgba 작업 크기로 맞춘 사진의 픽셀. 긴 변이 options.workSize 이하여야 한다.
 * @param onStage 단계가 바뀔 때마다 불린다. 화면에 진행 상황을 보여 주고 싶으면 여기서 기다렸다가 돌아오면 된다.
 */
export async function photoToPainting(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: PhotoOptions = DEFAULT_PHOTO_OPTIONS,
  onStage?: (stage: PhotoStage) => void | Promise<void>,
): Promise<PhotoPainting> {
  // 1. 만화풍으로 다듬기: 윤곽은 남기고 자잘한 무늬를 뭉갠다
  await onStage?.('smooth');
  let smoothed = rgba;
  for (let pass = 0; pass < Math.round(options.smoothing); pass++) {
    smoothed = bilateral(smoothed, width, height, 4, 3, 28);
  }

  // 2. 색 묶기: 비슷한 색을 물감 수만큼의 묶음으로 나눈다
  await onStage?.('colors');
  const lab = toLab(smoothed);
  for (let i = 0; i < lab.length; i += 3) {
    lab[i + 1] *= CHROMA_WEIGHT;
    lab[i + 2] *= CHROMA_WEIGHT;
  }
  const { labels: rough, k } = quantize(lab, options.colors, 7);
  // 묶음마다의 대표 색 (칸을 합칠 때 색이 비슷한 이웃을 고르는 데 쓴다)
  const centers = new Float64Array(k * 4);
  for (let i = 0; i < rough.length; i++) {
    const c = rough[i] * 4;
    centers[c] += lab[i * 3];
    centers[c + 1] += lab[i * 3 + 1];
    centers[c + 2] += lab[i * 3 + 2];
    centers[c + 3]++;
  }
  const colorDistance = (a: number, b: number) => {
    const na = centers[a * 4 + 3] || 1;
    const nb = centers[b * 4 + 3] || 1;
    return Math.hypot(
      centers[a * 4] / na - centers[b * 4] / nb,
      centers[a * 4 + 1] / na - centers[b * 4 + 1] / nb,
      centers[a * 4 + 2] / na - centers[b * 4 + 2] / nb,
    );
  };
  let labels = modeFilter(rough, width, height, 2, k);
  labels = modeFilter(labels, width, height, 2, k);

  // 3. 결과 크기로 늘린 뒤 칸을 정리한다
  await onStage?.('regions');
  const out = fitSize(width, height, options.outputSize);
  let big = out.width === width && out.height === height ? labels : upscaleLabels(labels, width, height, out.width, out.height);
  if (big !== labels) big = modeFilter(big, out.width, out.height, 2, k);
  const total = out.width * out.height;

  // 너무 작은 칸은 번호를 적거나 칠하기 어렵다: 이웃 칸에 합친다.
  // 그래도 칸이 너무 많으면 기준을 조금씩 올려 가며 더 합친다.
  let minArea = Math.max(4, Math.round(total * 0.0003));
  let comp = components(big, out.width, out.height);
  for (let round = 0; round < 60; round++) {
    const selected = new Uint8Array(comp.count + 1);
    let small = 0;
    for (let id = 1; id <= comp.count; id++) {
      if (comp.sizes[id] < minArea) {
        selected[id] = 1;
        small++;
      }
    }
    if (small === 0) {
      if (comp.count <= options.maxRegions) break;
      minArea = Math.ceil(minArea * 1.35);
      continue;
    }
    if (absorb(big, out.width, out.height, comp, selected, colorDistance) === 0) break;
    comp = components(big, out.width, out.height);
  }

  // 실처럼 가느다란 칸도 칠하기 어렵다: 번호를 놓을 자리의 여유가 거의 없는 칸을 한 번 더 합친다.
  for (let round = 0; round < 3; round++) {
    const seg: Segmentation = { ids: Uint16Array.from(comp.ids), count: comp.count };
    const info = describeRegions(seg, out.width, out.height);
    const selected = new Uint8Array(comp.count + 1);
    let thin = 0;
    for (const r of info) {
      if (r.clearance < Math.max(3, out.width / 400) && comp.count - thin > 1) {
        selected[r.id] = 1;
        thin++;
      }
    }
    if (thin === 0 || absorb(big, out.width, out.height, comp, selected, colorDistance) === 0) break;
    comp = components(big, out.width, out.height);
  }

  // 4. 선화와 번호
  await onStage?.('lines');
  const darkness = drawLines(comp.ids, out.width, out.height, Math.max(1.5, out.width / 700));
  const seg: Segmentation = { ids: Uint16Array.from(comp.ids), count: comp.count };
  const regions = describeRegions(seg, out.width, out.height, darkness, 128);

  // 묶음마다의 색: 다듬은 사진에서 그 묶음에 속한 픽셀들의 평균. 원본의 색을 그대로 따른다.
  const sums = new Float64Array(k * 4);
  for (let y = 0; y < out.height; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / out.height));
    for (let x = 0; x < out.width; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / out.width));
      const label = big[y * out.width + x];
      const o = (sy * width + sx) * 4;
      sums[label * 4] += smoothed[o];
      sums[label * 4 + 1] += smoothed[o + 1];
      sums[label * 4 + 2] += smoothed[o + 2];
      sums[label * 4 + 3]++;
    }
  }
  // 쓰이는 묶음에만 번호를 매긴다. 넓게 쓰이는 색이 앞 번호다.
  const used = [];
  for (let label = 0; label < k; label++) if (sums[label * 4 + 3] > 0) used.push(label);
  used.sort((a, b) => sums[b * 4 + 3] - sums[a * 4 + 3]);
  const numberOf = new Int16Array(k);
  const palette: PaletteEntry[] = used.map((label, index) => {
    numberOf[label] = index + 1;
    const count = sums[label * 4 + 3];
    return { number: index + 1, color: toHex(sums[label * 4] / count, sums[label * 4 + 1] / count, sums[label * 4 + 2] / count) };
  });

  return {
    width: out.width,
    height: out.height,
    seg,
    darkness,
    regions,
    assignment: regions.map((r) => numberOf[comp.labelOf[r.id]]),
    palette,
    smoothed: { width, height, rgba: smoothed },
  };
}
