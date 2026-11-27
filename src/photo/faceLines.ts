// 사람 얼굴의 눈·코·입을 칸이 아니라 "선"으로 남기기 위한 계산.
// 얼굴을 직접 알아보는 것은 아니고, 살색인 곳을 찾아 그 안의 어두운 가는 무늬를 선으로 삼는다.
// DOM 과 무관한 순수 계산이다.

/** 픽셀마다 밝기 (0~255) */
export function luminance(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return out;
}

/** 가우시안 흐림 (가로 한 번, 세로 한 번) */
export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
    sum += kernel[k + radius];
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = Math.min(width - 1, Math.max(0, x + k));
        acc += src[y * width + nx] * kernel[k + radius];
      }
      tmp[y * width + x] = acc;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = Math.min(height - 1, Math.max(0, y + k));
        acc += tmp[ny * width + x] * kernel[k + radius];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

/**
 * 살색인 픽셀을 표시한다. 밝기와 무관한 색 성분(Cb, Cr)의 범위로 가려내므로
 * 밝은 피부와 어두운 피부, 그늘진 피부를 함께 잡는다. 노란색은 빼지만, 나무나 베이지색 벽은 잡힐 수 있다.
 */
export function skinMask(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const mask = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < mask.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (!(cb >= 77 && cb <= 127 && cr >= 135 && cr <= 175 && r > 60 && r > b && r - Math.min(g, b) > 12)) continue;
    // 노란 것(금색 장식, 노란 전등)은 뺀다: 살색은 빨강에서 주황 사이의 색조이고, 노랑은 초록 성분이 그보다 많다.
    // 색조로 치면 약 34도까지를 살색으로 본다 (노랑은 50~60도).
    if (g - b > 0.57 * (r - b)) continue;
    mask[i] = 1;
  }
  return mask;
}

