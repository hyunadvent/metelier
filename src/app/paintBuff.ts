/**
 * 색칠 버프: 창가에서 차를 마시고 잠시 쉬면 걸린다. 걸려 있는 동안 붓이 칠하는 범위가 넓어진다.
 * 화실과 색칠 화면이 함께 보는 값이라 이 파일 안에 둔다 (새로 접속하면 사라진다).
 */

/** 차를 이만큼 마시면 버프가 걸린다 (초) */
export const TEA_BUFF_AFTER_S = 5;
/** 버프가 유지되는 시간 (밀리초) */
export const PAINT_BUFF_MS = 60_000;
/** 버프가 걸려 있을 때 붓 범위 배율 */
export const PAINT_BUFF_SCALE = 2;

let until = 0;
const listeners = new Set<() => void>();

/** 버프를 건다. 이미 걸려 있으면 지금부터 다시 1분이다. */
export function grantPaintBuff(now = Date.now()): void {
  until = now + PAINT_BUFF_MS;
  listeners.forEach((fn) => fn());
}

/** 버프가 남은 시간 (밀리초). 걸려 있지 않으면 0. */
export function paintBuffLeft(now = Date.now()): number {
  return Math.max(0, until - now);
}

/** 지금 붓 범위 배율 */
export function brushScale(now = Date.now()): number {
  return paintBuffLeft(now) > 0 ? PAINT_BUFF_SCALE : 1;
}

/** 버프가 새로 걸렸을 때 알린다. 돌려주는 함수로 그만 듣는다. */
export function onPaintBuff(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 시험용 */
export function clearPaintBuff(): void {
  until = 0;
}

/**
 * 차를 마신 시간이 이번 프레임에 기준을 넘었는가 (한 번 앉아서 마시는 동안 한 번만 참이다).
 * @param before 이번 프레임 전까지 마신 시간 (초)
 * @param after 이번 프레임까지 마신 시간 (초)
 */
export function teaBuffReached(before: number, after: number, threshold = TEA_BUFF_AFTER_S): boolean {
  return before < threshold && after >= threshold;
}
