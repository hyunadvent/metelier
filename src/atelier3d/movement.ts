// 3D 화실에서 캐릭터가 걷는 규칙. three.js 와 무관한 순수 계산이다.

export interface Ground {
  x: number;
  z: number;
}

export interface WalkArea {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: { x: number; z: number; r: number }[];
}

/** 축에 나란한 상자 */
export interface Box3D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * 상자 안의 점 origin 에서 direction 방향으로 상자를 벗어나지 않고 갈 수 있는 가장 먼 거리.
 * 카메라가 벽이나 천장 밖으로 나가지 않도록 당길 때 쓴다. wanted 보다 멀리는 가지 않는다.
 * @param direction 길이 1 의 방향
 */
export function distanceInsideBox(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  box: Box3D,
  wanted: number,
): number {
  let limit = wanted;
  const axes = [
    [origin.x, direction.x, box.minX, box.maxX],
    [origin.y, direction.y, box.minY, box.maxY],
    [origin.z, direction.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, min, max] of axes) {
    if (d > 1e-9) limit = Math.min(limit, (max - o) / d);
    else if (d < -1e-9) limit = Math.min(limit, (min - o) / d);
  }
  return Math.max(0, limit);
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

/** 카메라가 캐릭터를 바라보는 방식: 좌우 방향, 위아래 각도, 거리 */
export interface CameraPose {
  azimuth: number;
  polar: number;
  distance: number;
}

/** 각도 차이를 -π ~ π 로 고친다 (가까운 쪽으로 돌기 위해). */
export function shortestTurn(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * 카메라를 목표 쪽으로 조금 옮긴다. 좌우 방향은 가까운 쪽으로 돈다.
 * @param amount 0 이면 그대로, 1 이면 목표와 같아진다
 * @returns 새 카메라와, 목표에 다 왔는지
 */
export function approachCamera(current: CameraPose, goal: CameraPose, amount: number): { pose: CameraPose; arrived: boolean } {
  const turn = shortestTurn(current.azimuth, goal.azimuth);
  const pose = {
    azimuth: current.azimuth + turn * amount,
    polar: current.polar + (goal.polar - current.polar) * amount,
    distance: current.distance + (goal.distance - current.distance) * amount,
  };
  const arrived =
    Math.abs(shortestTurn(pose.azimuth, goal.azimuth)) < 0.002 &&
    Math.abs(pose.polar - goal.polar) < 0.002 &&
    Math.abs(pose.distance - goal.distance) < 0.005;
  return { pose: arrived ? { ...goal, azimuth: pose.azimuth + shortestTurn(pose.azimuth, goal.azimuth) } : pose, arrived };
}
