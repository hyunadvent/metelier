// 선화를 칸으로 나누는 알고리즘. DOM 과 무관하다.

export interface SegmentOptions {
  /** 이 값 이상으로 어두운 픽셀을 선으로 본다 (0~255). */
  threshold: number;
  /** 이 거리(픽셀) 이하로 끊긴 선은 이어진 것으로 본다. 0 이면 끄기. */
  gapRadius: number;
  /** 이보다 작은 칸은 버리고 주변 칸에 합친다 (픽셀 수). */
  minArea: number;
}

export interface Segmentation {
  /** 픽셀마다 칸 ID (1..count). 선 아래 픽셀도 가장 가까운 칸에 속한다. 칸이 하나도 없으면 모두 0. */
  ids: Uint16Array;
  count: number;
}

export interface RegionInfo {
  id: number;
  /** 번호를 놓을 자리: 칸 경계와 선에서 가장 먼 점. */
  x: number;
  y: number;
  /** 그 점에서 경계까지의 거리. 번호 글자 크기를 정하는 데 쓴다. */
  clearance: number;
  pixels: number;
}

const MAX_REGIONS = 65535;

/** RGBA 이미지를 어두운 정도(0=흰색, 255=검정)로 바꾼다. 투명한 곳은 흰색으로 본다. */
export function toDarkness(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    const lum = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    out[i] = Math.round(((255 - lum) * rgba[o + 3]) / 255);
  }
  return out;
}

/** 표시된 픽셀까지의 거리 (3-4 챔퍼 근사, 픽셀 단위). */
function distanceTo(mask: Uint8Array, width: number, height: number): Float32Array {
  const dist = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? 0 : 1e9;
  const D = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[i - width] + 1);
        if (x > 0) d = Math.min(d, dist[i - width - 1] + D);
        if (x < width - 1) d = Math.min(d, dist[i - width + 1] + D);
      }
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let d = dist[i];
      if (x < width - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < height - 1) {
        d = Math.min(d, dist[i + width] + 1);
        if (x < width - 1) d = Math.min(d, dist[i + width + 1] + D);
        if (x > 0) d = Math.min(d, dist[i + width - 1] + D);
      }
      dist[i] = d;
    }
  }
  return dist;
}

/**
 * 선으로 둘러싸인 영역을 칸으로 나눈다.
 * 1) 선(과 끊긴 틈)을 막힌 곳으로 표시 → 2) 막히지 않은 곳을 연결된 덩어리로 묶음
 * → 3) 너무 작은 덩어리는 버림 → 4) 남은 칸을 선 아래까지 넓혀 모든 픽셀을 채움.
 */
export function segment(darkness: Uint8Array, width: number, height: number, options: SegmentOptions): Segmentation {
  const count = width * height;
  let blocked = new Uint8Array(count);
  for (let i = 0; i < count; i++) blocked[i] = darkness[i] >= options.threshold ? 1 : 0;
  if (options.gapRadius > 0) {
    const dist = distanceTo(blocked, width, height);
    const grown = new Uint8Array(count);
    for (let i = 0; i < count; i++) grown[i] = dist[i] <= options.gapRadius ? 1 : 0;
    blocked = grown;
  }

  // 연결된 덩어리 찾기 (상하좌우 연결)
  const labels = new Int32Array(count);
  const stack = new Int32Array(count);
  const sizes: number[] = [0];
  for (let start = 0; start < count; start++) {
    if (blocked[start] || labels[start]) continue;
    const label = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % width;
      if (x > 0 && !blocked[i - 1] && !labels[i - 1]) {
        labels[i - 1] = label;
        stack[top++] = i - 1;
      }
      if (x < width - 1 && !blocked[i + 1] && !labels[i + 1]) {
        labels[i + 1] = label;
        stack[top++] = i + 1;
      }
      if (i >= width && !blocked[i - width] && !labels[i - width]) {
        labels[i - width] = label;
        stack[top++] = i - width;
      }
      if (i < count - width && !blocked[i + width] && !labels[i + width]) {
        labels[i + width] = label;
        stack[top++] = i + width;
      }
    }
    sizes.push(size);
  }

  // 작은 덩어리를 버리고 번호를 다시 매긴다
  const remap = new Int32Array(sizes.length);
  let kept = 0;
  for (let label = 1; label < sizes.length; label++) {
    if (sizes[label] >= options.minArea && kept < MAX_REGIONS) remap[label] = ++kept;
  }

  // 남은 칸을 비어 있는 픽셀(선 아래, 버린 덩어리)로 넓힌다: 가까운 칸이 먼저 차지한다
  const ids = new Uint16Array(count);
  const queue = stack; // 재사용
  let head = 0;
  let tail = 0;
  for (let i = 0; i < count; i++) {
    const id = remap[labels[i]];
    if (id) {
      ids[i] = id;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const id = ids[i];
    const x = i % width;
    if (x > 0 && !ids[i - 1]) {
      ids[i - 1] = id;
      queue[tail++] = i - 1;
    }
    if (x < width - 1 && !ids[i + 1]) {
      ids[i + 1] = id;
      queue[tail++] = i + 1;
    }
    if (i >= width && !ids[i - width]) {
      ids[i - width] = id;
      queue[tail++] = i - width;
    }
    if (i < count - width && !ids[i + width]) {
      ids[i + width] = id;
      queue[tail++] = i + width;
    }
  }
  return { ids, count: kept };
}

