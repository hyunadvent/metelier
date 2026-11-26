export interface Point {
  x: number;
  y: number;
}

export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 장면의 배치: 화면 픽셀 = 장면 좌표 * scale + (x, y). */
export interface ScenePlacement {
  scale: number;
  x: number;
  y: number;
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 점이 다각형 밖이면 가장 가까운 가장자리 안쪽으로 옮긴다. */
export function clampToPolygon(p: Point, polygon: Point[]): Point {
  if (pointInPolygon(p, polygon)) return p;
  let best = polygon[0];
  let bestDist = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  // 가장자리 위에 정확히 놓이지 않도록 다각형 중심 쪽으로 조금 당긴다.
  const cx = polygon.reduce((s, v) => s + v.x, 0) / polygon.length;
  const cy = polygon.reduce((s, v) => s + v.y, 0) / polygon.length;
  const len = Math.hypot(cx - best.x, cy - best.y) || 1;
  return { x: best.x + (cx - best.x) / len, y: best.y + (cy - best.y) / len };
}

/**
 * 화실 화면의 카메라: 장면이 화면을 꽉 채우도록 맞추고(바닥 기준),
 * 장면이 화면보다 넓으면 focusX(캐릭터 위치)가 가운데 오도록 좌우로 따라간다.
 */
export function roomPlacement(sceneW: number, sceneH: number, screenW: number, screenH: number, focusX: number): ScenePlacement {
  const scale = Math.max(screenW / sceneW, screenH / sceneH);
  const x = Math.min(0, Math.max(screenW - sceneW * scale, screenW / 2 - focusX * scale));
  return { scale, x, y: screenH - sceneH * scale };
}

/**
 * 색칠 화면의 카메라: 장면의 이젤 부분(focus)이 화면의 종이(paper) 뒤에 같은 크기로 오게 한다.
 * 그 배율로 화면 가장자리가 비면 화면이 꽉 찰 때까지 더 키운다.
 */
export function easelPlacement(
  sceneW: number,
  sceneH: number,
  focus: SceneRect,
  paper: SceneRect,
  screenW: number,
  screenH: number,
): ScenePlacement {
  const fx = focus.x + focus.width / 2;
  const fy = focus.y + focus.height / 2;
  const cx = paper.x + paper.width / 2;
  const cy = paper.y + paper.height / 2;
  const scale = Math.max(
    paper.width / focus.width,
    cx / fx,
    (screenW - cx) / (sceneW - fx),
    cy / fy,
    (screenH - cy) / (sceneH - fy),
  );
  return { scale, x: cx - fx * scale, y: cy - fy * scale };
}
