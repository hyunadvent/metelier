import { describe, expect, it } from 'vitest';
import { absorb, bilateral, components, modeFilter, quantize, seededRandom, toLab, upscaleLabels } from '../src/photo/imageOps';
import { closeHoles, inkLines, skinMask } from '../src/photo/faceLines';
import { fitSize, photoToPainting } from '../src/photo/photoToPainting';

const W = 120;
const H = 80;
const RED = [205, 60, 55];
const BLUE = [60, 90, 200];
const GREEN = [80, 170, 90];

/** 왼쪽 빨강, 오른쪽 파랑, 가운데 위에 초록 네모. 사진처럼 픽셀마다 조금씩 색이 흔들린다. */
function testPhoto(noise = 12): Uint8ClampedArray {
  const random = seededRandom(3);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let color = x < 60 ? RED : BLUE;
      if (x >= 40 && x < 80 && y >= 10 && y < 45) color = GREEN;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = color[c] + (random() - 0.5) * 2 * noise;
      rgba[o + 3] = 255;
    }
  }
  // 잡티: 빨간 면 한가운데의 2 x 2 흰 점
  for (const [x, y] of [[20, 60], [21, 60], [20, 61], [21, 61]]) rgba.set([250, 250, 250, 255], (y * W + x) * 4);
  return rgba;
}

const hexToRgb = (hex: string) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
const near = (a: number[], b: number[], tolerance = 14) => a.every((v, k) => Math.abs(v - b[k]) <= tolerance);

describe('이미지 연산', () => {
  it('양방향 필터는 면을 평평하게 하되 경계는 남긴다', () => {
    const rgba = testPhoto(20);
    const out = bilateral(rgba, W, H, 4, 3, 28);
    const spread = (data: Uint8ClampedArray) => {
      // 빨간 면 안쪽의 색 흔들림
      let min = 255;
      let max = 0;
      for (let y = 20; y < 50; y++) {
        for (let x = 5; x < 30; x++) {
          const v = data[(y * W + x) * 4];
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
      return max - min;
    };
    expect(spread(out)).toBeLessThan(spread(rgba) / 2);
    // 빨강과 파랑의 경계 양쪽은 여전히 뚜렷이 다르다
    const left = out[(70 * W + 57) * 4];
    const right = out[(70 * W + 62) * 4];
    expect(left - right).toBeGreaterThan(100);
  });

  it('색을 주어진 수만큼의 묶음으로 나눈다', () => {
    const { labels, k } = quantize(toLab(bilateral(testPhoto(), W, H, 4, 3, 28)), 3);
    expect(k).toBe(3);
    const red = labels[70 * W + 10];
    const blue = labels[70 * W + 110];
    const green = labels[25 * W + 60];
    expect(new Set([red, blue, green]).size).toBe(3);
    expect(labels[5 * W + 5]).toBe(red);
  });

  it('주변과 다른 점은 주변 묶음으로 바뀐다', () => {
    const labels = new Uint8Array(100).fill(0);
    labels[55] = 1;
    expect(modeFilter(labels, 10, 10, 2, 2).every((v) => v === 0)).toBe(true);
  });

  it('묶음 지도를 늘려도 묶음의 종류와 큰 배치는 그대로다', () => {
    const labels = new Uint8Array(16 * 8);
    for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) labels[y * 16 + x] = 1;
    const big = upscaleLabels(labels, 16, 8, 64, 32);
    expect(big.length).toBe(64 * 32);
    expect(big[10 * 64 + 5]).toBe(0);
    expect(big[10 * 64 + 60]).toBe(1);
    expect(new Set(big).size).toBe(2);
  });

  it('이어진 덩어리마다 칸이 되고, 작은 칸은 맞닿은 이웃에 합쳐진다', () => {
    const labels = new Uint8Array(10 * 10).fill(0);
    for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) labels[y * 10 + x] = 1;
    labels[3 * 10 + 2] = 2; // 왼쪽 칸 안의 한 점
    const comp = components(labels, 10, 10);
    expect(comp.count).toBe(3);
    const speck = comp.ids[3 * 10 + 2];
    expect(comp.sizes[speck]).toBe(1);
    const selected = new Uint8Array(comp.count + 1);
    selected[speck] = 1;
    expect(absorb(labels, 10, 10, comp, selected)).toBe(1);
    expect(labels[3 * 10 + 2]).toBe(0);
    expect(components(labels, 10, 10).count).toBe(2);
  });
});

