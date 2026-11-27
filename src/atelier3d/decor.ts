// 화실의 꾸민 상태. 방을 만드는 함수가 이 데이터를 읽어 그리므로,
// 화실 화면과 색칠 화면 배경이 같은 꾸밈을 보여 준다 (R9).
// 꾸미기 화면은 나중에 추가된다: 그때는 이 데이터를 바꿔 저장하기만 하면 된다.

/** 벽에 그림을 걸 수 있는 자리 */
export const PICTURE_SLOTS = ['back-left', 'back-large', 'back-small-top', 'back-small-bottom', 'door-near', 'door-far'] as const;
export type PictureSlot = (typeof PICTURE_SLOTS)[number];

/** 코드로 그려 둔 기본 그림 */
export const BUILTIN_PICTURES = ['meadow', 'hills', 'pink-flowers', 'rose-flowers', 'lilac-flowers'] as const;
export type BuiltinPicture = (typeof BUILTIN_PICTURES)[number];

/** 액자에 거는 그림: 기본 그림, 또는 색칠 그림의 완성 예시 */
export type PictureRef = { kind: 'builtin'; id: BuiltinPicture } | { kind: 'painting'; paintingId: string };

export interface AtelierDecor {
  version: 1;
  pictures: Record<PictureSlot, PictureRef>;
}

export const DEFAULT_DECOR: AtelierDecor = {
  version: 1,
  pictures: {
    'back-left': { kind: 'builtin', id: 'hills' },
    'back-large': { kind: 'builtin', id: 'meadow' },
    'back-small-top': { kind: 'builtin', id: 'pink-flowers' },
    'back-small-bottom': { kind: 'builtin', id: 'rose-flowers' },
    'door-near': { kind: 'painting', paintingId: 'hill-house' },
    'door-far': { kind: 'builtin', id: 'lilac-flowers' },
  },
};

const PAINTING_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const STORAGE_KEY = 'metelier.decor';

function parsePicture(raw: unknown): PictureRef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'builtin' && (BUILTIN_PICTURES as readonly unknown[]).includes(value.id)) {
    return { kind: 'builtin', id: value.id as BuiltinPicture };
  }
  if (value.kind === 'painting' && typeof value.paintingId === 'string' && PAINTING_ID.test(value.paintingId)) {
    return { kind: 'painting', paintingId: value.paintingId };
  }
  return null;
}

/** 저장된 값을 믿을 수 있는 꾸밈 데이터로 고친다. 빠졌거나 잘못된 자리는 기본값으로 채운다. */
export function normalizeDecor(raw: unknown): AtelierDecor {
  const saved = typeof raw === 'object' && raw !== null ? ((raw as { pictures?: unknown }).pictures ?? {}) : {};
  const pictures = { ...DEFAULT_DECOR.pictures };
  if (typeof saved === 'object' && saved !== null) {
    for (const slot of PICTURE_SLOTS) {
      const picture = parsePicture((saved as Record<string, unknown>)[slot]);
      if (picture) pictures[slot] = picture;
    }
  }
  return { version: 1, pictures };
}

export function loadDecor(): AtelierDecor {
  try {
    return normalizeDecor(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return normalizeDecor(null);
  }
}

export function saveDecor(decor: AtelierDecor): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decor));
  } catch {
    // 저장할 수 없는 환경이면 이번 접속 동안만 유지된다.
  }
}
