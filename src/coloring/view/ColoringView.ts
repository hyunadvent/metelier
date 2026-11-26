import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { PaintEngine, type Brush } from '../engine/PaintEngine';
import type { LoadedPainting } from '../painting';

/** 붓 반지름 (화면 픽셀). 확대하면 그림 기준으로는 가늘어진다. */
const BRUSH_SCREEN_RADIUS = 20;
/** 그림 주변 여백 (화면 픽셀): 위쪽 HUD, 아래쪽 물감 바 자리. */
const MARGIN = { top: 76, right: 24, bottom: 136, left: 24 };

export interface ColoringViewEvents {
  onProgress(filled: number, total: number): void;
}

/** 색칠 화면의 캔버스 부분: 종이 → 칠 레이어 → 선화 → 번호 → 붓 커서. */
export class ColoringView {
  static async create(host: HTMLElement, painting: LoadedPainting, events: ColoringViewEvents): Promise<ColoringView> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    const linesTexture = await Assets.load<Texture>(painting.linesUrl);
    return new ColoringView(app, host, painting, linesTexture, events);
  }

  readonly engine: PaintEngine;
  private readonly world = new Container();
  private readonly cursor = new Graphics();
  private readonly paintCanvas: HTMLCanvasElement;
  private readonly paintCtx: CanvasRenderingContext2D;
  private readonly paintImage: ImageData;
  private readonly paintTexture: Texture;
  private readonly labels = new Map<number, Text>();
  private activePointer: number | null = null;
  private lastFilled = -1;
  private layoutW = 0;
  private layoutH = 0;

  private constructor(
    private readonly app: Application,
    host: HTMLElement,
    private readonly painting: LoadedPainting,
    linesTexture: Texture,
    private readonly events: ColoringViewEvents,
  ) {
    const { meta, regionIds } = painting;
    this.engine = new PaintEngine(meta.width, meta.height, regionIds);

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

    this.cursor.circle(0, 0, BRUSH_SCREEN_RADIUS).stroke({ width: 2, color: 0x5b4636, alpha: 0.7 });
    this.cursor.visible = false;
    this.app.stage.addChild(this.world, this.cursor);

    const canvas = this.app.canvas;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'none';
    canvas.style.display = 'block';
    host.appendChild(canvas);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.app.ticker.add(this.onTick);
    this.layout();
    this.reportProgress();
  }

  setBrush(brush: Brush | null): void {
    this.engine.setBrush(brush);
  }

  clear(): void {
    this.engine.clear();
    this.flush();
  }

  destroy(): void {
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.app.ticker.remove(this.onTick);
    this.paintTexture.destroy(true);
    void Assets.unload(this.painting.linesUrl);
    this.app.destroy(true, { children: true });
  }

  /** 그림 전체가 여백 안에 들어오도록 맞춘다 (줌 100%). */
  private layout(): void {
    const { width: sw, height: sh } = this.app.screen;
    const { width, height } = this.painting.meta;
    this.layoutW = sw;
    this.layoutH = sh;
    const availW = Math.max(1, sw - MARGIN.left - MARGIN.right);
    const availH = Math.max(1, sh - MARGIN.top - MARGIN.bottom);
    const scale = Math.min(availW / width, availH / height);
    this.world.scale.set(scale);
    this.world.position.set(
      MARGIN.left + (availW - width * scale) / 2,
      MARGIN.top + (availH - height * scale) / 2,
    );
    this.engine.setRadius(BRUSH_SCREEN_RADIUS / scale);
  }

  private toWorld(e: PointerEvent): { x: number; y: number; sx: number; sy: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      sx,
      sy,
      x: (sx - this.world.position.x) / this.world.scale.x,
      y: (sy - this.world.position.y) / this.world.scale.y,
    };
  }

  private moveCursor(e: PointerEvent): void {
    const p = this.toWorld(e);
    this.cursor.position.set(p.sx, p.sy);
    this.cursor.visible = true;
  }

  private onTick = (): void => {
    if (this.app.screen.width !== this.layoutW || this.app.screen.height !== this.layoutH) this.layout();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.activePointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.moveCursor(e);
    const p = this.toWorld(e);
    if (this.engine.beginStroke(p.x, p.y) === 0) return;
    this.activePointer = e.pointerId;
    try {
      this.app.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 캡처가 안 되는 포인터여도 칠하기는 계속한다.
    }
    this.flush();
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.moveCursor(e);
    if (e.pointerId !== this.activePointer) return;
    // 빠르게 움직여도 끊기지 않도록 프레임 사이의 중간 좌표까지 모두 쓴다.
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [e]) {
      const p = this.toWorld(sample);
      this.engine.strokeTo(p.x, p.y);
    }
    this.flush();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.engine.endStroke();
    this.activePointer = null;
    if (e.pointerType !== 'mouse') this.cursor.visible = false;
  };

  private onPointerLeave = (): void => {
    if (this.activePointer === null) this.cursor.visible = false;
  };

  /** 엔진에서 바뀐 부분만 캔버스에 옮기고 텍스처를 갱신한다. */
  private flush(): void {
    const dirty = this.engine.takeDirty();
    if (!dirty) return;
    this.paintCtx.putImageData(this.paintImage, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
    this.paintTexture.source.update();
    this.reportProgress();
  }

  private reportProgress(): void {
    for (const [id, label] of this.labels) label.visible = !this.engine.isFilled(id);
    const filled = this.engine.filledCount();
    if (filled === this.lastFilled) return;
    this.lastFilled = filled;
    this.events.onProgress(filled, this.engine.regionCount);
  }
}