describe('사진을 색칠 그림으로', () => {
  const options = { colors: 3, maxRegions: 50, outputSize: 240, workSize: 120, smoothing: 2, faceLines: false };

  it('면마다 칸이 되고, 칸의 번호는 원본 색을 가리킨다', async () => {
    const painting = await photoToPainting(testPhoto(), W, H, options);
    expect([painting.width, painting.height]).toEqual([240, 160]);
    expect(painting.regions).toHaveLength(3);
    expect(painting.palette).toHaveLength(3);

    // 결과 좌표는 원본의 두 배다
    const numberAt = (x: number, y: number) => painting.assignment[painting.seg.ids[y * 240 + x] - 1];
    const colorOf = (n: number) => hexToRgb(painting.palette.find((p) => p.number === n)!.color);
    expect(near(colorOf(numberAt(20, 140)), RED)).toBe(true);
    expect(near(colorOf(numberAt(220, 140)), BLUE)).toBe(true);
    expect(near(colorOf(numberAt(120, 50)), GREEN)).toBe(true);
    // 잡티(흰 점)는 빨간 칸에 합쳐졌다
    expect(numberAt(41, 121)).toBe(numberAt(20, 140));
  });

  it('모든 픽셀이 어느 칸에 속하고, 번호는 넓은 색부터 1 이다', async () => {
    const painting = await photoToPainting(testPhoto(), W, H, options);
    expect(painting.seg.ids.every((id) => id >= 1 && id <= painting.regions.length)).toBe(true);
    expect(painting.palette.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(painting.assignment.every((n) => n >= 1 && n <= 3)).toBe(true);
    // 번호 자리는 그 칸 안이고 선 위가 아니다
    for (const r of painting.regions) {
      expect(painting.seg.ids[r.y * painting.width + r.x]).toBe(r.id);
      expect(painting.darkness[r.y * painting.width + r.x]).toBeLessThan(128);
    }
  });

  it('선은 칸의 경계에 있고 칸 안쪽에는 없다', async () => {
    const painting = await photoToPainting(testPhoto(), W, H, options);
    const { seg, darkness, width, height } = painting;
    let boundary = 0;
    let dark = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        if (seg.ids[y * width + x] !== seg.ids[y * width + x + 1]) {
          boundary++;
          if (darkness[y * width + x] > 100 && darkness[y * width + x + 1] > 100) dark++;
        }
      }
    }
    expect(boundary).toBeGreaterThan(0);
    expect(dark).toBe(boundary);
    expect(darkness[140 * width + 20]).toBe(0); // 빨간 칸 한가운데
  });

  it('칸이 너무 많으면 작은 칸부터 합쳐 정한 수 이하로 줄인다', async () => {
    // 세로 줄무늬 24 개
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const stripe = Math.floor(x / 5);
        rgba.set(stripe % 2 ? [230, 230, 230, 255] : [30, 30, 30, 255], (y * W + x) * 4);
      }
    }
    const many = await photoToPainting(rgba, W, H, { ...options, colors: 2, smoothing: 0, maxRegions: 50 });
    expect(many.regions.length).toBe(24);
    const few = await photoToPainting(rgba, W, H, { ...options, colors: 2, smoothing: 0, maxRegions: 8 });
    expect(few.regions.length).toBeLessThanOrEqual(8);
    expect(few.regions.length).toBeGreaterThanOrEqual(1);
  });

  it('긴 변을 기준으로 크기를 맞춘다', () => {
    expect(fitSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitSize(600, 900, 1024)).toEqual({ width: 683, height: 1024 });
  });
});

