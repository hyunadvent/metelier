import * as THREE from 'three';

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

export interface Ground {
  x: number;
  z: number;
}

/**
 * 3D 화실. 화실 화면(3인칭 시점)과 색칠 화면 배경(이젤 앞 시점)이 같은 함수로 방을 만든다 (R9).
 * 단위는 미터, 바닥은 y = 0, 창문이 있는 벽은 -z 쪽이다.
 */
export interface AtelierRoom {
  group: THREE.Group;
  /** 캐릭터가 걸을 수 있는 범위와 피해야 할 가구 */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: { x: number; z: number; r: number }[];
  /** 입장할 때 걸어 들어오는 출발점(방 밖)과 도착점 */
  entry: Ground;
  spawn: Ground;
  stool: { approach: Ground; seat: THREE.Vector3 };
  /** 이젤 위의 캔버스 판. 색칠 화면에서는 이 판 자리에 종이가 겹쳐진다. */
  board: THREE.Mesh;
  /** 캔버스 판의 세로 길이 (미터) */
  boardHeight: number;
  /** 캔버스 판의 가로세로 비율을 그림에 맞춘다. */
  setBoardAspect(aspect: number): void;
  hotspots: Hotspot3D[];
  dispose(): void;
}

const ROOM = { halfW: 4.5, back: -3.5, front: 3.5, height: 3.4 };
const WINDOW = { x0: -0.4, x1: 3.6, y0: 0.9, y1: 2.9 };
const EASEL = { x: -1.6, z: -1.3 };
const STOOL = { x: -1.6, z: -0.05 };
const BOARD_HEIGHT = 0.78;

