// 테스트용 그림 패키지를 만든다: public/paintings/hill-house/
//   regions.png   칸 ID 맵 (ID = R | G << 8, 0 은 칸 없음)
//   lines.png     선화 (칸 경계에서 자동 생성)
//   reference.png 완성 예시
//   meta.json     칸 목록, 팔레트
// 실제 그림은 M4 제작 도구로 만들 예정이며, 이 스크립트는 엔진 개발용이다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const W = 2048;
const H = 1536;
const LINE_HALF_WIDTH = 4;
const LINE_COLOR = [91, 70, 54];
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'paintings', 'hill-house');

const PALETTE = [
  { number: 1, color: '#FFF8E7' },
  { number: 2, color: '#F48FB1' },
  { number: 3, color: '#F9D65C' },
  { number: 4, color: '#7CB86A' },
  { number: 5, color: '#6FB7E9' },
  { number: 6, color: '#9B6B4A' },
  { number: 7, color: '#B388EB' },
  { number: 8, color: '#F4A24C' },
  { number: 9, color: '#5CC8B8' },
];

// ── 도형 ─────────────────────────────────────────────
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ellipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const union = (...shapes) => (x, y) => shapes.some((s) => s(x, y));
const triangle = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

const petals = [];
for (let k = 0; k < 5; k++) {
  const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
  petals.push(circle(350 + Math.cos(a) * 85, 1130 + Math.sin(a) * 85, 62));
}

// 아래에서 위로 쌓이는 순서. 배열 순서 + 1 이 칸 ID.
const SHAPES = [
  { name: '하늘', number: 5, test: () => true },
  { name: '해', number: 3, test: circle(1650, 300, 150) },
  {
    name: '구름',
    number: 1,
    test: union(circle(400, 340, 90), circle(500, 300, 110), circle(610, 340, 95), circle(500, 370, 100)),
  },
  { name: '먼 언덕', number: 4, test: ellipse(600, 1500, 1100, 600) },
  { name: '가까운 언덕', number: 9, test: ellipse(1500, 1650, 1100, 620) },
  { name: '집 벽', number: 7, test: rect(760, 760, 1240, 1120) },
  { name: '지붕', number: 8, test: triangle(700, 760, 1300, 760, 1000, 500) },
  { name: '문', number: 6, test: rect(940, 900, 1060, 1120) },
  { name: '왼쪽 창문', number: 5, test: rect(800, 840, 900, 940) },
  { name: '오른쪽 창문', number: 5, test: rect(1100, 840, 1200, 940) },
  { name: '나무 기둥', number: 6, test: rect(1540, 900, 1600, 1180) },
  { name: '나뭇잎', number: 4, test: circle(1570, 800, 170) },
  { name: '꽃 줄기', number: 4, test: rect(338, 1215, 362, 1420) },
  { name: '꽃잎', number: 2, test: union(...petals) },
  { name: '꽃 가운데', number: 3, test: circle(350, 1130, 48) },
];

// ── 칸 ID 맵 ─────────────────────────────────────────
const ids = new Uint16Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    for (let s = SHAPES.length - 1; s >= 0; s--) {
      if (SHAPES[s].test(x + 0.5, y + 0.5)) {
        ids[y * W + x] = s + 1;
        break;
      }
    }
  }
}

// ── 선화: 칸 경계를 따라 일정한 굵기로 ───────────────
const lineAlpha = new Float32Array(W * H);
function splat(cx, cy) {
  const reach = LINE_HALF_WIDTH + 1;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(W - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(H - 1, Math.ceil(cy + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.min(1, Math.max(0, LINE_HALF_WIDTH - d + 0.5));
      const i = y * W + x;
      if (a > lineAlpha[i]) lineAlpha[i] = a;
    }
  }
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const id = ids[y * W + x];
    if (x + 1 < W && ids[y * W + x + 1] !== id) splat(x + 1, y + 0.5);
    if (y + 1 < H && ids[(y + 1) * W + x] !== id) splat(x + 0.5, y + 1);
  }
}

// ── 번호 위치: 경계에서 가장 먼 점 (챔퍼 거리 변환) ──
const dist = new Float32Array(W * H).fill(1e9);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const id = ids[i];
    if (
      x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
      ids[i - 1] !== id || ids[i + 1] !== id || ids[i - W] !== id || ids[i + W] !== id
    ) {
      dist[i] = 0;
    }
  }
}
const D = Math.SQRT2;
for (let y = 1; y < H; y++) {
  for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - W] + 1, dist[i - W - 1] + D, dist[i - W + 1] + D);
  }
}
for (let y = H - 2; y >= 0; y--) {
  for (let x = W - 2; x >= 1; x--) {
    const i = y * W + x;
    dist[i] = Math.min(dist[i], dist[i + 1] + 1, dist[i + W] + 1, dist[i + W + 1] + D, dist[i + W - 1] + D);
  }
}

const regions = SHAPES.map((s, k) => ({ id: k + 1, name: s.name, number: s.number, pixels: 0, best: -1, x: 0, y: 0 }));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const r = regions[ids[i] - 1];
    r.pixels++;
    if (dist[i] > r.best) {
      r.best = dist[i];
      r.x = x;
      r.y = y;
    }
  }
}

// ── PNG 쓰기 ─────────────────────────────────────────
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}
function encodePng(rgba) {
  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * W * 4, (y + 1) * W * 4), y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hexToRgb = (hex) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
const colorOf = new Map(PALETTE.map((p) => [p.number, hexToRgb(p.color)]));

const regionsPng = new Uint8Array(W * H * 4);
const linesPng = new Uint8Array(W * H * 4);
const referencePng = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  const id = ids[i];
  regionsPng[o] = id & 255;
  regionsPng[o + 1] = id >> 8;
  regionsPng[o + 3] = 255;

  const a = lineAlpha[i];
  linesPng[o] = LINE_COLOR[0];
  linesPng[o + 1] = LINE_COLOR[1];
  linesPng[o + 2] = LINE_COLOR[2];
  linesPng[o + 3] = Math.round(a * 255);

  const fill = colorOf.get(SHAPES[id - 1].number);
  for (let c = 0; c < 3; c++) referencePng[o + c] = Math.round(fill[c] * (1 - a) + LINE_COLOR[c] * a);
  referencePng[o + 3] = 255;
}

const meta = {
  id: 'hill-house',
  title: '언덕 위의 집',
  width: W,
  height: H,
  files: { regions: 'regions.png', lines: 'lines.png', reference: 'reference.png' },
  palette: PALETTE,
  regions: regions.map((r) => ({
    id: r.id,
    name: r.name,
    number: r.number,
    pixels: r.pixels,
    label: { x: r.x, y: r.y, size: Math.round(Math.min(64, Math.max(18, r.best * 0.9))) },
  })),
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'regions.png'), encodePng(regionsPng));
writeFileSync(join(OUT, 'lines.png'), encodePng(linesPng));
writeFileSync(join(OUT, 'reference.png'), encodePng(referencePng));
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`wrote ${OUT}`);
for (const r of meta.regions) console.log(`  ${r.id}\t${r.name}\t#${r.number}\t${r.pixels}px\tlabel ${r.label.x},${r.label.y} (${r.label.size})`);
