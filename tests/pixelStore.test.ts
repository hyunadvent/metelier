import { describe, expect, it } from 'vitest';
import { packPixels, unpackPixels } from '../src/storage/pixelStore';

describe('pixelStore', () => {
  it('칠 버퍼를 압축했다가 그대로 되살린다', async () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31) % 256;
    const packed = await packPixels(pixels);
    expect(packed.encoding).toBe('gzip');
    const restored = await unpackPixels(packed);
    expect(restored.length).toBe(pixels.length);
    expect(Array.from(restored)).toEqual(Array.from(pixels));
  });

  it('빈 그림은 아주 작게 저장된다', async () => {
    const packed = await packPixels(new Uint8ClampedArray(512 * 512 * 4));
    expect(packed.data.size).toBeLessThan(5000);
  });

  it('압축하지 않은 저장본도 읽는다', async () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 255, 9, 8, 7, 128]);
    const restored = await unpackPixels({ data: new Blob([pixels]), encoding: 'raw' });
    expect(Array.from(restored)).toEqual(Array.from(pixels));
  });
});
