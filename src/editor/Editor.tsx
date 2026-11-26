import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PaletteEntry } from '../coloring/painting';
import {
  buildPackage,
  EXCLUDED,
  hexToRgb,
  labelSize,
  LINE_COLOR,
  rgbToHex,
  savePackage,
  UNASSIGNED,
  type Assignment,
} from './exportPainting';
import { clusterColors, describeRegions, meanColors, segment, toDarkness, type RegionInfo, type Segmentation } from './segment';

/** 그림의 긴 변을 이 크기로 맞춘다. */
const TARGET_SIZE = 2048;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

const DEFAULT_PALETTE: PaletteEntry[] = [
  '#FFF8E7', '#F48FB1', '#F9D65C', '#7CB86A', '#6FB7E9', '#9B6B4A', '#B388EB', '#F4A24C', '#5CC8B8',
].map((color, k) => ({ number: k + 1, color }));

interface Source {
  width: number;
  height: number;
  darkness: Uint8Array;
}

interface Parts {
  seg: Segmentation;
  regions: RegionInfo[];
}

/** 이미지 파일을 읽어 지정한 크기(없으면 긴 변 2048)로 맞춘 픽셀을 돌려준다. 투명한 곳은 흰색이 된다. */
async function readImage(file: File, size?: { width: number; height: number }): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const scale = TARGET_SIZE / Math.max(bitmap.width, bitmap.height);
  const width = size?.width ?? Math.round(bitmap.width * scale);
  const height = size?.height ?? Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
}

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [reference, setReference] = useState<Uint8ClampedArray | null>(null);
  const [threshold, setThreshold] = useState(110);
  const [gapRadius, setGapRadius] = useState(0);
  const [minArea, setMinArea] = useState(150);
  const [parts, setParts] = useState<Parts | null>(null);
  const [assignment, setAssignment] = useState<Assignment[]>([]);
  const [palette, setPalette] = useState<PaletteEntry[]>(DEFAULT_PALETTE);
  const [active, setActive] = useState<Assignment>(1);
  const [colorCount, setColorCount] = useState(9);
  const [zoom, setZoom] = useState(1);
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const partsRef = useRef<Parts | null>(null);
  const assignmentRef = useRef<Assignment[]>([]);

  useEffect(() => {
    partsRef.current = parts;
    assignmentRef.current = assignment;
  }, [parts, assignment]);

  // ── 칸 나누기: 선화나 설정이 바뀌면 다시 계산한다 ──
  useEffect(() => {
    if (!source) return;
    setBusy(true);
    const timer = window.setTimeout(() => {
      const { width, height, darkness } = source;
      const seg = segment(darkness, width, height, { threshold, gapRadius, minArea });
      const regions = describeRegions(seg, width, height, darkness, threshold);
      // 다시 나눠도 이미 지정한 번호는 유지한다: 새 칸의 번호 자리에 있던 예전 칸의 것을 물려받는다.
      const old = partsRef.current;
      const oldAssignment = assignmentRef.current;
      const next = regions.map((r) => {
        const oldId = old && old.seg.ids.length === seg.ids.length ? old.seg.ids[r.y * width + r.x] : 0;
        return oldId ? (oldAssignment[oldId - 1] ?? UNASSIGNED) : UNASSIGNED;
      });
      setParts({ seg, regions });
      setAssignment(next);
      setBusy(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [source, threshold, gapRadius, minArea]);

  // ── 미리보기 ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !parts) return;
    const { width, height, darkness } = source;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const colorOf = new Map(palette.map((e) => [e.number, hexToRgb(e.color)]));
    const fills = parts.regions.map((r) => {
      const a = assignment[r.id - 1];
      if (a === EXCLUDED) return [205, 205, 205];
      return colorOf.get(a) ?? [255, 255, 255];
    });
    const image = ctx.createImageData(width, height);
    const out = image.data;
    for (let i = 0; i < darkness.length; i++) {
      const fill = fills[parts.seg.ids[i] - 1] ?? [255, 255, 255];
      const a = darkness[i] / 255;
      const o = i * 4;
      out[o] = fill[0] * (1 - a) + LINE_COLOR[0] * a;
      out[o + 1] = fill[1] * (1 - a) + LINE_COLOR[1] * a;
      out[o + 2] = fill[2] * (1 - a) + LINE_COLOR[2] * a;
      out[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of parts.regions) {
      const a = assignment[r.id - 1];
      if (a === EXCLUDED) continue;
      ctx.font = `700 ${labelSize(r.clearance)}px system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgb(255 255 255 / 85%)';
      ctx.fillStyle = a === UNASSIGNED ? '#d43b3b' : '#4a382b';
      const text = a === UNASSIGNED ? '?' : String(a);
      ctx.strokeText(text, r.x, r.y);
      ctx.fillText(text, r.x, r.y);
    }
  }, [source, parts, assignment, palette]);

  const counts = useMemo(() => {
    const unassigned = assignment.filter((a) => a === UNASSIGNED).length;
    const excluded = assignment.filter((a) => a === EXCLUDED).length;
    return { total: assignment.length, unassigned, excluded, painted: assignment.length - unassigned - excluded };
  }, [assignment]);

  const loadLineArt = useCallback(async (file: File) => {
    try {
      const image = await readImage(file);
      setParts(null);
      setAssignment([]);
      setReference(null);
      setSource({ width: image.width, height: image.height, darkness: toDarkness(image.data) });
      const base = file.name.replace(/\.[^.]+$/, '');
      const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      setId((prev) => prev || slug);
      setTitle((prev) => prev || base);
      setMessage(null);
    } catch {
      setMessage({ kind: 'error', text: '이미지를 읽지 못했습니다. PNG, JPG, WebP, SVG 파일인지 확인하세요.' });
    }
  }, []);

  const loadReference = useCallback(
    async (file: File) => {
      if (!source) return;
      try {
        setReference((await readImage(file, source)).data);
        setMessage(null);
      } catch {
        setMessage({ kind: 'error', text: '완성 예시 이미지를 읽지 못했습니다.' });
      }
    },
    [source],
  );

  /** 완성 예시의 색을 비슷한 것끼리 묶어 팔레트를 만들고 칸마다 번호를 지정한다. */
  const autoAssign = () => {
    if (!source || !parts || !reference) return;
    const colors = meanColors(parts.seg, reference, source.darkness, threshold);
    const targets = parts.regions.filter((r) => assignment[r.id - 1] !== EXCLUDED);
    if (targets.length === 0) return;
    const { centers, assignment: cluster } = clusterColors(
      targets.map((r) => colors[r.id - 1]),
      targets.map((r) => r.pixels),
      colorCount,
    );
    setPalette(centers.map((c, k) => ({ number: k + 1, color: rgbToHex(c) })));
    const next = [...assignment];
    targets.forEach((r, k) => (next[r.id - 1] = cluster[k] + 1));
    setAssignment(next);
    setActive(1);
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!source || !parts) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * source.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * source.height);
    const region = parts.seg.ids[y * source.width + x];
    if (!region) return;
    setAssignment((prev) => prev.map((a, k) => (k === region - 1 ? (a === active ? UNASSIGNED : active) : a)));
  };

  const addColor = () => {
    const number = Math.max(0, ...palette.map((p) => p.number)) + 1;
    setPalette([...palette, { number, color: '#CCCCCC' }]);
    setActive(number);
  };

  const removeColor = (number: number) => {
    setPalette(palette.filter((p) => p.number !== number));
    setAssignment((prev) => prev.map((a) => (a === number ? UNASSIGNED : a)));
    if (active === number) setActive(EXCLUDED);
  };

  const problem = !source
    ? '선화를 먼저 불러오세요.'
    : !parts || busy
      ? '칸을 나누는 중입니다.'
      : counts.painted === 0
        ? '번호를 지정한 칸이 없습니다.'
        : counts.unassigned > 0
          ? `번호를 정하지 않은 칸이 ${counts.unassigned}개 있습니다 (빨간 물음표).`
          : !ID_PATTERN.test(id)
            ? '그림 ID 는 영문 소문자, 숫자, 하이픈만 쓸 수 있습니다.'
            : !title.trim()
              ? '제목을 입력하세요.'
              : null;

  const save = async () => {
    if (problem || !source || !parts) return;
    setBusy(true);
    try {
      const files = buildPackage({ id, title: title.trim(), ...source, ...parts, assignment, palette });
      await savePackage(id, files);
      setMessage({ kind: 'ok', text: `public/paintings/${id}/ 에 저장했습니다.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor">
      <main className="editor__stage">
        {source ? (
          <div className="editor__scroll">
            <canvas ref={canvasRef} style={{ width: `${zoom * 100}%` }} onClick={onCanvasClick} />
          </div>
        ) : (
          <label className="editor__drop">
            <strong>선화 이미지를 선택하세요</strong>
            <span>흰 바탕(또는 투명 바탕)에 어두운 선으로 그린 PNG, JPG, WebP, SVG</span>
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && loadLineArt(e.target.files[0])} />
          </label>
        )}
      </main>

      <aside className="editor__panel">
        <h1>그림 제작 도구</h1>

        <section>
          <h2>1. 이미지</h2>
          <label className="field">
            <span>선화</span>
            <input
              type="file"
              accept="image/*"
              data-testid="line-art"
              onChange={(e) => e.target.files?.[0] && loadLineArt(e.target.files[0])}
            />
          </label>
          <label className="field">
            <span>완성 예시 (선택)</span>
            <input
              type="file"
              accept="image/*"
              data-testid="reference"
              disabled={!source}
              onChange={(e) => e.target.files?.[0] && loadReference(e.target.files[0])}
            />
          </label>
          {source && (
            <p className="note">
              {source.width} × {source.height} 로 맞췄습니다.
            </p>
          )}
        </section>

        <section>
          <h2>2. 칸 나누기</h2>
          <label className="field">
            <span>선 인식 기준 {threshold}</span>
            <input type="range" min={20} max={240} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>끊긴 선 잇기 {gapRadius}px</span>
            <input type="range" min={0} max={12} value={gapRadius} onChange={(e) => setGapRadius(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>작은 칸 합치기 {minArea}px 미만</span>
            <input type="range" min={0} max={2000} step={10} value={minArea} onChange={(e) => setMinArea(Number(e.target.value))} />
          </label>
          <p className="note" data-testid="counts">
            {busy ? '계산 중…' : `칸 ${counts.total}개 · 칠하는 칸 ${counts.painted} · 미정 ${counts.unassigned} · 칠하지 않음 ${counts.excluded}`}
          </p>
          <p className="note">칸이 서로 합쳐져 보이면 선이 끊긴 것입니다. "끊긴 선 잇기"를 조금씩 올려 보세요.</p>
        </section>

        <section>
          <h2>3. 번호와 색</h2>
          <p className="note">번호를 고른 뒤 그림의 칸을 누르면 지정됩니다. 같은 번호로 다시 누르면 취소됩니다.</p>
          <div className="swatches">
            {palette.map((p) => (
              <div key={p.number} className={`swatch${active === p.number ? ' swatch--active' : ''}`}>
                <button style={{ background: p.color }} aria-label={`${p.number}번`} onClick={() => setActive(p.number)}>
                  {p.number}
                </button>
                <input
                  type="color"
                  value={p.color}
                  aria-label={`${p.number}번 색`}
                  onChange={(e) =>
                    setPalette(palette.map((q) => (q.number === p.number ? { ...q, color: e.target.value.toUpperCase() } : q)))
                  }
                />
                <button className="swatch__remove" aria-label={`${p.number}번 삭제`} onClick={() => removeColor(p.number)}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="row">
            <button onClick={addColor}>색 추가</button>
            <button className={active === EXCLUDED ? 'is-active' : ''} onClick={() => setActive(EXCLUDED)}>
              칠하지 않는 칸
            </button>
          </div>
          <div className="row">
            <label className="field field--inline">
              <span>색 수</span>
              <input type="number" min={2} max={30} value={colorCount} onChange={(e) => setColorCount(Number(e.target.value) || 2)} />
            </label>
            <button data-testid="auto" disabled={!reference || !parts} onClick={autoAssign}>
              완성 예시로 자동 지정
            </button>
          </div>
        </section>

        <section>
          <h2>4. 저장</h2>
          <label className="field">
            <span>그림 ID</span>
            <input type="text" value={id} placeholder="cat-basket" data-testid="id" onChange={(e) => setId(e.target.value)} />
          </label>
          <label className="field">
            <span>제목</span>
            <input type="text" value={title} placeholder="바구니 속 고양이" data-testid="title" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>미리보기 크기 {Math.round(zoom * 100)}%</span>
            <input type="range" min={1} max={4} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <button className="primary" data-testid="save" disabled={problem !== null || busy} onClick={save}>
            게임용으로 저장
          </button>
          {problem && <p className="note">{problem}</p>}
          {message && (
            <p className={`note note--${message.kind}`} data-testid="message">
              {message.text}{' '}
              {message.kind === 'ok' && (
                <a href={`/?painting=${id}`} target="_blank" rel="noreferrer">
                  게임에서 열기
                </a>
              )}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
