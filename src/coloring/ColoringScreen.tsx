import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush } from './Brush';
import { hexToRgb, loadPainting, type PaintingMeta, type Tool } from './painting';
import { ColoringView } from './view/ColoringView';
import './coloring.css';

const ZOOM_STEP = 1.5;
const WHEEL_SENSITIVITY = 0.0015;

export function ColoringScreen({ paintingId }: { paintingId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<ColoringView | null>(null);
  const [meta, setMeta] = useState<PaintingMeta | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [progress, setProgress] = useState({ filled: 0, total: 0 });
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let created: ColoringView | null = null;

    (async () => {
      try {
        const painting = await loadPainting(paintingId);
        if (cancelled) return;
        const v = await ColoringView.create(host, painting, {
          onProgress: (filled, total) => setProgress({ filled, total }),
          onZoom: setZoom,
        });
        if (cancelled) {
          v.destroy();
          return;
        }
        created = v;
        setView(v);
        setMeta(painting.meta);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      created?.destroy();
      setView(null);
      setMeta(null);
    };
  }, [paintingId]);

  useEffect(() => {
    if (!view || !meta) return;
    if (tool === null) {
      view.setBrush(null);
    } else if (tool === 'eraser') {
      view.setBrush({ kind: 'erase' });
    } else {
      const entry = meta.palette.find((p) => p.number === tool);
      view.setBrush(entry ? { kind: 'paint', color: hexToRgb(entry.color) } : null);
    }
  }, [tool, meta, view]);

  // 붓이나 HUD 위에서 휠을 돌려도 확대·축소되도록 화면 전체에서 받는다.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !view) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * WHEEL_SENSITIVITY));
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [view]);

  const shakePalette = useCallback(() => {
    paletteRef.current?.animate(
      [{ translate: '0 0' }, { translate: '-8px 0' }, { translate: '8px 0' }, { translate: '-5px 0' }, { translate: '0 0' }],
      { duration: 360 },
    );
  }, []);

  return (
    <div className="coloring" ref={rootRef}>
      {/* 화실 배경 자리. M5 에서 꾸민 화실 장면(이젤 앞 시점)으로 바뀐다. */}
      <div className="coloring__backdrop" />
      <div className="coloring__canvas" ref={hostRef} />

      {error && <p className="coloring__message">{error}</p>}
      {!error && !meta && <p className="coloring__message">그림을 불러오는 중…</p>}

      {meta && view && (
        <>
          <header className="coloring__top">
            <div className="pill" aria-label="칠한 칸 수">
              🎨 {progress.filled} / {progress.total}
            </div>
            <div className="pill pill--title">{meta.title}</div>
            <div className="zoom" role="group" aria-label="확대·축소">
              <button aria-label="축소" disabled={zoom <= 1} onClick={() => view.zoomBy(1 / ZOOM_STEP)}>
                −
              </button>
              <button className="zoom__value" aria-label="화면에 맞추기" onClick={() => view.resetZoom()}>
                {Math.round(zoom * 100)}%
              </button>
              <button aria-label="확대" disabled={zoom >= 5} onClick={() => view.zoomBy(ZOOM_STEP)}>
                +
              </button>
            </div>
            <button className="pill pill--button" onClick={() => view.clear()}>
              처음부터
            </button>
          </header>

          {tool === null && <p className="coloring__hint">붓 손잡이를 잡고 물감에 붓끝을 담가 보세요</p>}

          <footer className="palette" ref={paletteRef} aria-label="물감">
            {meta.palette.map((p) => (
              <div
                key={p.number}
                className={`pot${tool === p.number ? ' pot--selected' : ''}`}
                style={{ background: p.color }}
                data-pot={p.number}
                aria-label={`${p.number}번 물감`}
              >
                {p.number}
              </div>
            ))}
            <span className="palette__divider" />
            <div
              className={`pot pot--eraser${tool === 'eraser' ? ' pot--selected' : ''}`}
              data-pot="eraser"
              aria-label="지우개"
            >
              🧽
            </div>
          </footer>

          <Brush view={view} palette={meta.palette} tool={tool} onDip={setTool} onEmptyStroke={shakePalette} />
        </>
      )}
    </div>
  );
}
