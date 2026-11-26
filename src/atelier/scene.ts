import type { Point, SceneRect } from './geometry';

export type HotspotId = 'easel' | 'stool' | 'window' | 'bookshelf';

export interface Hotspot {
  id: HotspotId;
  label: string;
  icon: string;
  /** 누를 수 있는 영역 */
  rect: SceneRect;
  /** 표시를 놓을 자리 */
  marker: Point;
  /** false 면 아직 준비 중인 활동 */
  available: boolean;
}

/**
 * 화실 장면 정의. 화실 화면과 색칠 화면 배경이 같은 정의를 쓴다 (R9).
 * 좌표는 배경 그림의 픽셀 단위다.
 */
export interface AtelierLayout {
  width: number;
  height: number;
  background: string;
  /** 캐릭터가 걸을 수 있는 바닥 */
  walkArea: Point[];
  /** 입장할 때 걸어 들어오는 출발점(화면 밖)과 도착점 */
  entry: Point;
  spawn: Point;
  stool: {
    /** 의자 앞에 서는 자리 */
    approach: Point;
    /** 앉았을 때 캐릭터의 발 위치 */
    seat: Point;
  };
  /** 이젤 위 캔버스가 있는 부분. 색칠 화면은 이 부분이 종이 뒤에 오도록 장면을 확대한다. */
  easelFocus: SceneRect;
  hotspots: Hotspot[];
}

/**
 * 임시 화실. 배경은 기획 참고 이미지(docs/reference/atelier-room.webp)를 그대로 쓴다.
 * 실제 에셋이 준비되면 이 정의와 public/atelier/ 의 그림만 바꾸면 된다.
 */
export const PLACEHOLDER_ATELIER: AtelierLayout = {
  width: 1672,
  height: 941,
  background: `${import.meta.env.BASE_URL}atelier/room.webp`,
  walkArea: [
    { x: 600, y: 790 },
    { x: 1560, y: 790 },
    { x: 1650, y: 932 },
    { x: 470, y: 932 },
  ],
  entry: { x: 1800, y: 900 },
  spawn: { x: 1230, y: 880 },
  stool: {
    approach: { x: 1010, y: 905 },
    seat: { x: 852, y: 700 },
  },
  easelFocus: { x: 568, y: 318, width: 300, height: 225 },
  hotspots: [
    {
      id: 'easel',
      label: '이젤',
      icon: '🎨',
      rect: { x: 560, y: 270, width: 320, height: 345 },
      marker: { x: 716, y: 430 },
      available: true,
    },
    {
      id: 'stool',
      label: '의자',
      icon: '🪑',
      rect: { x: 735, y: 635, width: 235, height: 260 },
      marker: { x: 852, y: 668 },
      available: true,
    },
    {
      id: 'window',
      label: '창가에서 차 마시기',
      icon: '☕',
      rect: { x: 1040, y: 330, width: 380, height: 300 },
      marker: { x: 1230, y: 560 },
      available: false,
    },
    {
      id: 'bookshelf',
      label: '책 읽기',
      icon: '📖',
      rect: { x: 1490, y: 200, width: 182, height: 520 },
      marker: { x: 1575, y: 470 },
      available: false,
    },
  ],
};
