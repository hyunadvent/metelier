import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import {
  clampOnWall,
  DEFAULT_DECOR,
  FRAME_BORDER,
  wallPictureSize,
  type AtelierDecor,
  type FrameKind,
  type PictureRef,
  type PictureSlot,
  type PlantKind,
  type PlantSlot,
  type WallPicture,
} from './decor';
import type { WallImage } from './wallImages';
import type { Box3D, Ground, WalkArea } from './movement';
import { curtainGeometry, lathe, roundedBox, smoothProfile } from './shapes';
import {
  bookSpineTexture,
  edgeShadeTexture,
  flowerPainting,
  landscapePainting,
  linenTexture,
  petalTexture,
  plasterTexture,
  radialTexture,
  rugTexture,
  seededRandom,
  skyTexture,
  woodFloorTexture,
} from './textures';

export type Hotspot3DId = 'easel' | 'stool' | 'window' | 'bookshelf' | 'plant' | 'camera' | 'gallery-wall';

/** 그림 벽에 걸 그림 한 점: 자리와 액자, 그리고 불러온 그림 */
export interface WallPictureView {
  picture: WallPicture;
  image: WallImage;
}

/** 캐릭터가 자리를 잡고 하는 활동: 그림 그리기, 차 마시기, 책 읽기 */
export type Activity = 'paint' | 'tea' | 'read';

/** 활동을 하는 자리 */
export interface Seat {
  /** 앉기 전에 걸어가서 서는 자리 */
  approach: Ground;
  /** 앉았을 때 엉덩이가 놓이는 자리 */
  seat: THREE.Vector3;
  /** 앉았을 때 바라보는 방향 (y 축 회전) */
  heading: number;
}

export interface Hotspot3D {
  id: Hotspot3DId;
  label: string;
  icon: string;
  /** 표시를 띄울 자리 */
  position: THREE.Vector3;
  /** false 면 아직 준비 중인 활동 */
  available: boolean;
}

/**
 * 3D 화실. 화실 화면(3인칭 시점)과 색칠 화면 배경(이젤 앞 시점)이 같은 함수로 방을 만든다 (R9).
 * 단위는 미터, 바닥은 y = 0, 창문이 있는 벽은 -z 쪽이다.
 * 방은 사방과 천장이 막혀 있어, 방 밖은 창문으로만 보인다. 캐릭터는 방 끝에서 끝까지 걸을 수 있다.
 */
export interface AtelierRoom extends WalkArea {
  group: THREE.Group;
  /** 카메라가 머물 수 있는 범위 (방 안쪽). 이 밖으로 나가면 벽 너머가 보인다. */
  cameraBox: Box3D;
  /** 입장할 때 걸어 들어오는 출발점과 도착점 */
  entry: Ground;
  spawn: Ground;
  /** 활동별 자리: 이젤 앞 의자, 창가 방석, 책장 옆 방석 */
  seats: Record<Activity, Seat>;
  /** 책을 고르러 가서 서는 책장 앞 */
  bookshelfFront: Ground;
  /** 이젤 위의 캔버스 판. 색칠 화면에서는 이 판 자리에 종이가 겹쳐진다. */
  board: THREE.Mesh;
  /** 캔버스 판의 가로세로 비율을 그림에 맞춘다. */
  setBoardAspect(aspect: number): void;
  /** 이젤의 캔버스에 그림을 올린다 (칠하던 그림). null 이면 빈 캔버스. 텍스처는 부르는 쪽이 정리한다. */
  setBoardPicture(texture: THREE.Texture | null, aspect?: number): void;
  hotspots: Hotspot3D[];
  /** 그 자리의 화분을 다른 화분으로 바꾼다 (꾸미기). */
  setPlant(slot: PlantSlot, kind: PlantKind): void;
  /** 그림 벽(이젤 왼쪽 벽)의 안쪽 면의 x */
  galleryWallX: number;
  /** 그림 벽에 건 그림들을 새로 건다. 그림의 텍스처는 부르는 쪽이 갖고 있다가 정리한다. */
  setWallPictures(items: WallPictureView[]): void;
  /** 벽에 건 그림을 옮긴다. 벽 밖으로 나가지 않게 고친 자리를 돌려준다. */
  moveWallPicture(id: string, z: number, y: number): { z: number; y: number } | null;
  /** 벽에 건 그림의 크기 (액자 테두리 빼고) */
  wallPictureRect(id: string): { z: number; y: number; w: number; h: number } | null;
  /** 광선이 맞히는 벽 그림. 없으면 null. */
  wallPictureAt(raycaster: THREE.Raycaster): string | null;
  /** 고른 그림을 살짝 앞으로 내밀어 표시한다. */
  highlightWallPicture(id: string | null): void;
  /** 움직이는 것(창밖 꽃잎, 등불의 흔들림)을 한 프레임만큼 진행한다. */
  update(dt: number): void;
  dispose(): void;
}

/** 외곽선을 그리지 않을 재질로 표시한다 (투명한 것, 빛 번짐, 그림자 얼룩처럼 형태가 없는 것). */
function noOutline<T extends THREE.Material>(material: T): T {
  material.userData.outlineParameters = { visible: false };
  return material;
}

/** 화실을 그리는 렌더러의 공통 설정: 부드러운 그림자와, 밝은 곳이 하얗게 날아가지 않는 색 처리 */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.08;
}

/**
 * 물체 둘레에 가는 갈색 선을 두르는 효과. 색칠 그림의 선화와 어울리는 일러스트 느낌을 낸다.
 * renderer.render 대신 이 효과의 render 로 그린다.
 */
export function createOutline(renderer: THREE.WebGLRenderer): OutlineEffect {
  return new OutlineEffect(renderer, { defaultThickness: 0.0022, defaultColor: [0.42, 0.3, 0.22], defaultAlpha: 0.85 });
}

// 방 크기. 뒤쪽(-z)에 창문 벽이, 앞쪽(+z)에 문이 있는 벽이 있다.
const ROOM = { halfW: 4, back: -3, front: 7.5, height: 3.3 };
const WINDOW = { x0: 0.25, x1: 3.6, y0: 0.72, y1: 2.98 };
const EASEL = { x: -0.35, z: -1.55, turn: 0.24 };
const BOARD_HEIGHT = 0.78;
/** 앞벽에 있는 문의 가운데 x */
const DOOR_X = 1.4;

const WOOD = 0xd9a56c;
const WOOD_DARK = 0xb9793f;
const WOOD_LIGHT = 0xe9bf8c;
const CREAM = 0xfff6ea;
const LEAF = [0x7cb86a, 0x8fc97c, 0x6aa85a, 0x9bd08a];
const BLOSSOM = [0xf9c5d8, 0xfbd3e1, 0xf7b3cc, 0xfde0ea];
const PASTELS = [0x6fb7e9, 0xf48fb1, 0xf9d65c, 0x7cb86a, 0xb388eb, 0xf4a24c, 0x5cc8b8, 0xfff8e7, 0xf9c5d8, 0x9fc5e8];

/**
 * 기획 참고 이미지(docs/reference/atelier-room.webp)의 화실을 코드로 만든 3D 방.
 * 모양은 도형과 곡면을 조합하고, 텍스처는 캔버스에 그려서 만든다.
 * 실제 3D 모델(GLB)이 준비되면 소품별로 모델을 불러오도록 바꾸면 된다.
 * @param decor 꾸민 상태. 같은 값을 주면 화실 화면과 색칠 화면 배경이 똑같이 그려진다.
 */
