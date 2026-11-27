import { useCallback, useEffect, useRef, useState } from 'react';
import { buildPackage, hexToRgb, labelSize, LINE_COLOR, savePackage } from '../editor/exportPainting';
import { DEFAULT_PHOTO_OPTIONS, photoToPainting, type PhotoPainting, type PhotoStage } from './photoToPainting';
import { readPhoto, type Photo } from './readPhoto';

const STAGE_LABEL: Record<PhotoStage, string> = {
  smooth: '만화풍으로 다듬는 중…',
  colors: '색을 묶는 중…',
  regions: '칸을 나누는 중…',
  lines: '선과 번호를 넣는 중…',
};
const TEST_ID = 'photo-test';

function drawPixels(canvas: HTMLCanvasElement | null, width: number, height: number, rgba: Uint8ClampedArray): void {
  if (!canvas) return;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}

/** 칸을 번호의 색으로 채운 "완성 모습" 또는 번호만 적힌 "선화" 를 그린다. */
function drawPainting(canvas: HTMLCanvasElement | null, painting: PhotoPainting, filled: boolean): void {
  if (!canvas) return;
  const { width, height, seg, darkness, regions, assignment, palette } = painting;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const colorOf = new Map(palette.map((p) => [p.number, hexToRgb(p.color)]));
  const fills = regions.map((r) => (filled ? (colorOf.get(assignment[r.id - 1]) ?? [255, 253, 248]) : [255, 253, 248]));
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < darkness.length; i++) {
    // 칸 번호 0 은 윤곽선이 지나가는 자리다
    const fill = fills[seg.ids[i] - 1] ?? [255, 253, 248];
    const a = darkness[i] / 255;
    const o = i * 4;
    image.data[o] = fill[0] * (1 - a) + LINE_COLOR[0] * a;
    image.data[o + 1] = fill[1] * (1 - a) + LINE_COLOR[1] * a;
    image.data[o + 2] = fill[2] * (1 - a) + LINE_COLOR[2] * a;
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  if (filled) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8f857c';
  for (const r of regions) {
    ctx.font = `700 ${labelSize(r.clearance)}px system-ui, sans-serif`;
    ctx.fillText(String(assignment[r.id - 1]), r.x, r.y);
  }
}

