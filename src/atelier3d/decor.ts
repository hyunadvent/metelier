import { notifyLocalChange, notifyRemoteApplied } from '../storage/changes';
import { normalizeStamps, stampChanges, type DecorStamps } from './decorMerge';

// 화실의 꾸민 상태. 방을 만드는 함수가 이 데이터를 읽어 그리므로,
// 화실 화면과 색칠 화면 배경이 같은 꾸밈을 보여 준다 (R9).
// 꾸미기 화면은 나중에 추가된다: 그때는 이 데이터를 바꿔 저장하기만 하면 된다.

/** 벽에 그림을 걸 수 있는 자리 */
export const PICTURE_SLOTS = ['back-left', 'back-large', 'back-small-top', 'back-small-bottom', 'door-near', 'door-far'] as const;
export type PictureSlot = (typeof PICTURE_SLOTS)[number];

/** 코드로 그려 둔 기본 그림 */
export const BUILTIN_PICTURES = ['meadow', 'hills', 'pink-flowers', 'rose-flowers', 'lilac-flowers'] as const;
export type BuiltinPicture = (typeof BUILTIN_PICTURES)[number];

/** 액자에 거는 그림: 기본 그림, 또는 색칠 그림의 완성 예시 */
export type PictureRef = { kind: 'builtin'; id: BuiltinPicture } | { kind: 'painting'; paintingId: string };

/** 화분을 바꿀 수 있는 자리 */
export const PLANT_SLOTS = ['window-stand'] as const;
export type PlantSlot = (typeof PLANT_SLOTS)[number];

/** 고를 수 있는 화분 */
export const PLANT_KINDS = ['leafy', 'tulip', 'cactus'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

export const PLANT_INFO: Record<PlantKind, { icon: string; label: string }> = {
  leafy: { icon: '🌿', label: '초록 잎' },
  tulip: { icon: '🌷', label: '튤립' },
  cactus: { icon: '🌵', label: '선인장' },
};

/** 고를 수 있는 액자. 새로 걸면 첫 번째(나무 액자)로 걸린다. */
export const FRAME_KINDS = ['wood', 'white', 'gold', 'pink'] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];

/** 액자 이름과, 고르는 버튼에 칠할 색 */
export const FRAME_INFO: Record<FrameKind, { label: string; swatch: string }> = {
  wood: { label: '나무 액자', swatch: '#d9a56c' },
  white: { label: '하얀 액자', swatch: '#f7f4ee' },
  gold: { label: '금빛 액자', swatch: '#e0b44c' },
  pink: { label: '분홍 액자', swatch: '#f7b6c8' },
};

/**
 * 이젤 왼쪽 벽(그림 벽)에 건 완성작.
 * 위치는 벽 위의 좌표다: z 는 방의 깊이 방향(창문 쪽이 -), y 는 바닥에서의 높이. 둘 다 그림 가운데의 자리.
 */
export interface WallPicture {
  /** 벽에 건 그림마다 붙는 이름표 */
  id: string;
  /** 완성작(작품집)의 그림 */
  paintingId: string;
  frame: FrameKind;
  z: number;
  y: number;
}

/** 그림 벽에서 액자를 걸 수 있는 범위 (액자의 바깥 테두리 기준). 아래쪽은 바닥 소품 위, 위쪽은 천장 아래. */
export const GALLERY_WALL = { minZ: -2.1, maxZ: 7.1, minY: 1.15, maxY: 3.1 } as const;
/** 벽에 건 그림의 긴 변 (액자 테두리 빼고) */
export const WALL_PICTURE_SIZE = 0.62;
/** 액자 테두리가 그림 둘레에 더하는 폭 (양쪽 합) */
export const FRAME_BORDER = 0.13;
export const MAX_WALL_PICTURES = 16;

/** 그림의 가로세로 비율에 맞춘 그림 크기 (액자 테두리 빼고) */
export function wallPictureSize(aspect: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(4, Math.max(0.25, aspect)) : 1;
  return a >= 1 ? { w: WALL_PICTURE_SIZE, h: WALL_PICTURE_SIZE / a } : { w: WALL_PICTURE_SIZE * a, h: WALL_PICTURE_SIZE };
}

