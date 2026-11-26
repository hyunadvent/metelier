import * as THREE from 'three';
import type { Box3D, Ground, WalkArea } from './movement';

export type Hotspot3DId = 'easel' | 'stool' | 'window' | 'bookshelf';

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
  stool: {
    approach: Ground;
    seat: THREE.Vector3;
    /** 앉았을 때 바라보는 방향 (y 축 회전, 이젤 쪽) */
    heading: number;
  };
  /** 이젤 위의 캔버스 판. 색칠 화면에서는 이 판 자리에 종이가 겹쳐진다. */
  board: THREE.Mesh;
  /** 캔버스 판의 가로세로 비율을 그림에 맞춘다. */
  setBoardAspect(aspect: number): void;
  hotspots: Hotspot3D[];
  dispose(): void;
}

// 방 크기. 뒤쪽(-z)에 창문 벽이, 앞쪽(+z)에 문이 있는 벽이 있다.
const ROOM = { halfW: 4, back: -3, front: 6, height: 3.3 };
const WINDOW = { x0: 0.25, x1: 3.6, y0: 0.72, y1: 2.98 };
const EASEL = { x: -0.35, z: -1.55, turn: 0.24 };
const BOARD_HEIGHT = 0.78;
/** 앞벽에 있는 문의 가운데 x */
const DOOR_X = 1.4;

const WOOD = 0xd9a56c;
const WOOD_DARK = 0xb9793f;
const WOOD_LIGHT = 0xe9bf8c;
const WALL = 0xfdf0dd;
const CREAM = 0xfff6ea;
const GREEN = 0x7cb86a;
const PASTELS = [0x6fb7e9, 0xf48fb1, 0xf9d65c, 0x7cb86a, 0xb388eb, 0xf4a24c, 0x5cc8b8, 0xfff8e7, 0xf9c5d8, 0x9fc5e8];

/**
 * 기획 참고 이미지(docs/reference/atelier-room.webp)의 화실을 기본 도형으로 옮긴 임시 3D 방.
 * 실제 3D 모델(GLB)이 준비되면 이 함수가 모델을 불러오도록 바꾸면 된다.
 */
