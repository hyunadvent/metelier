export type Rgb = readonly [number, number, number];

export type Brush = { kind: 'paint'; color: Rgb } | { kind: 'erase' };

export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 칸의 이 비율 이상이 칠해지면 "칠한 칸"으로 센다. */
export const FILLED_RATIO = 0.95;

/** 이 알파 이상인 픽셀을 칠해진 것으로 본다. */
const COVERED_ALPHA = 128;

/** 되돌릴 수 있는 스트로크 수와, 기록 전체가 담을 수 있는 픽셀 수의 상한. */
const MAX_HISTORY_STROKES = 30;
const MAX_HISTORY_PIXELS = 6_000_000;

/** 한 스트로크가 바꾼 픽셀들과, 바뀌기 전(되돌린 뒤에는 바뀐 후)의 값. */
interface StrokeRecord {
  indices: Uint32Array;
  values: Uint32Array;
}

/**
 * 칠 레이어를 CPU 버퍼로 관리하는 칠하기 엔진. DOM 과 무관하다.
 *
 * - 스트로크는 시작한 칸에 고정되며 그 칸 밖의 픽셀은 건드리지 않는다.
 * - 색은 불투명 단색으로 덮어쓴다. 여러 번 지나가도 진해지지 않고, 다른 색이면 교체된다.
 * - 좌표는 그림 픽셀 단위이고 (0, 0) 은 왼쪽 위 모서리다.
 */
export class PaintEngine {
  /** RGBA (비 프리멀티플라이). ImageData 로 그대로 쓸 수 있다. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** 칸 ID → 칸의 픽셀 수. 인덱스 0 은 쓰지 않는다. */
  readonly regionSize: Uint32Array;
  readonly regionCount: number;

