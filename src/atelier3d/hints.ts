import type { Activity } from './room';

/** 안내 문구에 나오는 조작. 한 번이라도 해 보면 그 안내는 다시 보이지 않는다. */
export type HintAction = 'walk' | 'look' | 'zoom' | 'jump' | 'continue' | 'pick' | 'standUp';

export interface HintContext {
  activity: Activity | null;
  /** 손가락으로 쓰는 기기인가 */
  touch: boolean;
  /** 이젤 캔버스에 이어 칠할 그림이 있는가 */
  easelPainting: boolean;
}

export interface HintItem {
  action: HintAction;
  text: string;
}

const MOUSE: Record<'walk' | 'look' | 'zoom' | 'jump', string> = {
  walk: '바닥을 누르거나 WASD로 걷기',
  jump: '캐릭터나 스페이스로 점프',
  look: '끌어서 둘러보기',
  zoom: '휠로 확대',
};

const TOUCH: Record<'walk' | 'look' | 'zoom' | 'jump', string> = {
  walk: '왼쪽 끌기: 걷기',
  look: '오른쪽 끌기: 둘러보기',
  zoom: '두 손가락: 확대',
  jump: '캐릭터 누르기: 점프',
};

/** 지금 보여 줄 안내 (이미 해 본 조작은 뺀다). 비면 안내를 숨긴다. */
export function hintItems({ activity, touch, easelPainting }: HintContext, done: ReadonlySet<HintAction>): HintItem[] {
  const items: HintItem[] = [];
  const add = (action: HintAction, text: string) => {
    if (!done.has(action)) items.push({ action, text });
  };
  if (activity === null) {
    const words = touch ? TOUCH : MOUSE;
    add('walk', words.walk);
    add('look', words.look);
    add('zoom', words.zoom);
    add('jump', words.jump);
    if (easelPainting) add('continue', '캔버스를 누르면 이어서 칠해요');
  } else if (activity === 'paint') {
    if (easelPainting) add('continue', '캔버스를 누르면 이어서 칠해요');
    add('pick', easelPainting ? '이젤 표시로 다른 그림 고르기' : '이젤을 눌러 색칠할 그림을 고르세요');
  } else {
    // 차 마시기, 책 읽기: 무엇을 하는지는 늘 보여 주고, 일어나는 법만 익히면 뺀다
    const doing = activity === 'tea' ? '창밖을 보며 차를 마시고 있어요' : '책을 읽고 있어요';
    if (!done.has('standUp')) items.push({ action: 'standUp', text: `${doing} · 바닥을 누르면 일어나요` });
  }
  return items;
}

const STORAGE_KEY = 'metelier.hintsDone';

export function loadHintsDone(): Set<HintAction> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? (raw as HintAction[]) : []);
  } catch {
    return new Set();
  }
}

export function saveHintsDone(done: ReadonlySet<HintAction>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
  } catch {
    // 저장이 안 되는 브라우저(사생활 보호 창 등)면 이번에만 기억한다.
  }
}
