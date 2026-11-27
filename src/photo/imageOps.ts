// 사진을 만화풍으로 바꾸는 데 쓰는 이미지 연산. DOM 과 무관한 순수 계산이다.

/** 매번 같은 결과가 나오도록 씨앗을 주는 난수 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 색 공간: 사람 눈이 느끼는 색 차이에 가까운 Lab 에서 색을 묶는다 ──

const LINEAR = new Float32Array(256);
for (let v = 0; v < 256; v++) {
  const c = v / 255;
  LINEAR[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** RGBA 픽셀들을 Lab (픽셀당 L, a, b) 로 바꾼다. */
export function toLab(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const n = rgba.length / 4;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = LINEAR[rgba[i * 4]];
    const g = LINEAR[rgba[i * 4 + 1]];
    const b = LINEAR[rgba[i * 4 + 2]];
    const x = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    lab[i * 3] = 116 * y - 16;
    lab[i * 3 + 1] = 500 * (x - y);
    lab[i * 3 + 2] = 200 * (y - z);
  }
  return lab;
}

// ── 다듬기: 윤곽은 남기고 자잘한 무늬와 잡티를 뭉갠다 ──

/**
 * 양방향 필터. 가까이 있고 색이 비슷한 픽셀끼리만 섞으므로 경계는 선명하게 남는다.
 * @param sigmaColor 클수록 색이 다른 픽셀과도 섞여 더 평평해진다 (0~255 기준)
 */
export function bilateral(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  sigmaSpace: number,
  sigmaColor: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const size = radius * 2 + 1;
  const spatial = new Float32Array(size * size);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      spatial[(dy + radius) * size + dx + radius] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace));
    }
  }
  // 색 차이(제곱)에 따른 가중치 표
  const range = new Float32Array(3 * 255 * 255 + 1);
  const k = 1 / (2 * sigmaColor * sigmaColor);
  for (let d = 0; d < range.length; d++) range[d] = Math.exp(-d * k);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const cr = rgba[o];
      const cg = rgba[o + 1];
      const cb = rgba[o + 2];
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sw = 0;
      for (let ny = y0; ny <= y1; ny++) {
        const row = (ny - y + radius) * size + radius - x;
        let p = (ny * width + x0) * 4;
        for (let nx = x0; nx <= x1; nx++, p += 4) {
          const dr = rgba[p] - cr;
          const dg = rgba[p + 1] - cg;
          const db = rgba[p + 2] - cb;
          const w = spatial[row + nx] * range[dr * dr + dg * dg + db * db];
          sr += rgba[p] * w;
          sg += rgba[p + 1] * w;
          sb += rgba[p + 2] * w;
          sw += w;
        }
      }
      out[o] = sr / sw;
      out[o + 1] = sg / sw;
      out[o + 2] = sb / sw;
      out[o + 3] = 255;
    }
  }
  return out;
}

// ── 색 묶기 ──

export interface Quantized {
  /** 픽셀마다 속한 색 묶음 (0..k-1) */
  labels: Uint8Array;
  k: number;
}

/**
 * 색을 k 개로 묶는다 (k-평균, Lab 색 공간).
 * 픽셀 일부만 뽑아 묶음의 중심을 정한 뒤, 모든 픽셀을 가장 가까운 묶음에 넣는다.
 */