describe('얼굴의 눈·코·입을 선으로 남기기', () => {
  const FW = 200;
  const FH = 160;
  const SKIN = [226, 176, 148];
  const WALL = [206, 208, 212];
  const DARK = [52, 40, 36];

  /** 회색 벽 앞의 살색 얼굴(원)에 감은 눈 두 개와 입을 어두운 가는 선으로 그린다. 오른쪽에는 살색이 아닌 파란 원이 있다. */
  function facePhoto(): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(FW * FH * 4);
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        let color = WALL;
        if (Math.hypot(x - 70, y - 80) < 46) color = SKIN;
        if (Math.hypot(x - 160, y - 80) < 26) color = [70, 110, 200];
        const eye = (y >= 68 && y < 71 && ((x >= 46 && x < 60) || (x >= 80 && x < 94))) || (y >= 100 && y < 103 && x >= 56 && x < 84);
        // 파란 원 안에도 같은 모양의 어두운 선을 둔다 (살색이 아니므로 선으로 남지 않아야 한다)
        const mark = y >= 79 && y < 82 && x >= 150 && x < 170;
        if (eye || mark) color = DARK;
        rgba.set([...color, 255], (y * FW + x) * 4);
      }
    }
    return rgba;
  }

  it('살색인 곳을 찾고, 그 안의 작은 구멍을 메운다', () => {
    const skin = skinMask(facePhoto());
    expect(skin[80 * FW + 70]).toBe(1); // 볼
    expect(skin[69 * FW + 50]).toBe(0); // 눈
    expect(skin[10 * FW + 10]).toBe(0); // 벽
    expect(skin[80 * FW + 160]).toBe(0); // 파란 원
    const closed = closeHoles(skin, FW, FH, 4);
    expect(closed[69 * FW + 50]).toBe(1); // 눈이 얼굴에 포함된다
    expect(closed[10 * FW + 10]).toBe(0);
  });

  it('주변보다 어두운 가는 무늬만 선으로 뽑는다', () => {
    const ink = inkLines(facePhoto(), FW, FH, 4);
    expect(ink[69 * FW + 52]).toBeGreaterThan(0.8); // 눈
    expect(ink[101 * FW + 70]).toBeGreaterThan(0.8); // 입
    expect(ink[85 * FW + 70]).toBe(0); // 볼 한가운데
    expect(ink[10 * FW + 10]).toBe(0); // 벽
  });

  it('눈과 입은 칸이 되지 않고 얼굴 칸 위의 선으로 남는다', async () => {
    const options = { colors: 4, maxRegions: 50, outputSize: 400, workSize: 200, smoothing: 1, faceLines: true };
    const painting = await photoToPainting(facePhoto(), FW, FH, options);
    const at = (x: number, y: number) => y * 2 * painting.width + x * 2; // 결과는 원본의 두 배 크기
    const face = painting.seg.ids[at(70, 85)];
    // 눈과 입 자리가 얼굴과 같은 칸이다
    expect(painting.seg.ids[at(52, 69)]).toBe(face);
    expect(painting.seg.ids[at(87, 69)]).toBe(face);
    expect(painting.seg.ids[at(70, 101)]).toBe(face);
    // 그 자리에 선이 그려져 있고, 볼에는 없다
    expect(painting.darkness[at(52, 69)]).toBeGreaterThan(200);
    expect(painting.darkness[at(87, 69)]).toBeGreaterThan(200);
    expect(painting.darkness[at(70, 101)]).toBeGreaterThan(200);
    expect(painting.darkness[at(70, 85)]).toBe(0);
    // 얼굴, 벽, 파란 원과 그 안의 표시: 얼굴의 눈·입은 칸 수에 들지 않는다
    expect(painting.regions.length).toBeLessThanOrEqual(4);
  });

  it('옵션을 끄면 눈과 입 자리에 선을 따로 그리지 않는다', async () => {
    const options = { colors: 4, maxRegions: 50, outputSize: 400, workSize: 200, smoothing: 1, faceLines: false };
    const off = await photoToPainting(facePhoto(), FW, FH, options);
    const on = await photoToPainting(facePhoto(), FW, FH, { ...options, faceLines: true });
    const inked = (d: Uint8Array) => d.reduce((n, v) => n + (v > 128 ? 1 : 0), 0);
    // 켰을 때는 눈과 입의 선이 온전히 남는다. 껐을 때 그 자리는 얼굴에 합쳐져 사라지거나 칸의 테두리만 남는다.
    expect(on.darkness[(69 * 2) * on.width + 52 * 2]).toBeGreaterThan(200);
    expect(inked(on.darkness)).not.toBe(inked(off.darkness));
  });
});
