import { useEffect, useRef, useState } from 'react';
import { hexToRgb, loadPainting, type PaintingMeta } from './painting';
import { ColoringView } from './view/ColoringView';
import './coloring.css';

type Tool = number | 'eraser';

export function ColoringScreen({ paintingId }: { paintingId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ColoringView | null>(null);
  const [meta, setMeta] = useState<PaintingMeta | null>(null);
  const [tool, setTool] = useState<Tool>(1);
  const [progress, setProgress] = useState({ filled: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: ColoringView | null = null;

    (async () => {
      try {
        const painting = await loadPainting(paintingId);
        if (cancelled) return;
        const created = await ColoringView.create(host, painting, {
          onProgress: (filled, total) => setProgress({ filled, total }),
        });
        if (cancelled) {
          created.destroy();
          return;
        }
        view = created;
        viewRef.current = created;
        setMeta(painting.meta);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
      setMeta(null);
    };
  }, [paintingId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !meta) return;
    if (tool === 'eraser') {
      view.setBrush({ kind: 'erase' });
      return;
    }
    const entry = meta.palette.find((p) => p.number === tool);
    view.setBrush(entry ? { kind: 'paint', color: hexToRgb(entry.color) } : null);
  }, [tool, meta]);

  return (
    <div className="coloring">
      <div className="coloring__canvas" ref={hostRef} />

      {error && <p className="coloring__message">{error}</p>}
      {!error && !meta && <p className="coloring__message">그림을 불러오는 중…</p>}

      {meta && (
        <>
          <header className="coloring__top">
            <div className="pill" aria-label="칠한 칸 수">
              🎨 {progress.filled} / {progress.total}
            </div>
            <div className="pill pill--title">{meta.title}</div>
            <button className="pill pill--button" onClick={() => viewRef.current?.clear()}>
              처음부터
            </button>
          </header>

          <footer className="palette" role="toolbar" aria-label="물감">
            {meta.palette.map((p) => (
              <button
                key={p.number}
                className={`pot${tool === p.number ? ' pot--selected' : ''}`}
                style={{ background: p.color }}
                aria-pressed={tool === p.number}
                aria-label={`${p.number}번 물감`}
                onClick={() => setTool(p.number)}
              >
                {p.number}
              </button>
            ))}
            <span className="palette__divider" />
            <button
              className={`pot pot--eraser${tool === 'eraser' ? ' pot--selected' : ''}`}
              aria-pressed={tool === 'eraser'}
              aria-label="지우개"
              onClick={() => setTool('eraser')}
            >
              🧽
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
