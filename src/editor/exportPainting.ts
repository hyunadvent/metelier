import type { PaintingMeta, PaletteEntry } from '../coloring/painting';
import type { RegionInfo, Segmentation } from './segment';

export const LINE_COLOR = [91, 70, 54] as const;

/** 칸에 지정한 것: 물감 번호, 0 = 아직 안 정함, -1 = 칠하지 않는 칸. */
export type Assignment = number;
export const UNASSIGNED = 0;
export const EXCLUDED = -1;

export interface EditorPainting {
  id: string;
  title: string;
  width: number;
  height: number;
  darkness: Uint8Array;
  seg: Segmentation;
  regions: RegionInfo[];
  assignment: Assignment[];
  palette: PaletteEntry[];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** 번호 글자 크기: 칸이 클수록 크게, 18~64 사이. */
export function labelSize(clearance: number): number {
  return Math.round(Math.min(64, Math.max(18, clearance * 0.9)));
}

function toDataUrl(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

/** 게임이 읽는 그림 패키지 파일들을 만든다 (PNG 는 data URL, meta.json 은 문자열). */
export function buildPackage(p: EditorPainting): Record<string, string> {
  const { width, height, darkness, seg, assignment } = p;
  const count = width * height;

  // 칠하는 칸만 1 부터 다시 번호를 매긴다. 칠하지 않는 칸은 0 이 된다.
  const newId = new Uint16Array(seg.count + 1);
  const kept: RegionInfo[] = [];
  p.regions.forEach((r) => {
    if (assignment[r.id - 1] > 0) {
      kept.push(r);
      newId[r.id] = kept.length;
    }
  });

  const colorOf = new Map(p.palette.map((e) => [e.number, hexToRgb(e.color)]));
  const regionsPng = new Uint8ClampedArray(count * 4);
  const linesPng = new Uint8ClampedArray(count * 4);
  const referencePng = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const id = newId[seg.ids[i]];
    regionsPng[o] = id & 255;
    regionsPng[o + 1] = id >> 8;
    regionsPng[o + 3] = 255;

    const a = darkness[i] / 255;
    linesPng[o] = LINE_COLOR[0];
    linesPng[o + 1] = LINE_COLOR[1];
    linesPng[o + 2] = LINE_COLOR[2];
    linesPng[o + 3] = darkness[i];

    const fill = (id && colorOf.get(assignment[seg.ids[i] - 1])) || [255, 253, 248];
    for (let c = 0; c < 3; c++) referencePng[o + c] = fill[c] * (1 - a) + LINE_COLOR[c] * a;
    referencePng[o + 3] = 255;
  }

  const used = new Set(kept.map((r) => assignment[r.id - 1]));
  const meta: PaintingMeta = {
    id: p.id,
    title: p.title,
    width,
    height,
    files: { regions: 'regions.png', lines: 'lines.png', reference: 'reference.png' },
    palette: p.palette.filter((e) => used.has(e.number)),
    regions: kept.map((r, k) => ({
      id: k + 1,
      name: `칸 ${k + 1}`,
      number: assignment[r.id - 1],
      pixels: r.pixels,
      label: { x: r.x, y: r.y, size: labelSize(r.clearance) },
    })),
  };

  return {
    'regions.png': toDataUrl(regionsPng, width, height),
    'lines.png': toDataUrl(linesPng, width, height),
    'reference.png': toDataUrl(referencePng, width, height),
    'meta.json': JSON.stringify(meta, null, 2) + '\n',
  };
}

/** 개발 서버에 그림 패키지를 저장한다 (public/paintings/<id>/). */
export async function savePackage(id: string, files: Record<string, string>): Promise<void> {
  const response = await fetch('/__editor/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, files }),
  });
  if (!response.ok) throw new Error((await response.text()) || `저장하지 못했습니다 (${response.status})`);
}
