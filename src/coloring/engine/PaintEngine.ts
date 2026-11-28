export type Rgb = readonly [number, number, number];

export type Brush = { kind: 'paint'; color: Rgb } | { kind: 'erase' };

export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 이 알파 이상인 픽셀을 칠해진 것으로 본다. */
const COVERED_ALPHA = 128;

/**
 * 칸을 이만큼 넘게 칠하면, 스트로크가 끝날 때 남은 곳을 가까이 칠한 색으로 메워 칸을 끝낸다.
 * 마지막 한두 군데를 찾아 헤매지 않게 한다.
 */
const REGION_AUTOFILL = 0.99;
/**
 * 그림 전체를 이만큼 넘게 칠하면, 남은 칸을 모두 채워 그림을 끝낸다.
 * 조금 칠한 칸은 가까이 칠한 색으로, 아직 칠하지 않은 칸은 그 칸의 번호 색으로 채운다.
 */
const PICTURE_AUTOFILL = 0.99;

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
 * - 칸은 보이는 픽셀이 모두 칠해져야 "칠한 칸"이 된다. 선에 가려진 픽셀은 세지 않는다.
 * - 좌표는 그림 픽셀 단위이고 (0, 0) 은 왼쪽 위 모서리다.
 */
export class PaintEngine {
  /** RGBA (비 프리멀티플라이). ImageData 로 그대로 쓸 수 있다. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** 칸 ID → 칠해야 하는 (선에 가려지지 않은) 픽셀 수. 인덱스 0 은 쓰지 않는다. */
  readonly regionSize: Uint32Array;
  /** 가장 큰 칸 ID. */
  readonly regionCount: number;
  /** 칠해야 하는 픽셀이 하나라도 있는 칸의 수. */
  readonly fillableCount: number;

  /** 진행도에 세는 픽셀 (칸에 속하고 선에 가려지지 않음). */
  private readonly countable: Uint8Array;
  private readonly covered: Uint8Array;
  private readonly coveredCount: Uint32Array;
  /** 칸 ID → 경계 상자 [minX, minY, maxX, maxY]. */
  private readonly regionBox: Int32Array;
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
  /** 칸마다의 번호 색. 그림을 거의 다 칠했을 때 아직 칠하지 않은 칸을 채우는 데 쓴다. */
  private regionColor: ((region: number) => Rgb | null) | null = null;
  private radius = 16;
  private activeRegion = 0;
  private lastX = 0;
  private lastY = 0;
  private dirtyMinX = Infinity;
  private dirtyMinY = Infinity;
  private dirtyMaxX = -Infinity;
  private dirtyMaxY = -Infinity;

