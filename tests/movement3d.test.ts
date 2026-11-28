import { describe, expect, it } from 'vitest';
import {
  approachCamera,
  clampDestination,
  fovForAspect,
  stickFrom,
  distanceInsideBox,
  isOnCharacter,
  JUMP_GRAVITY,
  JUMP_SPEED,
  pushOutOfObstacles,
  shortestTurn,
  stepJump,
  stepToward,
  type WalkArea,
} from '../src/atelier3d/movement';

const AREA: WalkArea = {
  bounds: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 },
  obstacles: [{ x: 0, z: 0, r: 1 }],
};

describe('3D 화실 이동', () => {
  it('가구 안의 점은 가구 밖으로 밀어낸다', () => {
    const p = pushOutOfObstacles({ x: 0.5, z: 0 }, AREA);
    expect(p.x).toBeCloseTo(1);
    expect(p.z).toBeCloseTo(0);
    expect(pushOutOfObstacles({ x: 2, z: 2 }, AREA)).toEqual({ x: 2, z: 2 });
    expect(Math.hypot(...Object.values(pushOutOfObstacles({ x: 0, z: 0 }, AREA)))).toBeCloseTo(1);
  });

  it('목적지는 걸을 수 있는 범위 안, 가구 밖으로 고친다', () => {
    expect(clampDestination({ x: 99, z: -99 }, AREA)).toEqual({ x: 4, z: -3 });
    const p = clampDestination({ x: 0.2, z: 0.1 }, AREA);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(1);
  });

  it('목적지까지 남은 거리가 한 걸음보다 짧으면 도착한다', () => {
    const { position, arrived } = stepToward({ x: 2, z: 2 }, { x: 2.05, z: 2 }, 0.1, AREA);
    expect(arrived).toBe(true);
    expect(position).toEqual({ x: 2.05, z: 2 });
  });

  it('가구 건너편으로 갈 때 가구를 돌아서 도착한다', () => {
    let position = { x: -3, z: 0.2 };
    const target = { x: 3, z: 0.2 };
    let arrived = false;
    for (let k = 0; k < 400 && !arrived; k++) {
      ({ position, arrived } = stepToward(position, target, 0.05, AREA));
      expect(Math.hypot(position.x, position.z)).toBeGreaterThanOrEqual(1 - 1e-6);
    }
    expect(arrived).toBe(true);
  });
});

describe('카메라를 방 안에 두기', () => {
  const box = { minX: -4, maxX: 4, minY: 0.3, maxY: 3, minZ: -3, maxZ: 6 };

  it('벽에 닿지 않으면 원하는 거리 그대로', () => {
    expect(distanceInsideBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box, 5)).toBe(5);
  });

  it('벽이나 천장에 닿으면 그 앞에서 멈춘다', () => {
    expect(distanceInsideBox({ x: 0, y: 1, z: 3 }, { x: 0, y: 0, z: 1 }, box, 5)).toBeCloseTo(3);
    expect(distanceInsideBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, box, 5)).toBeCloseTo(2);
    expect(distanceInsideBox({ x: 3, y: 1, z: 0 }, { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }, box, 5)).toBeCloseTo(Math.SQRT2);
  });

  it('어느 방향으로 보아도 카메라는 상자 안에 있다', () => {
    const origin = { x: 3.2, y: 0.9, z: 2.5 };
    for (let az = -1; az <= 1; az += 0.25) {
      for (let polar = 0.95; polar <= 1.42; polar += 0.1) {
        const d = { x: Math.sin(polar) * Math.sin(az), y: Math.cos(polar), z: Math.sin(polar) * Math.cos(az) };
        const t = distanceInsideBox(origin, d, box, 5.3);
        const p = { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t };
        expect(p.x).toBeLessThanOrEqual(box.maxX + 1e-9);
        expect(p.x).toBeGreaterThanOrEqual(box.minX - 1e-9);
        expect(p.y).toBeLessThanOrEqual(box.maxY + 1e-9);
        expect(p.z).toBeLessThanOrEqual(box.maxZ + 1e-9);
      }
    }
  });
});

