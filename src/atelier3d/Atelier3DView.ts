import * as THREE from 'three';
import { Character3D } from './Character3D';
import { clampDestination, distanceInsideBox, stepToward, type Ground } from './movement';
import { buildAtelierRoom, type AtelierRoom, type Hotspot3D } from './room';

/** 걷는 속도 (미터 / 초) */
const WALK_SPEED = 2.6;
/** 이만큼(픽셀) 넘게 끌면 누르기가 아니라 둘러보기로 본다. */
const DRAG_THRESHOLD = 6;
const CAMERA = {
  minPolar: 0.95,
  maxPolar: 1.42,
  minDistance: 2.4,
  /** 가장 멀리서 본 거리. 이보다 멀어지지 않고, 벽이나 천장에 닿으면 더 가까워진다. */
  maxDistance: 5.3,
};

export interface Atelier3DEvents {
  onSeatedChange(seated: boolean): void;
  /** 의자에 앉은 채로 이젤을 눌렀을 때 */
  onEasel(): void;
  /** 아직 준비 중인 활동을 눌렀을 때 */
  onUnavailable(hotspot: Hotspot3D): void;
}

/**
 * 3D 화실 화면: 캐릭터를 뒤에서 따라가는 3인칭 시점.
 * - 바닥을 누르거나 WASD/방향키로 걷는다.
 * - 화면을 끌면 360도로 둘러보고, 휠로 가까이/멀리 본다. 카메라는 방 밖으로 나가지 않는다.
 * - 의자를 누르면 앉고, 앉아서 이젤을 누르면 색칠을 시작한다.
 */
export class Atelier3DView {
  private readonly renderer: THREE.WebGLRenderer;
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
  private seated = false;
  private heading = Math.PI;
  private stuckTime = 0;
  private azimuth = 0.22;
  private polar = 1.2;
  private distance = CAMERA.maxDistance;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private frame = 0;
  private lastTime = performance.now();
  private time = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: Atelier3DEvents,
    options: { startSeated: boolean },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0xf6e7d4);

    this.room = buildAtelierRoom();
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
      this.position = { ...this.room.stool.approach };
      this.sitDown();
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

  destroy(): void {
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
    if (this.seated) this.standUp();
    this.target = target;
    this.onArrive = onArrive;
    this.stuckTime = 0;
    this.character.setPose('walk');
  }

  private sitDown(): void {
    this.target = null;
    this.seated = true;
    this.heading = this.room.stool.heading; // 이젤을 바라본다
    this.character.setPose('sit');
    this.events.onSeatedChange(true);
  }

  private standUp(): void {
    this.seated = false;
    this.position = { ...this.room.stool.approach };
    this.character.setPose('idle');
    this.events.onSeatedChange(false);
  }

  private onHotspot(hotspot: Hotspot3D): void {
    if (!hotspot.available) {
      this.events.onUnavailable(hotspot);
      return;
    }
    if (hotspot.id === 'easel' && this.seated) {
      this.events.onEasel();
      return;
    }
    // 의자를 누르거나, 앉지 않은 채 이젤을 누르면 먼저 의자로 가서 앉는다.
    if (!this.seated) this.walkTo(this.room.stool.approach, () => this.sitDown());
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
    if (this.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // 캡처가 안 되는 포인터여도 계속한다.
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    // 좌우로는 제한 없이 한 바퀴 돌 수 있다.
    this.azimuth -= dx * 0.006;
    this.polar = Math.min(CAMERA.maxPolar, Math.max(CAMERA.minPolar, this.polar - dy * 0.005));
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.moved) return;
    const ground = this.groundAt(e.clientX, e.clientY);
    if (ground) this.walkTo(clampDestination(ground, this.room));
  };

  private onPointerCancel = (): void => {
    this.drag = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.distance = Math.min(CAMERA.maxDistance, Math.max(CAMERA.minDistance, this.distance * Math.exp(e.deltaY * 0.001)));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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
    const feetY = this.seated ? this.room.stool.seat.y : 0;
    const focusX = this.seated ? this.room.stool.seat.x : this.position.x;
    const focusZ = this.seated ? this.room.stool.seat.z : this.position.z;
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
      if (this.seated) this.standUp();
      this.target = null;
      this.onArrive = null;
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
    } else if (!this.seated) {
      this.character.setPoseIfChanged('idle');
    }

    this.character.update(dt);
    const g = this.character.group;
    if (this.seated) {
      const seat = this.room.stool.seat;
      g.position.set(seat.x, seat.y - Character3D.hipHeight, seat.z);
    } else {
      g.position.set(this.position.x, 0, this.position.z);
    }
    // 가까운 쪽으로 부드럽게 돌아선다.
    const turn = Math.atan2(Math.sin(this.heading - g.rotation.y), Math.cos(this.heading - g.rotation.y));
    g.rotation.y += turn * Math.min(1, dt * 12);

    this.placeCamera(Math.min(1, dt * 6));
    this.renderer.render(this.scene, this.camera);
    this.placeSpots();
  };

  /** 활동 표시 버튼을 3D 위치에 맞춰 화면에 놓는다. */
  private placeSpots(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const pulse = 1 + 0.1 * Math.sin(this.time * 4);
    for (const { hotspot, el } of this.spots) {
      const p = hotspot.position.clone().project(this.camera);
      const hidden = p.z > 1 || (hotspot.id === 'stool' && this.seated);
      el.style.display = hidden ? 'none' : '';
      if (hidden) continue;
      // 앉아 있으면 이젤이, 서 있으면 의자가 눈에 띄게 움직인다.
      const emphasized = hotspot.id === (this.seated ? 'easel' : 'stool');
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-p.y * 0.5 + 0.5) * height;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${emphasized ? pulse : 1})`;
    }
  }
}
