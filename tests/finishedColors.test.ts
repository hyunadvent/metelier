import { describe, expect, it } from 'vitest';
import { finishedColors } from '../src/coloring/finishedColors';

describe('finishedColors', () => {
  const regions = [
    { id: 1, number: 1 },
    { id: 2, number: 1 },
    { id: 3, number: 2 },
    { id: 4, number: 3 },
  ];
  const size = (id: number) => (id === 4 ? 0 : 10);

  it('한 번호의 칸을 모두 칠해야 그 번호가 끝난다', () => {
    expect([...finishedColors(regions, size, (id) => id === 1)]).toEqual([]);
    expect([...finishedColors(regions, size, (id) => id === 1 || id === 2)]).toEqual([1]);
  });

  it('칠할 칸이 없는 번호는 끝난 것으로 치지 않는다', () => {
    expect([...finishedColors(regions, size, () => true)].sort()).toEqual([1, 2]);
  });
});