/** 액자가 그림 벽 밖으로 나가지 않도록 그림 가운데의 자리를 고친다. */
export function clampOnWall(z: number, y: number, w: number, h: number): { z: number; y: number } {
  const hw = (w + FRAME_BORDER) / 2;
  const hh = (h + FRAME_BORDER) / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return {
    z: clamp(z, GALLERY_WALL.minZ + hw, GALLERY_WALL.maxZ - hw),
    y: clamp(y, GALLERY_WALL.minY + hh, GALLERY_WALL.maxY - hh),
  };
}

/** 벽 위의 사각형 (가운데와 그림 크기) */
export interface WallRect {
  z: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 새 그림을 걸 빈자리를 찾는다. 다른 액자와 겹치지 않는 자리 가운데 prefer 에 가장 가까운 곳.
 * 빈자리가 없으면 prefer 를 벽 안으로 고친 자리를 돌려준다.
 */
export function findFreeSpot(existing: WallRect[], w: number, h: number, prefer: { z: number; y: number }): { z: number; y: number } {
  const gap = 0.1;
  const overlaps = (z: number, y: number) =>
    existing.some(
      (r) => Math.abs(r.z - z) < (r.w + w) / 2 + FRAME_BORDER + gap && Math.abs(r.y - y) < (r.h + h) / 2 + FRAME_BORDER + gap,
    );
  const start = clampOnWall(prefer.z, prefer.y, w, h);
  if (!overlaps(start.z, start.y)) return start;
  let best: { z: number; y: number } | null = null;
  let bestDistance = Infinity;
  const step = 0.05;
  for (let z = GALLERY_WALL.minZ; z <= GALLERY_WALL.maxZ; z += step) {
    for (let y = GALLERY_WALL.minY; y <= GALLERY_WALL.maxY; y += step) {
      const p = clampOnWall(z, y, w, h);
      if (Math.abs(p.z - z) > 1e-9 || Math.abs(p.y - y) > 1e-9) continue;
      const d = Math.hypot(p.z - start.z, (p.y - start.y) * 1.5);
      if (d < bestDistance && !overlaps(p.z, p.y)) {
        best = p;
        bestDistance = d;
      }
    }
  }
  return best ?? start;
}

export interface AtelierDecor {
  version: 1;
  pictures: Record<PictureSlot, PictureRef>;
  plants: Record<PlantSlot, PlantKind>;
  /** 그림 벽에 건 완성작들 */
  wall: WallPicture[];
}

export const DEFAULT_DECOR: AtelierDecor = {
  version: 1,
  pictures: {
    'back-left': { kind: 'builtin', id: 'hills' },
    'back-large': { kind: 'builtin', id: 'meadow' },
    'back-small-top': { kind: 'builtin', id: 'pink-flowers' },
    'back-small-bottom': { kind: 'builtin', id: 'rose-flowers' },
    'door-near': { kind: 'painting', paintingId: 'hill-house' },
    'door-far': { kind: 'builtin', id: 'lilac-flowers' },
  },
  plants: { 'window-stand': 'leafy' },
  wall: [],
};

const PAINTING_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const WALL_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

function parseWall(raw: unknown): WallPicture[] {
  if (!Array.isArray(raw)) return [];
  const wall: WallPicture[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (wall.length >= MAX_WALL_PICTURES) break;
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.id !== 'string' || !WALL_ID.test(v.id) || seen.has(v.id)) continue;
    if (typeof v.paintingId !== 'string' || !PAINTING_ID.test(v.paintingId)) continue;
    if (typeof v.z !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.z) || !Number.isFinite(v.y)) continue;
    const frame = (FRAME_KINDS as readonly unknown[]).includes(v.frame) ? (v.frame as FrameKind) : 'wood';
    // 그림의 비율을 여기서는 모르므로, 가장 작은 그림이어도 벽 안에 들도록만 고친다
    const z = Math.min(GALLERY_WALL.maxZ, Math.max(GALLERY_WALL.minZ, v.z));
    const y = Math.min(GALLERY_WALL.maxY, Math.max(GALLERY_WALL.minY, v.y));
    seen.add(v.id);
    wall.push({ id: v.id, paintingId: v.paintingId, frame, z, y });
  }
  return wall;
}
const STORAGE_KEY = 'metelier.decor';
/** 꾸밈을 마지막으로 바꾼 때 (동기화가 어느 쪽이 새것인지 가리는 데 쓴다). 한 번도 바꾸지 않았으면 없다. */
const UPDATED_KEY = 'metelier.decor.updatedAt';
/** 조각마다 바꾼 때의 기록 (decorMerge.ts). 다른 기기의 꾸밈과 조각 단위로 합치는 데 쓴다. */
const STAMPS_KEY = 'metelier.decor.stamps';

