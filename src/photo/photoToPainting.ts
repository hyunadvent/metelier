// 사진 한 장을 색칠 그림으로 바꾼다: 만화풍으로 다듬기 → 색 묶기 → 칸 나누기 → 선화와 번호.
// 모든 계산은 브라우저 안에서 하며, 사진을 어디에도 보내지 않는다.
import type { PaletteEntry } from '../coloring/painting';
import { describeRegions, type RegionInfo, type Segmentation } from '../editor/segment';
import { closeHoles, dilate, erode, featureLines, fillHolesWithSkin, flattenSkin, luminance, skinMask, upscaleMap } from './faceLines';
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
  /**
   * 사람의 눈·코·입을 칸으로 나누지 않고 선으로 남긴다.
   * 살색인 곳 안의 작은 무늬는 얼굴 칸에 합치고, 그 자리에 어두운 선을 그려 표정이 보이게 한다.
   */
  faceLines: boolean;
  /**
   * 검정에 가까운 곳을 칸으로 나누지 않고 선화에 검게 채운 채로 둔다. 0 이면 끈다.
   * 값은 "밝기 + 색의 진하기 x 2" 의 상한이다 (밝기는 0 = 검정, 100 = 흰색).
   * 색 기운이 있는 어두운 색(짙은 남색 바지)은 같은 밝기의 검정보다 늦게 채워진다.
   */
  blackFill: number;
}

/** 검게 채운 곳을 나타내는 색 묶음 번호. 물감 묶음(0..253)과 겹치지 않는다. */
const BLACK = 255;
/** 확실히 검은 곳과 이어져 있으면, 기준보다 이만큼 덜 어두운 곳까지 함께 채운다. */
const BLACK_SPREAD = 12;

export const DEFAULT_PHOTO_OPTIONS: PhotoOptions = {
  colors: 14,
  maxRegions: 160,
  outputSize: 2048,
  workSize: 1024,
  smoothing: 2,
  faceLines: true,
  blackFill: 30,
};

