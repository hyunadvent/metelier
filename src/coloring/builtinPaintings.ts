/** 처음부터 들어 있는 색칠 그림 (public/paintings/<id>/). 이젤의 고르는 창에 이 차례로 보인다. */
export interface BuiltinPainting {
  id: string;
  title: string;
}

export const BUILTIN_PAINTINGS: BuiltinPainting[] = [
  { id: 'hill-house', title: '언덕 위의 집' },
  { id: 'duck-pond', title: '연못의 오리 가족' },
  { id: 'swallows', title: '하늘을 나는 제비' },
  { id: 'penguins', title: '빙산 위의 펭귄 가족' },
  { id: 'puppy-ball', title: '공놀이하는 강아지' },
];

/** 고르는 창에 보여 줄 작은 그림: 다 칠한 모습 */
export function builtinThumbnail(id: string): string {
  return `${import.meta.env.BASE_URL}paintings/${id}/reference.png`;
}
