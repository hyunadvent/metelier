/**
 * 손가락으로 쓰는 기기(휴대폰, 태블릿)인가.
 * 마우스처럼 정밀하게 가리키지 못하고(pointer: coarse) 올려 두기(hover)가 없으면 터치 기기로 본다.
 * 터치 화면 노트북처럼 마우스도 함께 있으면 PC 로 본다.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