export interface PhotoPainting {
  width: number;
  height: number;
  /** 픽셀마다 칸 번호 (1..regions.length). 검게 채운 곳은 0 이며 칠할 수 없다. */
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
 * @param detail 결과 크기(긴 변 options.outputSize)로 맞춘 같은 사진. 주면 얼굴의 선을 더 정밀하게 뽑는다.
 * @param onStage 단계가 바뀔 때마다 불린다. 화면에 진행 상황을 보여 주고 싶으면 여기서 기다렸다가 돌아오면 된다.
 */
export async function photoToPainting(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: PhotoOptions = DEFAULT_PHOTO_OPTIONS,
  onStage?: (stage: PhotoStage) => void | Promise<void>,
  detail?: { width: number; height: number; rgba: Uint8ClampedArray },
): Promise<PhotoPainting> {
  // 1. 만화풍으로 다듬기: 윤곽은 남기고 자잘한 무늬를 뭉갠다
  await onStage?.('smooth');
  let smoothed = rgba;
  for (let pass = 0; pass < Math.round(options.smoothing); pass++) {
    smoothed = bilateral(smoothed, width, height, 4, 3, 28);
  }

  // 1-1. 얼굴은 다듬지 않는다: 살색인 곳(과 그 안의 눈·입)은 원본 그대로 되돌린다.
  // 다듬으면 작은 얼굴의 눈·코·입이 살색에 섞여 사라지기 때문이다.
  // 살색인 곳은 다듬은 사진에서 찾는다 (원본은 픽셀마다 색이 흔들려 구멍이 많이 난다).
  const reach = Math.max(4, Math.round(Math.max(width, height) / 130));
  const skin = options.faceLines ? skinMask(smoothed) : null;
  const closed = skin ? closeHoles(skin, width, height, reach) : null;
  if (closed && smoothed !== rgba) {
    const keep = dilate(closed, width, height, 2);
    for (let i = 0; i < keep.length; i++) {
      if (!keep[i]) continue;
      const o = i * 4;
      smoothed[o] = rgba[o];
      smoothed[o + 1] = rgba[o + 1];
      smoothed[o + 2] = rgba[o + 2];
    }
  }

  // 2. 색 묶기: 비슷한 색을 물감 수만큼의 묶음으로 나눈다
  await onStage?.('colors');
  const lab = toLab(smoothed);
  // 검정에 가까운 곳: 물감 색으로 뽑지 않고 선화에 검게 채워 둔다. 얼굴 안(눈, 눈썹)은 선으로 따로 다루므로 뺀다.
  let black: Uint8Array | null = null;
  if (options.blackFill > 0) {
    // 2 = 확실히 검정, 1 = 검정에 꽤 가까움
    const level = new Uint8Array(lab.length / 3);
    for (let i = 0; i < level.length; i++) {
      if (closed && closed[i]) continue;
      const darkness = lab[i * 3] + Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]) * 2;
      if (darkness < options.blackFill) level[i] = 2;
      else if (darkness < options.blackFill + BLACK_SPREAD) level[i] = 1;
    }
    // 확실히 검은 곳에서 출발해, 이어져 있는 "꽤 가까운" 곳까지 넓힌다.
    // 한 물건(짙은 바지, 검은 옷)이 그늘진 부분만 얼룩덜룩하게 검어지지 않고 통째로 채워지게 한다.
    const dark = new Uint8Array(level.length);
    const queue = new Int32Array(level.length);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < level.length; i++) {
      if (level[i] === 2) {
        dark[i] = 1;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const grow = (j: number) => {
        if (dark[j] || level[j] === 0) return;
        dark[j] = 1;
        queue[tail++] = j;
      };
      if (x > 0) grow(i - 1);
      if (x < width - 1) grow(i + 1);
      if (i >= width) grow(i - width);
      if (i < level.length - width) grow(i + width);
    }
    // 점처럼 흩어진 것은 지우고 가장자리를 다듬는다
    black = modeFilter(dark, width, height, 1, 2);
  }
  for (let i = 0; i < lab.length; i += 3) {
    lab[i + 1] *= CHROMA_WEIGHT;
    lab[i + 2] *= CHROMA_WEIGHT;
  }
  const { labels: rough, k } = quantize(lab, options.colors, 7, black ?? undefined);
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
    // 검게 채운 곳은 어느 물감 색과도 멀다고 본다: 작은 칸이 검정보다는 색이 있는 이웃에 합쳐지게 한다
    if (a === BLACK || b === BLACK) return 90;
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
  if (black) for (let i = 0; i < labels.length; i++) if (black[i]) labels[i] = BLACK;

  // 2-1. 얼굴: 눈·코·입을 칸이 아니라 선으로 남긴다
  // 선을 그려도 되는 곳(작업 크기)과, 얼굴의 크기를 짐작한 값
  let face: { inside: Uint8Array; size: number } | null = null;
  if (skin && closed) {
    // 살색 안에 뚫린 작은 구멍(눈, 입, 콧구멍)을 얼굴과 같은 색 묶음으로 메운다
    fillHolesWithSkin(labels, skin, closed, width, height);
    // 얼굴과 팔을 한 가지 살색 면으로 만든다 (명암으로 쪼개진 칸을 없앤다)
    const largest = flattenSkin(labels, closed, width, height, k);
    // 가장 큰 살색 면의 넓이로 얼굴의 폭을 짐작한다. 한 면으로 만든 것이 없으면 사진 크기로 어림한다.
    const size = largest > 0 ? Math.sqrt(largest) : Math.sqrt(width * height) * 0.25;
    // 살색 면의 테두리(머리카락, 옷과 맞닿은 곳)는 뺀다: 거기는 칸의 경계선이 이미 있다
    face = { inside: erode(closed, width, height, Math.max(2, Math.round(size / 22))), size };
  }

  // 3. 결과 크기로 늘린 뒤 칸을 정리한다
  await onStage?.('regions');
  const out = fitSize(width, height, options.outputSize);
  let big = out.width === width && out.height === height ? labels : upscaleLabels(labels, width, height, out.width, out.height);
  if (big !== labels) big = modeFilter(big, out.width, out.height, 2, black ? 256 : k);
  const total = out.width * out.height;

  // 너무 작은 칸은 번호를 적거나 칠하기 어렵다: 이웃 칸에 합친다.
  // 그래도 칸이 너무 많으면 기준을 조금씩 올려 가며 더 합친다.
  let minArea = Math.max(4, Math.round(total * 0.0003));
  // 검게 채운 곳은 칠하는 칸이 아니므로 가늘거나 작아도 그대로 둔다 (가는 검은 줄이 그림에 남는다).
  // 먼지처럼 아주 작은 것만 이웃에 합친다.
  const blackDust = Math.max(4, Math.round(total * 0.00002));
  let comp = components(big, out.width, out.height);
  for (let round = 0; round < 60; round++) {
    const selected = new Uint8Array(comp.count + 1);
    let small = 0;
    let paintable = 0;
    for (let id = 1; id <= comp.count; id++) {
      const isBlack = comp.labelOf[id] === BLACK;
      if (!isBlack) paintable++;
      if (comp.sizes[id] < (isBlack ? blackDust : minArea)) {
        selected[id] = 1;
        small++;
      }
    }
    if (small === 0) {
      if (paintable <= options.maxRegions) break;
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
      if (comp.labelOf[r.id] !== BLACK && r.clearance < Math.max(3, out.width / 400) && comp.count - thin > 1) {
        selected[r.id] = 1;
        thin++;
      }
    }
    if (thin === 0 || absorb(big, out.width, out.height, comp, selected, colorDistance) === 0) break;
    comp = components(big, out.width, out.height);
  }

  // 4. 선화와 번호
  await onStage?.('lines');
  const darkness = drawLines(comp.ids, out.width, out.height, Math.max(1.5, out.width / 850));
  if (face) {
    // 얼굴의 선은 결과 크기에서 뽑는다. 작업 크기에서 뽑아 늘리면 작은 얼굴의 선이 뭉개진다.
    const up = out.width / width;
    const lum =
      detail && detail.width === out.width && detail.height === out.height
        ? luminance(detail.rgba)
        : upscaleMap(luminance(rgba), width, height, out.width, out.height);
    const inside = new Float32Array(face.inside.length);
    for (let i = 0; i < inside.length; i++) inside[i] = face.inside[i];
    const insideBig = upscaleMap(inside, width, height, out.width, out.height);
    const mask = new Uint8Array(insideBig.length);
    for (let i = 0; i < mask.length; i++) mask[i] = insideBig[i] > 0.5 ? 1 : 0;
    // 얼굴 폭에 비례해 선의 기본 굵기를 정한다. 작은 얼굴일수록 가는 선이 된다.
    const sigma = Math.min(3.2, Math.max(1, (face.size * up) / 190));
    const ink = featureLines(lum, out.width, out.height, mask, sigma);
    for (let i = 0; i < darkness.length; i++) {
      const line = Math.round(ink[i] * 255);
      if (line > darkness[i]) darkness[i] = line;
    }
  }
  // 칠하는 칸에만 번호를 매긴다. 검게 채운 곳은 칸 번호 0 (칠할 수 없는 곳) 이 되고 선화에 검게 그려진다.
  const newId = new Uint16Array(comp.count + 1);
  const labelOfRegion: number[] = [0];
  for (let id = 1; id <= comp.count; id++) {
    if (comp.labelOf[id] === BLACK) continue;
    newId[id] = labelOfRegion.length;
    labelOfRegion.push(comp.labelOf[id]);
  }
  const ids = new Uint16Array(total);
  for (let i = 0; i < total; i++) {
    ids[i] = newId[comp.ids[i]];
    if (big[i] === BLACK) darkness[i] = 255;
  }
  const seg: Segmentation = { ids, count: labelOfRegion.length - 1 };
  const regions = describeRegions(seg, out.width, out.height, darkness, 128);

  // 묶음마다의 색: 다듬은 사진에서 그 묶음에 속한 픽셀들의 평균. 원본의 색을 그대로 따른다.
  const sums = new Float64Array(k * 4);
  for (let y = 0; y < out.height; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / out.height));
    for (let x = 0; x < out.width; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / out.width));
      const label = big[y * out.width + x];
      if (label === BLACK) continue;
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
    assignment: regions.map((r) => numberOf[labelOfRegion[r.id]]),
    palette,
    smoothed: { width, height, rgba: smoothed },
  };
}