  private readonly covered: Uint8Array;
  private readonly coveredCount: Uint32Array;
  /** pixels 를 픽셀당 32비트로 보는 뷰. 되돌리기 기록에 쓴다. */
  private readonly pixels32: Uint32Array;
  /** 현재 스트로크에서 이미 기록한 픽셀 표시. */
  private readonly touched: Uint8Array;
  private logIdx = new Uint32Array(4096);
  private logVal = new Uint32Array(4096);
  private logLen = 0;
  private undoStack: StrokeRecord[] = [];
  private redoStack: StrokeRecord[] = [];
  private brush: Brush | null = null;
  private radius = 16;
  private activeRegion = 0;
  private lastX = 0;
  private lastY = 0;
  private dirtyMinX = Infinity;
  private dirtyMinY = Infinity;
  private dirtyMaxX = -Infinity;
  private dirtyMaxY = -Infinity;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly regionIds: Uint16Array,
  ) {
    if (regionIds.length !== width * height) {
      throw new Error(`칸 ID 맵 크기가 맞지 않습니다: ${regionIds.length} != ${width} x ${height}`);
    }
    let maxId = 0;
    for (let i = 0; i < regionIds.length; i++) if (regionIds[i] > maxId) maxId = regionIds[i];
    this.regionCount = maxId;
    this.regionSize = new Uint32Array(maxId + 1);
    for (let i = 0; i < regionIds.length; i++) this.regionSize[regionIds[i]]++;
    this.regionSize[0] = 0;
    this.coveredCount = new Uint32Array(maxId + 1);
    this.covered = new Uint8Array(width * height);
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.pixels32 = new Uint32Array(this.pixels.buffer);
    this.touched = new Uint8Array(width * height);
  }

  setBrush(brush: Brush | null): void {
    this.brush = brush;
  }

  /** 붓 반지름 (그림 픽셀 단위). */
  setRadius(radius: number): void {
    this.radius = Math.max(0.5, radius);
  }

  /** 해당 좌표의 칸 ID. 칸이 없거나 그림 밖이면 0. */
  regionAt(x: number, y: number): number {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return 0;
    return this.regionIds[py * this.width + px];
  }

  /** 스트로크를 시작하고 대상 칸 ID 를 돌려준다. 칠할 수 없으면 0. */
  beginStroke(x: number, y: number): number {
    this.endStroke();
    if (!this.brush) return 0;
    const region = this.regionAt(x, y);
    if (region === 0) return 0;
    this.activeRegion = region;
    this.lastX = x;
    this.lastY = y;
    this.paintSegment(x, y, x, y);
    return region;
  }

  strokeTo(x: number, y: number): void {
    if (this.activeRegion === 0) return;
    this.paintSegment(this.lastX, this.lastY, x, y);
    this.lastX = x;
    this.lastY = y;
  }

  /** 스트로크를 끝내고, 바뀐 픽셀이 있으면 되돌리기 기록에 남긴다. */
  endStroke(): void {
    this.activeRegion = 0;
    const len = this.logLen;
    if (len === 0) return;
    const indices = this.logIdx.slice(0, len);
    const values = this.logVal.slice(0, len);
    for (let k = 0; k < len; k++) this.touched[indices[k]] = 0;
    this.logLen = 0;
    this.undoStack.push({ indices, values });
    this.redoStack.length = 0;

    let total = 0;
    for (const r of this.undoStack) total += r.indices.length;
    while (this.undoStack.length > 1 && (this.undoStack.length > MAX_HISTORY_STROKES || total > MAX_HISTORY_PIXELS)) {
      total -= this.undoStack.shift()!.indices.length;
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 마지막 스트로크를 되돌린다. */
  undo(): boolean {
    if (this.isStroking) return false;
    const record = this.undoStack.pop();
    if (!record) return false;
    this.swap(record);
    this.redoStack.push(record);
    return true;
  }

  /** 되돌린 스트로크를 다시 적용한다. */
  redo(): boolean {
    if (this.isStroking) return false;
    const record = this.redoStack.pop();
    if (!record) return false;
    this.swap(record);
    this.undoStack.push(record);
    return true;
  }

  /** 저장해 둔 칠을 불러온다. 진행도를 다시 계산하고 되돌리기 기록은 비운다. */
  loadPixels(rgba: Uint8ClampedArray | Uint8Array): void {
    if (rgba.length !== this.pixels.length) {
      throw new Error(`저장된 칠의 크기가 그림과 맞지 않습니다: ${rgba.length} != ${this.pixels.length}`);
    }
    this.pixels.set(rgba);
    this.coveredCount.fill(0);
    for (let i = 0; i < this.covered.length; i++) {
      const now = this.pixels[i * 4 + 3] >= COVERED_ALPHA ? 1 : 0;
      this.covered[i] = now;
      if (now) this.coveredCount[this.regionIds[i]]++;
    }
    this.resetHistory();
    this.markDirty(0, 0, this.width - 1, this.height - 1);
  }

  get isStroking(): boolean {
    return this.activeRegion !== 0;
  }

  /** 칸이 칠해진 비율 (0~1). */
  coverage(region: number): number {
    const size = this.regionSize[region];
    return size ? this.coveredCount[region] / size : 0;
  }

  isFilled(region: number): boolean {
    return this.coverage(region) >= FILLED_RATIO;
  }

  filledCount(): number {
    let n = 0;
    for (let id = 1; id <= this.regionCount; id++) if (this.isFilled(id)) n++;
    return n;
  }

  clear(): void {
    this.pixels.fill(0);
    this.covered.fill(0);
    this.coveredCount.fill(0);
    this.resetHistory();
    this.markDirty(0, 0, this.width - 1, this.height - 1);
  }

  private resetHistory(): void {
    this.activeRegion = 0;
    this.touched.fill(0);
    this.logLen = 0;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** 기록된 픽셀 값과 현재 값을 맞바꾼다. 같은 기록으로 되돌리기와 다시 하기를 모두 한다. */
  private swap(record: StrokeRecord): void {
    const { indices, values } = record;
    const { width, pixels, pixels32, covered, coveredCount, regionIds } = this;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const current = pixels32[i];
      pixels32[i] = values[k];
      values[k] = current;
      const now = pixels[i * 4 + 3] >= COVERED_ALPHA ? 1 : 0;
      if (now !== covered[i]) {
        covered[i] = now;
        coveredCount[regionIds[i]] += now ? 1 : -1;
      }
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX >= minX) this.markDirty(minX, minY, maxX, maxY);
  }

  /** 마지막 호출 이후 바뀐 영역을 돌려주고 초기화한다. 바뀐 게 없으면 null. */
  takeDirty(): DirtyRect | null {
    if (this.dirtyMaxX < this.dirtyMinX) return null;
    const rect = {
      x: this.dirtyMinX,
      y: this.dirtyMinY,
      width: this.dirtyMaxX - this.dirtyMinX + 1,
      height: this.dirtyMaxY - this.dirtyMinY + 1,
    };
    this.dirtyMinX = this.dirtyMinY = Infinity;
    this.dirtyMaxX = this.dirtyMaxY = -Infinity;
    return rect;
  }

  private growLog(): void {
    const idx = new Uint32Array(this.logIdx.length * 2);
    const val = new Uint32Array(this.logVal.length * 2);
    idx.set(this.logIdx);
    val.set(this.logVal);
    this.logIdx = idx;
    this.logVal = val;
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (x0 < this.dirtyMinX) this.dirtyMinX = x0;
    if (y0 < this.dirtyMinY) this.dirtyMinY = y0;
    if (x1 > this.dirtyMaxX) this.dirtyMaxX = x1;
    if (y1 > this.dirtyMaxY) this.dirtyMaxY = y1;
  }

  /** 선분 (x0,y0)-(x1,y1) 을 붓 굵기의 캡슐 모양으로 칠한다. 고정된 칸 안에서만. */
  private paintSegment(x0: number, y0: number, x1: number, y1: number): void {
    const brush = this.brush;
    if (!brush) return;
    const { width, height, regionIds, pixels, pixels32, touched, covered, coveredCount } = this;
    const region = this.activeRegion;
    const reach = this.radius + 0.5;
    const reachSq = reach * reach;

    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - reach));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + reach));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - reach));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + reach));
    if (minX > maxX || minY > maxY) return;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;
    const erase = brush.kind === 'erase';
    const cr = erase ? 0 : brush.color[0];
    const cg = erase ? 0 : brush.color[1];
    const cb = erase ? 0 : brush.color[2];

    let tMinX = Infinity;
    let tMinY = Infinity;
    let tMaxX = -Infinity;
    let tMaxY = -Infinity;

    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      const row = py * width;
      for (let px = minX; px <= maxX; px++) {
        const i = row + px;
        if (regionIds[i] !== region) continue;
        const cx = px + 0.5;
        let t = lenSq > 0 ? ((cx - x0) * dx + (cy - y0) * dy) / lenSq : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const ex = cx - (x0 + t * dx);
        const ey = cy - (y0 + t * dy);
        const distSq = ex * ex + ey * ey;
        if (distSq >= reachSq) continue;
        // 붓 가장자리 1px 만 부드럽게, 안쪽은 완전 불투명.
        const a = Math.min(1, reach - Math.sqrt(distSq));

        if (touched[i] === 0) {
          touched[i] = 1;
          if (this.logLen === this.logIdx.length) this.growLog();
          this.logIdx[this.logLen] = i;
          this.logVal[this.logLen++] = pixels32[i];
        }

        const o = i * 4;
        if (erase) {
          pixels[o + 3] = pixels[o + 3] * (1 - a);
        } else if (a >= 1) {
          pixels[o] = cr;
          pixels[o + 1] = cg;
          pixels[o + 2] = cb;
          pixels[o + 3] = 255;
        } else {
          const keep = (pixels[o + 3] / 255) * (1 - a);
          const outA = a + keep;
          pixels[o] = (cr * a + pixels[o] * keep) / outA;
          pixels[o + 1] = (cg * a + pixels[o + 1] * keep) / outA;
          pixels[o + 2] = (cb * a + pixels[o + 2] * keep) / outA;
          pixels[o + 3] = outA * 255;
        }

        const now = pixels[o + 3] >= COVERED_ALPHA ? 1 : 0;
        if (now !== covered[i]) {
          covered[i] = now;
          coveredCount[region] += now ? 1 : -1;
        }

        if (px < tMinX) tMinX = px;
        if (px > tMaxX) tMaxX = px;
        if (py < tMinY) tMinY = py;
        if (py > tMaxY) tMaxY = py;
      }
    }

    if (tMaxX >= tMinX) this.markDirty(tMinX, tMinY, tMaxX, tMaxY);
  }
}