export function PhotoLab() {
  const originalRef = useRef<HTMLCanvasElement>(null);
  const smoothedRef = useRef<HTMLCanvasElement>(null);
  const filledRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<HTMLCanvasElement>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [colors, setColors] = useState(DEFAULT_PHOTO_OPTIONS.colors);
  const [maxRegions, setMaxRegions] = useState(DEFAULT_PHOTO_OPTIONS.maxRegions);
  const [smoothing, setSmoothing] = useState(DEFAULT_PHOTO_OPTIONS.smoothing);
  const [faceLines, setFaceLines] = useState(DEFAULT_PHOTO_OPTIONS.faceLines);
  const [thinLines, setThinLines] = useState(DEFAULT_PHOTO_OPTIONS.thinLines);
  const [edgeMerge, setEdgeMerge] = useState(DEFAULT_PHOTO_OPTIONS.edgeMerge);
  const [contours, setContours] = useState(DEFAULT_PHOTO_OPTIONS.contours);
  const [painting, setPainting] = useState<PhotoPainting | null>(null);
  const [stage, setStage] = useState<PhotoStage | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loadPhoto = useCallback(async (file: File) => {
    try {
      setPainting(null);
      setMessage(null);
      setPhoto(await readPhoto(file, DEFAULT_PHOTO_OPTIONS.workSize));
    } catch {
      setMessage({ kind: 'error', text: '사진을 읽지 못했습니다. JPG, PNG, WebP 파일인지 확인하세요.' });
    }
  }, []);

  // 사진이나 설정이 바뀌면 다시 변환한다
  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const started = performance.now();
      try {
        const result = await photoToPainting(
          photo.rgba,
          photo.width,
          photo.height,
          { ...DEFAULT_PHOTO_OPTIONS, colors, maxRegions, smoothing, faceLines, thinLines, edgeMerge, contours },
          async (next) => {
            if (cancelled) throw new Error('cancelled');
            setStage(next);
            // 진행 문구가 화면에 그려질 틈을 준다
            await new Promise((resolve) => setTimeout(resolve, 20));
          },
          photo.detail,
        );
        if (cancelled) return;
        setPainting(result);
        setSeconds((performance.now() - started) / 1000);
      } catch (e) {
        if (!cancelled) setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!cancelled) setStage(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [photo, colors, maxRegions, smoothing, faceLines, thinLines, edgeMerge, contours]);

  useEffect(() => {
    if (photo) drawPixels(originalRef.current, photo.width, photo.height, photo.rgba);
  }, [photo]);

  useEffect(() => {
    if (!painting) return;
    drawPixels(smoothedRef.current, painting.smoothed.width, painting.smoothed.height, painting.smoothed.rgba);
    drawPainting(filledRef.current, painting, true);
    drawPainting(linesRef.current, painting, false);
  }, [painting]);

  const save = async () => {
    if (!painting || !photo) return;
    try {
      const title = photo.name.replace(/\.[^.]+$/, '') || '사진';
      await savePackage(TEST_ID, buildPackage({ id: TEST_ID, title, ...painting }));
      setMessage({ kind: 'ok', text: `public/paintings/${TEST_ID}/ 에 저장했습니다.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="editor">
      <main className="editor__stage">
        {photo ? (
          <div className="photo-grid">
            <figure>
              <canvas ref={originalRef} />
              <figcaption>1. 원본 사진</figcaption>
            </figure>
            <figure>
              <canvas ref={smoothedRef} />
              <figcaption>2. 만화풍으로 다듬기</figcaption>
            </figure>
            <figure>
              <canvas ref={filledRef} data-testid="filled" />
              <figcaption>3. 번호대로 칠한 완성 모습</figcaption>
            </figure>
            <figure>
              <canvas ref={linesRef} data-testid="lines" />
              <figcaption>4. 색칠할 선화와 번호</figcaption>
            </figure>
          </div>
        ) : (
          <label className="editor__drop">
            <strong>사진을 선택하세요</strong>
            <span>사진은 이 브라우저 안에서만 처리되며 어디에도 전송되지 않습니다</span>
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && loadPhoto(e.target.files[0])} />
          </label>
        )}
      </main>

      <aside className="editor__panel">
        <h1>사진 변환 시험</h1>
        <section>
          <h2>1. 사진</h2>
          <label className="field">
            <span>사진 파일</span>
            <input type="file" accept="image/*" data-testid="photo" onChange={(e) => e.target.files?.[0] && loadPhoto(e.target.files[0])} />
          </label>
          {photo && (
            <p className="note">
              작업 크기 {photo.width} × {photo.height}
            </p>
          )}
        </section>

        <section>
          <h2>2. 변환 설정</h2>
          <label className="field">
            <span>물감 색 수 {colors}</span>
            <input type="range" min={6} max={24} value={colors} onChange={(e) => setColors(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>칸 수 최대 {maxRegions}</span>
            <input type="range" min={40} max={320} step={10} value={maxRegions} onChange={(e) => setMaxRegions(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>다듬는 세기 {smoothing}</span>
            <input type="range" min={0} max={3} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>흐릿한 경계 합치기 {edgeMerge === 0 ? '끔' : edgeMerge.toFixed(1)}</span>
            <input type="range" min={0} max={2} step={0.1} value={edgeMerge} data-testid="edge-merge" onChange={(e) => setEdgeMerge(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>같은 색 사이의 윤곽 잡기 {contours === 0 ? '끔' : contours.toFixed(1)}</span>
            <input type="range" min={0} max={2.5} step={0.1} value={contours} data-testid="contours" onChange={(e) => setContours(Number(e.target.value))} />
          </label>
          <label className="field field--check">
            <input type="checkbox" checked={thinLines} data-testid="thin-lines" onChange={(e) => setThinLines(e.target.checked)} />
            <span>가는 줄은 칸이 아닌 선으로 남기기</span>
          </label>
          <label className="field field--check">
            <input type="checkbox" checked={faceLines} data-testid="face-lines" onChange={(e) => setFaceLines(e.target.checked)} />
            <span>얼굴의 눈·코·입을 선으로 남기기</span>
          </label>
          <p className="note" data-testid="status">
            {stage
              ? STAGE_LABEL[stage]
              : painting
                ? `칸 ${painting.regions.length}개 · 색 ${painting.palette.length}개 · ${seconds?.toFixed(1)}초`
                : '사진을 넣으면 변환합니다.'}
          </p>
        </section>

        {painting && (
          <section>
            <h2>3. 물감 번호</h2>
            <div className="photo-palette">
              {painting.palette.map((p) => (
                <span key={p.number} style={{ background: p.color }} title={p.color}>
                  {p.number}
                </span>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>4. 게임에서 칠해 보기</h2>
          <button className="primary" data-testid="save" disabled={!painting || stage !== null} onClick={save}>
            시험용 그림으로 저장
          </button>
          {message && (
            <p className={`note note--${message.kind}`} data-testid="message">
              {message.text}{' '}
              {message.kind === 'ok' && (
                <a href={`/?painting=${TEST_ID}`} target="_blank" rel="noreferrer">
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
