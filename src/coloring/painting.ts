import type { Rgb } from './engine/PaintEngine';
import { decodeRegionIds } from './engine/regionMap';

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
  linesUrl: string;
  referenceUrl: string;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

async function loadRegionIds(url: string, width: number, height: number): Promise<Uint16Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`칸 ID 맵을 불러오지 못했습니다: ${url}`);
  // 색 보정이나 알파 곱셈이 들어가면 ID 가 달라지므로 둘 다 끈다.
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  if (bitmap.width !== width || bitmap.height !== height) {
    throw new Error(`칸 ID 맵 크기가 meta.json 과 다릅니다: ${bitmap.width} x ${bitmap.height}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다.');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return decodeRegionIds(ctx.getImageData(0, 0, width, height).data);
}

export async function loadPainting(id: string): Promise<LoadedPainting> {
  const baseUrl = `${import.meta.env.BASE_URL}paintings/${id}/`;
  const response = await fetch(`${baseUrl}meta.json`);
  if (!response.ok) throw new Error(`그림 정보를 불러오지 못했습니다: ${id}`);
  const meta = (await response.json()) as PaintingMeta;
  const regionIds = await loadRegionIds(baseUrl + meta.files.regions, meta.width, meta.height);
  return {
    meta,
    regionIds,
    linesUrl: baseUrl + meta.files.lines,
    referenceUrl: baseUrl + meta.files.reference,
  };
}
