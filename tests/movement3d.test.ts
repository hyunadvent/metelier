import { describe, expect, it } from 'vitest';
import { clampDestination, distanceInsideBox, pushOutOfObstacles, stepToward, type WalkArea } from '../src/atelier3d/movement';

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
