/** 화면 좌표의 사각형. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 그림의 배치: 화면 픽셀 = 그림 픽셀 * scale + (x, y). */
export interface Placement {
  scale: number;
  x: number;
  y: number;
}

/** 줌 배율. 1 = 그림 전체가 화면에 맞는 크기. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 그림 전체가 avail 안에 들어오는 배율. */
export function fitScale(avail: Rect, width: number, height: number): number {
  const w = Math.max(1, avail.right - avail.left);
  const h = Math.max(1, avail.bottom - avail.top);
  return Math.min(w / width, h / height);
}

function clampAxis(pos: number, size: number, lo: number, hi: number): number {
  const room = hi - lo;
  // 그림이 더 작으면 가운데, 더 크면 가장자리가 안쪽으로 들어오지 않게.
  if (size <= room) return lo + (room - size) / 2;
  return Math.min(lo, Math.max(hi - size, pos));
}

/** 그림이 avail 밖으로 벗어나 빈 공간이 생기지 않게 위치를 고친다. */
export function clampPlacement(p: Placement, avail: Rect, width: number, height: number): Placement {
  return {
    scale: p.scale,
    x: clampAxis(p.x, width * p.scale, avail.left, avail.right),
    y: clampAxis(p.y, height * p.scale, avail.top, avail.bottom),
  };
}

/** 화면의 (anchorX, anchorY) 아래에 있는 그림 위치가 그대로 유지되도록 배율을 바꾼다. */
export function scaleAround(p: Placement, anchorX: number, anchorY: number, scale: number): Placement {
  const k = scale / p.scale;
  return {
    scale,
    x: anchorX - (anchorX - p.x) * k,
    y: anchorY - (anchorY - p.y) * k,
  };
}
