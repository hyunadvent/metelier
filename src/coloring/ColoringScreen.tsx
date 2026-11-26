import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush } from './Brush';
import { CompleteDialog, ConfirmDialog, GalleryDialog } from './dialogs';
import { hexToRgb, loadPainting, type LoadedPainting, type PaintingMeta, type Tool } from './painting';
import { restoreSession, saveSession } from './persistence';
import { loadSettings, saveSettings, type Settings } from './settings';
import { sound } from './sound';
import { ColoringView } from './view/ColoringView';
import './coloring.css';

const ZOOM_STEP = 1.5;
const WHEEL_SENSITIVITY = 0.0015;
/** 칠이 바뀐 뒤 이만큼 기다렸다가 저장한다. */
const SAVE_DELAY_MS = 600;

type DialogKind = 'complete' | 'gallery' | 'reset' | null;

export function ColoringScreen({ paintingId }: { paintingId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const completedRef = useRef(false);
  const filledRef = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const onChangeRef = useRef<() => void>(() => {});

  const [view, setView] = useState<ColoringView | null>(null);
  const [painting, setPainting] = useState<LoadedPainting | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [progress, setProgress] = useState({ filled: 0, total: 0 });
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta: PaintingMeta | null = painting?.meta ?? null;

  // ── 그림 불러오기, 이어 칠하기 ─────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let created: ColoringView | null = null;

    (async () => {
      try {
        const loaded = await loadPainting(paintingId);
        if (cancelled) return;
        const v = await ColoringView.create(host, loaded, {
          onProgress: (filled, total) => setProgress({ filled, total }),
          onZoom: setZoom,
          onHistory: (undo, redo) => setHistory({ undo, redo }),
          onChange: () => onChangeRef.current(),
        });
        created = v;
        let completed = false;
        try {
          completed = await restoreSession(v, loaded.meta);
        } catch (e) {
          console.warn('저장된 그림을 불러오지 못했습니다.', e);
        }
        if (cancelled) {
          v.destroy();
          return;
        }
        completedRef.current = completed;
        filledRef.current = v.engine.filledCount();
        setView(v);
        setPainting(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      created?.destroy();
      setView(null);
      setPainting(null);
    };
  }, [paintingId]);

  // ── 자동 저장 ──────────────────────────────────────
  const saveNow = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!view || !meta) return;
    saveSession(view, meta, completedRef.current).catch((e) => console.warn('그림을 저장하지 못했습니다.', e));
  }, [view, meta]);

  useEffect(() => {
    onChangeRef.current = () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(saveNow, SAVE_DELAY_MS);
    };
    // 화면을 떠날 때는 기다리지 않고 바로 저장한다.
    const onHide = () => {
      if (document.visibilityState === 'hidden' && saveTimer.current !== null) saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (saveTimer.current !== null) saveNow();
    };
  }, [saveNow]);

  // ── 진행도: 칸을 다 칠했을 때, 그림을 완성했을 때 ──
  useEffect(() => {
    if (!view || progress.total === 0) return;
    if (progress.filled > filledRef.current) sound.fill();
    filledRef.current = progress.filled;
    if (progress.filled === progress.total && !completedRef.current) {
      completedRef.current = true;
      sound.complete();
      setDialog('complete');
      saveNow();
    }
  }, [progress, view, saveNow]);

  // 완성 화면에 보여 줄 작품 이미지
  useEffect(() => {
    if (dialog !== 'complete' || !view) return;
    let cancelled = false;
    let url: string | null = null;
    view
      .renderArtwork()
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setArtworkUrl(url);
      })
      .catch((e) => console.warn(e));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setArtworkUrl(null);
    };
  }, [dialog, view]);

  // ── 붓, 설정 ───────────────────────────────────────
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

  useEffect(() => {
    sound.setEnabled(settings.sound);
    view?.setLabelsVisible(settings.numbers);
    saveSettings(settings);
  }, [settings, view]);

  const pickTool = useCallback((next: Tool) => {
    setTool(next);
    sound.dip();
  }, []);

  const shakePalette = useCallback(() => {
    paletteRef.current?.animate(
      [{ translate: '0 0' }, { translate: '-8px 0' }, { translate: '8px 0' }, { translate: '-5px 0' }, { translate: '0 0' }],
      { duration: 360 },
    );
  }, []);

  // ── 휠 확대·축소, 단축키 ───────────────────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !view) return;
    // 붓이나 HUD 위에서 휠을 돌려도 확대·축소되도록 화면 전체에서 받는다.
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.dialog')) return;
      e.preventDefault();
      view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * WHEEL_SENSITIVITY));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) view.undo();
      else if (key === 'y' || (key === 'z' && e.shiftKey)) view.redo();
      else return;
      e.preventDefault();
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [view]);

  const closeDialog = useCallback(() => setDialog(null), []);

  const toggle = (key: keyof Settings) => (
    <label className="settings__row">
      <span>{{ sound: '효과음', numbers: '번호 표시', tapToPick: '물감을 눌러서 고르기' }[key]}</span>
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
      />
    </label>
  );

  return (
    <div className="coloring" ref={rootRef}>
      {/* 화실 배경 자리. M5 에서 꾸민 화실 장면(이젤 앞 시점)으로 바뀐다. */}
      <div className="coloring__backdrop" />
      <div className="coloring__canvas" ref={hostRef} />

      {error && <p className="coloring__message">{error}</p>}
      {!error && !meta && <p className="coloring__message">그림을 불러오는 중…</p>}

      {meta && view && painting && (
        <>
          <header className="coloring__top">
            <div className="pill" aria-label="칠한 칸 수">
              🎨 {progress.filled} / {progress.total}
            </div>
            <div className="pill pill--title">{meta.title}</div>
            <span className="coloring__spacer" />
            <div className="segmented" role="group" aria-label="되돌리기">
              <button aria-label="되돌리기" disabled={!history.undo} onClick={() => view.undo()}>
                ↶
              </button>
              <button aria-label="다시 하기" disabled={!history.redo} onClick={() => view.redo()}>
                ↷
              </button>
            </div>
            <div className="segmented" role="group" aria-label="확대·축소">
              <button aria-label="축소" disabled={zoom <= 1} onClick={() => view.zoomBy(1 / ZOOM_STEP)}>
                −
              </button>
              <button className="segmented__value" aria-label="화면에 맞추기" onClick={() => view.resetZoom()}>
                {Math.round(zoom * 100)}%
              </button>
              <button aria-label="확대" disabled={zoom >= 5} onClick={() => view.zoomBy(ZOOM_STEP)}>
                +
              </button>
            </div>
            <button
              className="icon-button"
              aria-label="완성 예시 보기"
              aria-pressed={showReference}
              onClick={() => setShowReference((v) => !v)}
            >
              👁
            </button>
            <button className="icon-button" aria-label="내 갤러리" onClick={() => setDialog('gallery')}>
              🖼
            </button>
            <button
              className="icon-button"
              aria-label="설정"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              ⚙
            </button>
          </header>

          {showReference && (
            <button className="reference" aria-label="완성 예시 닫기" onClick={() => setShowReference(false)}>
              <img src={painting.referenceUrl} alt="완성 예시" />
              <span>완성 예시</span>
            </button>
          )}

          {settingsOpen && (
            <div className="settings" role="group" aria-label="설정">
              {toggle('sound')}
              {toggle('numbers')}
              {toggle('tapToPick')}
              <button
                className="button button--danger"
                onClick={() => {
                  setSettingsOpen(false);
                  setDialog('reset');
                }}
              >
                처음부터 다시 칠하기
              </button>
            </div>
          )}

          {tool === null && <p className="coloring__hint">붓 손잡이를 잡고 물감에 붓끝을 담가 보세요</p>}

          <footer className="palette" ref={paletteRef} aria-label="물감">
            {meta.palette.map((p) => (
              <div
                key={p.number}
                className={`pot${tool === p.number ? ' pot--selected' : ''}${settings.tapToPick ? ' pot--tappable' : ''}`}
                style={{ background: p.color }}
                data-pot={p.number}
                aria-label={`${p.number}번 물감`}
                onClick={settings.tapToPick ? () => pickTool(p.number) : undefined}
              >
                {p.number}
              </div>
            ))}
            <span className="palette__divider" />
            <div
              className={`pot pot--eraser${tool === 'eraser' ? ' pot--selected' : ''}${settings.tapToPick ? ' pot--tappable' : ''}`}
              data-pot="eraser"
              aria-label="지우개"
              onClick={settings.tapToPick ? () => pickTool('eraser') : undefined}
            >
              🧽
            </div>
          </footer>

          <Brush view={view} palette={meta.palette} tool={tool} onDip={pickTool} onEmptyStroke={shakePalette} />

          {dialog === 'complete' && (
            <CompleteDialog artworkUrl={artworkUrl} onClose={closeDialog} onGallery={() => setDialog('gallery')} />
          )}
          {dialog === 'gallery' && <GalleryDialog onClose={closeDialog} />}
          {dialog === 'reset' && (
            <ConfirmDialog
              title="처음부터 다시 칠할까요?"
              text="지금까지 칠한 것이 모두 지워지고 되돌릴 수 없어요. 갤러리에 걸린 작품은 그대로 남아요."
              confirmLabel="모두 지우기"
              onClose={closeDialog}
              onConfirm={() => {
                completedRef.current = false;
                view.clear();
                setDialog(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