export function quantize(lab: Float32Array, k: number, seed = 1): Quantized {
  const n = lab.length / 3;
  k = Math.max(1, Math.min(k, 255, n));
  const random = seededRandom(seed);
  const step = Math.max(1, Math.floor(n / 40000));
  const sample: number[] = [];
  for (let i = Math.floor(step / 2); i < n; i += step) sample.push(i);
  const m = sample.length;

  const centers = new Float32Array(k * 3);
  const dist2 = (i: number, c: number) => {
    const dl = lab[i * 3] - centers[c * 3];
    const da = lab[i * 3 + 1] - centers[c * 3 + 1];
    const db = lab[i * 3 + 2] - centers[c * 3 + 2];
    return dl * dl + da * da + db * db;
  };
  const setCenter = (c: number, i: number) => {
    centers[c * 3] = lab[i * 3];
    centers[c * 3 + 1] = lab[i * 3 + 1];
    centers[c * 3 + 2] = lab[i * 3 + 2];
  };

  // 시작점: 이미 고른 중심에서 먼 색일수록 다음 중심으로 뽑힐 가능성이 크다 (k-means++)
  setCenter(0, sample[Math.floor(random() * m)]);
  const nearest = new Float32Array(m).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let s = 0; s < m; s++) {
      const d = dist2(sample[s], c - 1);
      if (d < nearest[s]) nearest[s] = d;
      total += nearest[s];
    }
    let pick = random() * total;
    let chosen = m - 1;
    for (let s = 0; s < m; s++) {
      pick -= nearest[s];
      if (pick <= 0) {
        chosen = s;
        break;
      }
    }
    setCenter(c, sample[chosen]);
  }

  const assign = new Uint8Array(m);
  const sums = new Float64Array(k * 4);
  for (let iter = 0; iter < 16; iter++) {
    let changed = 0;
    sums.fill(0);
    for (let s = 0; s < m; s++) {
      const i = sample[s];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(i, c);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[s] !== best) {
        assign[s] = best;
        changed++;
      }
      sums[best * 4] += lab[i * 3];
      sums[best * 4 + 1] += lab[i * 3 + 1];
      sums[best * 4 + 2] += lab[i * 3 + 2];
      sums[best * 4 + 3]++;
    }
    for (let c = 0; c < k; c++) {
      const count = sums[c * 4 + 3];
      if (count > 0) {
        centers[c * 3] = sums[c * 4] / count;
        centers[c * 3 + 1] = sums[c * 4 + 1] / count;
        centers[c * 3 + 2] = sums[c * 4 + 2] / count;
      } else {
        // 비어 버린 묶음은 아무 픽셀이나 새 중심으로 삼는다
        setCenter(c, sample[Math.floor(random() * m)]);
      }
    }
    if (iter > 0 && changed < m * 0.002) break;
  }

  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = dist2(i, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    labels[i] = best;
  }
  return { labels, k };
}

// ── 묶음 지도 다듬기 ──

/**
 * 주변에서 가장 많은 묶음으로 바꾼다. 점처럼 흩어진 픽셀이 사라지고 경계가 둥글어진다.
 */
export function modeFilter(labels: Uint8Array, width: number, height: number, radius: number, k: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  const counts = new Uint16Array(k);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const own = labels[y * width + x];
      let best = own;
      let bestCount = 0;
      for (let ny = y0; ny <= y1; ny++) {
        for (let p = ny * width + x0, end = ny * width + x1; p <= end; p++) {
          const count = ++counts[labels[p]];
          // 수가 같으면 원래 묶음을 유지한다
          if (count > bestCount || (count === bestCount && labels[p] === own)) {
            bestCount = count;
            best = labels[p];
          }
        }
      }
      for (let ny = y0; ny <= y1; ny++) {
        for (let p = ny * width + x0, end = ny * width + x1; p <= end; p++) counts[labels[p]] = 0;
      }
      out[y * width + x] = best;
    }
  }
  return out;
}

/**
 * 묶음 지도를 더 큰 크기로 늘린다.
 * 새 픽셀마다 원래의 이웃 네 픽셀을 거리에 따라 가중해 가장 무거운 묶음을 고르므로,
 * 단순히 늘린 것보다 경계의 계단이 덜하다.
 */
export function upscaleLabels(labels: Uint8Array, width: number, height: number, outWidth: number, outHeight: number): Uint8Array {
  const out = new Uint8Array(outWidth * outHeight);
  const sx = width / outWidth;
  const sy = height / outHeight;
  for (let y = 0; y < outHeight; y++) {
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < outWidth; x++) {
      const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const tx = fx - x0;
      const a = labels[y0 * width + x0];
      const b = labels[y0 * width + x1];
      const c = labels[y1 * width + x0];
      const d = labels[y1 * width + x1];
      const wa = (1 - tx) * (1 - ty);
      const wb = tx * (1 - ty);
      const wc = (1 - tx) * ty;
      const wd = tx * ty;
      // 같은 묶음끼리 가중치를 더해 가장 무거운 것을 고른다
      const sa = wa + (b === a ? wb : 0) + (c === a ? wc : 0) + (d === a ? wd : 0);
      const sb = wb + (a === b ? wa : 0) + (c === b ? wc : 0) + (d === b ? wd : 0);
      const sc = wc + (a === c ? wa : 0) + (b === c ? wb : 0) + (d === c ? wd : 0);
      const sd = wd + (a === d ? wa : 0) + (b === d ? wb : 0) + (c === d ? wc : 0);
      let best = a;
      let bestW = sa;
      if (sb > bestW) {
        best = b;
        bestW = sb;
      }
      if (sc > bestW) {
        best = c;
        bestW = sc;
      }
      if (sd > bestW) best = d;
      out[y * outWidth + x] = best;
    }
  }
  return out;
}

// ── 칸 ──

