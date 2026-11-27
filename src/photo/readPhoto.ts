import { DEFAULT_PHOTO_OPTIONS, fitSize } from './photoToPainting';

export interface Photo {
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** 결과 크기로 맞춘 같은 사진. 얼굴의 선을 정밀하게 뽑는 데 쓴다. */
  detail: { width: number; height: number; rgba: Uint8ClampedArray };
}

/** 사진 파일을 읽어 작업 크기로 맞춘 픽셀을 돌려준다. */
export async function readPhoto(file: Blob & { name?: string }, workSize: number = DEFAULT_PHOTO_OPTIONS.workSize): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitSize(bitmap.width, bitmap.height, Math.min(workSize, Math.max(bitmap.width, bitmap.height)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  // 결과 크기로도 한 벌 만든다
  const big = fitSize(width, height, DEFAULT_PHOTO_OPTIONS.outputSize);
  canvas.width = big.width;
  canvas.height = big.height;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, big.width, big.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, big.width, big.height);
  bitmap.close();
  return { name: file.name ?? '', width, height, rgba, detail: { ...big, rgba: ctx.getImageData(0, 0, big.width, big.height).data } };
}
