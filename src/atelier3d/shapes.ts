// 상자·원기둥·공보다 부드러운 모양을 만드는 도우미.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** 모서리가 둥근 상자 */
export function roundedBox(width: number, height: number, depth: number, radius = 0.02): THREE.BufferGeometry {
  const r = Math.min(radius, width / 2 - 1e-4, height / 2 - 1e-4, depth / 2 - 1e-4);
  return r > 0.002 ? new RoundedBoxGeometry(width, height, depth, 3, r) : new THREE.BoxGeometry(width, height, depth);
}

/**
 * 옆모습(단면)을 한 바퀴 돌려 만드는 모양: 꽃병, 화분, 컵, 방석처럼 둥근 물건.
 * @param profile [반지름, 높이] 를 아래에서 위로 이은 점들
 */
export function lathe(profile: [number, number][], segments = 28): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
    segments,
  );
}

/** 점들을 부드러운 곡선으로 이어 단면을 만든다 (방석처럼 통통한 모양에 쓴다). */
export function smoothProfile(points: [number, number][], steps = 24): [number, number][] {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints(steps).map((p) => [p.x, p.y]);
}

export interface CurtainOptions {
  /** 주름 수 */
  folds: number;
  /** 주름의 깊이 (미터) */
  depth: number;
  /** 묶은 높이 (0 = 아래, 1 = 위). 없으면 곧게 내려온다. */
  tieAt?: number;
  /** 묶은 곳의 폭 (원래 폭 대비 0~1) */
  tieWidth?: number;
  /** 묶을 때 쏠리는 방향: -1 왼쪽, 1 오른쪽 */
  tieSide?: -1 | 1;
}

/** 주름진 커튼. 원점은 위쪽 가운데이고 아래로 늘어진다. */
export function curtainGeometry(width: number, height: number, options: CurtainOptions): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 56, 28);
  const position = geometry.attributes.position;
  const { folds, depth, tieAt, tieWidth = 0.4, tieSide = 1 } = options;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const u = x / width + 0.5;
    const v = y / height + 0.5;
    // 묶은 높이에서 가장 좁고, 위아래로 갈수록 다시 퍼진다
    let spread = 1;
    if (tieAt !== undefined) {
      const d = (v - tieAt) / 0.2;
      spread = 1 - (1 - tieWidth) * Math.exp(-d * d);
    }
    // 아래로 갈수록 주름이 조금 벌어진다
    const hang = 1 + (1 - v) * 0.08;
    const shift = tieAt !== undefined ? tieSide * (1 - spread) * width * 0.28 : 0;
    position.setX(i, x * spread * hang + shift);
    position.setY(i, y - height / 2);
    position.setZ(i, Math.sin(u * folds * Math.PI * 2) * depth * (0.45 + 0.55 * spread));
  }
  geometry.computeVertexNormals();
  return geometry;
}