export function buildAtelierRoom(decor: AtelierDecor = DEFAULT_DECOR): AtelierRoom {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const materials = new Map<string, THREE.Material>();
  const random = seededRandom(11);

  const keep = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  /** 같은 색과 설정의 재질은 하나를 함께 쓴다. */
  const mat = (color: number, options: THREE.MeshStandardMaterialParameters = {}): THREE.Material => {
    const { map, ...rest } = options;
    const key = `${color}:${map?.uuid ?? ''}:${JSON.stringify(rest)}`;
    let m = materials.get(key);
    if (!m) {
      m = keep(new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...options }));
      materials.set(key, m);
    }
    return m;
  };
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = group): THREE.Mesh => {
    keep(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const at = <T extends THREE.Object3D>(object: T, x: number, y: number, z: number): T => {
    object.position.set(x, y, z);
    return object;
  };
  /** 모서리가 둥근 상자 */
  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent?: THREE.Object3D, radius = 0.015) =>
    at(add(roundedBox(w, h, d, radius), mat(color), parent), x, y, z);
  const cylinder = (rTop: number, rBottom: number, h: number, color: number, x: number, y: number, z: number, parent?: THREE.Object3D) =>
    at(add(new THREE.CylinderGeometry(rTop, rBottom, h, 24), mat(color), parent), x, y, z);
  const ball = (r: number, color: number, x: number, y: number, z: number, parent?: THREE.Object3D) =>
    at(add(new THREE.SphereGeometry(r, 18, 12), mat(color), parent), x, y, z);
  /** 단면을 돌려 만든 둥근 물건 */
  const turned = (profile: [number, number][], material: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D) =>
    at(add(lathe(profile), material, parent), x, y, z);
  function addGroup(x: number, y: number, z: number, parent: THREE.Object3D): THREE.Group {
    const g = at(new THREE.Group(), x, y, z);
    parent.add(g);
    return g;
  }

  // ── 텍스처 ─────────────────────────────────────
  const { halfW, back, front, height } = ROOM;
  const depth = front - back;
  const midZ = (front + back) / 2;
  const floorTex = keep(woodFloorTexture(halfW, depth / 4.5));
  const wallTex = keep(plasterTexture(3, 1.2));
  const sideWallTex = keep(plasterTexture(3.4, 1.2));
  const linen = keep(linenTexture(6));
  const spine = keep(bookSpineTexture());
  const shade = keep(edgeShadeTexture());
  const blob = keep(radialTexture('rgba(90, 55, 25, 0.42)', 'rgba(90, 55, 25, 0)'));
  const wallMat = mat(0xffffff, { map: wallTex, roughness: 0.95 });
  const sideWallMat = mat(0xffffff, { map: sideWallTex, roughness: 0.95 });
  const fabric = (color: number) => mat(color, { map: linen, roughness: 1 });

  /** 바닥에 깔리는 부드러운 그림자: 가구가 바닥에 붙어 보이게 한다. */
  const shadeMat = noOutline(keep(new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false })));
  const contact = (x: number, z: number, w: number, d: number, y = 0.021) => {
    const plane = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, d)), shadeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, y, z);
    plane.renderOrder = 1;
    group.add(plane);
  };
  /** 벽과 바닥, 벽과 벽이 만나는 구석의 음영 */
  const edgeMat = noOutline(keep(new THREE.MeshBasicMaterial({ map: shade, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  const edge = (w: number, h: number, x: number, y: number, z: number, rx: number, ry: number, rz = 0) => {
    const plane = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), edgeMat);
    plane.position.set(x, y, z);
    plane.rotation.set(rx, ry, rz, 'YXZ');
    plane.renderOrder = 1;
    group.add(plane);
  };

  /** 잎이 달린 화분. 납작한 잎 여러 장을 방사형으로 꽂는다. */
  const plant = (x: number, y: number, z: number, s: number, parent?: THREE.Object3D, leaves = 16) => {
    const g = addGroup(x, y, z, parent ?? group);
    turned(
      [[0, 0], [0.17 * s, 0], [0.2 * s, 0.03 * s], [0.25 * s, 0.34 * s], [0.27 * s, 0.38 * s], [0.24 * s, 0.4 * s], [0.22 * s, 0.3 * s], [0, 0.3 * s]],
      mat(0xf7f3ec, { roughness: 0.6 }),
      0, 0, 0, g,
    );
    // 흙: 화분 안쪽 바닥보다 위에 떠 있어 겹치지 않는다
    cylinder(0.21 * s, 0.21 * s, 0.02 * s, 0x7a5a3f, 0, 0.35 * s, 0, g).castShadow = false;
    for (let k = 0; k < leaves; k++) {
      const ring = k / leaves;
      const a = k * 2.4;
      const lean = 0.25 + ring * 1.05;
      const len = (0.34 + random() * 0.2) * s;
      const leaf = add(new THREE.SphereGeometry(1, 10, 8), mat(LEAF[k % LEAF.length]), g);
      leaf.scale.set(len * 0.42, len, len * 0.1);
      // 잎의 뿌리 쪽이 화분 가운데에 오도록 기울여 놓는다
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.38 * s, 0);
      pivot.rotation.set(0, a, 0);
      const arm = new THREE.Group();
      arm.rotation.x = lean;
      leaf.position.y = len * 0.95;
      g.add(pivot);
      pivot.add(arm);
      arm.add(leaf);
    }
    return g;
  };
  /** 아래로 늘어지는 덩굴 */
  const vine = (x: number, y: number, z: number, length: number, parent?: THREE.Object3D) => {
    const sway = random() * 6;
    for (let k = 0; k * 0.075 < length; k++) {
      const leaf = ball(0.05 - k * 0.0012, LEAF[k % LEAF.length], x + Math.sin(k * 1.3 + sway) * 0.04, y - k * 0.075, z + Math.cos(k * 1.7 + sway) * 0.025, parent);
      leaf.scale.set(1, 0.7, 0.45);
      leaf.rotation.z = Math.sin(k * 2.1) * 0.8;
      leaf.castShadow = false;
    }
  };
  /** 벽에 건 액자. normal 은 그림이 바라보는 방향 (+1: 방 앞쪽, -1: 방 뒤쪽) */
  const frame = (x: number, y: number, z: number, w: number, h: number, picture: THREE.Texture, normal: 1 | -1 = 1) => {
    keep(picture);
    box(w + 0.13, h + 0.13, 0.06, WOOD, x, y, z + normal * 0.03, undefined, 0.02);
    box(w + 0.04, h + 0.04, 0.062, 0xfffaf2, x, y, z + normal * 0.032, undefined, 0.004);
    const canvas = add(new THREE.PlaneGeometry(w, h), mat(0xffffff, { map: picture, roughness: 1 }));
    canvas.castShadow = false;
    canvas.position.set(x, y, z + normal * 0.065);
    if (normal < 0) canvas.rotation.y = Math.PI;
  };

  // ── 바닥, 벽, 천장 ─────────────────────────────
  const floor = add(new THREE.BoxGeometry(halfW * 2, 0.2, depth), mat(0xffffff, { map: floorTex, roughness: 0.7 }));
  floor.position.set(0, -0.1, midZ);
  floor.castShadow = false;
  at(add(new THREE.BoxGeometry(halfW * 2 + 0.4, 0.2, depth + 0.4), mat(CREAM)), 0, height + 0.1, midZ);
  // 창문이 있는 뒷벽: 창 둘레를 네 조각으로 막는다
  const winW = WINDOW.x1 - WINDOW.x0;
  const winH = WINDOW.y1 - WINDOW.y0;
  const winX = (WINDOW.x0 + WINDOW.x1) / 2;
  const winY = (WINDOW.y0 + WINDOW.y1) / 2;
  const wall = (w: number, h: number, d: number, x: number, y: number, z: number, material = wallMat) =>
    at(add(new THREE.BoxGeometry(w, h, d), material), x, y, z);
  wall(WINDOW.x0 + halfW, height, 0.2, (-halfW + WINDOW.x0) / 2, height / 2, back - 0.1);
  wall(halfW - WINDOW.x1, height, 0.2, (halfW + WINDOW.x1) / 2, height / 2, back - 0.1);
  wall(winW, WINDOW.y0, 0.2, winX, WINDOW.y0 / 2, back - 0.1);
  wall(winW, height - WINDOW.y1, 0.2, winX, (height + WINDOW.y1) / 2, back - 0.1);
  wall(0.2, height, depth + 0.4, -halfW - 0.1, height / 2, midZ, sideWallMat);
  wall(0.2, height, depth + 0.4, halfW + 0.1, height / 2, midZ, sideWallMat);
  wall(halfW * 2, height, 0.2, 0, height / 2, front + 0.1);
  // 걸레받이
  box(WINDOW.x0 + halfW, 0.13, 0.04, WOOD_LIGHT, (-halfW + WINDOW.x0) / 2, 0.065, back + 0.02);
  box(halfW - WINDOW.x1, 0.13, 0.04, WOOD_LIGHT, (halfW + WINDOW.x1) / 2, 0.065, back + 0.02);
  box(0.04, 0.13, depth, WOOD_LIGHT, -halfW + 0.02, 0.065, midZ);
  box(0.04, 0.13, depth, WOOD_LIGHT, halfW - 0.02, 0.065, midZ);
  box(halfW * 2, 0.13, 0.04, WOOD_LIGHT, 0, 0.065, front - 0.02);
  // 구석의 음영: 바닥 가장자리와 벽 위쪽(천장 밑)
  const band = 0.6;
  edge(halfW * 2, band, 0, 0.02, back + band / 2, -Math.PI / 2, 0);
  edge(halfW * 2, band, 0, 0.02, front - band / 2, -Math.PI / 2, Math.PI);
  edge(depth, band, -halfW + band / 2, 0.02, midZ, -Math.PI / 2, Math.PI / 2);
  edge(depth, band, halfW - band / 2, 0.02, midZ, -Math.PI / 2, -Math.PI / 2);
  edge(halfW * 2, band, 0, height - band / 2, back + 0.012, 0, 0);
  edge(halfW * 2, band, 0, height - band / 2, front - 0.012, 0, Math.PI);
  edge(depth, band, -halfW + 0.012, height - band / 2, midZ, 0, Math.PI / 2);
  edge(depth, band, halfW - 0.012, height - band / 2, midZ, 0, -Math.PI / 2);

  // ── 창문, 커튼 ─────────────────────────────────
  box(winW + 0.26, 0.13, 0.26, WOOD, winX, WINDOW.y1 + 0.045, back - 0.04);
  box(winW + 0.56, 0.09, 0.46, WOOD, winX, WINDOW.y0 - 0.03, back + 0.07, undefined, 0.03);
  for (const x of [WINDOW.x0, WINDOW.x1]) box(0.13, winH, 0.14, WOOD, x, winY, back - 0.04);
  box(0.1, winH, 0.12, WOOD, winX, winY, back - 0.04);
  box(winW, 0.08, 0.1, WOOD, winX, WINDOW.y0 + winH * 0.62, back - 0.04);
  for (const x of [WINDOW.x0 + winW * 0.25, WINDOW.x0 + winW * 0.75]) box(0.045, winH, 0.07, WOOD, x, winY, back - 0.04);
  // 커튼 봉과 고리
  cylinder(0.022, 0.022, winW + 1.5, WOOD_DARK, winX, WINDOW.y1 + 0.2, back + 0.2).rotation.z = Math.PI / 2;
  for (const x of [winX - winW / 2 - 0.75, winX + winW / 2 + 0.75]) ball(0.045, WOOD_DARK, x, WINDOW.y1 + 0.2, back + 0.2);
  // 얇은 커튼: 햇빛을 막지 않도록 그림자는 드리우지 않는다
  const sheer = noOutline(
    keep(new THREE.MeshStandardMaterial({ color: 0xfffaf3, map: linen, transparent: true, opacity: 0.86, roughness: 1, side: THREE.DoubleSide })),
  );
  const curtainTop = WINDOW.y1 + 0.18;
  const leftCurtain = add(curtainGeometry(0.8, curtainTop - 0.06, { folds: 5, depth: 0.045 }), sheer);
  leftCurtain.position.set(WINDOW.x0 - 0.12, curtainTop, back + 0.2);
  leftCurtain.castShadow = false;
  const rightCurtain = add(curtainGeometry(0.85, curtainTop - 0.06, { folds: 5, depth: 0.045, tieAt: 0.5, tieWidth: 0.34, tieSide: 1 }), sheer);
  rightCurtain.position.set(WINDOW.x1 + 0.08, curtainTop, back + 0.2);
  rightCurtain.castShadow = false;
  box(0.36, 0.06, 0.12, 0xf9c5d8, WINDOW.x1 + 0.32, curtainTop * 0.5 + 0.03, back + 0.2, undefined, 0.02);

  // ── 창밖: 하늘, 언덕, 벚나무 ───────────────────
  const outside = <T extends THREE.Mesh>(m: T): T => {
    noOutline(m.material as THREE.Material);
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  };
  const sky = outside(add(new THREE.PlaneGeometry(110, 46), noOutline(keep(new THREE.MeshBasicMaterial({ map: keep(skyTexture()), toneMapped: false })))));
  sky.position.set(winX, 14, back - 26);
  outside(at(add(new THREE.BoxGeometry(110, 0.4, 30), mat(0xbfe3a8)), winX, -0.4, back - 14.5));
  outside(ball(7, 0xcdeab2, winX - 6, -4.2, back - 14));
  outside(ball(9, 0xb7dd9e, winX + 8, -5.6, back - 16));
  outside(ball(12, 0xc6e6ad, winX - 1, -9.2, back - 22));
  [
    [-1.6, -3.6, 1.0],
    [0.9, -4.8, 1.25],
    [3.2, -3.8, 0.95],
    [-4.4, -6.5, 1.2],
    [5.8, -6.2, 1.3],
  ].forEach(([tx, tz, s], t) => {
    const tree = addGroup(winX + tx, 0, back + tz, group);
    const trunk = outside(turned([[0.28 * s, 0], [0.2 * s, 0.6 * s], [0.16 * s, 1.8 * s], [0.13 * s, 2.7 * s], [0, 2.7 * s]], mat(0x9b6b4a), 0, 0, 0, tree));
    trunk.rotation.z = (t % 2 ? 1 : -1) * 0.05;
    for (const [dir, len] of [[-1, 1.3], [1, 1.2]]) {
      const branch = outside(cylinder(0.05 * s, 0.09 * s, len * s, 0x9b6b4a, dir * 0.42 * s, 2.5 * s, 0, tree));
      branch.rotation.z = -dir * 0.9;
    }
    // 큰 꽃 덩어리 위에 작은 덩어리를 얹어 뭉게뭉게 보이게 한다
    const puffs = [
      [0, 3.0, 0, 1.1],
      [-0.95, 2.6, 0.15, 0.82],
      [0.95, 2.65, -0.1, 0.88],
      [0.3, 3.75, -0.2, 0.78],
      [-0.5, 3.5, 0.25, 0.68],
      [1.45, 2.05, 0.2, 0.58],
      [-1.4, 2.0, -0.2, 0.6],
    ];
    puffs.forEach(([bx, by, bz, r], k) => {
      outside(ball(r * s, BLOSSOM[(k + t) % 3], bx * s, by * s, bz * s, tree));
      for (let j = 0; j < 5; j++) {
        const a = j * 1.26 + k;
        const rr = r * (0.34 + random() * 0.12);
        outside(ball(rr * s, BLOSSOM[(j + k) % 4], (bx + Math.cos(a) * r * 0.85) * s, (by + Math.sin(a * 1.7) * r * 0.6) * s, (bz + Math.sin(a) * r * 0.85) * s, tree));
      }
    });
  });
  // 창 바로 밖으로 뻗은 꽃가지: 햇빛 길목에 있어 방 안에 아롱진 그림자를 만든다
  const bough = addGroup(winX + 0.85, 2.95, back - 1.0, group);
  const stem = cylinder(0.035, 0.06, 2.6, 0x9b6b4a, 0, 0, 0, bough);
  stem.rotation.z = 1.25;
  for (let k = 0; k < 34; k++) {
    const along = (random() - 0.5) * 2.5;
    const puff = ball(0.1 + random() * 0.13, BLOSSOM[k % 4], along, along * 0.33 + (random() - 0.5) * 0.9, (random() - 0.5) * 0.5, bough);
    puff.receiveShadow = false;
  }
  // 구름
  [
    [-3.5, 9.5, 1.5],
    [4.5, 11.5, 1.9],
    [0.5, 13.5, 1.3],
  ].forEach(([cx, cy, s]) => {
    for (const [dx, dy, r] of [[0, 0, 1], [1, -0.1, 0.75], [-1, -0.15, 0.7], [0.45, 0.4, 0.7], [-0.5, 0.35, 0.6]]) {
      const cloud = outside(add(new THREE.SphereGeometry(r * s, 14, 10), noOutline(keep(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })))));
      cloud.position.set(winX + cx + dx * s, cy + dy * s, back - 24);
      cloud.scale.z = 0.3;
    }
  });
  // 흩날리는 꽃잎
  const PETALS = 150;
  const petalPos = new Float32Array(PETALS * 3);
  const petalSeed = new Float32Array(PETALS * 2);
  for (let k = 0; k < PETALS; k++) {
    petalPos[k * 3] = winX + (random() - 0.5) * 9;
    petalPos[k * 3 + 1] = random() * 6;
    petalPos[k * 3 + 2] = back - 0.7 - random() * 6;
    petalSeed[k * 2] = random() * Math.PI * 2;
    petalSeed[k * 2 + 1] = 0.25 + random() * 0.35;
  }
  const petalGeometry = keep(new THREE.BufferGeometry());
  petalGeometry.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  const petals = new THREE.Points(
    petalGeometry,
    noOutline(keep(new THREE.PointsMaterial({ map: keep(petalTexture()), size: 0.13, transparent: true, depthWrite: false, alphaTest: 0.05 }))),
  );
  petals.frustumCulled = false;
  group.add(petals);

  // ── 뒷벽 왼쪽: 선반, 액자 ──────────────────────
  const shelfY = 2.52;
  box(3.9, 0.06, 0.34, WOOD, -2.0, shelfY, back + 0.17, undefined, 0.02);
  for (const x of [-3.6, -2.0, -0.4]) {
    const bracket = add(new THREE.CylinderGeometry(0.22, 0.22, 0.045, 12, 1, false, 0, Math.PI / 2), mat(WOOD_DARK));
    bracket.rotation.set(Math.PI, 0, Math.PI / 2);
    bracket.position.set(x, shelfY - 0.03, back + 0.02);
  }
  // 선반 위: 책, 등불, 화분과 덩굴
  let bx = -3.85;
  [0.3, 0.26, 0.33, 0.28, 0.31, 0.25, 0.3, 0.27].forEach((h, k) => {
    const w = 0.065 + (k % 3) * 0.015;
    const book = at(add(roundedBox(w, h, 0.22, 0.008), mat(PASTELS[(k * 3 + 1) % PASTELS.length], { map: spine })), bx + w / 2, shelfY + 0.03 + h / 2, back + 0.17);
    if (k === 7) book.rotation.z = -0.22;
    bx += w + 0.008;
  });
  const lantern = addGroup(-2.55, shelfY + 0.03, back + 0.18, group);
  box(0.21, 0.03, 0.21, 0x6b5340, 0, 0.015, 0, lantern, 0.008);
  const flame = add(roundedBox(0.15, 0.24, 0.15, 0.02), mat(0xffe2a6, { emissive: 0xffc56b, emissiveIntensity: 1.6 }), lantern);
  flame.position.y = 0.15;
  flame.castShadow = false;
  for (const [lx, lz] of [[-0.085, -0.085], [0.085, -0.085], [-0.085, 0.085], [0.085, 0.085]]) box(0.02, 0.26, 0.02, 0x6b5340, lx, 0.15, lz, lantern, 0.004);
  turned([[0.13, 0], [0.13, 0.02], [0.05, 0.07], [0.03, 0.1], [0, 0.1]], mat(0x6b5340), 0, 0.28, 0, lantern);
  const ring = add(new THREE.TorusGeometry(0.03, 0.006, 6, 16), mat(0x6b5340), lantern);
  ring.position.y = 0.41;
  // 등불의 빛 번짐
  const glowSprite = new THREE.Sprite(
    keep(
      new THREE.SpriteMaterial({
        map: keep(radialTexture('rgba(255, 214, 150, 0.9)', 'rgba(255, 190, 110, 0)')),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    ),
  );
  glowSprite.scale.setScalar(1.25);
  glowSprite.position.set(-2.55, shelfY + 0.2, back + 0.22);
  group.add(glowSprite);
  const glow = new THREE.PointLight(0xffd9a0, 2.4, 3.5);
  glow.position.set(-2.55, shelfY + 0.2, back + 0.36);
  group.add(glow);
  plant(-1.95, shelfY + 0.03, back + 0.18, 0.42, undefined, 10);
  plant(-1.2, shelfY + 0.03, back + 0.18, 0.5, undefined, 10);
  plant(-0.5, shelfY + 0.03, back + 0.18, 0.36, undefined, 9);
  vine(-1.3, shelfY, back + 0.33, 0.8);
  vine(-1.08, shelfY, back + 0.33, 0.5);
  vine(-0.42, shelfY, back + 0.33, 0.62);
  vine(-3.9, shelfY + 0.2, back + 0.3, 0.95);
  // 선반 아래: 풍경화 두 점과 꽃 그림 두 점
  /** 액자에 걸 그림의 텍스처 */
  const pictureTexture = (ref: PictureRef): THREE.Texture => {
    if (ref.kind === 'painting') {
      const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}paintings/${ref.paintingId}/reference.png`);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }
    switch (ref.id) {
      case 'meadow':
        return landscapePainting(8);
      case 'hills':
        return landscapePainting(3, false);
      case 'pink-flowers':
        return flowerPainting('#f9c5d8', 2);
      case 'rose-flowers':
        return flowerPainting('#f48fb1', 9);
      case 'lilac-flowers':
        return flowerPainting('#d9c8ee', 14);
    }
  };
  /** 그림을 걸 수 있는 자리마다 액자를 만들고, 꾸밈 데이터가 정한 그림을 넣는다. */
  const hang = (slot: PictureSlot, x: number, y: number, z: number, w: number, h: number, normal: 1 | -1 = 1) =>
    frame(x, y, z, w, h, pictureTexture(decor.pictures[slot]), normal);
  hang('back-left', -3.78, 1.72, back, 0.3, 0.86);
  hang('back-large', -2.5, 1.72, back, 1.55, 1.0);
  hang('back-small-top', -1.2, 2.02, back, 0.4, 0.52);
  hang('back-small-bottom', -1.2, 1.36, back, 0.4, 0.52);

  // ── 작업 책상 (뒷벽 왼쪽) ──────────────────────
  const desk = addGroup(-2.75, 0, back + 0.48, group);
  box(2.5, 0.08, 0.82, WOOD, 0, 0.86, 0, desk, 0.03);
  box(2.3, 0.12, 0.05, WOOD_DARK, 0, 0.76, 0.34, desk);
  box(2.3, 0.12, 0.05, WOOD_DARK, 0, 0.76, -0.34, desk);
  for (const [lx, lz] of [[-1.15, -0.33], [1.15, -0.33], [-1.15, 0.33], [1.15, 0.33]]) box(0.09, 0.82, 0.09, WOOD_DARK, lx, 0.41, lz, desk, 0.02);
  box(2.3, 0.05, 0.6, WOOD_LIGHT, 0, 0.28, 0, desk, 0.02);
  contact(-2.75, back + 0.5, 2.9, 1.2);
  // 붓통 세 개
  [
    [-1.05, 0.02, 0xfdfdfd],
    [-0.82, -0.12, 0xf3ece0],
    [0.02, -0.14, 0xcfe3f5],
  ].forEach(([jx, jz, c], j) => {
    turned([[0, 0], [0.07, 0], [0.078, 0.02], [0.086, 0.2], [0.09, 0.22], [0.08, 0.22], [0.076, 0.03], [0, 0.03]], mat(c, { roughness: 0.5 }), jx, 0.9, jz, desk);
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7 + j;
      const lean = 0.22;
      const brush = addGroup(jx + Math.cos(a) * 0.03, 0.93, jz + Math.sin(a) * 0.03, desk);
      brush.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
      cylinder(0.009, 0.007, 0.3, WOOD_DARK, 0, 0.15, 0, brush);
      cylinder(0.012, 0.012, 0.04, 0xcfd4dc, 0, 0.31, 0, brush);
      turned([[0.012, 0], [0.018, 0.03], [0.012, 0.06], [0, 0.085]], mat(PASTELS[(k + j * 2) % 7]), 0, 0.33, 0, brush);
    }
  });
  // 유리 꽃병과 꽃다발
  const vase = addGroup(-0.42, 0.9, -0.05, desk);
  const glass = noOutline(keep(new THREE.MeshStandardMaterial({ color: 0xdff1f7, transparent: true, opacity: 0.5, roughness: 0.15, side: THREE.DoubleSide })));
  turned([[0, 0], [0.1, 0], [0.13, 0.04], [0.145, 0.16], [0.12, 0.3], [0.085, 0.38], [0.105, 0.44]], glass, 0, 0, 0, vase).castShadow = false;
  turned([[0, 0.01], [0.095, 0.01], [0.125, 0.05], [0.135, 0.15], [0, 0.15]], mat(0xbfe3f2, { transparent: true, opacity: 0.55, roughness: 0.2 }), 0, 0, 0, vase).castShadow = false;
  for (const [sx, sz, lean] of [[-0.03, 0, -0.12], [0.03, 0.02, 0.12], [0, -0.03, 0.02], [0.02, 0.03, -0.05]]) {
    cylinder(0.007, 0.007, 0.6, 0x6aa85a, sx, 0.32, sz, vase).rotation.z = lean;
  }
  // 수국처럼 작은 꽃이 모인 송이
  [
    [0, 0.74, 0, 0.15, 0xf9c5d8],
    [-0.18, 0.63, 0.05, 0.13, 0xffffff],
    [0.18, 0.65, 0.03, 0.13, 0xf48fb1],
    [0.05, 0.61, 0.17, 0.12, 0xcfe3f5],
    [-0.06, 0.61, -0.16, 0.12, 0xffffff],
    [-0.25, 0.49, -0.06, 0.1, 0xcfe3f5],
    [0.26, 0.51, -0.08, 0.1, 0xffffff],
    [0.1, 0.86, -0.04, 0.1, 0xffffff],
    [-0.1, 0.84, 0.06, 0.1, 0xf48fb1],
  ].forEach(([fx, fy, fz, r, c]) => {
    ball(r * 0.78, c, fx, fy, fz, vase);
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4;
      const up = 0.25 + ((k * 0.37) % 1) * 1.1;
      ball(r * 0.36, c, fx + Math.cos(a) * Math.sin(up) * r * 0.75, fy + Math.cos(up) * r * 0.75, fz + Math.sin(a) * Math.sin(up) * r * 0.75, vase).castShadow = false;
    }
  });
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9;
    const leaf = ball(1, LEAF[k % 4], Math.cos(a) * 0.24, 0.47 + (k % 3) * 0.03, Math.sin(a) * 0.24, vase);
    leaf.scale.set(0.11, 0.035, 0.055);
    leaf.rotation.set(0, -a, 0.5);
  }
  // 고양이 장식
  const cat = addGroup(0.42, 0.9, -0.08, desk);
  turned(smoothProfile([[0, 0], [0.1, 0.005], [0.125, 0.07], [0.105, 0.17], [0.06, 0.22], [0, 0.23]]), mat(0xfffaf2, { roughness: 0.55 }), 0, 0, 0, cat);
  ball(0.1, 0xfffaf2, 0, 0.29, 0.02, cat).scale.set(1.08, 0.95, 0.95);
  ball(0.05, 0xf4a24c, 0.05, 0.345, -0.005, cat);
  ball(0.06, 0xf4a24c, -0.075, 0.13, 0.04, cat);
  ball(0.045, 0x8b6748, 0.08, 0.09, -0.03, cat);
  for (const ex of [-0.058, 0.058]) {
    const ear = add(new THREE.ConeGeometry(0.036, 0.075, 10), mat(ex > 0 ? 0xf4a24c : 0xfffaf2), cat);
    ear.position.set(ex, 0.395, 0.02);
    ear.rotation.z = -ex * 4;
    // 웃는 눈: 납작한 반원
    const eye = add(new THREE.TorusGeometry(0.017, 0.005, 6, 12, Math.PI), mat(0x5b4636), cat);
    eye.position.set(ex * 0.72, 0.3, 0.115);
    ball(0.016, 0xf9a8bf, ex * 1.1, 0.27, 0.1, cat).scale.z = 0.4;
  }
  ball(0.011, 0xf48fb1, 0, 0.275, 0.125, cat);
  const tail = add(new THREE.TorusGeometry(0.07, 0.018, 8, 16, Math.PI * 1.2), mat(0xf4a24c), cat);
  tail.position.set(0.1, 0.07, -0.06);
  tail.rotation.set(Math.PI / 2, 0, 0.6);
  // 팔레트와 물감 튜브
  const paletteShape = new THREE.Shape();
  paletteShape.absellipse(0, 0, 0.3, 0.21, 0, Math.PI * 2);
  const thumb = new THREE.Path();
  thumb.absellipse(0.17, -0.08, 0.04, 0.03, 0, Math.PI * 2);
  paletteShape.holes.push(thumb);
  const paletteBoard = add(new THREE.ExtrudeGeometry(paletteShape, { depth: 0.018, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 28 }), mat(0xf0dcc0), desk);
  paletteBoard.rotation.set(-Math.PI / 2, 0, 0.25);
  paletteBoard.position.set(0.92, 0.905, 0.1);
  [0xf48fb1, 0xf9d65c, 0x7cb86a, 0x6fb7e9, 0xb388eb, 0xf4a24c, 0xffffff, 0x5cc8b8, 0xe2574c].forEach((c, k) => {
    const a = 0.6 + (k / 9) * Math.PI * 1.55;
    const dab = ball(0.042, c, 0.92 + Math.cos(a) * 0.2, 0.932, 0.1 - Math.sin(a) * 0.14, desk);
    dab.scale.set(1 + (k % 3) * 0.25, 0.3, 1);
    dab.castShadow = false;
  });
  [0x6fb7e9, 0xf9d65c, 0xf48fb1].forEach((c, k) => {
    const tube = addGroup(0.18 + k * 0.08, 0.925, 0.27, desk);
    tube.rotation.set(0, 0.3 * k - 0.2, Math.PI / 2);
    turned([[0.004, 0], [0.026, 0.02], [0.026, 0.13], [0.012, 0.15], [0.012, 0.17], [0, 0.17]], mat(c, { roughness: 0.4 }), 0, -0.08, 0, tube);
  });

  // ── 책상 앞 바닥: 종이 바구니, 상자, 화분, 나무 상자 ──
  const basket = addGroup(-2.45, 0, -1.55, group);
  turned([[0, 0], [0.23, 0], [0.25, 0.03], [0.3, 0.4], [0.32, 0.44], [0.29, 0.44], [0.27, 0.05], [0, 0.05]], mat(0xcfa26b, { map: linen }), 0, 0, 0, basket);
  for (const y of [0.1, 0.2, 0.3, 0.4]) {
    const hoop = add(new THREE.TorusGeometry(0.255 + y * 0.14, 0.012, 6, 28), mat(0xb9874c), basket);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
  }
  [
    [-0.1, 0.05, 0.2],
    [0.08, -0.06, -0.18],
    [0.02, 0.12, 0.05],
    [-0.02, -0.1, -0.3],
    [0.12, 0.06, 0.25],
  ].forEach(([rx, rz, lean]) => {
    const roll = cylinder(0.05, 0.05, 0.66, 0xfdfbf5, rx, 0.5, rz, basket);
    roll.rotation.set(lean * 0.6, 0, lean);
  });
  contact(-2.45, -1.55, 0.95, 0.95);
  const boxes = addGroup(-3.5, 0, -0.75, group);
  box(0.62, 0.3, 0.46, 0x7f9fc6, 0, 0.15, 0, boxes, 0.02).rotation.y = 0.12;
  box(0.64, 0.05, 0.48, 0x94b2d6, 0, 0.3, 0, boxes, 0.015).rotation.y = 0.12;
  box(0.56, 0.24, 0.42, 0x9fbde0, 0.02, 0.45, 0, boxes, 0.02).rotation.y = -0.1;
  box(0.58, 0.05, 0.44, 0xe9f0f8, 0.02, 0.58, 0, boxes, 0.015).rotation.y = -0.1;
  contact(-3.5, -0.75, 1.0, 0.85);
  plant(-3.45, 0, 0.55, 1.15, undefined, 22);
  contact(-3.45, 0.55, 1.2, 1.2);
  const crate = addGroup(-3.5, 0, 1.85, group);
  crate.rotation.y = 0.08;
  for (const y of [0.07, 0.2, 0.33]) {
    box(0.7, 0.1, 0.03, WOOD_LIGHT, 0, y, 0.24, crate);
    box(0.7, 0.1, 0.03, WOOD_LIGHT, 0, y, -0.24, crate);
    box(0.03, 0.1, 0.48, WOOD_LIGHT, 0.335, y, 0, crate);
    box(0.03, 0.1, 0.48, WOOD_LIGHT, -0.335, y, 0, crate);
  }
  for (const [px, pz] of [[-0.32, -0.23], [0.32, -0.23], [-0.32, 0.23], [0.32, 0.23]]) box(0.05, 0.4, 0.05, WOOD, px, 0.2, pz, crate);
  box(0.64, 0.02, 0.44, WOOD, 0, 0.02, 0, crate);
  contact(-3.5, 1.85, 1.05, 0.85);

  // ── 이젤 ───────────────────────────────────────
  const easel = addGroup(EASEL.x, 0, EASEL.z, group);
  easel.rotation.y = EASEL.turn;
  for (const x of [-0.42, 0.42]) {
    const leg = box(0.07, 1.95, 0.06, WOOD, x * 1.15, 0.95, 0.12, easel, 0.015);
    leg.rotation.set(-0.1, 0, x > 0 ? 0.1 : -0.1);
  }
  box(0.07, 1.95, 0.06, WOOD_DARK, 0, 0.95, -0.44, easel, 0.015).rotation.x = 0.28;
  box(0.86, 0.06, 0.05, WOOD_DARK, 0, 0.42, 0.09, easel);
  // 뒤로 살짝 젖혀진 부분: 받침 선반, 기둥, 캔버스 판
  const tilt = addGroup(0, 0.88, 0.1, easel);
  tilt.rotation.x = -0.13;
  box(1.4, 0.06, 0.17, WOOD, 0, 0, 0.05, tilt, 0.02);
  box(1.4, 0.035, 0.03, WOOD_DARK, 0, 0.045, 0.12, tilt);
  box(0.09, 1.4, 0.05, WOOD_DARK, 0, 0.64, -0.04, tilt);
  const clamp = box(0.34, 0.1, 0.1, WOOD, 0, 0, 0.02, tilt, 0.02);
  const board = add(new THREE.BoxGeometry(1, 1, 0.035), mat(0xfffdf8, { roughness: 1 }), tilt);
  const setBoardAspect = (aspect: number) => {
    let h = BOARD_HEIGHT;
    let w = h * aspect;
    if (w > 1.3) {
      w = 1.3;
      h = w / aspect;
    }
    board.scale.set(w, h, 1);
    board.position.set(0, 0.03 + h / 2, 0.03);
    clamp.position.y = 0.03 + h + 0.05;
  };
  setBoardAspect(4 / 3);
  // 캔버스 앞면에 붙이는 그림. 판의 크기를 따라가도록 판에 붙인다 (판의 앞면은 +z).
  const boardPictureMaterial = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
  const boardPicture = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), boardPictureMaterial);
  boardPicture.position.z = 0.0185;
  boardPicture.visible = false;
  board.add(boardPicture);
  const setBoardPicture = (texture: THREE.Texture | null, aspect?: number) => {
    boardPictureMaterial.map = texture;
    boardPictureMaterial.needsUpdate = true;
    boardPicture.visible = texture !== null;
    setBoardAspect(texture && aspect ? aspect : 4 / 3);
  };
  contact(EASEL.x, EASEL.z - 0.1, 1.7, 1.5);

  // ── 의자: 캔버스 정면에 놓는다 ─────────────────
  const facing = { x: Math.sin(EASEL.turn), z: Math.cos(EASEL.turn) };
  const stoolAt = { x: EASEL.x + facing.x * 1.32, z: EASEL.z + facing.z * 1.32 };
  const stool = addGroup(stoolAt.x, 0, stoolAt.z, group);
  // 통통한 방석
  turned(smoothProfile([[0, 0.47], [0.2, 0.47], [0.3, 0.485], [0.325, 0.53], [0.3, 0.575], [0.2, 0.595], [0, 0.6]]), fabric(0xfff3df), 0, 0, 0, stool);
  cylinder(0.29, 0.27, 0.05, WOOD, 0, 0.45, 0, stool);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = cylinder(0.03, 0.036, 0.46, WOOD_DARK, Math.cos(a) * 0.21, 0.22, Math.sin(a) * 0.21, stool);
    leg.rotation.set(Math.sin(a) * 0.13, 0, -Math.cos(a) * 0.13);
  }
  const brace = add(new THREE.TorusGeometry(0.2, 0.014, 6, 24), mat(WOOD_DARK), stool);
  brace.rotation.x = Math.PI / 2;
  brace.position.y = 0.17;
  contact(stoolAt.x, stoolAt.z, 0.95, 0.95);

  // ── 깔개 ───────────────────────────────────────
  // 윗면에만 무늬를 입힌다 (상자의 면 순서: +x, -x, +y, -y, +z, -z)
  const rugSide = mat(0xf3dde6);
  const rug = new THREE.Mesh(keep(new THREE.BoxGeometry(4.0, 0.016, 2.8)), [
    rugSide,
    rugSide,
    mat(0xffffff, { map: keep(rugTexture()), roughness: 1 }),
    rugSide,
    rugSide,
    rugSide,
  ]);
  rug.position.set(0.35, 0.008, 0.05);
  rug.receiveShadow = true;
  group.add(rug);

  // ── 물감 수레, 창가 화분 ───────────────────────
  const cart = addGroup(1.2, 0, back + 0.52, group);
  for (const [cx, cz] of [[-0.3, -0.19], [0.3, -0.19], [-0.3, 0.19], [0.3, 0.19]]) {
    cylinder(0.014, 0.014, 0.92, 0xe9e6e0, cx, 0.5, cz, cart);
    ball(0.035, 0x8d8a85, cx, 0.035, cz, cart);
  }
  [0.16, 0.5, 0.86].forEach((y, tier) => {
    box(0.66, 0.03, 0.44, 0xfaf8f4, 0, y, 0, cart);
    for (const z of [0.21, -0.21]) box(0.66, 0.07, 0.02, 0xfaf8f4, 0, y + 0.04, z, cart, 0.008);
    for (const x of [0.32, -0.32]) box(0.02, 0.07, 0.44, 0xfaf8f4, x, y + 0.04, 0, cart, 0.008);
    for (let k = 0; k < 6; k++) {
      const h = 0.13 + ((k + tier) % 3) * 0.03;
      const px = -0.25 + (k % 3) * 0.25 + (k > 2 ? 0.1 : 0);
      const pz = k > 2 ? 0.09 : -0.09;
      // 물감 병: 몸통, 어깨, 뚜껑
      turned([[0, 0], [0.036, 0], [0.04, 0.01], [0.04, h * 0.72], [0.022, h * 0.9], [0.022, h], [0, h]], mat(PASTELS[(k * 2 + tier * 3) % 7], { roughness: 0.45 }), px, y + 0.015, pz, cart);
      cylinder(0.024, 0.024, 0.03, 0xffffff, px, y + 0.03 + h, pz, cart);
    }
  });
  contact(1.2, back + 0.52, 1.0, 0.8);
  const stand = addGroup(0.5, 0, back + 0.42, group);
  turned([[0, 0.78], [0.22, 0.78], [0.25, 0.8], [0.22, 0.82], [0, 0.82]], mat(WOOD), 0, 0, 0, stand);
  turned([[0.2, 0], [0.2, 0.025], [0.05, 0.06], [0.03, 0.4], [0.045, 0.74], [0.09, 0.78], [0, 0.78]], mat(WOOD_DARK), 0, 0, 0, stand);
  // 받침대 위의 화분: 꾸밈 데이터가 정한 화분을 놓고, 꾸미기로 바꿀 수 있다
  const standPlant = addGroup(0, 0.82, 0, stand);
  const potProfile = (s: number): [number, number][] => [
    [0, 0],
    [0.17 * s, 0],
    [0.2 * s, 0.03 * s],
    [0.25 * s, 0.34 * s],
    [0.27 * s, 0.38 * s],
    [0.24 * s, 0.4 * s],
    // 안쪽 바닥은 흙보다 아래에 둔다 (같은 높이면 두 면이 겹쳐 깜빡인다)
    [0.22 * s, 0.3 * s],
    [0, 0.3 * s],
  ];
  const growPlant = (kind: PlantKind) => {
    standPlant.clear();
    const s = 0.62;
    const soilY = 0.36 * s;
    if (kind === 'leafy') {
      plant(0, 0, 0, s, standPlant, 14);
      return;
    }
    if (kind === 'tulip') {
      // 분홍 화분에 튤립 다섯 송이
      turned(potProfile(s), mat(0xf7c9b8, { roughness: 0.6 }), 0, 0, 0, standPlant);
      cylinder(0.21 * s, 0.21 * s, 0.02 * s, 0x7a5a3f, 0, soilY - 0.006, 0, standPlant).castShadow = false;
      const colors = [0xf48fb1, 0xf9d65c, 0xf2788f, 0xfbd3e1, 0xf4a24c];
      colors.forEach((color, k) => {
        const a = (k / colors.length) * Math.PI * 2;
        const lean = k === 0 ? 0 : 0.22;
        const off = k === 0 ? 0 : 0.05;
        const tall = 0.52 + (k % 3) * 0.07;
        const stemGroup = addGroup(Math.cos(a) * off, soilY, Math.sin(a) * off, standPlant);
        stemGroup.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
        cylinder(0.008, 0.01, tall, 0x6aa85a, 0, tall / 2, 0, stemGroup);
        // 꽃봉오리: 위가 살짝 오므라진 컵 모양
        turned(
          [[0, 0], [0.03, 0.006], [0.056, 0.05], [0.058, 0.095], [0.04, 0.135], [0.022, 0.15], [0, 0.15]],
          mat(color, { roughness: 0.6 }),
          0,
          tall - 0.01,
          0,
          stemGroup,
        );
        // 길쭉한 잎
        const leaf = ball(1, LEAF[k % LEAF.length], 0.03, tall * 0.36, 0, stemGroup);
        leaf.scale.set(0.035, tall * 0.34, 0.012);
        leaf.rotation.set(0, a, -0.28);
      });
      return;
    }
    // 하늘색 화분에 둥근 선인장
    turned(potProfile(s), mat(0xa9cdee, { roughness: 0.6 }), 0, 0, 0, standPlant);
    cylinder(0.21 * s, 0.21 * s, 0.02 * s, 0xd9c9a8, 0, soilY - 0.006, 0, standPlant).castShadow = false;
    const body = ball(1, 0x6fae62, 0, soilY + 0.2, 0, standPlant);
    body.scale.set(0.15, 0.23, 0.15);
    for (let k = 0; k < 8; k++) {
      // 세로 골과 가시
      const a = (k / 8) * Math.PI * 2;
      const rib = ball(1, 0x5b9a50, Math.cos(a) * 0.118, soilY + 0.2, Math.sin(a) * 0.118, standPlant);
      rib.scale.set(0.04, 0.205, 0.04);
      for (let j = 0; j < 4; j++) {
        const r = 0.15 - Math.abs(j - 1.5) * 0.012;
        ball(0.011, 0xfffaf2, Math.cos(a) * r, soilY + 0.08 + j * 0.08, Math.sin(a) * r, standPlant).castShadow = false;
      }
    }
    const arm = ball(1, 0x6fae62, 0.17, soilY + 0.18, 0.02, standPlant);
    arm.scale.set(0.07, 0.1, 0.07);
    // 꼭대기의 분홍 꽃
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const petal = ball(0.035, 0xf48fb1, Math.cos(a) * 0.04, soilY + 0.44, Math.sin(a) * 0.04, standPlant);
      petal.scale.y = 0.55;
    }
    ball(0.024, 0xf9d65c, 0, soilY + 0.455, 0, standPlant);
  };
  growPlant(decor.plants['window-stand']);
  contact(0.5, back + 0.42, 0.7, 0.7);

  // ── 창가 찻상 ──────────────────────────────────
  const tea = addGroup(2.15, 0, back + 0.72, group);
  turned([[0, 0.37], [0.37, 0.37], [0.4, 0.395], [0.37, 0.42], [0, 0.42]], mat(WOOD), 0, 0, 0, tea);
  turned([[0.2, 0], [0.19, 0.03], [0.07, 0.09], [0.05, 0.3], [0.1, 0.37], [0, 0.37]], mat(WOOD_DARK), 0, 0, 0, tea);
  // 찻잔과 받침, 찻주전자
  turned([[0, 0.42], [0.075, 0.42], [0.085, 0.43], [0, 0.432]], mat(0xffffff, { roughness: 0.3 }), -0.1, 0, 0.06, tea);
  turned([[0, 0.43], [0.03, 0.43], [0.05, 0.47], [0.056, 0.5], [0.05, 0.5], [0.045, 0.47], [0, 0.445]], mat(0xffffff, { roughness: 0.3, side: THREE.DoubleSide }), -0.1, 0, 0.06, tea);
  cylinder(0.045, 0.04, 0.004, 0xc98f5a, -0.1, 0.49, 0.06, tea).castShadow = false;
  const pot = addGroup(0.14, 0.42, -0.06, tea);
  turned(smoothProfile([[0, 0], [0.07, 0.005], [0.11, 0.06], [0.1, 0.12], [0.06, 0.15], [0, 0.155]]), mat(0xf9c5d8, { roughness: 0.35 }), 0, 0, 0, pot);
  ball(0.018, 0xf9c5d8, 0, 0.165, 0, pot);
  const handle = add(new THREE.TorusGeometry(0.045, 0.01, 8, 16, Math.PI), mat(0xf9c5d8, { roughness: 0.35 }), pot);
  handle.position.set(-0.1, 0.08, 0);
  handle.rotation.z = Math.PI / 2;
  const spout = cylinder(0.01, 0.018, 0.09, 0xf9c5d8, 0.12, 0.09, 0, pot);
  spout.rotation.z = -0.9;
  contact(2.15, back + 0.72, 0.9, 0.9);
  // 찻상 앞 방석: 창을 바라보고 앉는 자리
  const teaSeat = { x: 2.15, z: back + 1.48 };
  const zabuton = addGroup(teaSeat.x, 0, teaSeat.z, group);
  turned(smoothProfile([[0, 0], [0.26, 0.004], [0.34, 0.03], [0.35, 0.07], [0.3, 0.1], [0.1, 0.11], [0, 0.105]]), fabric(0xf9c5d8), 0, 0, 0, zabuton);
  ball(0.03, 0xe58aa0, 0, 0.105, 0, zabuton).scale.y = 0.4;
  contact(teaSeat.x, teaSeat.z, 0.9, 0.9);

  // ── 책장 (오른쪽 벽) ───────────────────────────
  const shelf = addGroup(halfW - 0.27, 0, -1.65, group);
  const shelfLen = 1.9;
  const shelfH = 2.55;
  box(0.5, shelfH, 0.06, WOOD, 0, shelfH / 2, -shelfLen / 2, shelf);
  box(0.5, shelfH, 0.06, WOOD, 0, shelfH / 2, shelfLen / 2, shelf);
  box(0.04, shelfH, shelfLen, WOOD_DARK, 0.23, shelfH / 2, 0, shelf);
  box(0.56, 0.07, shelfLen + 0.12, WOOD, 0, shelfH + 0.01, 0, shelf, 0.02);
  for (let row = 0; row < 6; row++) {
    const y = 0.06 + row * 0.49;
    box(0.5, 0.05, shelfLen, WOOD, 0, y, 0, shelf);
    if (row === 5) continue;
    let z = -shelfLen / 2 + 0.06;
    for (let k = 0; z < shelfLen / 2 - 0.16; k++) {
      const seed = (row * 7 + k * 13) % 11;
      const w = 0.06 + (seed % 4) * 0.018;
      const h = 0.27 + (seed % 5) * 0.03;
      // 넷째 칸 가운데는 토끼 인형, 셋째 칸 끝은 꽃병 자리로 비워 둔다
      const reserved = (row === 3 && z > -0.25 && z < 0.3) || (row === 2 && z > 0.45);
      if (seed === 5 || reserved) {
        z += 0.12;
        continue;
      }
      const book = at(add(roundedBox(0.3 - (seed % 3) * 0.02, h, w, 0.008), mat(PASTELS[(row * 3 + k) % PASTELS.length], { map: spine })), -0.05, y + 0.025 + h / 2, z + w / 2);
      shelf.add(book);
      // 가끔 기대어 선 책
      if (seed === 9) book.rotation.x = 0.16;
      z += w + 0.01;
    }
  }
  // 토끼 인형
  const plush = addGroup(-0.08, 0.06 + 3 * 0.49 + 0.025, 0.03, shelf);
  plush.rotation.y = -Math.PI / 2;
  turned(smoothProfile([[0, 0], [0.08, 0.005], [0.105, 0.07], [0.08, 0.16], [0, 0.19]]), fabric(0xfffaf2), 0, 0, 0, plush);
  ball(0.09, 0xfffaf2, 0, 0.25, 0.01, plush);
  for (const ex of [-0.04, 0.04]) {
    const ear = add(new THREE.CapsuleGeometry(0.022, 0.11, 4, 8), mat(0xfffaf2), plush);
    ear.position.set(ex, 0.385, 0);
    ear.rotation.z = -ex * 3;
    ball(0.011, 0x5b4636, ex * 0.75, 0.26, 0.088, plush);
    ball(0.035, 0xfffaf2, ex * 2.1, 0.05, 0.075, plush);
    ball(0.03, 0xfffaf2, ex * 2.3, 0.14, 0.05, plush);
  }
  // 분홍 리본
  for (const side of [-1, 1]) {
    const bow = ball(0.035, 0xf48fb1, side * 0.035, 0.175, 0.085, plush);
    bow.scale.set(1.1, 0.75, 0.45);
  }
  ball(0.016, 0xe5709a, 0, 0.175, 0.095, plush);
  // 흰 꽃을 꽂은 작은 꽃병
  const smallVase = addGroup(-0.06, 0.06 + 2 * 0.49 + 0.025, 0.7, shelf);
  turned([[0, 0], [0.045, 0], [0.065, 0.04], [0.06, 0.09], [0.035, 0.13], [0.045, 0.15]], mat(0xdff1f7, { roughness: 0.25, side: THREE.DoubleSide }), 0, 0, 0, smallVase);
  [[0, 0.25, 0], [0.06, 0.21, 0.03], [-0.06, 0.21, -0.02], [0.02, 0.2, -0.06], [-0.02, 0.28, 0.04], [0.05, 0.27, -0.03]].forEach(([fx, fy, fz]) => {
    cylinder(0.004, 0.004, fy - 0.08, 0x6aa85a, fx * 0.5, (fy + 0.08) / 2, fz * 0.5, smallVase).castShadow = false;
    ball(0.034, 0xffffff, fx, fy, fz, smallVase);
    ball(0.012, 0xf9d65c, fx, fy + 0.025, fz + 0.012, smallVase).castShadow = false;
  });
  // 책장 위: 작은 액자와 덩굴 화분
  box(0.04, 0.3, 0.26, WOOD, 0, shelfH + 0.2, 0.45, shelf).rotation.z = 0.15;
  box(0.045, 0.22, 0.18, 0xf9c5d8, -0.005, shelfH + 0.2, 0.45, shelf).rotation.z = 0.15;
  plant(0, shelfH + 0.045, -0.45, 0.45, shelf, 10);
  vine(-0.22, shelfH, -0.6, 0.7, shelf);
  vine(-0.22, shelfH, -0.3, 0.45, shelf);
  contact(halfW - 0.4, -1.65, 1.0, 2.3);

  // ── 방석 ───────────────────────────────────────
  const pouf = addGroup(2.95, 0, 0.35, group);
  turned(smoothProfile([[0, 0], [0.3, 0.005], [0.43, 0.05], [0.47, 0.14], [0.42, 0.24], [0.28, 0.29], [0.06, 0.285], [0, 0.27]]), fabric(0xf9d65c), 0, 0, 0, pouf);
  ball(0.045, 0xe9bd3e, 0, 0.275, 0, pouf).scale.y = 0.45;
  contact(2.95, 0.35, 1.25, 1.25);

  // ── 문 (앞벽) ──────────────────────────────────
  const door = addGroup(DOOR_X, 0, front, group);
  box(1.24, 2.26, 0.1, WOOD_DARK, 0, 1.13, -0.03, door, 0.02);
  box(1.0, 2.1, 0.08, WOOD, 0, 1.05, -0.07, door, 0.02);
  for (const [py, ph] of [[1.52, 0.9], [0.52, 0.72]]) box(0.74, ph, 0.03, WOOD_LIGHT, 0, py, -0.11, door, 0.012);
  ball(0.045, 0xf2c94c, -0.37, 1.02, -0.15, door);
  cylinder(0.02, 0.02, 0.06, 0xf2c94c, -0.37, 1.02, -0.12, door).rotation.x = Math.PI / 2;
  box(1.3, 0.016, 0.7, 0xc98f6a, 0, 0.008, -0.5, door, 0.006).castShadow = false;
  box(1.1, 0.018, 0.5, 0xe3b08a, 0, 0.01, -0.5, door, 0.006).castShadow = false;
  // 문 옆: 옷걸이와 액자 (완성한 그림을 거는 자리)
  const rack = addGroup(DOOR_X + 1.25, 0, front - 0.04, group);
  box(0.7, 0.1, 0.04, WOOD, 0, 1.75, 0, rack, 0.015);
  for (const hx of [-0.24, 0, 0.24]) {
    cylinder(0.014, 0.014, 0.1, WOOD_DARK, hx, 1.75, -0.06, rack).rotation.x = Math.PI / 2;
    ball(0.024, WOOD_DARK, hx, 1.75, -0.11, rack);
  }
  const apron = add(curtainGeometry(0.36, 0.66, { folds: 2, depth: 0.02 }), keep(new THREE.MeshStandardMaterial({ color: 0xf7b6c8, map: linen, roughness: 1, side: THREE.DoubleSide })), rack);
  apron.position.set(-0.24, 1.75, -0.09);
  // 걸이대에 끈으로 걸어 둔 카메라. 누르면 사진을 골라 색칠 그림으로 만든다.
  const CAMERA_HOOK = 0.24;
  const CAMERA_SCALE = 1.3;
  const cam = addGroup(CAMERA_HOOK, 1.75 - 0.39 * CAMERA_SCALE, -0.085, rack);
  cam.scale.setScalar(CAMERA_SCALE);
  cam.rotation.z = -0.05;
  // 끈: 고리에서 몸통 양쪽으로 내려온다
  for (const side of [-1, 1]) {
    const strap = box(0.012, 0.36, 0.006, 0x8a5a3c, side * 0.055, 0.215, 0.012, cam, 0.002);
    strap.rotation.z = side * 0.3;
    strap.castShadow = false;
    ball(0.011, 0xcfd3d6, side * 0.1, 0.055, 0.01, cam);
  }
  // 몸통: 민트색 몸통에 크림색 윗부분
  box(0.24, 0.13, 0.07, 0x8fd3c1, 0, -0.01, 0, cam, 0.022);
  box(0.245, 0.04, 0.074, CREAM, 0, 0.04, 0, cam, 0.016);
  box(0.07, 0.035, 0.05, CREAM, -0.02, 0.07, 0, cam, 0.012);
  // 셔터와 감기 손잡이
  cylinder(0.015, 0.015, 0.016, 0xf48fb1, 0.075, 0.066, 0, cam);
  cylinder(0.02, 0.02, 0.012, 0xcfd3d6, -0.085, 0.064, 0, cam);
  // 렌즈: 방 안쪽을 향한다
  const lens = (r: number, len: number, color: number, z: number) => {
    const m = cylinder(r, r, len, color, 0, -0.012, z, cam);
    m.rotation.x = Math.PI / 2;
    return m;
  };
  lens(0.052, 0.03, 0xf2f2f0, -0.045);
  lens(0.043, 0.03, 0x5b4636, -0.062);
  lens(0.03, 0.006, 0x3b5a7a, -0.079).castShadow = false;
  ball(0.009, 0xffffff, 0.012, 0, -0.082, cam).castShadow = false;
  // 플래시와 뷰파인더
  box(0.04, 0.022, 0.006, 0xfff3c4, 0.08, 0.036, -0.038, cam, 0.004).castShadow = false;
  box(0.026, 0.018, 0.006, 0x5b4636, -0.02, 0.07, -0.026, cam, 0.004).castShadow = false;
  hang('door-near', DOOR_X - 1.5, 1.7, front, 0.8, 0.6, -1);
  hang('door-far', DOOR_X - 2.9, 1.7, front, 0.5, 0.66, -1);

  // ── 그림 벽 (이젤 왼쪽 벽): 완성한 그림을 액자에 넣어 건다 ──
  const wallGroup = new THREE.Group();
  group.add(wallGroup);
  /** 벽 그림마다 만든 것들. 그림을 다시 걸 때 정리한다. */
  const wallItems = new Map<string, { group: THREE.Group; w: number; h: number; trash: { dispose(): void }[] }>();
  /** 액자 종류마다의 모양: 테두리 재질, 모서리의 둥글기, 그림 둘레의 가는 띠(있으면) */
  const FRAME_LOOKS: Record<FrameKind, { color: number; roughness: number; metalness?: number; radius: number; bead?: number }> = {
    // 따뜻한 원목
    wood: { color: WOOD, roughness: 0.75, radius: 0.02 },
    // 반듯하고 깔끔한 흰 액자
    white: { color: 0xf7f4ee, roughness: 0.45, radius: 0.008 },
    // 그림 둘레에 진한 금색 띠를 두른 금빛 액자
    gold: { color: 0xe0b44c, roughness: 0.35, metalness: 0.55, radius: 0.012, bead: 0xb8862b },
    // 모서리가 아주 둥근 분홍 액자
    pink: { color: 0xf7b6c8, roughness: 0.6, radius: 0.04 },
  };
  const frameMaterials = new Map<number, THREE.Material>();
  const frameMaterial = (color: number, roughness: number, metalness = 0): THREE.Material => {
    const key = color * 1000 + Math.round(roughness * 100) * 10 + Math.round(metalness * 9);
    let m = frameMaterials.get(key);
    if (!m) {
      m = keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
      frameMaterials.set(key, m);
    }
    return m;
  };
  const matMaterial = mat(0xfffaf2);
  const clearWall = () => {
    for (const item of wallItems.values()) {
      wallGroup.remove(item.group);
      item.trash.forEach((t) => t.dispose());
    }
    wallItems.clear();
  };
  /** 액자 하나. 그림 앞면이 방 안쪽(+x)을 바라보도록 세운다. */
  const buildWallPicture = ({ picture, image }: WallPictureView) => {
    const { w, h } = wallPictureSize(image.aspect);
    const g = new THREE.Group();
    g.rotation.y = Math.PI / 2;
    g.userData.wallId = picture.id;
    const trash: { dispose(): void }[] = [];
    const part = (geometry: THREE.BufferGeometry, material: THREE.Material, z: number, shadow = true) => {
      trash.push(geometry);
      const m = new THREE.Mesh(geometry, material);
      m.position.z = z;
      m.castShadow = shadow;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // 액자 테두리, 그 안의 흰 여백, 그림
    const look = FRAME_LOOKS[picture.frame];
    part(roundedBox(w + FRAME_BORDER, h + FRAME_BORDER, 0.05, look.radius), frameMaterial(look.color, look.roughness, look.metalness), 0.025);
    part(roundedBox(w + 0.04, h + 0.04, 0.052, 0.004), matMaterial, 0.027);
    if (look.bead !== undefined) {
      // 테두리 안쪽을 따라 도드라진 띠
      const bead = frameMaterial(look.bead, 0.3, 0.6);
      const t = 0.014;
      const bw = w + 0.04 + t;
      const bh = h + 0.04 + t;
      for (const [sw, sh, x, y] of [
        [bw + t, t, 0, bh / 2],
        [bw + t, t, 0, -bh / 2],
        [t, bh + t, bw / 2, 0],
        [t, bh + t, -bw / 2, 0],
      ]) {
        part(roundedBox(sw, sh, 0.062, 0.005), bead, 0.031).position.set(x, y, 0.031);
      }
    }
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: image.texture, roughness: 1 });
    trash.push(canvasMat);
    part(new THREE.PlaneGeometry(w, h), canvasMat, 0.0545, false);
    // 벽에 닿는 그림자
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(w + FRAME_BORDER + 0.1, h + FRAME_BORDER + 0.1), shadeMat);
    trash.push(shadowPlane.geometry);
    shadowPlane.position.set(0, -0.03, 0.003);
    shadowPlane.renderOrder = 1;
    g.add(shadowPlane);
    const p = clampOnWall(picture.z, picture.y, w, h);
    g.position.set(-halfW, p.y, p.z);
    wallGroup.add(g);
    wallItems.set(picture.id, { group: g, w, h, trash });
  };
  let highlighted: string | null = null;

  // ── 조명 ───────────────────────────────────────
  group.add(new THREE.HemisphereLight(0xfff6e8, 0xe9c9a4, 1.25));
  group.add(new THREE.AmbientLight(0xfff3e4, 0.55));
  // 방 안을 은은하게 밝히는 등 (그림자 없음)
  for (const z of [0.8, 4.2]) {
    const fill = new THREE.PointLight(0xffe7c8, z < 2 ? 6 : 5, 0, 1.6);
    fill.position.set(0.3, height - 0.5, z);
    group.add(fill);
  }
  // 창밖에서 들어오는 햇빛
  const sun = new THREE.DirectionalLight(0xffe2b0, 2.7);
  sun.position.set(winX + 4.2, 7.2, back - 6.5);
  sun.target.position.set(winX - 1.7, 0, 0.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 5;
  sun.shadow.blurSamples = 16;
  group.add(sun, sun.target);

  let time = 0;
  return {
    group,
    bounds: { minX: -3.55, maxX: 3.55, minZ: -2.35, maxZ: front - 0.45 },
    obstacles: [
      { x: EASEL.x, z: EASEL.z - 0.1, r: 0.85 },
      { x: stoolAt.x, z: stoolAt.z, r: 0.42 },
      { x: -3.4, z: back + 0.45, r: 0.85 },
      { x: -2.1, z: back + 0.45, r: 0.85 },
      { x: -2.45, z: -1.55, r: 0.42 },
      { x: -3.5, z: -0.75, r: 0.5 },
      { x: -3.45, z: 0.55, r: 0.55 },
      { x: -3.5, z: 1.85, r: 0.5 },
      { x: 0.5, z: back + 0.42, r: 0.4 },
      { x: 1.2, z: back + 0.52, r: 0.5 },
      { x: 2.15, z: back + 0.72, r: 0.52 },
      { x: halfW - 0.2, z: -1.65, r: 1.05 },
      { x: 2.95, z: 0.35, r: 0.5 },
    ],
    cameraBox: {
      minX: -halfW + 0.3,
      maxX: halfW - 0.3,
      minY: 0.35,
      maxY: height - 0.3,
      minZ: back + 0.3,
      maxZ: front - 0.3,
    },
    // 문 앞에서 출발해 방 가운데로 걸어 들어온다.
    entry: { x: DOOR_X, z: front - 0.55 },
    spawn: { x: 1.3, z: 1.25 },
    seats: {
      // 이젤 앞 의자: 캔버스를 바라본다
      paint: {
        approach: { x: stoolAt.x + 0.78, z: stoolAt.z + 0.3 },
        seat: new THREE.Vector3(stoolAt.x, 0.6, stoolAt.z),
        heading: EASEL.turn + Math.PI,
      },
      // 창가 방석: 찻상 너머 창밖을 바라본다
      tea: {
        approach: { x: teaSeat.x - 0.2, z: teaSeat.z + 0.65 },
        seat: new THREE.Vector3(teaSeat.x, 0.11, teaSeat.z),
        heading: Math.PI,
      },
      // 책장 옆 노란 방석: 방 안쪽을 바라본다
      read: {
        approach: { x: 2.2, z: 0.75 },
        seat: new THREE.Vector3(2.95, 0.29, 0.35),
        heading: -Math.PI / 2 - 0.35,
      },
    },
    bookshelfFront: { x: halfW - 1.3, z: -1.25 },
    board,
    setBoardAspect,
    setBoardPicture,
    hotspots: [
      { id: 'easel', label: '이젤', icon: '🎨', position: new THREE.Vector3(EASEL.x, 2.12, EASEL.z), available: true },
      { id: 'stool', label: '의자', icon: '🪑', position: new THREE.Vector3(stoolAt.x, 0.9, stoolAt.z), available: true },
      { id: 'window', label: '창가에서 차 마시기', icon: '☕', position: new THREE.Vector3(2.15, 0.95, back + 0.72), available: true },
      { id: 'plant', label: '화분 바꾸기', icon: '🌱', position: new THREE.Vector3(0.5, 1.9, back + 0.42), available: true },
      { id: 'bookshelf', label: '책 읽기', icon: '📖', position: new THREE.Vector3(halfW - 0.55, 1.75, -1.65), available: true },
      { id: 'gallery-wall', label: '완성한 그림 걸기', icon: '🖼️', position: new THREE.Vector3(-halfW + 0.2, 2.55, 2.7), available: true },
      { id: 'camera', label: '사진으로 색칠 그림 만들기', icon: '📷', position: new THREE.Vector3(DOOR_X + 1.25 + 0.24, 2.08, front - 0.14), available: true },
    ],
    setPlant(slot: PlantSlot, kind: PlantKind) {
      if (slot === 'window-stand') growPlant(kind);
    },
    galleryWallX: -halfW,
    setWallPictures(items: WallPictureView[]) {
      clearWall();
      items.forEach(buildWallPicture);
      if (highlighted && !wallItems.has(highlighted)) highlighted = null;
      if (highlighted) wallItems.get(highlighted)!.group.position.x = -halfW + 0.04;
    },
    moveWallPicture(id: string, z: number, y: number) {
      const item = wallItems.get(id);
      if (!item) return null;
      const p = clampOnWall(z, y, item.w, item.h);
      item.group.position.z = p.z;
      item.group.position.y = p.y;
      return p;
    },
    wallPictureRect(id: string) {
      const item = wallItems.get(id);
      return item ? { z: item.group.position.z, y: item.group.position.y, w: item.w, h: item.h } : null;
    },
    wallPictureAt(raycaster: THREE.Raycaster) {
      const hit = raycaster.intersectObject(wallGroup, true)[0];
      let object: THREE.Object3D | null = hit?.object ?? null;
      while (object && object.userData.wallId === undefined) object = object.parent;
      return object ? (object.userData.wallId as string) : null;
    },
    highlightWallPicture(id: string | null) {
      if (id !== null && !wallItems.has(id)) return;
      for (const [key, item] of wallItems) item.group.position.x = key === id ? -halfW + 0.04 : -halfW;
      highlighted = id;
    },
    update(dt: number) {
      time += dt;
      // 꽃잎이 흔들리며 떨어지고, 땅에 닿으면 위에서 다시 내려온다
      for (let k = 0; k < PETALS; k++) {
        const phase = petalSeed[k * 2];
        petalPos[k * 3] += Math.sin(time * 0.9 + phase) * 0.35 * dt + 0.12 * dt;
        petalPos[k * 3 + 1] -= petalSeed[k * 2 + 1] * dt;
        petalPos[k * 3 + 2] += Math.cos(time * 0.7 + phase) * 0.15 * dt;
        if (petalPos[k * 3 + 1] < 0) petalPos[k * 3 + 1] = 6;
        if (petalPos[k * 3] > winX + 4.5) petalPos[k * 3] -= 9;
      }
      petalGeometry.attributes.position.needsUpdate = true;
      // 등불이 조금씩 일렁인다
      const flicker = 1 + Math.sin(time * 7.3) * 0.04 + Math.sin(time * 12.1) * 0.03;
      glow.intensity = 2.4 * flicker;
      glowSprite.material.opacity = 0.85 * flicker;
    },
    dispose() {
      clearWall();
      disposables.forEach((d) => d.dispose());
    },
  };
}
