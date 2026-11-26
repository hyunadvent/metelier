// 3D 화실에서 캐릭터가 걷는 규칙. three.js 와 무관한 순수 계산이다.

export interface Ground {
  x: number;
  z: number;
}

export interface WalkArea {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: { x: number; z: number; r: number }[];
}

/** 점이 가구 안에 있으면 가구 밖으로 밀어낸다. */
export function pushOutOfObstacles(p: Ground, area: WalkArea, margin = 0): Ground {
  let { x, z } = p;
  for (const o of area.obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    const dist = Math.hypot(dx, dz);
    const r = o.r + margin;
    if (dist >= r) continue;
    if (dist < 1e-6) {
      z = o.z + r; // 한가운데면 방 앞쪽으로
    } else {
      x = o.x + (dx / dist) * r;
      z = o.z + (dz / dist) * r;
    }
  }
  return { x, z };
}

/** 걸어갈 목적지를 걸을 수 있는 범위 안, 가구 밖으로 고친다. */
export function clampDestination(p: Ground, area: WalkArea): Ground {
  const { minX, maxX, minZ, maxZ } = area.bounds;
  const inside = { x: Math.min(maxX, Math.max(minX, p.x)), z: Math.min(maxZ, Math.max(minZ, p.z)) };
  return pushOutOfObstacles(inside, area, 0.05);
}

/**
 * 목적지를 향해 한 걸음 옮긴다. 가구에 부딪히면 가구 둘레를 따라 미끄러진다.
 * @returns 새 위치와, 목적지에 닿았는지
 */
export function stepToward(from: Ground, to: Ground, distance: number, area: WalkArea): { position: Ground; arrived: boolean } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const remaining = Math.hypot(dx, dz);
  if (remaining <= distance) return { position: { ...to }, arrived: true };
  const next = { x: from.x + (dx / remaining) * distance, z: from.z + (dz / remaining) * distance };
  return { position: pushOutOfObstacles(next, area), arrived: false };
}