/** 칸마다 픽셀 수와 번호를 놓을 자리를 구한다. */
export function describeRegions(
  seg: Segmentation,
  width: number,
  height: number,
  darkness?: Uint8Array,
  threshold = 128,
): RegionInfo[] {
  const { ids, count } = seg;
  // 경계: 그림 가장자리, 다른 칸과 맞닿은 곳, 선
  const edge = new Uint8Array(ids.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = ids[i];
      if (
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        ids[i - 1] !== id || ids[i + 1] !== id || ids[i - width] !== id || ids[i + width] !== id ||
        (darkness !== undefined && darkness[i] >= threshold)
      ) {
        edge[i] = 1;
      }
    }
  }
  const dist = distanceTo(edge, width, height);
  const regions: RegionInfo[] = Array.from({ length: count }, (_, k) => ({ id: k + 1, x: 0, y: 0, clearance: -1, pixels: 0 }));
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const r = regions[id - 1];
    r.pixels++;
    if (dist[i] > r.clearance) {
      r.clearance = dist[i];
      r.x = i % width;
      r.y = (i - r.x) / width;
    }
  }
  return regions;
}

/** 완성 예시 이미지에서 칸마다 평균 색을 구한다. 선 위의 픽셀은 빼고 계산한다. */
export function meanColors(
  seg: Segmentation,
  referenceRgba: Uint8ClampedArray | Uint8Array,
  darkness: Uint8Array,
  threshold: number,
): number[][] {
  const sums = new Float64Array(seg.count * 4);
  for (let i = 0; i < seg.ids.length; i++) {
    const id = seg.ids[i];
    if (!id || darkness[i] >= threshold / 2) continue;
    const s = (id - 1) * 4;
    sums[s] += referenceRgba[i * 4];
    sums[s + 1] += referenceRgba[i * 4 + 1];
    sums[s + 2] += referenceRgba[i * 4 + 2];
    sums[s + 3]++;
  }
  return Array.from({ length: seg.count }, (_, k) => {
    const n = sums[k * 4 + 3] || 1;
    return [sums[k * 4] / n, sums[k * 4 + 1] / n, sums[k * 4 + 2] / n];
  });
}

const sqDist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * 색들을 k 개의 묶음으로 나눈다 (k-평균). 결과는 넓이가 큰 묶음부터.
 * @returns centers: 묶음의 대표 색, assignment: 색마다 속한 묶음 번호 (0..k-1)
 */
export function clusterColors(colors: number[][], weights: number[], k: number): { centers: number[][]; assignment: number[] } {
  const n = colors.length;
  k = Math.max(1, Math.min(k, n));
  // 시작점: 가장 넓은 칸의 색에서 출발해, 이미 고른 색들과 가장 먼 색을 차례로 고른다
  const centers: number[][] = [];
  let first = 0;
  for (let i = 1; i < n; i++) if (weights[i] > weights[first]) first = i;
  centers.push([...colors[first]]);
  while (centers.length < k) {
    let best = 0;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.min(...centers.map((c) => sqDist(colors[i], c)));
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    }
    centers.push([...colors[best]]);
  }

  const assignment = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (let c = 1; c < k; c++) if (sqDist(colors[i], centers[c]) < sqDist(colors[i], centers[best])) best = c;
      if (best !== assignment[i]) {
        assignment[i] = best;
        changed = true;
      }
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assignment[i]];
      s[0] += colors[i][0] * weights[i];
      s[1] += colors[i][1] * weights[i];
      s[2] += colors[i][2] * weights[i];
      s[3] += weights[i];
    }
    sums.forEach((s, c) => {
      if (s[3] > 0) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
    if (!changed && iter > 0) break;
  }

  // 넓이가 큰 묶음부터 번호를 매긴다
  const area = centers.map(() => 0);
  for (let i = 0; i < n; i++) area[assignment[i]] += weights[i];
  const order = centers.map((_, c) => c).sort((a, b) => area[b] - area[a]);
  const rank = new Array<number>(k);
  order.forEach((c, r) => (rank[c] = r));
  return { centers: order.map((c) => centers[c]), assignment: assignment.map((c) => rank[c]) };
}
