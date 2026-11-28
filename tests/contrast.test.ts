import { describe, expect, it } from 'vitest';
import { isLowContrast } from '../src/coloring/contrast';

describe('종이 위에서 잘 안 보이는 색', () => {
  it('흰색과 아주 옅은 색만 해당한다', () => {
    expect(isLowContrast([255, 255, 255])).toBe(true);
    expect(isLowContrast([245, 240, 230])).toBe(true);
    // 옅은 노랑, 하늘색은 충분히 보인다
    expect(isLowContrast([255, 255, 173])).toBe(false);
    expect(isLowContrast([173, 216, 240])).toBe(false);
  });
});
