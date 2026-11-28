import { describe, expect, it } from 'vitest';
import { pickEaselProgress } from '../src/atelier3d/easelPicture';

describe('이젤에 올릴 그림', () => {
  const records = [
    { paintingId: 'old', updatedAt: 10 },
    { paintingId: 'recent', updatedAt: 30 },
    { paintingId: 'done', updatedAt: 50 },
  ];

  it('마지막으로 칠한 그림을 올린다 (다 칠한 것도)', () => {
    expect(pickEaselProgress(records)).toBe('done');
  });

  it('그림 벽에 건 그림은 내리고, 그다음으로 최근에 칠한 그림을 올린다', () => {
    expect(pickEaselProgress(records, new Set(['done']))).toBe('recent');
    expect(pickEaselProgress(records, new Set(['done', 'recent', 'old']))).toBeNull();
  });

  it('칠한 그림이 없으면 비워 둔다', () => {
    expect(pickEaselProgress([])).toBeNull();
  });
});
