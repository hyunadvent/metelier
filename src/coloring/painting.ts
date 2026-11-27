import type { Rgb } from './engine/PaintEngine';
import { decodeRegionIds } from './engine/regionMap';
import { loadStoredPainting } from '../storage/db';

/** 붓에 묻힐 수 있는 것: 물감 번호 또는 지우개. */
export type Tool = number | 'eraser';

export interface PaletteEntry {
  number: number;
  color: string;
}

export interface RegionMeta {
  id: number;
  name: string;
  number: number;
  pixels: number;
  label: { x: number; y: number; size: number };
}

export interface PaintingMeta {
  id: string;
  title: string;
  width: number;
  height: number;
  files: { regions: string; lines: string; reference: string };
  palette: PaletteEntry[];
  regions: RegionMeta[];
}

export interface LoadedPainting {
  meta: PaintingMeta;
  regionIds: Uint16Array;
  /** 선에 가려져 보이지 않는 픽셀 (0 이 아니면 가려짐). */
  hidden: Uint8Array;
  linesUrl: string;
  referenceUrl: string;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** 이미지 파일의 픽셀을 변형 없이 읽는다. */
async function readPixels(url: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`그림 파일을 불러오지 못했습니다: ${url}`);
  // 색 보정이나 알파 곱셈이 들어가면 값이 달라지므로 둘 다 끈다.
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  if (bitmap.width !== width || bitmap.height !== height) {
    throw new Error(`그림 파일 크기가 meta.json 과 다릅니다: ${url} (${bitmap.width} x ${bitmap.height})`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다.');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height).data;
}

/** 선화에서 선이 절반 이상 덮은 픽셀을 표시한다. 이런 픽셀은 보이지 않으므로 진행도에 세지 않는다. */
function hiddenByLines(linesRgba: Uint8ClampedArray): Uint8Array {
  const hidden = new Uint8Array(linesRgba.length / 4);
  for (let i = 0; i < hidden.length; i++) hidden[i] = linesRgba[i * 4 + 3] >= 128 ? 1 : 0;
  return hidden;
}

/** 사진으로 만든 그림의 이름표. 이런 그림은 서버가 아니라 이 브라우저에 저장되어 있다. */
export const PHOTO_PAINTING_PREFIX = 'photo-';

export function isPhotoPaintingId(id: string): boolean {
  return id.startsWith(PHOTO_PAINTING_PREFIX);
}

async function fromFiles(meta: PaintingMeta, urls: { regions: string; lines: string; reference: string }): Promise<LoadedPainting> {
  const [regions, lines] = await Promise.all([
    readPixels(urls.regions, meta.width, meta.height),
    readPixels(urls.lines, meta.width, meta.height),
  ]);
  return {
    meta,
    regionIds: decodeRegionIds(regions),
    hidden: hiddenByLines(lines),
    linesUrl: urls.lines,
    referenceUrl: urls.reference,
  };
}

export async function loadPainting(id: string): Promise<LoadedPainting> {
  if (isPhotoPaintingId(id)) {
    const stored = await loadStoredPainting(id);
    if (!stored) throw new Error('이 그림은 이 브라우저에 저장되어 있지 않습니다.');
    return fromFiles(stored.meta as PaintingMeta, stored);
  }
  const baseUrl = `${import.meta.env.BASE_URL}paintings/${id}/`;
  const response = await fetch(`${baseUrl}meta.json`);
  if (!response.ok) throw new Error(`그림 정보를 불러오지 못했습니다: ${id}`);
  const meta = (await response.json()) as PaintingMeta;
  return fromFiles(meta, {
    regions: baseUrl + meta.files.regions,
    lines: baseUrl + meta.files.lines,
    reference: baseUrl + meta.files.reference,
  });
}