/**
 * 임시 3D 화실을 기본 도형으로 만든다.
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
    const mesh = add(new THREE.CylinderGeometry(rTop, rBottom, h, 28), mat(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const ball = (r: number, color: number, x: number, y: number, z: number, parent?: THREE.Object3D) => {
    const mesh = add(new THREE.SphereGeometry(r, 20, 14), mat(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  };

  const WOOD = 0xd9a56c;
  const WOOD_DARK = 0xb9793f;
  const WALL = 0xfff1df;
  const { halfW, back, front, height } = ROOM;
  const depth = front - back;
  const midZ = (front + back) / 2;

  // ── 바닥, 벽 ───────────────────────────────────
  box(halfW * 2, 0.2, depth, 0xe9b98a, 0, -0.1, midZ).castShadow = false;
  for (let k = 0; k < 9; k++) box(0.02, 0.005, depth, 0xd5a070, -halfW + (k + 0.5) * ((halfW * 2) / 9), 0.003, midZ).castShadow = false;
  const rug = cylinder(2.3, 2.3, 0.02, 0xf6dfe4, -0.3, 0.01, 0.5);
  rug.castShadow = false;
  cylinder(1.9, 1.9, 0.022, 0xfdf2ea, -0.3, 0.012, 0.5).castShadow = false;

  // 창문이 있는 뒷벽: 창 둘레를 네 조각으로 막는다
  box(WINDOW.x0 + halfW, height, 0.2, WALL, (-halfW + WINDOW.x0) / 2, height / 2, back - 0.1);
  box(halfW - WINDOW.x1, height, 0.2, WALL, (halfW + WINDOW.x1) / 2, height / 2, back - 0.1);
  box(WINDOW.x1 - WINDOW.x0, WINDOW.y0, 0.2, WALL, (WINDOW.x0 + WINDOW.x1) / 2, WINDOW.y0 / 2, back - 0.1);
  box(WINDOW.x1 - WINDOW.x0, height - WINDOW.y1, 0.2, WALL, (WINDOW.x0 + WINDOW.x1) / 2, (height + WINDOW.y1) / 2, back - 0.1);
  box(0.2, height, depth, WALL, -halfW - 0.1, height / 2, midZ);
  box(0.2, height, depth, WALL, halfW + 0.1, height / 2, midZ);

  // 창틀, 창턱, 커튼
  const winW = WINDOW.x1 - WINDOW.x0;
  const winH = WINDOW.y1 - WINDOW.y0;
  const winX = (WINDOW.x0 + WINDOW.x1) / 2;
  const winY = (WINDOW.y0 + WINDOW.y1) / 2;
  box(winW + 0.16, 0.1, 0.26, WOOD, winX, WINDOW.y1 + 0.03, back - 0.05);
  box(winW + 0.5, 0.08, 0.42, WOOD, winX, WINDOW.y0 - 0.02, back + 0.05);
  for (const x of [WINDOW.x0, winX, WINDOW.x1]) box(0.09, winH, 0.12, WOOD, x, winY, back - 0.05);
  box(winW, 0.07, 0.1, WOOD, winX, winY + 0.25, back - 0.05);
  for (const x of [WINDOW.x0 - 0.12, WINDOW.x1 + 0.12]) {
    const curtain = add(new THREE.BoxGeometry(0.55, winH + 0.6, 0.06), mat(0xfffaf4, { transparent: true, opacity: 0.9 }));
    curtain.position.set(x, winY - 0.1, back + 0.16);
  }
  box(winW + 1.5, 0.06, 0.06, WOOD_DARK, winX, WINDOW.y1 + 0.28, back + 0.16);

  // 창밖: 하늘과 벚나무
  const sky = add(new THREE.PlaneGeometry(40, 16), new THREE.MeshBasicMaterial({ color: 0x9fd4f5 }));
  materials.set('sky', sky.material as THREE.Material);
  sky.position.set(winX, 5, back - 9);
  sky.castShadow = sky.receiveShadow = false;
  const hill = ball(9, 0xbfe3a8, winX, -7.2, back - 6);
  hill.castShadow = false;
  cylinder(0.22, 0.3, 3.2, 0x9b6b4a, winX + 0.9, 1.2, back - 3.2);
  [
    [0.9, 3.3, -3.2, 1.25],
    [-0.1, 2.9, -3.0, 0.95],
    [1.9, 2.9, -3.4, 1.0],
    [0.6, 4.1, -3.5, 0.9],
    [-1.3, 2.3, -3.6, 0.8],
    [2.9, 2.2, -3.9, 0.85],
  ].forEach(([x, y, z, r], k) => {
    ball(r, k % 2 ? 0xf9c5d8 : 0xfbd3e1, winX + x, y, back + z).castShadow = false;
  });

  // ── 이젤 ───────────────────────────────────────
  const easel = new THREE.Group();
  easel.position.set(EASEL.x, 0, EASEL.z);
  group.add(easel);
  for (const x of [-0.42, 0.42]) {
    const leg = box(0.07, 1.9, 0.07, WOOD, x * 1.15, 0.93, 0.12, easel);
    leg.rotation.set(-0.1, 0, x > 0 ? 0.1 : -0.1);
  }
  box(0.07, 1.9, 0.07, WOOD_DARK, 0, 0.93, -0.42, easel).rotation.x = 0.28;
  // 뒤로 살짝 젖혀진 부분: 받침 선반, 기둥, 캔버스 판
  const tilt = new THREE.Group();
  tilt.position.set(0, 0.86, 0.1);
  tilt.rotation.x = -0.13;
  easel.add(tilt);
  box(1.36, 0.06, 0.16, WOOD, 0, 0, 0.05, tilt);
  box(0.09, 1.35, 0.05, WOOD_DARK, 0, 0.62, -0.04, tilt);
  const clamp = box(0.36, 0.09, 0.1, WOOD, 0, 0, 0.02, tilt);
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
    clamp.position.y = 0.03 + h + 0.045;
  };
  setBoardAspect(4 / 3);

  // ── 의자 ───────────────────────────────────────
  const stool = new THREE.Group();
  stool.position.set(STOOL.x, 0, STOOL.z);
  group.add(stool);
  cylinder(0.3, 0.3, 0.1, 0xfff1dc, 0, 0.5, 0, stool);
  cylinder(0.27, 0.27, 0.04, WOOD, 0, 0.43, 0, stool);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = cylinder(0.03, 0.035, 0.44, WOOD_DARK, Math.cos(a) * 0.2, 0.21, Math.sin(a) * 0.2, stool);
    leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
  }

  // ── 작업 책상 (왼쪽) ───────────────────────────
  box(1.7, 0.08, 0.8, WOOD, -3.55, 0.82, -2.3);
  for (const [x, z] of [[-4.3, -2.6], [-2.8, -2.6], [-4.3, -2.0], [-2.8, -2.0]]) box(0.08, 0.8, 0.08, WOOD_DARK, x, 0.4, z);
  cylinder(0.1, 0.09, 0.24, 0xfdfdfd, -4.0, 0.98, -2.4);
  cylinder(0.1, 0.09, 0.24, 0xcfe3f5, -3.72, 0.98, -2.45);
  for (const [x, c] of [[-4.03, 0xf48fb1], [-3.97, 0x6fb7e9], [-3.74, 0xf9d65c], [-3.69, 0x7cb86a]] as const) {
    cylinder(0.012, 0.012, 0.3, WOOD_DARK, x, 1.2, -2.42).rotation.z = (x % 0.1) * 3;
    ball(0.028, c, x, 1.36, -2.42);
  }
  const paletteDish = cylinder(0.3, 0.3, 0.03, 0xf3e3cf, -3.15, 0.875, -2.2);
  [0xf48fb1, 0xf9d65c, 0x7cb86a, 0x6fb7e9, 0xb388eb, 0xf4a24c].forEach((c, k) => {
    const a = (k / 6) * Math.PI * 2;
    cylinder(0.06, 0.06, 0.012, c, Math.cos(a) * 0.17, 0.02, Math.sin(a) * 0.17, paletteDish);
  });
  // 선반과 액자 (왼쪽 벽)
  box(0.3, 0.05, 2.2, WOOD, -4.33, 2.25, -1.6);
  cylinder(0.11, 0.09, 0.18, 0xf2efe9, -4.33, 2.37, -2.3);
  ball(0.19, 0x7cb86a, -4.33, 2.58, -2.3);
  box(0.22, 0.3, 0.16, 0x6fb7e9, -4.33, 2.43, -1.5);
  box(0.22, 0.26, 0.14, 0xf48fb1, -4.33, 2.41, -1.3);
  for (const [z, w, c] of [[-0.3, 0.9, 0xbfe3a8], [0.9, 0.6, 0xf9c5d8]] as const) {
    box(0.05, w * 0.75 + 0.1, w + 0.1, WOOD, -4.47, 1.75, z);
    box(0.052, w * 0.75, w, c, -4.46, 1.75, z);
  }

  // ── 창가 찻상 ──────────────────────────────────
  cylinder(0.42, 0.42, 0.05, WOOD, 2.3, 0.42, -2.55);
  cylinder(0.05, 0.16, 0.4, WOOD_DARK, 2.3, 0.2, -2.55);
  cylinder(0.07, 0.05, 0.09, 0xffffff, 2.2, 0.49, -2.5);
  cylinder(0.11, 0.1, 0.14, 0xf9c5d8, 2.45, 0.52, -2.62);
  const cushion = ball(0.36, 0xf9d65c, 1.55, 0.1, -2.2);
  cushion.scale.y = 0.35;

  // ── 책장 (오른쪽 벽) ───────────────────────────
  const shelf = new THREE.Group();
  shelf.position.set(4.2, 0, -1.4);
  group.add(shelf);
  box(0.5, 2.3, 0.06, WOOD, 0, 1.15, -0.9, shelf);
  box(0.5, 2.3, 0.06, WOOD, 0, 1.15, 0.9, shelf);
  box(0.04, 2.3, 1.8, WOOD_DARK, 0.23, 1.15, 0, shelf);
  const bookColors = [0x6fb7e9, 0xf48fb1, 0xf9d65c, 0x7cb86a, 0xb388eb, 0xf4a24c, 0x5cc8b8, 0xfff8e7];
  for (let row = 0; row < 5; row++) {
    const y = 0.06 + row * 0.56;
    box(0.5, 0.05, 1.8, WOOD, 0, y, 0, shelf);
    if (row === 4) continue;
    let z = -0.82;
    for (let k = 0; z < 0.72; k++) {
      const seed = (row * 7 + k * 13) % 11;
      const w = 0.07 + (seed % 4) * 0.02;
      const h = 0.32 + (seed % 5) * 0.035;
      if (seed === 5) {
        z += 0.22; // 빈 칸
        continue;
      }
      box(0.3, h, w, bookColors[(row * 3 + k) % bookColors.length], -0.05, y + 0.025 + h / 2, z + w / 2, shelf);
      z += w + 0.012;
    }
  }

  // ── 화분 ───────────────────────────────────────
  for (const [x, z, s] of [[3.9, 1.3, 0.9], [-4.0, 1.9, 0.8]]) {
    cylinder(0.26 * s, 0.2 * s, 0.4 * s, 0xf2efe9, x, 0.2 * s, z);
    ball(0.42 * s, 0x7cb86a, x, 0.72 * s, z);
    ball(0.3 * s, 0x8fc97c, x + 0.2 * s, 0.98 * s, z - 0.1 * s);
    ball(0.26 * s, 0x6aa85a, x - 0.22 * s, 0.9 * s, z + 0.12 * s);
  }

  // ── 조명 ───────────────────────────────────────
  group.add(new THREE.HemisphereLight(0xfff6e8, 0xe7c7a2, 1.5));
  group.add(new THREE.AmbientLight(0xffffff, 0.55));
  // 창밖에서 들어오는 햇빛
  const sun = new THREE.DirectionalLight(0xffe9c7, 2.6);
  sun.position.set(winX + 3.5, 7, back - 5.5);
  sun.target.position.set(winX - 1.6, 0, 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 24;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  group.add(sun, sun.target);

  return {
    group,
    bounds: { minX: -4.0, maxX: 4.0, minZ: -2.9, maxZ: 3.1 },
    obstacles: [
      { x: EASEL.x, z: EASEL.z - 0.1, r: 0.85 },
      { x: STOOL.x, z: STOOL.z, r: 0.42 },
      { x: -3.55, z: -2.3, r: 1.05 },
      { x: 2.3, z: -2.55, r: 0.6 },
      { x: 4.1, z: -1.4, r: 1.0 },
      { x: 3.9, z: 1.3, r: 0.5 },
      { x: -4.0, z: 1.9, r: 0.45 },
    ],
    entry: { x: 2.6, z: 5.6 },
    spawn: { x: 0.9, z: 1.3 },
    stool: { approach: { x: STOOL.x + 0.75, z: STOOL.z + 0.25 }, seat: new THREE.Vector3(STOOL.x, 0.55, STOOL.z) },
    board,
    boardHeight: BOARD_HEIGHT,
    setBoardAspect,
    hotspots: [
      { id: 'easel', label: '이젤', icon: '🎨', position: new THREE.Vector3(EASEL.x, 2.0, EASEL.z), available: true },
      { id: 'stool', label: '의자', icon: '🪑', position: new THREE.Vector3(STOOL.x, 0.85, STOOL.z), available: true },
      { id: 'window', label: '창가에서 차 마시기', icon: '☕', position: new THREE.Vector3(2.3, 0.95, -2.55), available: false },
      { id: 'bookshelf', label: '책 읽기', icon: '📖', position: new THREE.Vector3(3.95, 2.6, -1.4), available: false },
    ],
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