export function buildAtelierRoom(): AtelierRoom {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.Material>();

  const mat = (color: number, options: THREE.MeshStandardMaterialParameters = {}): THREE.Material => {
    const key = `${color}:${JSON.stringify(options)}`;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...options });
      materials.set(key, m);
    }
    return m;
  };
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = group): THREE.Mesh => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent?: THREE.Object3D) => {
    const mesh = add(new THREE.BoxGeometry(w, h, d), mat(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const cylinder = (rTop: number, rBottom: number, h: number, color: number, x: number, y: number, z: number, parent?: THREE.Object3D) => {
    const mesh = add(new THREE.CylinderGeometry(rTop, rBottom, h, 24), mat(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const ball = (r: number, color: number, x: number, y: number, z: number, parent?: THREE.Object3D) => {
    const mesh = add(new THREE.SphereGeometry(r, 18, 12), mat(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const sub = (x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  /** 화분: 흰 화분에 둥근 잎 덩어리 */
  const plant = (x: number, y: number, z: number, s: number, parent?: THREE.Object3D) => {
    const g = sub(x, y, z, parent);
    cylinder(0.26 * s, 0.19 * s, 0.4 * s, 0xf7f3ec, 0, 0.2 * s, 0, g);
    [
      [0, 0.72, 0, 0.4],
      [0.24, 0.92, -0.08, 0.28],
      [-0.24, 0.86, 0.1, 0.26],
      [0.05, 1.12, 0.08, 0.24],
      [-0.12, 0.6, -0.22, 0.24],
    ].forEach(([px, py, pz, r], k) => ball(r * s, [GREEN, 0x8fc97c, 0x6aa85a][k % 3], px * s, py * s, pz * s, g));
    return g;
  };
  /** 아래로 늘어지는 덩굴 */
  const vine = (x: number, y: number, z: number, length: number, parent?: THREE.Object3D) => {
    for (let k = 0; k * 0.085 < length; k++) {
      ball(0.045 - k * 0.0012, k % 2 ? 0x8fc97c : 0x6aa85a, x + Math.sin(k * 1.3) * 0.035, y - k * 0.085, z + Math.cos(k * 1.7) * 0.02, parent).castShadow = false;
    }
  };
  /** 벽에 건 액자 */
  const frame = (x: number, y: number, w: number, h: number, colors: number[]) => {
    box(w + 0.12, h + 0.12, 0.05, WOOD, x, y, back + 0.03);
    box(w, h, 0.052, colors[0], x, y, back + 0.032);
    if (colors[1] !== undefined) box(w, h * 0.42, 0.054, colors[1], x, y - h * 0.29, back + 0.033);
    if (colors[2] !== undefined) ball(Math.min(w, h) * 0.16, colors[2], x + w * 0.12, y - h * 0.05, back + 0.04).scale.z = 0.2;
  };

  const { halfW, back, front, height } = ROOM;
  const depth = front - back;
  const midZ = (front + back) / 2;

  // ── 바닥, 벽, 천장 ─────────────────────────────
  box(halfW * 2, 0.2, depth, 0xe7b583, 0, -0.1, midZ).castShadow = false;
  for (let k = 1; k < 16; k++) box(0.015, 0.004, depth, 0xcf9b68, -halfW + k * 0.5, 0.002, midZ).castShadow = false;
  box(halfW * 2 + 0.4, 0.2, depth + 0.4, CREAM, 0, height + 0.1, midZ);
  // 창문이 있는 뒷벽: 창 둘레를 네 조각으로 막는다
  const winW = WINDOW.x1 - WINDOW.x0;
  const winH = WINDOW.y1 - WINDOW.y0;
  const winX = (WINDOW.x0 + WINDOW.x1) / 2;
  const winY = (WINDOW.y0 + WINDOW.y1) / 2;
  box(WINDOW.x0 + halfW, height, 0.2, WALL, (-halfW + WINDOW.x0) / 2, height / 2, back - 0.1);
  box(halfW - WINDOW.x1, height, 0.2, WALL, (halfW + WINDOW.x1) / 2, height / 2, back - 0.1);
  box(winW, WINDOW.y0, 0.2, WALL, winX, WINDOW.y0 / 2, back - 0.1);
  box(winW, height - WINDOW.y1, 0.2, WALL, winX, (height + WINDOW.y1) / 2, back - 0.1);
  box(0.2, height, depth + 0.4, WALL, -halfW - 0.1, height / 2, midZ);
  box(0.2, height, depth + 0.4, WALL, halfW + 0.1, height / 2, midZ);
  box(halfW * 2, height, 0.2, WALL, 0, height / 2, front + 0.1);
  // 걸레받이
  box(WINDOW.x0 + halfW, 0.12, 0.04, WOOD_LIGHT, (-halfW + WINDOW.x0) / 2, 0.06, back + 0.02);
  box(0.04, 0.12, depth, WOOD_LIGHT, -halfW + 0.02, 0.06, midZ);
  box(0.04, 0.12, depth, WOOD_LIGHT, halfW - 0.02, 0.06, midZ);

  // ── 창문, 커튼 ─────────────────────────────────
  box(winW + 0.24, 0.12, 0.26, WOOD, winX, WINDOW.y1 + 0.04, back - 0.04);
  box(winW + 0.5, 0.09, 0.44, WOOD, winX, WINDOW.y0 - 0.03, back + 0.06);
  for (const x of [WINDOW.x0, WINDOW.x1]) box(0.12, winH, 0.14, WOOD, x, winY, back - 0.04);
  box(0.1, winH, 0.12, WOOD, winX, winY, back - 0.04);
  box(winW, 0.08, 0.1, WOOD, winX, WINDOW.y0 + winH * 0.62, back - 0.04);
  for (const x of [WINDOW.x0 + winW * 0.25, WINDOW.x0 + winW * 0.75]) box(0.045, winH, 0.07, WOOD, x, winY, back - 0.04);
  box(winW + 1.3, 0.05, 0.05, WOOD_DARK, winX, WINDOW.y1 + 0.2, back + 0.2);
  const sheer = mat(0xfffaf3, { transparent: true, opacity: 0.82, roughness: 1 });
  // 왼쪽 커튼은 곧게, 오른쪽 커튼은 가운데를 묶었다
  add(new THREE.BoxGeometry(0.62, winH + 0.75, 0.05), sheer).position.set(WINDOW.x0 - 0.1, winY - 0.18, back + 0.2);
  add(new THREE.BoxGeometry(0.6, 1.25, 0.05), sheer).position.set(WINDOW.x1 + 0.12, WINDOW.y1 - 0.42, back + 0.2);
  add(new THREE.BoxGeometry(0.34, 0.3, 0.07), sheer).position.set(WINDOW.x1 + 0.2, 1.62, back + 0.2);
  add(new THREE.BoxGeometry(0.56, 1.45, 0.05), sheer).position.set(WINDOW.x1 + 0.14, 0.76, back + 0.2);
  box(0.36, 0.06, 0.09, 0xf9c5d8, WINDOW.x1 + 0.2, 1.62, back + 0.2);

  // ── 창밖: 하늘, 언덕, 벚나무 ───────────────────
  const sky = add(new THREE.PlaneGeometry(90, 50), new THREE.MeshBasicMaterial({ color: 0x8ecbf3 }));
  materials.set('sky', sky.material as THREE.Material);
  sky.position.set(winX, 8, back - 22);
  sky.castShadow = sky.receiveShadow = false;
  const outside = (m: THREE.Mesh) => {
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  };
  outside(box(90, 0.4, 24, 0xbfe3a8, winX, -0.4, back - 11.5));
  outside(ball(7, 0xcdeab2, winX - 6, -4.2, back - 14));
  outside(ball(9, 0xb7dd9e, winX + 8, -5.6, back - 16));
  [
    [-1.6, -3.4, 1.0],
    [0.9, -4.6, 1.25],
    [3.1, -3.6, 0.95],
    [-4.2, -6.5, 1.2],
    [5.6, -6.0, 1.3],
  ].forEach(([tx, tz, s], t) => {
    const tree = sub(winX + tx, 0, back + tz);
    outside(cylinder(0.16 * s, 0.26 * s, 2.6 * s, 0x9b6b4a, 0, 1.3 * s, 0, tree));
    [
      [0, 3.0, 0, 1.15],
      [-0.95, 2.6, 0.15, 0.85],
      [0.95, 2.65, -0.1, 0.9],
      [0.3, 3.75, -0.2, 0.8],
      [-0.5, 3.5, 0.25, 0.7],
      [1.45, 2.05, 0.2, 0.6],
      [-1.4, 2.0, -0.2, 0.62],
    ].forEach(([bx, by, bz, r], k) => {
      outside(ball(r * s, [0xf9c5d8, 0xfbd3e1, 0xf7b3cc][(k + t) % 3], bx * s, by * s, bz * s, tree));
    });
  });
  // 구름
  [
    [-2.5, 7.5, 1.3],
    [3.5, 9, 1.6],
  ].forEach(([cx, cy, s]) => {
    for (const [dx, dy, r] of [[0, 0, 1], [1, -0.1, 0.75], [-1, -0.15, 0.7], [0.45, 0.4, 0.7]]) {
      const cloud = add(new THREE.SphereGeometry(r * s, 14, 10), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35 }));
      cloud.position.set(winX + cx + dx * s, cy + dy * s, back - 20);
      cloud.scale.z = 0.3;
      outside(cloud);
    }
  });

  // ── 뒷벽 왼쪽: 선반, 액자 ──────────────────────
  const shelfY = 2.52;
  box(3.9, 0.06, 0.34, WOOD, -2.0, shelfY, back + 0.17);
  for (const x of [-3.6, -2.0, -0.4]) box(0.05, 0.22, 0.26, WOOD_DARK, x, shelfY - 0.14, back + 0.14);
  // 선반 위: 책, 등불, 화분과 덩굴
  let bx = -3.85;
  [0.3, 0.26, 0.33, 0.28, 0.31, 0.25, 0.3].forEach((h, k) => {
    const w = 0.07 + (k % 3) * 0.015;
    box(w, h, 0.22, PASTELS[(k * 3 + 1) % PASTELS.length], bx + w / 2, shelfY + 0.03 + h / 2, back + 0.17);
    bx += w + 0.008;
  });
  const lantern = sub(-2.55, shelfY + 0.03, back + 0.18);
  box(0.2, 0.03, 0.2, 0x6b5340, 0, 0.015, 0, lantern);
  add(new THREE.BoxGeometry(0.15, 0.24, 0.15), mat(0xffe2a6, { emissive: 0xffc56b, emissiveIntensity: 1.4 }), lantern).position.y = 0.15;
  for (const [lx, lz] of [[-0.085, -0.085], [0.085, -0.085], [-0.085, 0.085], [0.085, 0.085]]) box(0.02, 0.26, 0.02, 0x6b5340, lx, 0.15, lz, lantern);
  box(0.22, 0.03, 0.22, 0x6b5340, 0, 0.29, 0, lantern);
  cylinder(0.02, 0.07, 0.07, 0x6b5340, 0, 0.34, 0, lantern);
  const glow = new THREE.PointLight(0xffd9a0, 2.2, 3.5);
  glow.position.set(-2.55, shelfY + 0.2, back + 0.35);
  group.add(glow);
  plant(-1.95, shelfY + 0.03, back + 0.18, 0.42);
  plant(-1.2, shelfY + 0.03, back + 0.18, 0.5);
  plant(-0.5, shelfY + 0.03, back + 0.18, 0.36);
  vine(-1.3, shelfY, back + 0.33, 0.8);
  vine(-1.08, shelfY, back + 0.33, 0.5);
  vine(-0.42, shelfY, back + 0.33, 0.62);
  vine(-3.9, shelfY + 0.2, back + 0.3, 0.95);
  // 선반 아래: 풍경화 두 점과 꽃 그림 두 점
  frame(-3.78, 1.72, 0.32, 0.86, [0xbfe0f5, 0xcfe6a8]);
  frame(-2.5, 1.72, 1.55, 1.0, [0xbfe0f5, 0xcfe6a8, 0xfff3d6]);
  frame(-1.2, 2.02, 0.4, 0.52, [0xfdf6ec, 0xcfe6a8, 0xf9c5d8]);
  frame(-1.2, 1.36, 0.4, 0.52, [0xfdf6ec, 0xcfe6a8, 0xf48fb1]);

  // ── 작업 책상 (뒷벽 왼쪽) ──────────────────────
  const desk = sub(-2.75, 0, back + 0.48);
  box(2.5, 0.08, 0.82, WOOD, 0, 0.86, 0, desk);
  box(2.3, 0.12, 0.05, WOOD_DARK, 0, 0.76, 0.34, desk);
  for (const [lx, lz] of [[-1.15, -0.33], [1.15, -0.33], [-1.15, 0.33], [1.15, 0.33]]) box(0.09, 0.82, 0.09, WOOD_DARK, lx, 0.41, lz, desk);
  box(2.3, 0.05, 0.6, WOOD_LIGHT, 0, 0.28, 0, desk);
  // 붓통 세 개
  [
    [-1.05, 0.02, 0xfdfdfd],
    [-0.82, -0.12, 0xf3ece0],
    [0.02, -0.14, 0xfdfdfd],
  ].forEach(([jx, jz, c], j) => {
    cylinder(0.085, 0.075, 0.22, c, jx, 1.01, jz, desk);
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7 + j;
      const brush = cylinder(0.011, 0.011, 0.3, WOOD_DARK, jx + Math.cos(a) * 0.035, 1.2, jz + Math.sin(a) * 0.035, desk);
      brush.rotation.set(Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
      ball(0.024, PASTELS[(k + j * 2) % 7], jx + Math.cos(a) * 0.065, 1.35, jz + Math.sin(a) * 0.065, desk);
    }
  });
  // 유리 꽃병과 꽃다발
  const vase = sub(-0.42, 0.9, -0.05, desk);
  add(new THREE.CylinderGeometry(0.13, 0.11, 0.42, 24), mat(0xdff1f7, { transparent: true, opacity: 0.55, roughness: 0.2 }), vase).position.y = 0.21;
  for (const [sx, sz] of [[-0.03, 0], [0.03, 0.02], [0, -0.03]]) cylinder(0.008, 0.008, 0.55, 0x6aa85a, sx, 0.3, sz, vase);
  [
    [0, 0.72, 0, 0.15, 0xf9c5d8],
    [-0.17, 0.62, 0.05, 0.13, 0xffffff],
    [0.17, 0.64, 0.03, 0.13, 0xf48fb1],
    [0.05, 0.6, 0.16, 0.12, 0xcfe3f5],
    [-0.06, 0.6, -0.15, 0.12, 0xffffff],
    [-0.24, 0.48, -0.06, 0.1, 0xcfe3f5],
    [0.25, 0.5, -0.08, 0.1, 0xffffff],
    [0.1, 0.84, -0.04, 0.1, 0xffffff],
    [-0.1, 0.82, 0.06, 0.1, 0xf48fb1],
    [0.3, 0.42, 0.1, 0.08, 0x8fc97c],
    [-0.3, 0.4, 0.1, 0.08, 0x8fc97c],
    [0, 0.44, 0.2, 0.08, 0x7cb86a],
  ].forEach(([fx, fy, fz, r, c]) => ball(r, c, fx, fy, fz, vase));
  // 고양이 장식
  const cat = sub(0.42, 0.9, -0.08, desk);
  ball(0.12, 0xfffaf2, 0, 0.11, 0, cat).scale.set(1, 0.95, 0.85);
  ball(0.1, 0xfffaf2, 0, 0.28, 0.02, cat);
  ball(0.05, 0xf4a24c, 0.05, 0.33, 0, cat);
  ball(0.06, 0xf4a24c, -0.07, 0.13, 0.03, cat);
  for (const ex of [-0.055, 0.055]) {
    const ear = add(new THREE.ConeGeometry(0.035, 0.07, 10), mat(ex > 0 ? 0xf4a24c : 0xfffaf2), cat);
    ear.position.set(ex, 0.385, 0.02);
    ball(0.011, 0x5b4636, ex * 0.7, 0.29, 0.115, cat);
  }
  ball(0.012, 0xf48fb1, 0, 0.265, 0.12, cat);
  // 팔레트와 물감 튜브
  const paletteDish = cylinder(0.3, 0.3, 0.025, 0xf3e3cf, 0.92, 0.915, 0.08, desk);
  paletteDish.scale.z = 0.72;
  [0xf48fb1, 0xf9d65c, 0x7cb86a, 0x6fb7e9, 0xb388eb, 0xf4a24c, 0xffffff, 0x5cc8b8].forEach((c, k) => {
    const a = (k / 8) * Math.PI * 2;
    cylinder(0.05, 0.05, 0.012, c, Math.cos(a) * 0.19, 0.018, Math.sin(a) * 0.19, paletteDish);
  });
  [0x6fb7e9, 0xf9d65c, 0xf48fb1].forEach((c, k) => {
    const tube = cylinder(0.022, 0.028, 0.16, c, 0.2 + k * 0.07, 0.925, 0.26, desk);
    tube.rotation.set(0, 0.3 * k, Math.PI / 2);
  });

  // ── 책상 앞 바닥: 종이 바구니, 상자, 화분, 나무 상자 ──
  const basket = sub(-2.45, 0, -1.55);
  cylinder(0.3, 0.24, 0.42, 0xcfa26b, 0, 0.21, 0, basket);
  cylinder(0.31, 0.31, 0.04, 0xb9874c, 0, 0.42, 0, basket);
  [
    [-0.1, 0.05, 0.2],
    [0.08, -0.06, -0.18],
    [0.02, 0.12, 0.05],
    [-0.02, -0.1, -0.3],
  ].forEach(([rx, rz, tilt]) => {
    const roll = cylinder(0.055, 0.055, 0.62, 0xfdfbf5, rx, 0.52, rz, basket);
    roll.rotation.set(tilt * 0.6, 0, tilt);
  });
  const boxes = sub(-3.5, 0, -0.75);
  box(0.62, 0.3, 0.46, 0x7f9fc6, 0, 0.15, 0, boxes).rotation.y = 0.12;
  box(0.56, 0.24, 0.42, 0x9fbde0, 0.02, 0.42, 0, boxes).rotation.y = -0.1;
  box(0.58, 0.03, 0.44, 0xe9f0f8, 0.02, 0.555, 0, boxes).rotation.y = -0.1;
  plant(-3.45, 0, 0.55, 1.15);
  box(0.7, 0.38, 0.5, WOOD_LIGHT, -3.5, 0.19, 1.85).rotation.y = 0.08;
  box(0.72, 0.04, 0.52, WOOD, -3.5, 0.4, 1.85).rotation.y = 0.08;

  // ── 이젤 ───────────────────────────────────────
  const easel = sub(EASEL.x, 0, EASEL.z);
  easel.rotation.y = EASEL.turn;
  for (const x of [-0.42, 0.42]) {
    const leg = box(0.07, 1.95, 0.07, WOOD, x * 1.15, 0.95, 0.12, easel);
    leg.rotation.set(-0.1, 0, x > 0 ? 0.1 : -0.1);
  }
  box(0.07, 1.95, 0.07, WOOD_DARK, 0, 0.95, -0.44, easel).rotation.x = 0.28;
  box(0.86, 0.06, 0.05, WOOD_DARK, 0, 0.42, 0.09, easel);
  // 뒤로 살짝 젖혀진 부분: 받침 선반, 기둥, 캔버스 판
  const tilt = sub(0, 0.88, 0.1, easel);
  tilt.rotation.x = -0.13;
  box(1.4, 0.06, 0.17, WOOD, 0, 0, 0.05, tilt);
  box(0.09, 1.4, 0.05, WOOD_DARK, 0, 0.64, -0.04, tilt);
  const clamp = box(0.34, 0.1, 0.1, WOOD, 0, 0, 0.02, tilt);
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

  // ── 의자: 캔버스 정면에 놓는다 ─────────────────
  const facing = { x: Math.sin(EASEL.turn), z: Math.cos(EASEL.turn) };
  const stoolAt = { x: EASEL.x + facing.x * 1.32, z: EASEL.z + facing.z * 1.32 };
  const stool = sub(stoolAt.x, 0, stoolAt.z);
  const cushionTop = cylinder(0.31, 0.31, 0.11, 0xfff3df, 0, 0.53, 0, stool);
  cushionTop.scale.y = 1;
  cylinder(0.29, 0.27, 0.05, WOOD, 0, 0.45, 0, stool);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = cylinder(0.03, 0.036, 0.46, WOOD_DARK, Math.cos(a) * 0.21, 0.22, Math.sin(a) * 0.21, stool);
    leg.rotation.set(Math.sin(a) * 0.13, 0, -Math.cos(a) * 0.13);
  }
  cylinder(0.2, 0.2, 0.025, WOOD_DARK, 0, 0.17, 0, stool);

  // ── 깔개 ───────────────────────────────────────
  for (const [w, d, c, y] of [[4.0, 2.8, 0xeed9e2, 0.008], [3.7, 2.5, 0xfbf1ee, 0.011], [3.0, 1.8, 0xf3e1ea, 0.014], [2.7, 1.5, 0xfdf6f2, 0.017]]) {
    box(w, 0.012, d, c, 0.35, y, 0.05).castShadow = false;
  }

  // ── 물감 수레, 창가 화분 ───────────────────────
  const cart = sub(1.2, 0, back + 0.52);
  for (const [cx, cz] of [[-0.3, -0.19], [0.3, -0.19], [-0.3, 0.19], [0.3, 0.19]]) {
    cylinder(0.014, 0.014, 0.92, 0xe9e6e0, cx, 0.5, cz, cart);
    ball(0.035, 0x8d8a85, cx, 0.035, cz, cart);
  }
  [0.16, 0.5, 0.86].forEach((y, tier) => {
    box(0.66, 0.03, 0.44, 0xfaf8f4, 0, y, 0, cart);
    box(0.66, 0.07, 0.02, 0xfaf8f4, 0, y + 0.04, 0.21, cart);
    box(0.66, 0.07, 0.02, 0xfaf8f4, 0, y + 0.04, -0.21, cart);
    for (let k = 0; k < 6; k++) {
      const h = 0.13 + ((k + tier) % 3) * 0.03;
      cylinder(0.035, 0.04, h, PASTELS[(k * 2 + tier * 3) % 7], -0.25 + (k % 3) * 0.25 + (k > 2 ? 0.1 : 0), y + 0.015 + h / 2, k > 2 ? 0.09 : -0.09, cart);
      cylinder(0.018, 0.018, 0.035, 0xffffff, -0.25 + (k % 3) * 0.25 + (k > 2 ? 0.1 : 0), y + 0.03 + h, k > 2 ? 0.09 : -0.09, cart);
    }
  });
  const stand = sub(0.5, 0, back + 0.42);
  cylinder(0.24, 0.24, 0.04, WOOD, 0, 0.8, 0, stand);
  cylinder(0.035, 0.035, 0.8, WOOD_DARK, 0, 0.4, 0, stand);
  cylinder(0.2, 0.2, 0.03, WOOD_DARK, 0, 0.015, 0, stand);
  plant(0, 0.82, 0, 0.62, stand);

  // ── 창가 찻상 ──────────────────────────────────
  cylinder(0.4, 0.4, 0.05, WOOD, 2.6, 0.4, back + 0.72);
  cylinder(0.05, 0.16, 0.38, WOOD_DARK, 2.6, 0.19, back + 0.72);
  cylinder(0.065, 0.045, 0.085, 0xffffff, 2.5, 0.47, back + 0.78);
  cylinder(0.11, 0.1, 0.13, 0xf9c5d8, 2.74, 0.49, back + 0.66);
  cylinder(0.03, 0.03, 0.02, 0xf9c5d8, 2.74, 0.565, back + 0.66);

  // ── 책장 (오른쪽 벽) ───────────────────────────
  const shelf = sub(halfW - 0.27, 0, -1.65);
  const shelfLen = 1.9;
  const shelfH = 2.55;
  box(0.5, shelfH, 0.06, WOOD, 0, shelfH / 2, -shelfLen / 2, shelf);
  box(0.5, shelfH, 0.06, WOOD, 0, shelfH / 2, shelfLen / 2, shelf);
  box(0.04, shelfH, shelfLen, WOOD_DARK, 0.23, shelfH / 2, 0, shelf);
  for (let row = 0; row < 6; row++) {
    const y = 0.06 + row * 0.49;
    box(0.5, 0.05, shelfLen, WOOD, 0, y, 0, shelf);
    if (row === 5) continue;
    let z = -shelfLen / 2 + 0.06;
    for (let k = 0; z < shelfLen / 2 - 0.16; k++) {
      const seed = (row * 7 + k * 13) % 11;
      const w = 0.065 + (seed % 4) * 0.018;
      const h = 0.27 + (seed % 5) * 0.03;
      // 셋째 칸 가운데는 토끼 인형, 둘째 칸 끝은 꽃병 자리로 비워 둔다
      const reserved = (row === 3 && z > -0.25 && z < 0.3) || (row === 2 && z > 0.45);
      if (seed === 5 || reserved) {
        z += 0.12;
        continue;
      }
      box(0.3, h, w, PASTELS[(row * 3 + k) % PASTELS.length], -0.05, y + 0.025 + h / 2, z + w / 2, shelf);
      z += w + 0.01;
    }
  }
  // 토끼 인형
  const plush = sub(-0.08, 0.06 + 3 * 0.49 + 0.025, 0.03, shelf);
  plush.rotation.y = -Math.PI / 2;
  ball(0.1, 0xfffaf2, 0, 0.1, 0, plush);
  ball(0.085, 0xfffaf2, 0, 0.24, 0.01, plush);
  for (const ex of [-0.04, 0.04]) {
    const ear = add(new THREE.CapsuleGeometry(0.022, 0.1, 4, 8), mat(0xfffaf2), plush);
    ear.position.set(ex, 0.37, 0);
    ball(0.01, 0x5b4636, ex * 0.75, 0.25, 0.085, plush);
    ball(0.035, 0xfffaf2, ex * 2, 0.06, 0.07, plush);
  }
  box(0.11, 0.035, 0.03, 0xf48fb1, 0, 0.165, 0.085, plush);
  // 흰 꽃을 꽂은 작은 꽃병
  const smallVase = sub(-0.06, 0.06 + 2 * 0.49 + 0.025, 0.7, shelf);
  cylinder(0.05, 0.065, 0.14, 0xdff1f7, 0, 0.07, 0, smallVase);
  [[0, 0.24, 0], [0.06, 0.2, 0.03], [-0.06, 0.2, -0.02], [0.02, 0.19, -0.06], [-0.02, 0.27, 0.04]].forEach(([fx, fy, fz]) => ball(0.04, 0xffffff, fx, fy, fz, smallVase));
  // 책장 위: 작은 액자와 덩굴 화분
  box(0.04, 0.3, 0.26, WOOD, 0, shelfH + 0.2, 0.45, shelf).rotation.z = 0.15;
  box(0.045, 0.22, 0.18, 0xf9c5d8, -0.005, shelfH + 0.2, 0.45, shelf).rotation.z = 0.15;
  plant(0, shelfH + 0.03, -0.45, 0.45, shelf);
  vine(-0.22, shelfH, -0.6, 0.7, shelf);
  vine(-0.22, shelfH, -0.3, 0.45, shelf);

  // ── 방석 ───────────────────────────────────────
  const pouf = ball(0.42, 0xf9d65c, 2.95, 0.13, 0.35);
  pouf.scale.y = 0.36;
  ball(0.05, 0xe9bd3e, 2.95, 0.27, 0.35).scale.y = 0.4;

  // ── 문 (앞벽) ──────────────────────────────────
  const door = sub(DOOR_X, 0, front);
  box(1.24, 2.26, 0.1, WOOD_DARK, 0, 1.13, -0.03, door);
  box(1.0, 2.1, 0.08, WOOD, 0, 1.05, -0.07, door);
  for (const [py, ph] of [[1.52, 0.9], [0.52, 0.72]]) box(0.74, ph, 0.03, WOOD_LIGHT, 0, py, -0.11, door);
  ball(0.045, 0xf2c94c, -0.37, 1.02, -0.14, door);
  cylinder(0.02, 0.02, 0.06, 0xf2c94c, -0.37, 1.02, -0.11, door).rotation.x = Math.PI / 2;
  box(1.3, 0.014, 0.7, 0xc98f6a, 0, 0.008, -0.5, door).castShadow = false;
  box(1.1, 0.016, 0.5, 0xe3b08a, 0, 0.01, -0.5, door).castShadow = false;
  // 문 옆: 옷걸이와 작은 액자
  const rack = sub(DOOR_X + 1.25, 0, front - 0.04);
  box(0.7, 0.1, 0.04, WOOD, 0, 1.75, 0, rack);
  for (const hx of [-0.24, 0, 0.24]) cylinder(0.018, 0.018, 0.1, WOOD_DARK, hx, 1.75, -0.06, rack).rotation.x = Math.PI / 2;
  box(0.34, 0.62, 0.06, 0xf7b6c8, -0.24, 1.42, -0.08, rack); // 걸어 둔 앞치마
  box(0.56, 0.72, 0.05, WOOD, DOOR_X - 1.35, 1.7, front - 0.03);
  box(0.44, 0.6, 0.052, 0xcfe6a8, DOOR_X - 1.35, 1.7, front - 0.032);
  ball(0.09, 0xf9c5d8, DOOR_X - 1.35, 1.72, front - 0.06).scale.z = 0.2;

  // ── 조명 ───────────────────────────────────────
  group.add(new THREE.HemisphereLight(0xfff6e8, 0xe9c9a4, 1.15));
  group.add(new THREE.AmbientLight(0xfff3e4, 0.5));
  // 방 안을 은은하게 밝히는 등 (그림자 없음)
  const fill = new THREE.PointLight(0xffe7c8, 6, 0, 1.6);
  fill.position.set(0.3, height - 0.5, 0.8);
  group.add(fill);
  const fillFront = new THREE.PointLight(0xffe7c8, 5, 0, 1.6);
  fillFront.position.set(0.3, height - 0.5, 4.2);
  group.add(fillFront);
  // 창밖에서 들어오는 햇빛
  const sun = new THREE.DirectionalLight(0xffe6bd, 2.4);
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
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  group.add(sun, sun.target);

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
      { x: 2.6, z: back + 0.72, r: 0.52 },
      { x: halfW - 0.2, z: -1.65, r: 1.05 },
      { x: 2.95, z: 0.35, r: 0.48 },
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
    stool: {
      approach: { x: stoolAt.x + 0.78, z: stoolAt.z + 0.3 },
      seat: new THREE.Vector3(stoolAt.x, 0.585, stoolAt.z),
      heading: EASEL.turn + Math.PI,
    },
    board,
    setBoardAspect,
    hotspots: [
      { id: 'easel', label: '이젤', icon: '🎨', position: new THREE.Vector3(EASEL.x, 2.12, EASEL.z), available: true },
      { id: 'stool', label: '의자', icon: '🪑', position: new THREE.Vector3(stoolAt.x, 0.9, stoolAt.z), available: true },
      { id: 'window', label: '창가에서 차 마시기', icon: '☕', position: new THREE.Vector3(2.6, 0.9, back + 0.72), available: false },
      { id: 'bookshelf', label: '책 읽기', icon: '📖', position: new THREE.Vector3(halfW - 0.55, 1.75, -1.65), available: false },
    ],
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