function parsePicture(raw: unknown): PictureRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'builtin' && (BUILTIN_PICTURES as readonly unknown[]).includes(value.id)) {
    return { kind: 'builtin', id: value.id as BuiltinPicture };
  }
  if (value.kind === 'painting' && typeof value.paintingId === 'string' && PAINTING_ID.test(value.paintingId)) {
    return { kind: 'painting', paintingId: value.paintingId };
  }
  return null;
}

/** 저장된 값을 믿을 수 있는 꾸밈 데이터로 고친다. 빠졌거나 잘못된 자리는 기본값으로 채운다. */
export function normalizeDecor(raw: unknown): AtelierDecor {
  const source = typeof raw === 'object' && raw !== null ? (raw as { pictures?: unknown; plants?: unknown; wall?: unknown }) : {};
  const saved = source.pictures ?? {};
  const pictures = { ...DEFAULT_DECOR.pictures };
  const plants = { ...DEFAULT_DECOR.plants };
  if (typeof source.plants === 'object' && source.plants !== null) {
    for (const slot of PLANT_SLOTS) {
      const kind = (source.plants as Record<string, unknown>)[slot];
      if ((PLANT_KINDS as readonly unknown[]).includes(kind)) plants[slot] = kind as PlantKind;
    }
  }
  if (typeof saved === 'object' && saved !== null) {
    for (const slot of PICTURE_SLOTS) {
      const picture = parsePicture((saved as Record<string, unknown>)[slot]);
      if (picture) pictures[slot] = picture;
    }
  }
  return { version: 1, pictures, plants, wall: parseWall(source.wall) };
}

export function loadDecor(): AtelierDecor {
  try {
    return normalizeDecor(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return normalizeDecor(null);
  }
}

/**
 * 꾸밈을 저장한다.
 * @param fromSync 동기화가 서버에서 받아 쓰는 중이면 그때의 시각. 바뀌었다고 알리지 않는다.
 */
export function saveDecor(decor: AtelierDecor, fromSync?: { updatedAt: number; stamps: DecorStamps }): void {
  const now = Date.now();
  // 직접 꾸민 것이면 바뀐 조각을 기록하고, 동기화가 쓰는 것이면 합친 기록을 그대로 둔다
  const stamps = fromSync ? fromSync.stamps : stampChanges(loadDecor(), decor, loadDecorStamps(), now);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decor));
    localStorage.setItem(UPDATED_KEY, String(fromSync?.updatedAt ?? now));
    localStorage.setItem(STAMPS_KEY, JSON.stringify(stamps));
  } catch {
    // 저장할 수 없는 환경이면 이번 접속 동안만 유지된다.
  }
  if (fromSync) notifyRemoteApplied(new Set(['decor']));
  else notifyLocalChange('decor', 'main');
}

/** 조각마다 바꾼 때의 기록 */
export function loadDecorStamps(): DecorStamps {
  try {
    return normalizeStamps(JSON.parse(localStorage.getItem(STAMPS_KEY) ?? 'null'));
  } catch {
    return normalizeStamps(null);
  }
}

/** 꾸밈을 마지막으로 바꾼 때. 한 번도 바꾸지 않았으면 0 */
export function decorUpdatedAt(): number {
  try {
    const value = Number(localStorage.getItem(UPDATED_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** 꾸밈을 처음 상태로 되돌린다 (다른 사람이 같은 브라우저에서 로그인할 때). */
export function resetDecor(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(UPDATED_KEY);
    localStorage.removeItem(STAMPS_KEY);
  } catch {
    // 지울 수 없으면 그대로 둔다.
  }
}
