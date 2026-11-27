import * as THREE from 'three';
import { loadGalleryItem } from '../storage/db';

/** 그림 벽에 걸 완성작의 텍스처와 가로세로 비율 */
export interface WallImage {
  texture: THREE.Texture;
  aspect: number;
}

/** 벽에 거는 그림은 멀리서 보므로 이 크기로 줄여서 쓴다. */
const MAX_TEXTURE = 768;

/**
 * 작품집(완성작)의 그림을 텍스처로 읽어 둔다. 같은 그림은 한 번만 읽는다.
 * 화실 화면과 색칠 화면 배경이 각자 하나씩 갖는다.
 */
export class WallImageCache {
  private readonly cache = new Map<string, Promise<WallImage | null>>();

  get(paintingId: string): Promise<WallImage | null> {
    let entry = this.cache.get(paintingId);
    if (!entry) {
      entry = load(paintingId).catch((e: unknown) => {
        console.warn(e);
        return null;
      });
      this.cache.set(paintingId, entry);
    }
    return entry;
  }

  dispose(): void {
    for (const entry of this.cache.values()) void entry.then((image) => image?.texture.dispose());
    this.cache.clear();
  }
}

async function load(paintingId: string): Promise<WallImage | null> {
  const item = await loadGalleryItem(paintingId);
  if (!item) return null;
  const bitmap = await createImageBitmap(item.image);
  const scale = Math.min(1, MAX_TEXTURE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const aspect = bitmap.width / bitmap.height;
  bitmap.close();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect };
}