export interface Components {
  /** 픽셀마다 칸 번호 (1..count) */
  ids: Int32Array;
  count: number;
  /** 칸 번호 → 픽셀 수 */
  sizes: Uint32Array;
  /** 칸 번호 → 색 묶음 */
  labelOf: Uint8Array;
}

/** 같은 묶음이 이어진 덩어리마다 칸 번호를 매긴다 (상하좌우 연결). */
export function components(labels: Uint8Array, width: number, height: number): Components {
  const n = width * height;
  const ids = new Int32Array(n);
  const stack = new Int32Array(n);
  const sizes: number[] = [0];
  const labelOf: number[] = [0];
  for (let start = 0; start < n; start++) {
    if (ids[start]) continue;
    const label = labels[start];
    const id = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    ids[start] = id;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % width;
      if (x > 0 && !ids[i - 1] && labels[i - 1] === label) {
        ids[i - 1] = id;
        stack[top++] = i - 1;
      }
      if (x < width - 1 && !ids[i + 1] && labels[i + 1] === label) {
        ids[i + 1] = id;
        stack[top++] = i + 1;
      }
      if (i >= width && !ids[i - width] && labels[i - width] === label) {
        ids[i - width] = id;
        stack[top++] = i - width;
      }
      if (i < n - width && !ids[i + width] && labels[i + width] === label) {
        ids[i + width] = id;
        stack[top++] = i + width;
      }
    }
    sizes.push(size);
    labelOf.push(label);
  }
  return { ids, count: sizes.length - 1, sizes: Uint32Array.from(sizes), labelOf: Uint8Array.from(labelOf) };
}

/**
 * 고른 칸들을 이웃 칸에 합친다: 가장 길게 맞닿은 이웃의 색 묶음으로 바꿔 칠한다.
 * labels 를 직접 고친다.
 * @param colorDistance 두 색 묶음의 색 차이. 주면 길게 맞닿았더라도 색이 많이 다른 이웃보다 비슷한 이웃에 합친다.
 * @returns 합친 칸의 수
 */
export function absorb(
  labels: Uint8Array,
  width: number,
  height: number,
  comp: Components,
  selected: Uint8Array,
  colorDistance?: (a: number, b: number) => number,
): number {
  const { ids, labelOf } = comp;
  const n = width * height;
  // 고른 칸마다: 이웃 칸 → 맞닿은 길이
  const borders = new Map<number, Map<number, number>>();
  const touch = (a: number, b: number) => {
    let map = borders.get(a);
    if (!map) {
      map = new Map();
      borders.set(a, map);
    }
    map.set(b, (map.get(b) ?? 0) + 1);
  };
  for (let i = 0; i < n; i++) {
    const a = ids[i];
    const x = i % width;
    if (x < width - 1) {
      const b = ids[i + 1];
      if (a !== b) {
        if (selected[a]) touch(a, b);
        if (selected[b]) touch(b, a);
      }
    }
    if (i < n - width) {
      const b = ids[i + width];
      if (a !== b) {
        if (selected[a]) touch(a, b);
        if (selected[b]) touch(b, a);
      }
    }
  }
  const newLabel = new Int16Array(comp.count + 1).fill(-1);
  // 이번에 다른 칸을 받아들인 칸은 그대로 둔다.
  // 그러지 않으면 맞닿은 두 칸이 서로의 색으로 바뀌어 자리만 맞바꾸고 끝난다.
  const kept = new Uint8Array(comp.count + 1);
  const order = [...borders.keys()].sort((a, b) => comp.sizes[a] - comp.sizes[b]);
  let absorbed = 0;
  for (const id of order) {
    if (kept[id]) continue;
    let best = -1;
    let bestScore = -1;
    for (const [neighbor, length] of borders.get(id)!) {
      if (newLabel[neighbor] >= 0) continue; // 이미 사라지기로 한 칸에는 합치지 않는다
      // 맞닿은 길이가 길수록, 색이 비슷할수록 좋은 이웃이다
      const closeness = colorDistance ? length / (6 + colorDistance(labelOf[id], labelOf[neighbor])) : length;
      // 함께 사라질 후보보다는 남을 칸에 합치는 쪽을 고른다
      const score = closeness + (selected[neighbor] ? 0 : 1e6);
      if (score > bestScore) {
        bestScore = score;
        best = neighbor;
      }
    }
    if (best > 0 && labelOf[best] !== labelOf[id]) {
      newLabel[id] = labelOf[best];
      kept[best] = 1;
      absorbed++;
    }
  }
  if (absorbed === 0) return 0;
  for (let i = 0; i < n; i++) {
    const to = newLabel[ids[i]];
    if (to >= 0) labels[i] = to;
  }
  return absorbed;
}
