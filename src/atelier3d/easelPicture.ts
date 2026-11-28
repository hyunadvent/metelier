import * as THREE from 'three';
import { loadPaintingLook } from '../coloring/painting';
import { listProgress, type ProgressRecord } from '../storage/db';
import { unpackPixels } from '../storage/pixelStore';

/** 이젤에 올려 둘 그림: 칠하던 그림을 그때까지 칠한 모습으로 */
export interface EaselPicture {
  paintingId: string;
  texture: THREE.Texture;
  aspect: number;
}

/** 이젤의 캔버스는 멀리서 보므로 이 크기로 줄여 그린다. */
const MAX_SIZE = 1024;

/**
 * 이젤에 올릴 그림을 고른다: 아직 다 칠하지 않은 그림 가운데 가장 최근에 칠한 것.
 * 다 칠한 그림은 작품집(과 그림 벽)으로 가므로 이젤에는 올리지 않는다.
 */
export function pickEaselProgress(records: Pick<ProgressRecord, 'paintingId' | 'completed' | 'updatedAt'>[]): string | null {
  let best: (typeof records)[number] | null = null;
  for (const r of records) if (!r.completed && (!best || r.updatedAt > best.updatedAt)) best = r;
  return best?.paintingId ?? null;
}

/** 칠하던 그림을 이젤에 올릴 그림으로 만든다. 칠하던 그림이 없으면 null */
export async function loadEaselPicture(): Promise<EaselPicture | null> {
  const records = await listProgress();
  const paintingId = pickEaselProgress(records);
  if (!paintingId) return null;
  const record = records.find((r) => r.paintingId === paintingId)!;
  const look = await loadPaintingLook(paintingId);
  if (!look || look.width !== record.width || look.height !== record.height) return null;

  // 칠한 것 (칠하지 않은 곳은 투명)
  const pixels = await unpackPixels(record);
  if (pixels.length !== look.width * look.height * 4) return null;
  const full = document.createElement('canvas');
  full.width = look.width;
  full.height = look.height;
  full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), look.width, look.height), 0, 0);

  // 종이 → 칠한 것 → 선화 (작품을 만들 때와 같은 차례)
  const scale = Math.min(1, MAX_SIZE / Math.max(look.width, look.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(look.width * scale));
  canvas.height = Math.max(1, Math.round(look.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  const lines = await createImageBitmap(await (await fetch(look.linesUrl)).blob());
  ctx.drawImage(lines, 0, 0, canvas.width, canvas.height);
  lines.close();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { paintingId, texture, aspect: look.width / look.height };
}
