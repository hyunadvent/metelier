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
 * 밝은 피부와 어두운 피부, 그늘진 피부를 함께 잡는다. 나무나 베이지색 벽도 잡힐 수 있다.
 */
export function skinMask(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const mask = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < mask.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cb >= 77 && cb <= 127 && cr >= 135 && cr <= 175 && r > 60 && r > b && r - Math.min(g, b) > 12) mask[i] = 1;
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

/**
 * 주변보다 어두운 가는 무늬를 잉크 선으로 뽑는다 (0 = 없음, 1 = 진한 선).
 * 감은 눈, 눈썹, 콧구멍, 입술 사이, 손가락 사이처럼 살 위의 어두운 선이 여기에 잡힌다.
 * 넓고 부드러운 그늘은 주변과 밝기 차이가 완만해서 잡히지 않는다.
 * @param scale 무늬의 크기에 맞추는 값 (픽셀). 얼굴이 크게 찍힌 사진일수록 크게 준다.
 */
export function inkLines(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, scale: number): Float32Array {
  const lum = luminance(rgba);
  const fine = gaussianBlur(lum, width, height, Math.max(0.7, scale * 0.12));
  const broad = gaussianBlur(lum, width, height, Math.max(2.5, scale * 0.6));
  const ink = new Float32Array(lum.length);
  for (let i = 0; i < ink.length; i++) {
    // 주변 평균보다 얼마나 어두운가. 밝은 곳일수록 같은 차이도 덜 눈에 띄므로 조금 더 요구한다.
    const darker = broad[i] - fine[i] - 9 - broad[i] * 0.03;
    ink[i] = Math.min(1, Math.max(0, darker / 18));
  }
  return ink;
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
 */
export function flattenSkin(labels: Uint8Array, mask: Uint8Array, width: number, height: number, k: number, maxFraction = 0.12): void {
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const counts = new Uint32Array(k);
  const limit = n * maxFraction;
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
    for (const i of members) labels[i] = best;
  }
}
