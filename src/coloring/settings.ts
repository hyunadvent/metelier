export interface Settings {
  /** 효과음 */
  sound: boolean;
  /** 칸 번호 표시 */
  numbers: boolean;
}

const KEY = 'metelier.settings';
const DEFAULTS: Settings = { sound: true, numbers: true };

export function loadSettings(): Settings {
  try {
    // 예전에 저장한 값(물감 눌러 고르기 설정 등)은 읽지 않는다: 물감은 이제 늘 눌러서 고를 수 있다
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { sound: saved.sound ?? DEFAULTS.sound, numbers: saved.numbers ?? DEFAULTS.numbers };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 저장할 수 없는 환경이면 이번 접속 동안만 유지된다.
  }
}
