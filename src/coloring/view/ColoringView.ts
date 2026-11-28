import { Application, Assets, BlurFilter, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { createAtelierScene } from '../../atelier/AtelierScene';
import { easelPlacement } from '../../atelier/geometry';
import type { AtelierLayout } from '../../atelier/scene';
import { PaintEngine, type Brush } from '../engine/PaintEngine';
import { hexToRgb, type LoadedPainting } from '../painting';
import { clampPlacement, clampZoom, fitScale, scaleAround, type Placement, type Rect } from './viewport';

/** 붓이 칠하는 반지름 (화면 픽셀). 확대하면 그림 기준으로는 가늘어진다. */
export const BRUSH_SCREEN_RADIUS = 18;
/** 그림 주변 여백 (화면 픽셀): 위쪽 HUD, 아래쪽 물감 바 자리. */
const MARGIN = { top: 76, right: 24, bottom: 136, left: 24 };
/** 더블클릭으로 확대할 때의 배율. */
const DOUBLE_TAP_ZOOM = 2.5;

export interface ColoringViewEvents {
  onProgress(filled: number, total: number): void;
  onZoom(zoom: number): void;
  onHistory(canUndo: boolean, canRedo: boolean): void;
  /** 칠이 바뀌었을 때 (스트로크 끝, 되돌리기, 처음부터). 자동 저장에 쓴다. */
  onChange(): void;
  /** 줌 100% 일 때 종이가 놓이는 화면 위 자리가 정해졌을 때. 캔버스 뒤 배경을 맞추는 데 쓴다. */
  onLayout?(paper: { x: number; y: number; width: number; height: number }, screenW: number, screenH: number): void;
}

/**
 * 색칠 화면의 캔버스 부분: 종이 → 칠 레이어 → 선화 → 번호.
 * 배경은 투명이라 뒤에 놓인 화실 배경이 그대로 보인다.
 * 캔버스 위의 포인터 입력은 확대·축소·이동에만 쓰고, 칠하기는 붓(Brush)이 호출한다.
 */
export class ColoringView {
  /**
   * @param options.atelier 주면 화실 장면을 이젤 앞 시점으로 캔버스 뒤에 그린다 (R9).
   */
  static async create(
    host: HTMLElement,
    painting: LoadedPainting,
    events: ColoringViewEvents,
    options: { atelier?: AtelierLayout } = {},
  ): Promise<ColoringView> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    const linesTexture = await Assets.load<Texture>(painting.linesUrl);
    const atelier = options.atelier
      ? { layout: options.atelier, scene: await createAtelierScene(options.atelier) }
      : null;
    return new ColoringView(app, host, painting, linesTexture, events, atelier);
  }

  readonly engine: PaintEngine;
  private readonly world = new Container();
  /** 배경 위에 얇게 덮어 캔버스와 HUD 가 잘 보이게 하는 막 */
  private readonly veil = new Graphics();
  private readonly easel = new Graphics();
  private readonly paintCanvas: HTMLCanvasElement;
  private readonly paintCtx: CanvasRenderingContext2D;
  private readonly paintImage: ImageData;
  private readonly paintTexture: Texture;
  private readonly labels = new Map<number, Text>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private labelsVisible = true;
  private linesBitmap: Promise<ImageBitmap> | null = null;
  private zoom = 1;
  private fit = 1;
  private lastFilled = -1;
  private layoutW = 0;
  private layoutH = 0;

  private constructor(
    private readonly app: Application,
    host: HTMLElement,
    private readonly painting: LoadedPainting,
    linesTexture: Texture,
    private readonly events: ColoringViewEvents,
    private readonly atelier: { layout: AtelierLayout; scene: Container } | null,
  ) {
    const { meta, regionIds, hidden } = painting;
    this.engine = new PaintEngine(meta.width, meta.height, regionIds, hidden);
    // 그림을 거의 다 칠하면 아직 칠하지 않은 칸을 그 칸의 번호 색으로 채운다
    const paletteColor = new Map(meta.palette.map((p) => [p.number, hexToRgb(p.color)]));
    const regionColor = new Map(meta.regions.map((r) => [r.id, paletteColor.get(r.number) ?? null]));
    this.engine.setRegionColors((region) => regionColor.get(region) ?? null);

    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = meta.width;
    this.paintCanvas.height = meta.height;
    const ctx = this.paintCanvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다.');
    this.paintCtx = ctx;
    this.paintImage = new ImageData(this.engine.pixels, meta.width, meta.height);
    this.paintTexture = Texture.from(this.paintCanvas);

    const paper = new Graphics()
      .rect(0, 0, meta.width, meta.height)
      .fill({ color: 0xfffdf8 })
      .stroke({ width: 6, color: 0xe6d3b8, alignment: 0 });
    this.world.addChild(paper, new Sprite(this.paintTexture), new Sprite(linesTexture));

    for (const region of meta.regions) {
      const label = new Text({
        text: String(region.number),
        resolution: 2,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: region.label.size,
          fontWeight: '700',
          fill: 0xa89f97,
        },
      });
      label.anchor.set(0.5);
      label.position.set(region.label.x, region.label.y);
      this.labels.set(region.id, label);
      this.world.addChild(label);
    }
    if (atelier) {
      // 화실은 캔버스 뒤 배경이므로 아주 살짝만 흐리게 해서 그림에 눈이 가게 한다.
      atelier.scene.filters = [new BlurFilter({ strength: 1.2 })];
      this.app.stage.addChild(atelier.scene, this.veil, this.easel);
    }
    this.app.stage.addChild(this.world);

    const canvas = this.app.canvas;
    canvas.style.touchAction = 'none';
    canvas.style.display = 'block';
    host.appendChild(canvas);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('dblclick', this.onDoubleClick);

    this.app.ticker.add(this.onTick);
    this.layout();
    this.reportProgress();
  }

  // ── 칠하기 (붓이 호출) ───────────────────────────────

  setBrush(brush: Brush | null): void {
    this.engine.setBrush(brush);
  }

  /** 화면 좌표에서 스트로크를 시작한다. 칠할 칸이 없으면 false. */
  beginStrokeAt(clientX: number, clientY: number): boolean {
    const p = this.toWorld(clientX, clientY);
    const started = this.engine.beginStroke(p.x, p.y) !== 0;
    if (started) this.flush();
    return started;
  }

  strokeToClient(clientX: number, clientY: number): void {
    const p = this.toWorld(clientX, clientY);
    this.engine.strokeTo(p.x, p.y);
  }

  /** strokeToClient 를 여러 번 부른 뒤 한 번만 호출해 화면에 반영한다. */
  commitStroke(): void {
    this.flush();
  }

  endStroke(): void {
    this.engine.endStroke();
    this.flush();
    this.notifyChange();
  }

  clear(): void {
    this.engine.clear();
    this.flush();
    this.notifyChange();
  }

  undo(): void {
    if (!this.engine.undo()) return;
    this.flush();
    this.notifyChange();
  }

  redo(): void {
    if (!this.engine.redo()) return;
    this.flush();
    this.notifyChange();
  }

  /** 저장해 둔 칠을 불러온다. */
  restore(pixels: Uint8ClampedArray): void {
    this.engine.loadPixels(pixels);
    this.flush();
    this.events.onHistory(false, false);
  }

  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    this.updateLabels();
  }

  /** 종이 + 칠 + 선화를 합친 작품 이미지 (PNG). 갤러리와 완성 화면에 쓴다. */
  async renderArtwork(maxWidth = 1280): Promise<Blob> {
    const { width, height } = this.painting.meta;
    const scale = Math.min(1, maxWidth / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다.');
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.paintCanvas, 0, 0, canvas.width, canvas.height);
    this.linesBitmap ??= fetch(this.painting.linesUrl)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b));
    ctx.drawImage(await this.linesBitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('작품 이미지를 만들지 못했습니다.'))), 'image/png');
    });
  }

  // ── 확대·축소·이동 ───────────────────────────────────

  /** 화면의 한 점을 기준으로 확대·축소한다. */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const zoom = clampZoom(this.zoom * factor);
    if (zoom === this.zoom) return;
    const rect = this.app.canvas.getBoundingClientRect();
    this.zoom = zoom;
    this.place(scaleAround(this.placement(), clientX - rect.left, clientY - rect.top, this.fit * zoom));
  }

  /** 그림 영역의 가운데를 기준으로 확대·축소한다 (버튼용). */
  zoomBy(factor: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const avail = this.avail();
    this.zoomAt(rect.left + (avail.left + avail.right) / 2, rect.top + (avail.top + avail.bottom) / 2, factor);
  }

  resetZoom(): void {
    this.zoom = 1;
    this.place({ scale: this.fit, x: 0, y: 0 });
  }

  panBy(dx: number, dy: number): void {
    const p = this.placement();
    this.place({ scale: p.scale, x: p.x + dx, y: p.y + dy });
  }

  destroy(): void {
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.app.ticker.remove(this.onTick);
    this.paintTexture.destroy(true);
    void Assets.unload(this.painting.linesUrl);
    this.app.destroy(true, { children: true });
  }

  private avail(): Rect {
    const { width, height } = this.app.screen;
    return {
      left: MARGIN.left,
      top: MARGIN.top,
      right: Math.max(MARGIN.left + 1, width - MARGIN.right),
      bottom: Math.max(MARGIN.top + 1, height - MARGIN.bottom),
    };
  }

  private placement(): Placement {
    return { scale: this.world.scale.x, x: this.world.position.x, y: this.world.position.y };
  }

  private place(p: Placement): void {
    const { width, height } = this.painting.meta;
    const next = clampPlacement(p, this.avail(), width, height);
    this.world.scale.set(next.scale);
    this.world.position.set(next.x, next.y);
    this.engine.setRadius(BRUSH_SCREEN_RADIUS / next.scale);
    this.app.canvas.style.cursor = this.zoom > 1 ? 'grab' : 'default';
    this.events.onZoom(this.zoom);
  }

  /** 화면 크기가 바뀌면 보고 있던 가운데 지점을 유지한 채 다시 맞춘다. */
  private layout(): void {
    const { width: sw, height: sh } = this.app.screen;
    const { width, height } = this.painting.meta;
    const old = this.placement();
    const hadLayout = this.layoutW > 0;
    const focusX = (this.layoutW / 2 - old.x) / old.scale;
    const focusY = (this.layoutH / 2 - old.y) / old.scale;
    this.layoutW = sw;
    this.layoutH = sh;
    this.fit = fitScale(this.avail(), width, height);
    this.layoutBackdrop();
    const scale = this.fit * this.zoom;
    this.place(
      hadLayout
        ? { scale, x: sw / 2 - focusX * scale, y: sh / 2 - focusY * scale }
        : { scale, x: 0, y: 0 },
    );
  }

  /**
   * 화실 배경과 이젤을 줌 100% 일 때의 종이 자리에 맞춘다.
   * 확대·축소와 무관하게 고정되므로, 확대하면 캔버스만 커진다.
   */
  private layoutBackdrop(): void {
    const { width: sw, height: sh } = this.app.screen;
    const { width, height } = this.painting.meta;
    const fitted = clampPlacement({ scale: this.fit, x: 0, y: 0 }, this.avail(), width, height);
    const paper = { x: fitted.x, y: fitted.y, width: width * this.fit, height: height * this.fit };
    this.events.onLayout?.(paper, sw, sh);
    if (!this.atelier) return;

    const { layout, scene } = this.atelier;
    const p = easelPlacement(layout.width, layout.height, layout.easelFocus, paper, sw, sh);
    scene.scale.set(p.scale);
    scene.position.set(p.x, p.y);
    this.veil.clear().rect(0, 0, sw, sh).fill({ color: 0xfff3e2, alpha: 0.22 });

    // 임시 이젤: 기둥, 위쪽 집게, 종이를 받치는 선반, 다리
    const wood = 0xd9a56c;
    const woodDark = 0xb9793f;
    const edge = { width: 3, color: 0x8a5a2c };
    const cx = paper.x + paper.width / 2;
    const bottom = paper.y + paper.height;
    const ledgeH = Math.max(14, Math.min(26, paper.height * 0.045));
    this.easel
      .clear()
      .rect(cx - 17, paper.y - 46, 34, bottom - paper.y + 46)
      .fill(woodDark)
      .poly([paper.x + paper.width * 0.12, bottom, paper.x + paper.width * 0.2, bottom, paper.x + paper.width * 0.12, sh + 20, paper.x + paper.width * 0.02, sh + 20])
      .fill(woodDark)
      .stroke(edge)
      .poly([paper.x + paper.width * 0.8, bottom, paper.x + paper.width * 0.88, bottom, paper.x + paper.width * 0.98, sh + 20, paper.x + paper.width * 0.88, sh + 20])
      .fill(woodDark)
      .stroke(edge)
      .roundRect(cx - paper.width * 0.16, paper.y - 30, paper.width * 0.32, 32, 6)
      .fill(wood)
      .stroke(edge)
      .roundRect(paper.x - 26, bottom - 3, paper.width + 52, ledgeH, 6)
      .fill(wood)
      .stroke(edge)
      .rect(paper.x + 6, paper.y + 8, paper.width, paper.height)
      .fill({ color: 0x5b4636, alpha: 0.18 });
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.world.position.x) / this.world.scale.x,
      y: (clientY - rect.top - this.world.position.y) / this.world.scale.y,
    };
  }

  private onTick = (): void => {
    if (this.app.screen.width !== this.layoutW || this.app.screen.height !== this.layoutH) this.layout();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.app.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 캡처가 안 되는 포인터여도 이동은 계속한다.
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };

    if (this.pointers.size === 1) {
      // 한 손가락(또는 마우스) 드래그: 이동
      this.panBy(next.x - prev.x, next.y - prev.y);
    } else if (this.pointers.size === 2) {
      // 두 손가락: 벌리면 확대, 함께 움직이면 이동
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      const midX = (next.x + other.x) / 2;
      const midY = (next.y + other.y) / 2;
      this.panBy((next.x - prev.x) / 2, (next.y - prev.y) / 2);
      if (before > 0) this.zoomAt(midX, midY, after / before);
    }
    this.pointers.set(e.pointerId, next);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  private onDoubleClick = (e: MouseEvent): void => {
    if (this.zoom > 1) this.resetZoom();
    else this.zoomAt(e.clientX, e.clientY, DOUBLE_TAP_ZOOM);
  };

  /** 엔진에서 바뀐 부분만 캔버스에 옮기고 텍스처를 갱신한다. */
  private flush(): void {
    const dirty = this.engine.takeDirty();
    if (!dirty) return;
    this.paintCtx.putImageData(this.paintImage, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
    this.paintTexture.source.update();
    this.reportProgress();
  }

  private notifyChange(): void {
    this.events.onHistory(this.engine.canUndo, this.engine.canRedo);
    this.events.onChange();
  }

  private updateLabels(): void {
    for (const [id, label] of this.labels) label.visible = this.labelsVisible && !this.engine.isFilled(id);
  }

  private reportProgress(): void {
    this.updateLabels();
    const filled = this.engine.filledCount();
    if (filled === this.lastFilled) return;
    this.lastFilled = filled;
    this.events.onProgress(filled, this.engine.fillableCount);
  }
}
