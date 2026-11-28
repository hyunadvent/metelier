import { MAX_WALL_PICTURES, PICTURE_SLOTS, PLANT_SLOTS, type AtelierDecor, type WallPicture } from './decor';

/**
 * 꾸밈을 조각마다 언제 바꿨는지의 기록.
 * 꾸밈 전체를 한 덩어리로 "나중 것이 이긴다" 로 맞추면, 다른 기기에서 화분 하나만 바꿔도
 * 이 기기에서 건 그림이 통째로 사라진다. 그래서 화분 자리, 액자 자리, 벽 그림 하나하나를 따로 맞춘다.
 *
 * 열쇠: "plant:<자리>", "picture:<자리>", "wall:<벽 그림 ID>", "palette:colors" (나만의 물감 전체)
 */
export interface DecorStamps {
  /** 그 조각을 마지막으로 바꾼(걸거나 옮긴) 때 */
  changed: Record<string, number>;
  /** 벽 그림을 치운 때. 치운 것이 다른 기기에서 되살아나지 않게 한다. */
  removed: Record<string, number>;
}

export const EMPTY_STAMPS: DecorStamps = { changed: {}, removed: {} };

/** 치운 기록을 이보다 오래 두지 않는다 (기록이 끝없이 늘지 않게) */
const KEEP_REMOVED_MS = 180 * 24 * 60 * 60 * 1000;

function stampMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && /^(plant|picture|wall|palette):[a-z0-9-]{1,41}$/.test(key)) out[key] = value;
  }
  return out;
}

export function normalizeStamps(raw: unknown): DecorStamps {
  const source = typeof raw === 'object' && raw !== null ? (raw as { changed?: unknown; removed?: unknown }) : {};
  return { changed: stampMap(source.changed), removed: stampMap(source.removed) };
}

const sameWall = (a: WallPicture, b: WallPicture) =>
  a.paintingId === b.paintingId && a.frame === b.frame && (a.size ?? 'medium') === (b.size ?? 'medium') && a.z === b.z && a.y === b.y;

/** 꾸밈을 prev 에서 next 로 바꿨을 때, 바뀐 조각의 기록을 남긴다. */
export function stampChanges(prev: AtelierDecor, next: AtelierDecor, stamps: DecorStamps, now: number): DecorStamps {
  const changed = { ...stamps.changed };
  const removed = { ...stamps.removed };
  for (const slot of PLANT_SLOTS) if (prev.plants[slot] !== next.plants[slot]) changed[`plant:${slot}`] = now;
  for (const slot of PICTURE_SLOTS) {
    if (JSON.stringify(prev.pictures[slot]) !== JSON.stringify(next.pictures[slot])) changed[`picture:${slot}`] = now;
  }
  if (JSON.stringify(prev.colors ?? []) !== JSON.stringify(next.colors ?? [])) changed['palette:colors'] = now;
  const before = new Map(prev.wall.map((p) => [p.id, p]));
  const after = new Set(next.wall.map((p) => p.id));
  for (const p of next.wall) {
    const old = before.get(p.id);
    if (!old || !sameWall(old, p)) {
      changed[`wall:${p.id}`] = now;
      delete removed[`wall:${p.id}`];
    }
  }
  for (const p of prev.wall) {
    if (!after.has(p.id)) {
      removed[`wall:${p.id}`] = now;
      delete changed[`wall:${p.id}`];
    }
  }
  return { changed, removed };
}

export interface StampedDecor {
  decor: AtelierDecor;
  stamps: DecorStamps;
}

/**
 * 두 기기의 꾸밈을 합친다. 조각마다 나중에 바꾼 쪽을 따른다.
 * - 한쪽에만 있는 벽 그림은 남긴다. 다른 쪽에서 그보다 나중에 치웠을 때만 없앤다.
 * - 기록이 없는(같은 때인) 조각은 `prefer` 쪽을 따른다.
 */
export function mergeDecor(a: StampedDecor, b: StampedDecor, prefer: 'a' | 'b', now = Date.now()): StampedDecor {
  const [first, second] = prefer === 'a' ? [a, b] : [b, a];
  const time = (side: StampedDecor, key: string) => side.stamps.changed[key] ?? 0;
  const pick = <T>(key: string, fromFirst: T, fromSecond: T): T => (time(second, key) > time(first, key) ? fromSecond : fromFirst);

  const plants = { ...first.decor.plants };
  for (const slot of PLANT_SLOTS) plants[slot] = pick(`plant:${slot}`, first.decor.plants[slot], second.decor.plants[slot]);
  const pictures = { ...first.decor.pictures };
  for (const slot of PICTURE_SLOTS) pictures[slot] = pick(`picture:${slot}`, first.decor.pictures[slot], second.decor.pictures[slot]);

  const changed: Record<string, number> = { ...first.stamps.changed };
  for (const [key, t] of Object.entries(second.stamps.changed)) changed[key] = Math.max(changed[key] ?? 0, t);
  const removed: Record<string, number> = {};
  for (const side of [first, second]) {
    for (const [key, t] of Object.entries(side.stamps.removed)) if (now - t < KEEP_REMOVED_MS) removed[key] = Math.max(removed[key] ?? 0, t);
  }

  // 벽 그림: 먼저 따르는 쪽의 순서대로, 다른 쪽에만 있는 것은 뒤에 붙인다
  const firstWall = new Map(first.decor.wall.map((p) => [p.id, p]));
  const secondWall = new Map(second.decor.wall.map((p) => [p.id, p]));
  const ids = [...first.decor.wall.map((p) => p.id), ...second.decor.wall.map((p) => p.id).filter((id) => !firstWall.has(id))];
  const wall: WallPicture[] = [];
  const seenPaintings = new Set<string>();
  for (const id of ids) {
    const key = `wall:${id}`;
    const p1 = firstWall.get(id);
    const p2 = secondWall.get(id);
    const chosen = p1 && p2 ? pick(key, p1, p2) : (p1 ?? p2)!;
    const presentAt = Math.max(p1 ? time(first, key) : 0, p2 ? time(second, key) : 0);
    if ((removed[key] ?? 0) > presentAt) continue;
    // 같은 작품은 벽에 한 번만 건다 (두 기기에서 따로 걸었을 때)
    if (seenPaintings.has(chosen.paintingId)) continue;
    if (wall.length >= MAX_WALL_PICTURES) break;
    seenPaintings.add(chosen.paintingId);
    wall.push(chosen);
  }
  for (const p of wall) delete removed[`wall:${p.id}`];

  const colors = pick('palette:colors', first.decor.colors ?? [], second.decor.colors ?? []);

  return { decor: { version: 1, pictures, plants, wall, ...(colors.length ? { colors } : {}) }, stamps: { changed, removed } };
}

/** 두 꾸밈이 같은가 (기록까지) */
export function sameStampedDecor(a: StampedDecor, b: StampedDecor): boolean {
  return JSON.stringify(a.decor) === JSON.stringify(b.decor) && JSON.stringify(sortKeys(a.stamps)) === JSON.stringify(sortKeys(b.stamps));
}

function sortKeys(stamps: DecorStamps): DecorStamps {
  const sort = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).sort(([x], [y]) => x.localeCompare(y)));
  return { changed: sort(stamps.changed), removed: sort(stamps.removed) };
}
