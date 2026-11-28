import type { Rgb } from './engine/PaintEngine';

/** 종이 색 (ColoringView 가 깔아 두는 바탕) */
export const PAPER_RGB: Rgb = [0xff, 0xfd, 0xf8];
/** 종이와 이만큼 (RGB 거리) 가까운 물감은 칠해도 잘 안 보인다 */
export const LOW_CONTRAST_DISTANCE = 45;

/** 이 물감은 종이 위에서 잘 안 보이는가 (흰색, 아주 옅은 색) */
export function isLowContrast(color: Rgb, paper: Rgb = PAPER_RGB): boolean {
  return Math.hypot(color[0] - paper[0], color[1] - paper[1], color[2] - paper[2]) < LOW_CONTRAST_DISTANCE;
}
