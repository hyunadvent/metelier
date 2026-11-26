// 효과음. 음원 파일 없이 Web Audio 로 짧은 음을 합성한다.

let context: AudioContext | null = null;
let enabled = true;

function tone(freq: number, delay: number, duration: number, volume = 0.12, type: OscillatorType = 'sine'): void {
  if (!enabled || typeof AudioContext === 'undefined') return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(context.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  } catch {
    // 소리를 낼 수 없는 환경에서는 조용히 넘어간다.
  }
}

export const sound = {
  setEnabled(value: boolean): void {
    enabled = value;
  },
  /** 붓에 물감을 묻혔을 때 */
  dip(): void {
    tone(520, 0, 0.09, 0.1, 'triangle');
    tone(340, 0.05, 0.12, 0.08, 'triangle');
  },
  /** 한 칸을 다 칠했을 때 */
  fill(): void {
    tone(784, 0, 0.16);
    tone(1175, 0.08, 0.22);
  },
  /** 그림을 완성했을 때 */
  complete(): void {
    [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.13, 0.4, 0.13));
  },
};
