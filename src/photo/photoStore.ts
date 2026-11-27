import { PHOTO_PAINTING_PREFIX, type PaintingMeta } from '../coloring/painting';
import { buildPackage } from '../editor/exportPainting';
import { saveStoredPainting, type StoredPainting } from '../storage/db';
import type { PhotoPainting } from './photoToPainting';

/** 사진 파일 이름에서 그림 제목을 만든다. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim();
  return (base || '사진 그림').slice(0, 30);
}

export function newPhotoPaintingId(now: number = Date.now()): string {
  return PHOTO_PAINTING_PREFIX + now.toString(36);
}

/** 완성 모습을 작게 줄인다 (고르는 창에 쓴다). */
async function makeThumbnail(reference: string, size = 320): Promise<string> {
  const image = new Image();
  image.src = reference;
  await image.decode();
  const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** 변환한 그림을 게임이 읽는 그림 패키지로 만든다. 아직 저장하지는 않는다. */
export async function packPhotoPainting(title: string, painting: PhotoPainting): Promise<StoredPainting> {
  const id = newPhotoPaintingId();
  const files = buildPackage({ id, title, ...painting });
  const meta = JSON.parse(files['meta.json']) as PaintingMeta;
  return {
    id,
    title,
    createdAt: Date.now(),
    meta,
    regions: files['regions.png'],
    lines: files['lines.png'],
    reference: files['reference.png'],
    thumbnail: await makeThumbnail(files['reference.png']),
  };
}

export function storePhotoPainting(painting: StoredPainting): Promise<void> {
  return saveStoredPainting(painting);
}
