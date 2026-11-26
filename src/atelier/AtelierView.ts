import { Application, Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import { createAtelierScene } from './AtelierScene';
import { Character } from './Character';
import { clampToPolygon, roomPlacement, type Point } from './geometry';
import type { AtelierLayout, Hotspot } from './scene';

/** 걷는 속도 (장면 픽셀 / 초) */
const WALK_SPEED = 380;

export interface AtelierViewEvents {
  onSeatedChange(seated: boolean): void;
  /** 의자에 앉은 채로 이젤을 눌렀을 때 */
  onEasel(): void;
  /** 아직 준비 중인 활동을 눌렀을 때 */
  onUnavailable(hotspot: Hotspot): void;
}

/** 화실 화면: 방 전체 시점. 바닥을 누르면 걸어가고, 의자를 누르면 앉고, 앉아서 이젤을 누르면 색칠을 시작한다. */
export class AtelierView {
  static async create(
    host: HTMLElement,
    layout: AtelierLayout,
    events: AtelierViewEvents,
    options: { startSeated: boolean },
  ): Promise<AtelierView> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: 0xf6e7d4,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    const scene = await createAtelierScene(layout);
    return new AtelierView(app, host, layout, scene, events, options.startSeated);
  }

  private readonly root = new Container();
  private readonly character = new Character();
  private readonly markers = new Map<string, Container>();
  private position: Point;
  private target: Point | null = null;
  private onArrive: (() => void) | null = null;
  private seated = false;
  private time = 0;

  private constructor(
    private readonly app: Application,
    host: HTMLElement,
    private readonly layout: AtelierLayout,
    scene: Container,
    private readonly events: AtelierViewEvents,
    startSeated: boolean,
  ) {
    // 바닥(배경)을 누르면 그 자리로 걸어간다.
    scene.eventMode = 'static';
    scene.hitArea = new Rectangle(0, 0, layout.width, layout.height);
    scene.on('pointertap', (e: FederatedPointerEvent) => this.onFloorTap(e.getLocalPosition(this.root)));
    this.root.addChild(scene);

    for (const hotspot of layout.hotspots) {
      const area = new Container();
      area.eventMode = 'static';
      area.cursor = 'pointer';
      area.hitArea = new Rectangle(hotspot.rect.x, hotspot.rect.y, hotspot.rect.width, hotspot.rect.height);
      area.on('pointertap', () => this.onHotspotTap(hotspot));

      const marker = new Container();
      marker.position.set(hotspot.marker.x, hotspot.marker.y);
      marker.addChild(new Graphics().circle(0, 0, 30).fill({ color: 0xfffaf2, alpha: 0.94 }).stroke({ width: 4, color: 0xd9a56c }));
      const icon = new Text({ text: hotspot.icon, style: { fontSize: 30 } });
      icon.anchor.set(0.5);
      marker.addChild(icon);
      marker.alpha = hotspot.available ? 1 : 0.6;
      area.addChild(marker);
      this.markers.set(hotspot.id, marker);
      this.root.addChild(area);
    }

    this.root.addChild(this.character.view);
    this.app.stage.addChild(this.root);

    if (startSeated) {
      this.position = { ...layout.stool.approach };
      this.sitDown();
    } else {
      // 접속하면 화면 밖에서 화실로 걸어 들어온다.
      this.position = { ...layout.entry };
      this.walkTo(layout.spawn);
    }

    const canvas = this.app.canvas;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);
    this.app.ticker.add(this.onTick);
    this.onTick();
  }

  destroy(): void {
    this.app.ticker.remove(this.onTick);
    this.app.destroy(true, { children: true });
  }

  private walkTo(target: Point, onArrive: (() => void) | null = null): void {
    if (this.seated) this.standUp();
    this.target = target;
    this.onArrive = onArrive;
    this.character.setPose('walk');
    this.character.face(target.x < this.position.x ? -1 : 1);
  }

  private sitDown(): void {
    this.target = null;
    this.seated = true;
    this.character.setPose('sit');
    this.character.face(-1); // 이젤을 바라본다
    this.events.onSeatedChange(true);
  }

  private standUp(): void {
    this.seated = false;
    this.position = { ...this.layout.stool.approach };
    this.events.onSeatedChange(false);
  }

  private onFloorTap(p: Point): void {
    this.walkTo(clampToPolygon(p, this.layout.walkArea));
  }

  private onHotspotTap(hotspot: Hotspot): void {
    if (!hotspot.available) {
      this.events.onUnavailable(hotspot);
      return;
    }
    if (hotspot.id === 'easel' && this.seated) {
      this.events.onEasel();
      return;
    }
    // 의자를 누르거나, 앉지 않은 채 이젤을 누르면 먼저 의자로 가서 앉는다.
    if (!this.seated) this.walkTo(this.layout.stool.approach, () => this.sitDown());
  }

  private onTick = (): void => {
    const dt = Math.min(0.05, this.app.ticker.deltaMS / 1000);
    this.time += dt;

    if (this.target) {
      const dx = this.target.x - this.position.x;
      const dy = this.target.y - this.position.y;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;
      if (dist <= step) {
        this.position = { ...this.target };
        this.target = null;
        this.character.setPose('idle');
        const arrived = this.onArrive;
        this.onArrive = null;
        arrived?.();
      } else {
        this.position = { x: this.position.x + (dx / dist) * step, y: this.position.y + (dy / dist) * step };
      }
    }
    this.character.update(dt);

    const { layout } = this;
    const feet = this.seated ? layout.stool.seat : this.position;
    this.character.view.position.set(feet.x, feet.y);
    // 멀리(위쪽) 있을수록 조금 작게 그린다.
    const depth = Math.min(1, Math.max(0, (this.position.y - 790) / 140));
    this.character.view.scale.set(this.seated ? 0.92 : 0.86 + 0.2 * depth);

    // 앉아 있으면 이젤 표시가, 서 있으면 의자 표시가 눈에 띄게 움직인다.
    const pulse = 1 + 0.1 * Math.sin(this.time * 4);
    this.markers.get('easel')?.scale.set(this.seated ? pulse : 1);
    this.markers.get('stool')?.scale.set(this.seated ? 1 : pulse);
    const stoolMarker = this.markers.get('stool');
    if (stoolMarker) stoolMarker.visible = !this.seated;

    const { width, height } = this.app.screen;
    const p = roomPlacement(layout.width, layout.height, width, height, feet.x);
    this.root.scale.set(p.scale);
    this.root.position.set(p.x, p.y);
  };
}