describe('카메라 시점 옮기기', () => {
  it('좌우 방향은 가까운 쪽으로 돈다', () => {
    expect(shortestTurn(0.1, 0.3)).toBeCloseTo(0.2);
    expect(shortestTurn(6.2, 0.1)).toBeCloseTo(0.1 + (Math.PI * 2 - 6.2));
    expect(shortestTurn(0.1, 6.2)).toBeCloseTo(-(0.1 + (Math.PI * 2 - 6.2)));
    // 여러 바퀴 돈 상태에서도 한 바퀴 안쪽으로만 돈다
    expect(Math.abs(shortestTurn(13, 0.3))).toBeLessThanOrEqual(Math.PI);
  });

  it('조금씩 다가가 목표 시점에 도착한다', () => {
    let pose = { azimuth: 7.5, polar: 1.3, distance: 5.3 };
    const goal = { azimuth: 0.1, polar: 0.97, distance: 2.6 };
    let arrived = false;
    for (let k = 0; k < 400 && !arrived; k++) ({ pose, arrived } = approachCamera(pose, goal, 0.07));
    expect(arrived).toBe(true);
    expect(pose.polar).toBe(goal.polar);
    expect(pose.distance).toBe(goal.distance);
    // 방향은 같은 곳을 보지만, 돌아온 바퀴 수는 그대로다
    expect(shortestTurn(pose.azimuth, goal.azimuth)).toBeCloseTo(0);
    expect(Math.abs(pose.azimuth - 7.5)).toBeLessThanOrEqual(Math.PI);
  });

  it('amount 가 0 이면 움직이지 않는다', () => {
    const pose = { azimuth: 1, polar: 1.2, distance: 4 };
    expect(approachCamera(pose, { azimuth: 2, polar: 1, distance: 3 }, 0).pose).toEqual(pose);
  });
});

describe('점프', () => {
  it('뛰어올랐다가 바닥으로 돌아온다', () => {
    let jump = { height: 0, velocity: JUMP_SPEED };
    let peak = 0;
    let time = 0;
    for (let k = 0; k < 400; k++) {
      jump = stepJump(jump, 1 / 120);
      time += 1 / 120;
      peak = Math.max(peak, jump.height);
      if (jump.height === 0) break;
    }
    expect(jump).toEqual({ height: 0, velocity: 0 });
    // 가장 높이 뜬 높이는 v² / 2g, 떠 있는 시간은 2v / g 에 가깝다
    expect(peak).toBeCloseTo(JUMP_SPEED ** 2 / (2 * JUMP_GRAVITY), 1);
    expect(time).toBeCloseTo((2 * JUMP_SPEED) / JUMP_GRAVITY, 1);
  });

  it('바닥에 서 있으면 그대로 있다', () => {
    expect(stepJump({ height: 0, velocity: 0 }, 0.016)).toEqual({ height: 0, velocity: 0 });
  });
});

describe('캐릭터 누르기', () => {
  const feet = { x: 400, y: 500 };
  const head = { x: 400, y: 380 };

  it('몸과 머리, 그 둘레의 여유까지 캐릭터로 본다', () => {
    expect(isOnCharacter({ x: 400, y: 440 }, feet, head, 30)).toBe(true); // 몸 가운데
    expect(isOnCharacter({ x: 425, y: 385 }, feet, head, 30)).toBe(true); // 머리 옆
    expect(isOnCharacter({ x: 440, y: 450 }, feet, head, 30)).toBe(true); // 반지름 밖이지만 여유 안
    expect(isOnCharacter({ x: 400, y: 540 }, feet, head, 30)).toBe(true); // 발 바로 아래
  });

  it('떨어진 곳은 캐릭터가 아니다', () => {
    expect(isOnCharacter({ x: 460, y: 440 }, feet, head, 30)).toBe(false);
    expect(isOnCharacter({ x: 400, y: 320 }, feet, head, 30)).toBe(false);
    expect(isOnCharacter({ x: 400, y: 560 }, feet, head, 30)).toBe(false);
  });
});

describe('터치 조작', () => {
  it('조이스틱은 끈 거리를 반지름으로 나눈 만큼 기울고, 끝까지 끌면 길이가 1 이다', () => {
    const half = stickFrom({ x: 100, y: 100 }, { x: 100, y: 72 }, 56);
    expect(half.x).toBeCloseTo(0);
    expect(half.y).toBeCloseTo(-0.5);
    const far = stickFrom({ x: 0, y: 0 }, { x: 300, y: 400 }, 56);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1);
    expect(far.x / far.y).toBeCloseTo(0.75);
  });

  it('아주 조금 끈 것은 움직이지 않는다', () => {
    expect(stickFrom({ x: 0, y: 0 }, { x: 3, y: 2 }, 56)).toEqual({ x: 0, y: 0 });
  });

  it('가로 화면은 기본 시야각을, 세로로 긴 화면은 넓힌 시야각을 쓴다', () => {
    expect(fovForAspect(16 / 9)).toBe(42);
    const portrait = fovForAspect(375 / 812);
    expect(portrait).toBeGreaterThan(42);
    expect(portrait).toBeLessThanOrEqual(62);
    expect(fovForAspect(1)).toBeGreaterThan(42);
    expect(fovForAspect(1)).toBeLessThan(portrait);
  });
});
