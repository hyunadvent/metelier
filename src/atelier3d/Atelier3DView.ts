import * as THREE from 'three';
import type { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { Character3D, type Pose3D } from './Character3D';
import {
  findFreeSpot,
  loadDecor,
  MAX_WALL_PICTURES,
  wallPictureSize,
  type AtelierDecor,
  type FrameKind,
  type PlantKind,
  type PlantSlot,
  type WallPicture,
} from './decor';
import { WallImageCache } from './wallImages';
import { loadEaselPicture } from './easelPicture';
import {
  approachCamera,
  clampDestination,
  distanceInsideBox,
  isOnCharacter,
  JUMP_SPEED,
  stepJump,
  stepToward,
  type CameraPose,
  type Ground,
  type Jump,
} from './movement';
import {
  buildAtelierRoom,
  configureRenderer,
  createOutline,
  type Activity,
  type AtelierRoom,
  type Hotspot3D,
  type Hotspot3DId,
  type WallPictureView,
} from './room';

/** 걷는 속도 (미터 / 초) */
const WALK_SPEED = 2.6;
/** 이만큼(픽셀) 넘게 끌면 누르기가 아니라 둘러보기로 본다. */
const DRAG_THRESHOLD = 6;
/** 책장 앞에서 책을 고르는 시간 (초) */
const BROWSE_TIME = 0.9;
/** 활동마다 앉은 자세와, 그 자리를 가리키는 표시 */
const ACTIVITY_POSE: Record<Activity, Pose3D> = { paint: 'sit', tea: 'tea', read: 'read' };
/**
 * 활동을 시작하면 카메라가 옮겨 가는 시점. 일어나면 활동 전의 시점으로 돌아간다.
 * 그림 그리기는 정해 둔 시점이 없어 보던 그대로 둔다.
 */
const ACTIVITY_CAMERA: Partial<Record<Activity, CameraPose>> = {
  // 뒤쪽 위에서 내려다본다: 찻상과 창밖이 캐릭터 너머로 보인다
  tea: { azimuth: -0.2, polar: 0.97, distance: 2.6 },
  // 창을 정면으로 두고 가까이 본다: 책 읽는 옆모습과 창, 책장이 함께 보인다
  read: { azimuth: 0.05, polar: 1.25, distance: 2.7 },
};
const ACTIVITY_SPOT: Record<Activity, Hotspot3DId> = { paint: 'stool', tea: 'window', read: 'bookshelf' };
const CAMERA = {
  minPolar: 0.95,
  maxPolar: 1.42,
  minDistance: 2.4,
  /** 가장 멀리서 본 거리. 이보다 멀어지지 않고, 벽이나 천장에 닿으면 더 가까워진다. */
  maxDistance: 6.5,
  /** 처음 접속했을 때의 거리 */
  startDistance: 5.3,
  /** 활동 시점으로 옮겨 가거나 돌아올 때의 빠르기. 클수록 빠르다. */
  glideSpeed: 3.15,
};
/** 그림 벽을 바라보는 시점: 캐릭터 뒤(방 안쪽)에서 왼쪽 벽을 정면으로 본다 */
const WALL_CAMERA: CameraPose = { azimuth: Math.PI / 2, polar: 1.42, distance: 4.4 };
/** 그림 벽을 볼 때 캐릭터가 서는 곳의 벽에서 떨어진 거리 */
const WALL_STAND = 1.7;

/** 다른 꾸밈 자리와 겹치지 않는 벽 그림 이름표 */
function newWallId(): string {
  return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export interface Atelier3DEvents {
  /** 자리를 잡고 하는 활동이 바뀌었을 때. 일어나면 null. */
  onActivityChange(activity: Activity | null): void;
  /** 의자에 앉은 채로 이젤을 눌렀을 때 */
  onEasel(): void;
  /** 걸이대의 카메라를 눌렀을 때 */
  onCamera(): void;
  /** 그림 벽의 표시를 눌렀을 때 */
  onGalleryWall(): void;
  /** 벽에 건 그림을 고르거나(눌렀거나 옮겼을 때) 고른 것을 풀었을 때 */
  onWallPictureSelect(id: string | null): void;
  /** 벽 그림이 바뀌었을 때 (걸기, 옮기기, 치우기). 저장은 받는 쪽이 한다. */
  onWallChange(wall: WallPicture[]): void;
  /** 바꿀 수 있는 화분을 눌렀을 때 */
  onPlantSpot(slot: PlantSlot): void;
  /** 아직 준비 중인 활동을 눌렀을 때 */
  onUnavailable(hotspot: Hotspot3D): void;
}

/**
 * 3D 화실 화면: 캐릭터를 뒤에서 따라가는 3인칭 시점.
 * - 바닥을 누르거나 WASD/방향키로 걷고, 스페이스나 캐릭터를 눌러 점프한다.
 * - 화면을 끌면 360도로 둘러보고, 휠로 가까이/멀리 본다. 카메라는 방 밖으로 나가지 않는다.
 * - 의자를 누르면 앉고, 앉아서 이젤을 누르면 색칠을 시작한다.
 * - 창가를 누르면 방석에 앉아 차를 마시고, 책장을 누르면 책을 골라 방석에 앉아 읽는다.
 */
export class Atelier3DView {
  private readonly renderer: THREE.WebGLRenderer;
  /** 물체 둘레에 가는 갈색 선을 둘러 일러스트 같은 느낌을 낸다. */
  private readonly outline: OutlineEffect;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  private readonly room: AtelierRoom;
  private readonly character = new Character3D();
  private readonly spots: { hotspot: Hotspot3D; el: HTMLButtonElement }[] = [];
  private readonly spotLayer = document.createElement('div');
  private readonly resizeObserver: ResizeObserver;
  private readonly keys = new Set<string>();
  private readonly lookAt = new THREE.Vector3();
  private position: Ground;
  private target: Ground | null = null;
  private onArrive: (() => void) | null = null;
  private activity: Activity | null = null;
  /** 잠시 멈춰 있다가 이어서 할 일 (책장 앞에서 책 고르기) */
  private wait: { left: number; then: () => void } | null = null;
  /** 카메라가 스스로 옮겨 가는 목표. 사용자가 화면을 끌거나 휠을 굴리면 그만둔다. */
  private jump: Jump = { height: 0, velocity: 0 };
  private cameraGoal: CameraPose | null = null;
  /** 활동을 시작하기 전의 카메라. 일어나면 여기로 돌아간다. */
  private cameraBefore: CameraPose | null = null;
  private heading = Math.PI;
  private stuckTime = 0;
  private azimuth = 0.22;
  private polar = 1.2;
  private distance = CAMERA.startDistance;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  /** 벽 그림을 끌고 있는 중. offset 은 누른 곳과 그림 가운데의 차이 */
  private pictureDrag: { pointer: number; id: string; x: number; y: number; moved: boolean; offset: { z: number; y: number } } | null = null;
  private wall: WallPicture[];
  private readonly wallImages = new WallImageCache();
  private readonly raycaster = new THREE.Raycaster();
  private destroyed = false;
  /** 이젤에 올린 그림의 텍스처 (바꿀 때 정리한다) */
  private easelTexture: THREE.Texture | null = null;
  /** 이젤 그림을 마지막으로 부탁한 차례 (늦게 끝난 옛 요청이 새 그림을 덮지 않게) */
  private easelRequest = 0;
  /** 옮기는 중인 벽 그림. 이때는 그림 벽 표시를 숨긴다 (그림 위를 가리지 않게) */
  private wallSelection: string | null = null;
  /** 그림 벽 앞으로 갈 때 캐릭터가 서는 자리의 z. 다른 곳으로 걸어가면 잊는다. */
  private wallFocusZ: number | null = null;
  private frame = 0;
  private lastTime = performance.now();
  private time = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: Atelier3DEvents,
    options: { startSeated: boolean },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    configureRenderer(this.renderer);
    this.outline = createOutline(this.renderer);
    this.scene.background = new THREE.Color(0xf6e7d4);

    const decor = loadDecor();
    this.room = buildAtelierRoom(decor);
    this.wall = decor.wall;
    void this.rebuildWall();
    void this.refreshEasel();
    this.scene.add(this.room.group, this.character.group);

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    // 활동 표시: 3D 위치를 따라다니는 버튼
    this.spotLayer.className = 'atelier3d__spots';
    host.appendChild(this.spotLayer);
    for (const hotspot of this.room.hotspots) {
      const el = document.createElement('button');
      el.className = 'atelier3d__spot';
      el.textContent = hotspot.icon;
      el.setAttribute('aria-label', hotspot.label);
      el.dataset.spot = hotspot.id;
      if (!hotspot.available) el.classList.add('atelier3d__spot--soon');
      el.addEventListener('click', () => this.onHotspot(hotspot));
      this.spotLayer.appendChild(el);
      this.spots.push({ hotspot, el });
    }

    if (options.startSeated) {
      this.position = { ...this.room.seats.paint.approach };
      this.sitDown('paint');
    } else {
      // 접속하면 방 밖에서 화실로 걸어 들어온다.
      this.position = { ...this.room.entry };
      this.walkTo(this.room.spawn);
    }

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.placeCamera(1);
    this.frame = requestAnimationFrame(this.onFrame);
  }

  /** 서버에서 받은 꾸밈을 화실에 다시 보여 준다 (화분과 그림 벽). */
  applyDecor(decor: AtelierDecor): void {
    for (const slot of Object.keys(decor.plants) as PlantSlot[]) this.room.setPlant(slot, decor.plants[slot]);
    this.wall = decor.wall;
    if (this.wallSelection && !this.wall.some((p) => p.id === this.wallSelection)) this.selectWallPicture(null);
    void this.rebuildWall();
    void this.refreshEasel();
  }

  /** 꾸미기: 그 자리의 화분을 바꾼다. */
  setPlant(slot: PlantSlot, kind: PlantKind): void {
    this.room.setPlant(slot, kind);
  }

  // ── 그림 벽 ────────────────────────────────────

  /** 벽 그림들의 그림을 불러와 다시 건다. 작품집에서 지워진 그림은 걸지 않는다. */
  private async rebuildWall(): Promise<void> {
    const wall = this.wall;
    const images = await Promise.all(wall.map((p) => this.wallImages.get(p.paintingId)));
    if (this.destroyed || wall !== this.wall) return;
    const views: WallPictureView[] = [];
    wall.forEach((picture, i) => {
      const image = images[i];
      if (image) views.push({ picture, image });
    });
    this.room.setWallPictures(views);
  }

  /** 마지막으로 칠한 그림을 이젤의 캔버스에 올린다. 그림 벽에 건 그림은 올리지 않는다. 없으면 빈 캔버스. */
  async refreshEasel(): Promise<void> {
    const request = ++this.easelRequest;
    const hung = new Set(this.wall.map((p) => p.paintingId));
    const picture = await loadEaselPicture(hung).catch((e: unknown) => {
      console.warn('이젤 그림을 만들지 못했습니다.', e);
      return null;
    });
    if (this.destroyed || request !== this.easelRequest) {
      picture?.texture.dispose();
      return;
    }
    this.room.setBoardPicture(picture?.texture ?? null, picture?.aspect);
    this.easelTexture?.dispose();
    this.easelTexture = picture?.texture ?? null;
  }

  /** 그림 벽 쪽으로 걸어가서 벽을 바라본다. */
  focusGalleryWall(): void {
    const spot = this.room.hotspots.find((h) => h.id === 'gallery-wall')!;
    const z = Math.min(this.room.bounds.maxZ - 0.5, Math.max(-0.6, this.activity ? spot.position.z : this.position.z));
    const stand = clampDestination({ x: this.room.galleryWallX + WALL_STAND, z }, this.room);
    this.walkTo(stand, () => {
      this.heading = -Math.PI / 2;
    });
    this.wallFocusZ = stand.z;
    this.cameraGoal = WALL_CAMERA;
  }

  /** 이 완성작이 벽에 걸려 있으면 그 이름표 */
  wallPictureOf(paintingId: string): string | null {
    return this.wall.find((p) => p.paintingId === paintingId)?.id ?? null;
  }

  get wallCount(): number {
    return this.wall.length;
  }

  /**
   * 완성작을 벽에 건다. 화면 가운데가 가리키는 벽 자리 가까이의 빈자리에 건다.
   * @returns 건 그림의 이름표. 그림을 불러오지 못했거나 벽이 가득 차면 null
   */
  async addWallPicture(paintingId: string): Promise<string | null> {
    const existing = this.wallPictureOf(paintingId);
    if (existing) return existing;
    if (this.wall.length >= MAX_WALL_PICTURES) return null;
    const image = await this.wallImages.get(paintingId);
    if (!image || this.destroyed) return null;
    const { w, h } = wallPictureSize(image.aspect);
    const rects = this.wall.map((p) => this.room.wallPictureRect(p.id)).filter((r) => r !== null);
    // 눈높이에 건다. 좌우 자리는 화면 가운데가 가리키는 곳
    // 벽 앞으로 가는 중이면 캐릭터가 설 자리의 앞, 아니면 화면 가운데가 가리키는 곳
    const aim = { z: this.wallFocusZ ?? this.wallPointAt(0, 0)?.z ?? this.position.z, y: 1.95 };
    const spot = findFreeSpot(rects, w, h, aim);
    const picture: WallPicture = { id: newWallId(), paintingId, frame: 'wood', z: spot.z, y: spot.y };
    this.wall = [...this.wall, picture];
    await this.rebuildWall();
    this.events.onWallChange(this.wall);
    void this.refreshEasel();
    return picture.id;
  }

  /** 벽에 건 그림의 액자를 바꾼다. 자리는 그대로 둔다. */
  async setWallPictureFrame(id: string, frame: FrameKind): Promise<void> {
    const current = this.wall.find((p) => p.id === id);
    if (!current || current.frame === frame) return;
    // 끌어서 옮긴 직후라면 방에 있는 자리가 가장 새 자리다
    const rect = this.room.wallPictureRect(id);
    this.wall = this.wall.map((p) => (p.id === id ? { ...p, frame, ...(rect ? { z: rect.z, y: rect.y } : {}) } : p));
    this.events.onWallChange(this.wall);
    await this.rebuildWall();
    if (this.wallSelection === id) this.room.highlightWallPicture(id);
  }

  removeWallPicture(id: string): void {
    this.wall = this.wall.filter((p) => p.id !== id);
    if (this.wallSelection === id) this.selectWallPicture(null);
    void this.rebuildWall();
    this.events.onWallChange(this.wall);
    void this.refreshEasel();
  }

  /** 고른 그림을 살짝 앞으로 내밀어 보여 준다. null 이면 풀기. */
  selectWallPicture(id: string | null): void {
    this.wallSelection = id;
    this.room.highlightWallPicture(id);
  }

  /** 화면 위의 점(-1~1 정규 좌표)이 가리키는 그림 벽 위의 자리. 벽 쪽을 보고 있지 않으면 null. */
  private wallPointAt(ndcX: number, ndcY: number): { z: number; y: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (direction.x > -1e-4) return null;
    const t = (this.room.galleryWallX + 0.03 - origin.x) / direction.x;
    if (t <= 0) return null;
    return { z: origin.z + direction.z * t, y: origin.y + direction.y * t };
  }

  private toNdc(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 };
  }

  /** 화면의 한 점 아래에 있는 벽 그림 */
  private wallPictureUnder(clientX: number, clientY: number): string | null {
    const ndc = this.toNdc(clientX, clientY);
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    return this.room.wallPictureAt(this.raycaster);
  }

  destroy(): void {
    this.destroyed = true;
    this.wallImages.dispose();
    this.easelTexture?.dispose();
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.room.dispose();
    this.character.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.spotLayer.remove();
  }

  // ── 행동 ───────────────────────────────────────

  private walkTo(target: Ground, onArrive: (() => void) | null = null): void {
    this.wallFocusZ = null;
    if (this.activity) this.standUp();
    this.wait = null;
    this.target = target;
    this.onArrive = onArrive;
    this.stuckTime = 0;
    this.character.setPose('walk');
  }

  private sitDown(activity: Activity): void {
    this.target = null;
    this.activity = activity;
    this.heading = this.room.seats[activity].heading;
    this.character.setPose(ACTIVITY_POSE[activity]);
    const view = ACTIVITY_CAMERA[activity];
    if (view) {
      // 돌아오는 중이었다면 그 목표가 "활동 전의 시점"이다.
      this.cameraBefore = this.cameraGoal ?? { azimuth: this.azimuth, polar: this.polar, distance: this.distance };
      this.cameraGoal = view;
    }
    this.events.onActivityChange(activity);
  }

  private standUp(): void {
    if (!this.activity) return;
    this.position = { ...this.room.seats[this.activity].approach };
    this.activity = null;
    if (this.cameraBefore) {
      this.cameraGoal = this.cameraBefore;
      this.cameraBefore = null;
    }
    this.character.setPose('idle');
    this.events.onActivityChange(null);
  }

  /** 활동 자리로 걸어가서 앉는다. then 은 앉은 뒤에 이어서 할 일 */
  private goSit(activity: Activity, then?: () => void): void {
    if (this.activity === activity) return;
    this.walkTo(this.room.seats[activity].approach, () => {
      this.sitDown(activity);
      then?.();
    });
  }

  private onHotspot(hotspot: Hotspot3D): void {
    if (!hotspot.available) {
      this.events.onUnavailable(hotspot);
      return;
    }
    switch (hotspot.id) {
      case 'easel':
        // 의자에 앉아 있으면 바로, 아니면 의자로 가서 앉은 뒤 색칠을 시작한다.
        if (this.activity === 'paint') this.events.onEasel();
        else this.goSit('paint', () => this.events.onEasel());
        break;
      case 'stool':
        this.goSit('paint');
        break;
      case 'window':
        this.goSit('tea');
        break;
      case 'plant':
        this.events.onPlantSpot('window-stand');
        break;
      case 'camera':
        this.events.onCamera();
        break;
      case 'gallery-wall':
        this.focusGalleryWall();
        this.events.onGalleryWall();
        break;
      case 'bookshelf':
        if (this.activity === 'read') break;
        // 책장 앞에서 책을 고른 뒤 방석으로 가서 읽는다.
        this.walkTo(this.room.bookshelfFront, () => {
          this.heading = Math.PI / 2; // 책장(+x 쪽)을 바라본다
          this.wait = { left: BROWSE_TIME, then: () => this.goSit('read') };
        });
        break;
    }
  }

  /** 점프한다. 앉아 있거나 책을 고르는 중이거나 이미 떠 있으면 뛰지 않는다. */
  private tryJump(): void {
    if (this.activity || this.wait || this.jump.height > 0) return;
    this.jump = { height: 0, velocity: JUMP_SPEED };
  }

  /** 화면의 한 점이 캐릭터 위인가. */
  private isCharacterAt(clientX: number, clientY: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const base = this.character.group.position;
    const toScreen = (height: number) => {
      const p = new THREE.Vector3(base.x, base.y + height, base.z).project(this.camera);
      return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height, behind: p.z > 1 };
    };
    const feet = toScreen(0.1);
    const head = toScreen(1.15);
    if (feet.behind || head.behind) return false;
    // 몸의 반지름(약 0.3m)이 화면에서 차지하는 픽셀 수
    const distance = this.camera.position.distanceTo(base);
    const pixelsPerMeter = rect.height / 2 / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.max(0.1, distance));
    return isOnCharacter({ x: clientX - rect.left, y: clientY - rect.top }, feet, head, 0.3 * pixelsPerMeter);
  }

  /** 화면의 한 점 아래에 있는 바닥 위치. 바닥을 가리키지 않으면 null. */
  private groundAt(clientX: number, clientY: number): Ground | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      0.5,
    ).unproject(this.camera);
    const origin = this.camera.position;
    const dir = ndc.sub(origin);
    if (dir.y >= -1e-6) return null;
    const t = -origin.y / dir.y;
    return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
  }

  // ── 입력 ───────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    if (this.drag || this.pictureDrag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // 벽 그림을 누르면 둘러보기 대신 그림을 끈다
    const picture = this.wallPictureUnder(e.clientX, e.clientY);
    const rect = picture ? this.room.wallPictureRect(picture) : null;
    const point = rect ? this.wallPointAt(this.toNdc(e.clientX, e.clientY).x, this.toNdc(e.clientX, e.clientY).y) : null;
    if (picture && rect && point) {
      this.pictureDrag = { pointer: e.pointerId, id: picture, x: e.clientX, y: e.clientY, moved: false, offset: { z: point.z - rect.z, y: point.y - rect.y } };
      try {
        this.renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // 캡처가 안 되는 포인터여도 계속한다.
      }
      return;
    }
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // 캡처가 안 되는 포인터여도 계속한다.
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pictureDrag;
    if (p && e.pointerId === p.pointer) {
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      if (!p.moved) {
        p.moved = true;
        this.selectWallPicture(p.id);
        this.events.onWallPictureSelect(p.id);
      }
      const ndc = this.toNdc(e.clientX, e.clientY);
      const point = this.wallPointAt(ndc.x, ndc.y);
      if (point) this.room.moveWallPicture(p.id, point.z - p.offset.z, point.y - p.offset.y);
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    this.cameraGoal = null;
    // 좌우로는 제한 없이 한 바퀴 돌 수 있다.
    this.azimuth -= dx * 0.00294;
    this.polar = Math.min(CAMERA.maxPolar, Math.max(CAMERA.minPolar, this.polar - dy * 0.00245));
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pictureDrag;
    if (p && e.pointerId === p.pointer) {
      this.pictureDrag = null;
      if (p.moved) {
        const rect = this.room.wallPictureRect(p.id);
        if (rect) {
          this.wall = this.wall.map((w) => (w.id === p.id ? { ...w, z: rect.z, y: rect.y } : w));
          this.events.onWallChange(this.wall);
        }
      } else {
        this.selectWallPicture(p.id);
        this.events.onWallPictureSelect(p.id);
      }
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.moved) return;
    // 캐릭터를 누르면 점프한다 (키보드가 없는 터치 기기에서 뛰는 방법).
    if (this.isCharacterAt(e.clientX, e.clientY)) {
      this.tryJump();
      return;
    }
    const ground = this.groundAt(e.clientX, e.clientY);
    if (ground) this.walkTo(clampDestination(ground, this.room));
  };

  private onPointerCancel = (): void => {
    this.drag = null;
    if (this.pictureDrag?.moved) {
      // 끌던 그림은 마지막 자리에 둔다
      const id = this.pictureDrag.id;
      const rect = this.room.wallPictureRect(id);
      if (rect) {
        this.wall = this.wall.map((w) => (w.id === id ? { ...w, z: rect.z, y: rect.y } : w));
        this.events.onWallChange(this.wall);
      }
    }
    this.pictureDrag = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.cameraGoal = null;
    this.distance = Math.min(CAMERA.maxDistance, Math.max(CAMERA.minDistance, this.distance * Math.exp(e.deltaY * 0.001)));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      // 스페이스: 점프. 앉아 있거나 책을 고르는 중이거나 이미 떠 있으면 뛰지 않는다.
      e.preventDefault();
      if (!e.repeat) this.tryJump();
      return;
    }
    this.keys.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  /** 누르고 있는 이동 키의 방향 (카메라 기준). 없으면 null. */
  private keyDirection(): Ground | null {
    const has = (...names: string[]) => names.some((n) => this.keys.has(n));
    const forward = (has('w', 'arrowup', 'ㅈ') ? 1 : 0) - (has('s', 'arrowdown', 'ㄴ') ? 1 : 0);
    const right = (has('d', 'arrowright', 'ㅇ') ? 1 : 0) - (has('a', 'arrowleft', 'ㅁ') ? 1 : 0);
    if (!forward && !right) return null;
    // 카메라는 캐릭터의 (sin az, cos az) 쪽에 있으므로 앞은 그 반대 방향이다.
    const sin = Math.sin(this.azimuth);
    const cos = Math.cos(this.azimuth);
    const x = -sin * forward + cos * right;
    const z = -cos * forward - sin * right;
    const len = Math.hypot(x, z);
    return { x: x / len, z: z / len };
  }

  // ── 매 프레임 ──────────────────────────────────

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(blend: number): void {
    const seat = this.activity ? this.room.seats[this.activity].seat : null;
    const feetY = seat ? seat.y : 0;
    const focusX = seat ? seat.x : this.position.x;
    const focusZ = seat ? seat.z : this.position.z;
    this.lookAt.lerp(new THREE.Vector3(focusX, feetY + 0.9, focusZ), blend);
    // 카메라는 항상 방 안에 둔다: 벽이나 천장에 닿으면 그만큼 캐릭터 쪽으로 당긴다.
    const box = this.room.cameraBox;
    this.lookAt.x = Math.min(box.maxX, Math.max(box.minX, this.lookAt.x));
    this.lookAt.z = Math.min(box.maxZ, Math.max(box.minZ, this.lookAt.z));
    const sinPolar = Math.sin(this.polar);
    const direction = {
      x: sinPolar * Math.sin(this.azimuth),
      y: Math.cos(this.polar),
      z: sinPolar * Math.cos(this.azimuth),
    };
    const distance = distanceInsideBox(this.lookAt, direction, box, this.distance);
    this.camera.position.set(
      this.lookAt.x + direction.x * distance,
      this.lookAt.y + direction.y * distance,
      this.lookAt.z + direction.z * distance,
    );
    this.camera.lookAt(this.lookAt);
  }

  private onFrame = (now: number): void => {
    this.frame = requestAnimationFrame(this.onFrame);
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.time += dt;

    const keyDir = this.keyDirection();
    if (keyDir) {
      // 키보드로 걷는 동안에는 눌러서 정한 목적지를 잊는다.
      if (this.activity) this.standUp();
      this.target = null;
      this.onArrive = null;
      this.wait = null;
      this.wallFocusZ = null;
      const step = WALK_SPEED * dt;
      const wanted = { x: this.position.x + keyDir.x * step, z: this.position.z + keyDir.z * step };
      this.position = clampDestination(wanted, this.room);
      this.heading = Math.atan2(keyDir.x, keyDir.z);
      this.character.setPoseIfChanged('walk');
    } else if (this.target) {
      const before = this.position;
      const { position, arrived } = stepToward(before, this.target, WALK_SPEED * dt, this.room);
      const progress = Math.hypot(position.x - before.x, position.z - before.z);
      if (progress > 1e-4) this.heading = Math.atan2(position.x - before.x, position.z - before.z);
      // 가구에 막혀 거의 나아가지 못하면 그만 걷는다.
      this.stuckTime = progress < WALK_SPEED * dt * 0.2 ? this.stuckTime + dt : 0;
      this.position = position;
      if (arrived || this.stuckTime > 0.6) {
        this.target = null;
        this.character.setPose('idle');
        const done = arrived ? this.onArrive : null;
        this.onArrive = null;
        done?.();
      }
    } else if (this.wait) {
      this.wait.left -= dt;
      if (this.wait.left <= 0) {
        const { then } = this.wait;
        this.wait = null;
        then();
      }
    } else if (!this.activity) {
      this.character.setPoseIfChanged('idle');
    }

    if (this.jump.velocity !== 0 || this.jump.height > 0) this.jump = stepJump(this.jump, dt);
    if (this.activity) this.jump = { height: 0, velocity: 0 };
    this.character.update(dt, this.jump.height > 0);
    this.room.update(dt);
    const g = this.character.group;
    if (this.activity) {
      const seat = this.room.seats[this.activity].seat;
      g.position.set(seat.x, seat.y - Character3D.hipHeight, seat.z);
    } else {
      g.position.set(this.position.x, this.jump.height, this.position.z);
    }
    // 가까운 쪽으로 부드럽게 돌아선다.
    const turn = Math.atan2(Math.sin(this.heading - g.rotation.y), Math.cos(this.heading - g.rotation.y));
    g.rotation.y += turn * Math.min(1, dt * 12);

    if (this.cameraGoal) {
      const { pose, arrived } = approachCamera(
        { azimuth: this.azimuth, polar: this.polar, distance: this.distance },
        this.cameraGoal,
        1 - Math.exp(-dt * CAMERA.glideSpeed),
      );
      this.azimuth = pose.azimuth;
      this.polar = pose.polar;
      this.distance = pose.distance;
      if (arrived) this.cameraGoal = null;
    }
    this.placeCamera(Math.min(1, dt * 6));
    this.outline.render(this.scene, this.camera);
    this.placeSpots();
  };

  /** 활동 표시 버튼을 3D 위치에 맞춰 화면에 놓는다. */
  private placeSpots(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const pulse = 1 + 0.1 * Math.sin(this.time * 4);
    for (const { hotspot, el } of this.spots) {
      const p = hotspot.position.clone().project(this.camera);
      // 지금 앉아 있는 자리의 표시는 숨긴다.
      const hidden =
        p.z > 1 ||
        (this.activity !== null && hotspot.id === ACTIVITY_SPOT[this.activity]) ||
        (hotspot.id === 'gallery-wall' && this.wallSelection !== null);
      el.style.display = hidden ? 'none' : '';
      if (hidden) continue;
      // 앉아 있으면 이젤이, 서 있으면 의자가 눈에 띄게 움직인다.
      const emphasized = this.activity === 'paint' ? hotspot.id === 'easel' : this.activity === null && hotspot.id === 'stool';
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-p.y * 0.5 + 0.5) * height;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${emphasized ? pulse : 1})`;
    }
  }
}
