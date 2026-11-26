export interface Settings {
  /** 효과음 */
  sound: boolean;
  /** 칸 번호 표시 */
  numbers: boolean;
  /** 보조 옵션: 물감을 눌러서도 고를 수 있게 한다 */
  tapToPick: boolean;
}

const KEY = 'metelier.settings';
const DEFAULTS: Settings = { sound: true, numbers: true, tapToPick: false };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
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