  /**
   * @param hidden 선에 가려져 보이지 않는 픽셀 표시 (0 이 아니면 가려짐). 칠할 수는 있지만 진행도에는 세지 않는다.
   */
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly regionIds: Uint16Array,
    hidden?: Uint8Array,
  ) {
    const count = width * height;
    if (regionIds.length !== count) {
      throw new Error(`칸 ID 맵 크기가 맞지 않습니다: ${regionIds.length} != ${width} x ${height}`);
    }
    if (hidden && hidden.length !== count) {
      throw new Error(`선 마스크 크기가 맞지 않습니다: ${hidden.length} != ${width} x ${height}`);
    }
    let maxId = 0;
    for (let i = 0; i < count; i++) if (regionIds[i] > maxId) maxId = regionIds[i];
    this.regionCount = maxId;
    this.regionSize = new Uint32Array(maxId + 1);
    this.regionBox = new Int32Array((maxId + 1) * 4);
    for (let id = 0; id <= maxId; id++) {
      this.regionBox[id * 4] = width;
      this.regionBox[id * 4 + 1] = height;
      this.regionBox[id * 4 + 2] = -1;
      this.regionBox[id * 4 + 3] = -1;
    }
    this.countable = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const id = regionIds[i];
      if (id === 0 || (hidden && hidden[i])) continue;
      this.countable[i] = 1;
      this.regionSize[id]++;
      const x = i % width;
      const y = (i - x) / width;
      const b = id * 4;
      if (x < this.regionBox[b]) this.regionBox[b] = x;
      if (y < this.regionBox[b + 1]) this.regionBox[b + 1] = y;
      if (x > this.regionBox[b + 2]) this.regionBox[b + 2] = x;
      if (y > this.regionBox[b + 3]) this.regionBox[b + 3] = y;
    }
    let fillable = 0;
    for (let id = 1; id <= maxId; id++) if (this.regionSize[id] > 0) fillable++;
    this.fillableCount = fillable;

    this.coveredCount = new Uint32Array(maxId + 1);
    this.covered = new Uint8Array(count);
    this.pixels = new Uint8ClampedArray(count * 4);
    this.pixels32 = new Uint32Array(this.pixels.buffer);
    this.touched = new Uint8Array(count);
  }

  /** 칸마다의 번호 색을 알려 준다. 알려 주지 않으면 그림 전체를 채우는 일은 하지 않는다. */
  setRegionColors(colorOf: (region: number) => Rgb | null): void {
    this.regionColor = colorOf;
  }

  /** 그림 전체에서 칠한 비율 (0~1). 선에 가려진 픽셀은 세지 않는다. */
  totalCoverage(): number {
    let size = 0;
    let covered = 0;
    for (let id = 1; id <= this.regionCount; id++) {
      size += this.regionSize[id];
      covered += this.coveredCount[id];
    }
    return size ? covered / size : 0;
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
    const region = this.activeRegion;
    this.activeRegion = 0;
    if (region !== 0 && this.brush?.kind === 'paint') {
      if (this.coverage(region) >= REGION_AUTOFILL) this.fillRemaining(region);
      if (this.regionColor && this.totalCoverage() >= PICTURE_AUTOFILL) this.finishPicture();
    }

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

  get isStroking(): boolean {
    return this.activeRegion !== 0;
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
      if (now && this.countable[i]) this.coveredCount[this.regionIds[i]]++;
    }
    this.resetHistory();
    this.markDirty(0, 0, this.width - 1, this.height - 1);
  }

  /** 칸이 칠해진 비율 (0~1). */
  coverage(region: number): number {
    const size = this.regionSize[region];
    return size ? this.coveredCount[region] / size : 0;
  }

  /** 칸의 보이는 픽셀이 모두 칠해졌는가. */
  isFilled(region: number): boolean {
    const size = this.regionSize[region];
    return size > 0 && this.coveredCount[region] === size;
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

  private resetHistory(): void {
    this.activeRegion = 0;
    this.touched.fill(0);
    this.logLen = 0;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** 현재 스트로크의 되돌리기 기록에 픽셀의 지금 값을 남긴다 (스트로크당 한 번). */
  private remember(i: number): void {
    if (this.touched[i] !== 0) return;
    this.touched[i] = 1;
    if (this.logLen === this.logIdx.length) {
      const idx = new Uint32Array(this.logIdx.length * 2);
      const val = new Uint32Array(this.logVal.length * 2);
      idx.set(this.logIdx);
      val.set(this.logVal);
      this.logIdx = idx;
      this.logVal = val;
    }
    this.logIdx[this.logLen] = i;
    this.logVal[this.logLen++] = this.pixels32[i];
  }

  /** 픽셀의 알파가 바뀐 뒤 칠해짐 여부와 칸의 진행도를 맞춘다. */
  private updateCovered(i: number): void {
    const now = this.pixels[i * 4 + 3] >= COVERED_ALPHA ? 1 : 0;
    if (now === this.covered[i]) return;
    this.covered[i] = now;
    if (this.countable[i]) this.coveredCount[this.regionIds[i]] += now ? 1 : -1;
  }

  /** 기록된 픽셀 값과 현재 값을 맞바꾼다. 같은 기록으로 되돌리기와 다시 하기를 모두 한다. */
  private swap(record: StrokeRecord): void {
    const { indices, values } = record;
    const { width, pixels32 } = this;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const current = pixels32[i];
      pixels32[i] = values[k];
      values[k] = current;
      this.updateCovered(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX >= minX) this.markDirty(minX, minY, maxX, maxY);
  }

  /**
   * 칸의 남은 곳을 가까이 칠한 색으로 채운다 (칠한 곳에서 바깥으로 번져 가며).
   * 선에 가려진 픽셀도 함께 채워 칸이 깔끔하게 보이게 한다. 바뀐 픽셀은 지금 스트로크의 기록에 들어간다.
   * @returns 칠한 곳이 하나도 없어 채우지 못했으면 false
   */
  private fillRemaining(region: number): boolean {
    const { width, regionIds, covered, pixels } = this;
    const b = region * 4;
    const x0 = this.regionBox[b];
    const y0 = this.regionBox[b + 1];
    const x1 = this.regionBox[b + 2];
    const y1 = this.regionBox[b + 3];
    if (x1 < x0) return false;

    // 칠한 곳 가운데 빈 곳과 맞닿은 픽셀(가장자리)에서 시작해, 빈 곳으로만 번져 간다
    const bw = x1 - x0 + 1;
    const done = new Uint8Array(bw * (y1 - y0 + 1));
    let queue = new Int32Array(1024);
    let tail = 0;
    const push = (i: number) => {
      if (tail === queue.length) {
        const bigger = new Int32Array(queue.length * 2);
        bigger.set(queue);
        queue = bigger;
      }
      queue[tail++] = i;
    };
    const empty = (x: number, y: number) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const i = y * width + x;
      return regionIds[i] === region && !covered[i];
    };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if (regionIds[i] !== region || !covered[i]) continue;
        if (empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1)) {
          done[(y - y0) * bw + (x - x0)] = 1;
          push(i);
        }
      }
    }
    if (tail === 0) return false;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const spread = (from: number, nx: number, ny: number) => {
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) return;
      const i = ny * width + nx;
      const d = (ny - y0) * bw + (nx - x0);
      if (done[d] || regionIds[i] !== region || covered[i]) return;
      done[d] = 1;
      this.remember(i);
      pixels[i * 4] = pixels[from * 4];
      pixels[i * 4 + 1] = pixels[from * 4 + 1];
      pixels[i * 4 + 2] = pixels[from * 4 + 2];
      pixels[i * 4 + 3] = 255;
      this.updateCovered(i);
      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny;
      if (ny > maxY) maxY = ny;
      push(i);
    };
    for (let head = 0; head < tail; head++) {
      const from = queue[head];
      const fx = from % width;
      const fy = (from - fx) / width;
      spread(from, fx - 1, fy);
      spread(from, fx + 1, fy);
      spread(from, fx, fy - 1);
      spread(from, fx, fy + 1);
    }
    if (maxX >= minX) this.markDirty(minX, minY, maxX, maxY);
    return true;
  }

  /** 칸 전체를 한 색으로 칠한다 (선에 가려진 픽셀도). 바뀐 픽셀은 지금 스트로크의 기록에 들어간다. */
  private fillSolid(region: number, color: Rgb): void {
    const { width, regionIds, pixels } = this;
    const b = region * 4;
    const x0 = this.regionBox[b];
    const y0 = this.regionBox[b + 1];
    const x1 = this.regionBox[b + 2];
    const y1 = this.regionBox[b + 3];
    if (x1 < x0) return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if (regionIds[i] !== region) continue;
        this.remember(i);
        pixels[i * 4] = color[0];
        pixels[i * 4 + 1] = color[1];
        pixels[i * 4 + 2] = color[2];
        pixels[i * 4 + 3] = 255;
        this.updateCovered(i);
      }
    }
    this.markDirty(x0, y0, x1, y1);
  }

  /** 그림을 거의 다 칠했을 때: 남은 칸을 모두 채워 그림을 끝낸다. */
  private finishPicture(): void {
    for (let id = 1; id <= this.regionCount; id++) {
      if (this.regionSize[id] === 0 || this.isFilled(id)) continue;
      if (this.fillRemaining(id)) continue;
      const color = this.regionColor?.(id);
      if (color) this.fillSolid(id, color);
    }
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
    const { width, height, regionIds, pixels } = this;
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

        this.remember(i);

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
        this.updateCovered(i);

        if (px < tMinX) tMinX = px;
        if (px > tMaxX) tMaxX = px;
        if (py < tMinY) tMinY = py;
        if (py > tMaxY) tMaxY = py;
      }
    }

    if (tMaxX >= tMinX) this.markDirty(tMinX, tMinY, tMaxX, tMaxY);
  }
}