/** 표시된 곳을 사방으로 radius 만큼 넓히거나(grow) 좁힌다. 정사각형 범위로 계산한다. */
function morph(mask: Uint8Array, width: number, height: number, radius: number, grow: boolean): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const stride = horizontal ? 1 : width;
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * width : line;
      // 창 안에 있는 표시의 수를 밀어 가며 센다. 그림 밖은 넓힐 때는 0, 좁힐 때는 1 로 본다.
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        count += k < 0 || k >= length ? (grow ? 0 : 1) : src[base + k * stride];
      }
      for (let p = 0; p < length; p++) {
        out[base + p * stride] = grow ? (count > 0 ? 1 : 0) : count === radius * 2 + 1 ? 1 : 0;
        const leave = p - radius;
        const enter = p + radius + 1;
        count -= leave < 0 || leave >= length ? (grow ? 0 : 1) : src[base + leave * stride];
        count += enter < 0 || enter >= length ? (grow ? 0 : 1) : src[base + enter * stride];
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

export const dilate = (mask: Uint8Array, width: number, height: number, radius: number) => morph(mask, width, height, radius, true);
export const erode = (mask: Uint8Array, width: number, height: number, radius: number) => morph(mask, width, height, radius, false);

/** 넓혔다가 다시 좁혀서, 표시된 곳 안의 작은 구멍과 좁은 틈을 메운다. */
export function closeHoles(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return erode(dilate(mask, width, height, radius), width, height, radius);
}

/**
 * 구멍(closed 에는 있지만 skin 에는 없는 곳)의 색 묶음을 가장 가까운 살색 픽셀의 묶음으로 바꾼다.
 * 눈·입처럼 얼굴 안의 작은 무늬가 따로 칸이 되지 않고 얼굴 칸에 들어가게 한다.
 * labels 를 직접 고친다.
 */
export function fillHolesWithSkin(labels: Uint8Array, skin: Uint8Array, closed: Uint8Array, width: number, height: number): void {
  const n = width * height;
  const done = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (skin[i]) {
      done[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const visit = (j: number) => {
      if (done[j] || !closed[j]) return;
      done[j] = 1;
      labels[j] = labels[i];
      queue[tail++] = j;
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < n - width) visit(i + width);
  }
}

/** 0~1 값의 지도를 더 큰 크기로 부드럽게 늘린다. */
export function upscaleMap(src: Float32Array, width: number, height: number, outWidth: number, outHeight: number): Float32Array {
  const out = new Float32Array(outWidth * outHeight);
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
      const top = src[y0 * width + x0] * (1 - tx) + src[y0 * width + x1] * tx;
      const bottom = src[y1 * width + x0] * (1 - tx) + src[y1 * width + x1] * tx;
      out[y * outWidth + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/**
 * 살색 덩어리마다 가장 넓게 쓰인 색 묶음 하나로 통일한다.
 * 얼굴과 팔이 명암 때문에 여러 칸으로 쪼개지지 않고 한 가지 살색 면이 되어, 그 위의 선(눈·코·입)이 잘 보인다.
 * 너무 큰 덩어리는 건드리지 않는다: 사진 대부분이 살색 계열(나무, 베이지색 벽)이면 얼굴이 아니기 때문이다.
 * labels 를 직접 고친다.
 * @param maxFraction 이 비율(사진 전체 대비)보다 큰 덩어리는 그대로 둔다
 * @param skinLabel 주면 덩어리마다 가장 넓은 묶음을 고르는 대신 모두 이 묶음으로 만든다 (살색 전용 묶음)
 * @returns 한 면으로 만든 덩어리 가운데 가장 큰 것의 픽셀 수 (없으면 0). 얼굴의 크기를 짐작하는 데 쓴다.
 */
export function flattenSkin(
  labels: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  k: number,
  maxFraction = 0.12,
  skinLabel?: number,
): number {
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const counts = new Uint32Array(k);
  const limit = n * maxFraction;
  let largest = 0;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    // 이어진 살색 덩어리 하나를 모은다
    let top = 0;
    let size = 0;
    stack[top++] = start;
    seen[start] = 1;
    counts.fill(0);
    const members: number[] = [];
    while (top > 0) {
      const i = stack[--top];
      size++;
      counts[labels[i]]++;
      if (size <= limit) members.push(i);
      const x = i % width;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        stack[top++] = i - 1;
      }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        stack[top++] = i + 1;
      }
      if (i >= width && mask[i - width] && !seen[i - width]) {
        seen[i - width] = 1;
        stack[top++] = i - width;
      }
      if (i < n - width && mask[i + width] && !seen[i + width]) {
        seen[i + width] = 1;
        stack[top++] = i + width;
      }
    }
    if (size > limit) continue;
    let best = 0;
    for (let c = 1; c < k; c++) if (counts[c] > counts[best]) best = c;
    if (skinLabel !== undefined) best = skinLabel;
    for (const i of members) labels[i] = best;
    if (size > largest) largest = size;
  }
  return largest;
}

/**
 * 얼굴의 특징을 가는 선으로 뽑는다 (0 = 없음, 1 = 진한 선). 결과 그림의 해상도에서 계산한다.
 *
 * 두 가지를 선으로 본다.
 * - 가는 어두운 줄: 감은 눈, 눈썹, 입술 사이, 콧구멍, 손가락 사이 (가는 흐림과 중간 흐림의 차이)
 * - 조금 더 큰 어두운 점: 뜬 눈의 눈동자, 벌린 입 (중간 흐림과 넓은 흐림의 차이)
 * 밝기 차이를 주변 밝기로 나눠 보므로 그늘진 얼굴에서도 같은 기준으로 잡힌다.
 * 넓고 완만한 그늘은 차이가 작아 잡히지 않는다.
 *
 * @param lum 결과 크기의 밝기 (0~255)
 * @param mask 선을 그려도 되는 곳 (살색 면의 안쪽)
 * @param sigma 선 굵기에 맞춘 값 (픽셀). 얼굴이 클수록 크게 준다.
 */
export function featureLines(
  lum: Float32Array,
  width: number,
  height: number,
  mask: Uint8Array,
  sigma: number,
  tuning: { start?: number; range?: number; blob?: number } = {},
): Float32Array {
  // start: 이보다 약한 무늬는 선으로 보지 않는다. range: 그 위로 이만큼 더 세면 완전히 진한 선이다.
  // blob: 가는 줄이 아닌 조금 큰 어두운 점(눈동자, 벌린 입)을 얼마나 쳐줄지. 0 이면 가는 줄만 뽑는다.
  const { start = 0.038, range = 0.04, blob: blobWeight = 0.6 } = tuning;
  const ink = new Float32Array(width * height);
  // 계산은 살색이 있는 범위에서만 한다
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return ink;
  const pad = Math.ceil(sigma * 12);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) crop[y * cw + x] = lum[(y + y0) * width + x + x0];
  }

  const fine = gaussianBlur(crop, cw, ch, sigma * 0.55);
  const mid = gaussianBlur(crop, cw, ch, sigma * 2);
  const wide = gaussianBlur(crop, cw, ch, sigma * 4);
  const local = new Float32Array(cw * ch);
  const on = new Uint8Array(cw * ch);
  for (let i = 0; i < local.length; i++) {
    if (!mask[(Math.floor(i / cw) + y0) * width + (i % cw) + x0]) continue;
    const thin = (mid[i] - fine[i]) / (mid[i] + 30);
    const blob = (wide[i] - mid[i]) / (wide[i] + 30);
    const strength = Math.max(thin, blob * blobWeight);
    // 흐릿한 가장자리는 잘라 내 또렷한 선으로 만든다
    const t = Math.min(1, Math.max(0, (strength - start) / range));
    local[i] = t * t * (3 - 2 * t);
    if (local[i] > 0.5) on[i] = 1;
  }

  // 점처럼 흩어진 자잘한 얼룩은 지운다: 선이 되기에는 너무 작은 덩어리
  const minSize = Math.max(10, Math.round(sigma * sigma * 5));
  const seen = new Uint8Array(cw * ch);
  const stack = new Int32Array(cw * ch);
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || seen[start]) continue;
    const members: number[] = [];
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      const x = i % cw;
      // 대각선으로 이어진 것도 한 줄로 본다
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const j = i + dy * cw + dx;
          if (nx < 0 || nx >= cw || j < 0 || j >= on.length || !on[j] || seen[j]) continue;
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (members.length < minSize) for (const i of members) on[i] = 0;
  }
  // 남은 선과 그 부드러운 가장자리만 옮긴다
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (local[i] === 0) continue;
      let keep = on[i] === 1;
      for (let dy = -1; dy <= 1 && !keep; dy++) {
        for (let dx = -1; dx <= 1 && !keep; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < cw && ny >= 0 && ny < ch && on[ny * cw + nx]) keep = true;
        }
      }
      if (keep) ink[(y + y0) * width + x + x0] = local[i];
    }
  }
  return ink;
}
