import { describe, expect, it } from 'vitest';
import { pickEaselProgress } from '../src/atelier3d/easelPicture';

describe('이젤에 올릴 그림', () => {
  it('아직 다 칠하지 않은 그림 가운데 가장 최근에 칠한 것을 올린다', () => {
    expect(
      pickEaselProgress([
        { paintingId: 'old', completed: false, updatedAt: 10 },
        { paintingId: 'recent', completed: false, updatedAt: 30 },
        { paintingId: 'done', completed: true, updatedAt: 50 },
      ]),
    ).toBe('recent');
  });

  it('칠하던 그림이 없거나 모두 다 칠했으면 비워 둔다', () => {
    expect(pickEaselProgress([])).toBeNull();
    expect(pickEaselProgress([{ paintingId: 'done', completed: true, updatedAt: 50 }])).toBeNull();
  });
});
