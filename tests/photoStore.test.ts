import { describe, expect, it } from 'vitest';
import { isPhotoPaintingId } from '../src/coloring/painting';
import { newPhotoPaintingId, titleFromFileName } from '../src/photo/photoStore';

describe('사진으로 만든 그림의 이름', () => {
  it('파일 이름에서 확장자를 떼어 제목으로 쓴다', () => {
    expect(titleFromFileName('우리 강아지.jpg')).toBe('우리 강아지');
    expect(titleFromFileName('IMG_0012.final.PNG')).toBe('IMG_0012.final');
  });

  it('이름이 없으면 기본 제목을, 너무 길면 30자까지만 쓴다', () => {
    expect(titleFromFileName('')).toBe('사진 그림');
    expect(titleFromFileName('.png')).toBe('사진 그림');
    expect(titleFromFileName('가'.repeat(50) + '.jpg')).toHaveLength(30);
  });

  it('새 그림의 이름표는 사진 그림으로 알아볼 수 있고, 주소에 쓸 수 있는 글자로만 되어 있다', () => {
    const id = newPhotoPaintingId(1795791149331);
    expect(isPhotoPaintingId(id)).toBe(true);
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,40}$/);
    expect(newPhotoPaintingId(1795791149332)).not.toBe(id);
  });

  it('처음부터 들어 있는 그림은 사진 그림이 아니다', () => {
    expect(isPhotoPaintingId('hill-house')).toBe(false);
  });
});
