import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AtelierLayout } from '../atelier/scene';
import { EaselBackdrop, type ScreenRect } from '../atelier3d/EaselBackdrop';
import { Brush } from './Brush';
import { StardustOverlay } from './StardustOverlay';
import { PaintingPicker } from '../photo/PaintingPicker';
import { BUILTIN_PAINTINGS } from './builtinPaintings';
import { loadDecor } from '../atelier3d/decor';
import { listStoredPaintings, type StoredPaintingSummary } from '../storage/db';
import { useHintsDone } from '../app/useHintsDone';
import { brushScale, onPaintBuff, paintBuffLeft } from '../app/paintBuff';
import { CompleteDialog, ConfirmDialog, GalleryDialog } from './dialogs';
import { hexToRgb, isCustomTool, loadPainting, type LoadedPainting, type PaintingMeta, type Tool } from './painting';
import { onRemoteApplied } from '../storage/changes';
import { restoreSession, saveSession } from './persistence';
import { loadSettings, saveSettings, type Settings } from './settings';
import { sound } from './sound';
import { ColoringView } from './view/ColoringView';
import './coloring.css';

const WHEEL_SENSITIVITY = 0.0015;
/** 칠이 바뀐 뒤 이만큼 기다렸다가 저장한다. */
const SAVE_DELAY_MS = 1200;

type DialogKind = 'complete' | 'gallery' | 'reset' | null;

interface ColoringScreenProps {
  paintingId: string;
  /** 캔버스 뒤에 보일 화실: 3D 화실, 또는 예전 2D 화실. 없으면 단색 배경. */
  backdrop?: { kind: '3d' } | { kind: '2d'; layout: AtelierLayout };
  /** 주면 왼쪽 위에 화실로 돌아가는 버튼이 생긴다. */
  onExit?(): void;
  /** 주면 제목을 눌러 다른 그림으로 바꿀 수 있다 (지금 그림을 저장한 뒤 부른다). */
  onSwitchPainting?(paintingId: string): void;
  /**
   * 브라우저의 뒤로 가기를 누른 횟수 (누를 때마다 1씩 는다).
   * 처음 한 번은 실수일 수 있어 넘어가고, 두 번째부터 화실로 갈지 묻는다.
   */
  backPresses?: number;
}

export function ColoringScreen({ paintingId, backdrop, onExit, onSwitchPainting, backPresses = 0 }: ColoringScreenProps) {
  const atelier = backdrop?.kind === '2d' ? backdrop.layout : undefined;
  const use3d = backdrop?.kind === '3d';
  const backdropHostRef = useRef<HTMLDivElement>(null);
  const backdrop3dRef = useRef<EaselBackdrop | null>(null);
  const paperRef = useRef<{ paper: ScreenRect; width: number; height: number } | null>(null);
  /** 이젤을 종이에 다시 맞추려고 잡아 둔 다음 프레임 */
  const followFrame = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const completedRef = useRef(false);
  const filledRef = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const onChangeRef = useRef<() => void>(() => {});
  /** 연 뒤로 칠하거나 지운 것이 있는가. 없으면 저장하지 않는다: 아무것도 안 하고 나갈 때 빈 그림이
   *  "새로 저장한 것" 이 되어, 다른 기기에서 칠한 것을 덮어쓰지 않게 한다. */
  const dirtyRef = useRef(false);

  const [view, setView] = useState<ColoringView | null>(null);
  const [painting, setPainting] = useState<LoadedPainting | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [progress, setProgress] = useState({ filled: 0, total: 0 });
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 나만의 물감 (화실 책상의 팔레트에서 만든다) */
  const [customColors, setCustomColors] = useState(() => loadDecor().colors ?? []);
  /** 물감 줄 오른쪽의 "내 물감" 이 펼쳐져 있는가 */
  const [customOpen, setCustomOpen] = useState(false);
  useEffect(
    () =>
      // 다른 기기에서 만든 물감을 받아 오면 바로 보여 준다
      onRemoteApplied((kinds) => {
        if (kinds.has('decor')) setCustomColors(loadDecor().colors ?? []);
      }),
    [],
  );
  /** 뒤로 가기를 두 번째 눌렀을 때 화실로 갈지 묻는 창 */
  const [askExit, setAskExit] = useState(false);
  const firstBack = useRef<number | null>(null);
  /** 이 화면을 열 때의 횟수: 그 전에 누른 것(화실에서 등)은 세지 않는다 */
  const backBaseline = useRef(backPresses);
  useEffect(() => {
    if (backPresses === backBaseline.current || !onExit) return;
    if (firstBack.current === null) {
      // 처음 한 번은 넘어간다
      firstBack.current = backPresses;
      return;
    }
    setAskExit(true);
  }, [backPresses, onExit]);
  /** 제목을 눌러 그림을 바꾸는 중이면 사진으로 만든 그림의 목록 */
  const [choices, setChoices] = useState<StoredPaintingSummary[] | null>(null);
  const meta: PaintingMeta | null = painting?.meta ?? null;
  /** 붓 다루는 법을 해 봤는가. 로그인하지 않았으면 접속할 때마다 다시 알려 준다. */
  const [hintsDone, markHint] = useHintsDone();
  /** 색칠 버프가 남은 시간 (초). 걸려 있지 않으면 0 */
  const [buffLeft, setBuffLeft] = useState(() => Math.ceil(paintBuffLeft() / 1000));
  /** 필요한 곳을 모두 칠한 물감 번호 (칠한 칸 수가 바뀔 때마다 다시 센다) */
  const filledCount = progress.filled;
  const done = useMemo(() => (view && filledCount >= 0 ? view.finishedColors() : new Set<number>()), [view, filledCount]);

  // ── 3D 화실 배경 (이젤 앞 시점) ────────────────────
  useEffect(() => {
    const host = backdropHostRef.current;
    if (!use3d || !host) return;
    let created: EaselBackdrop | null = null;
    try {
      created = new EaselBackdrop(host);
      backdrop3dRef.current = created;
      const last = paperRef.current;
      if (last) created.place(last.paper, last.width, last.height);
    } catch (e) {
      console.warn('3D 화실 배경을 그릴 수 없습니다.', e);
    }
    return () => {
      created?.destroy();
      backdrop3dRef.current = null;
    };
  }, [use3d]);

  // ── 그림 불러오기, 이어 칠하기 ─────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let created: ColoringView | null = null;

    (async () => {
      try {
        dirtyRef.current = false;
        const loaded = await loadPainting(paintingId);
        if (cancelled) return;
        const v = await ColoringView.create(host, loaded, {
          onProgress: (filled, total) => setProgress({ filled, total }),
          // 확대·축소 버튼을 없앴으므로 배율은 보여 주지 않는다 (휠·두 손가락으로 확대)
          onZoom: () => {},
          onHistory: (undo, redo) => setHistory({ undo, redo }),
          onChange: () => onChangeRef.current(),
          onLayout: (paper, width, height) => {
            paperRef.current = { paper, width, height };
            backdrop3dRef.current?.place(paper, width, height);
          },
          // 확대·축소, 옮기기: 이젤도 함께 따라와 종이가 늘 이젤 위에 있다 (한 프레임에 한 번만 다시 그린다)
          onPaperMove: (paper, width, height) => {
            paperRef.current = { paper, width, height };
            if (followFrame.current) return;
            followFrame.current = requestAnimationFrame(() => {
              followFrame.current = 0;
              const last = paperRef.current;
              if (last) backdrop3dRef.current?.place(last.paper, last.width, last.height);
            });
          },
        }, { atelier });
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
      cancelAnimationFrame(followFrame.current);
      followFrame.current = 0;
      created?.destroy();
      setView(null);
      setPainting(null);
    };
  }, [paintingId, atelier]);

  // ── 자동 저장 ──────────────────────────────────────
  const saveNow = useCallback((): Promise<void> => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!view || !meta || !dirtyRef.current) return Promise.resolve();
    dirtyRef.current = false;
    return saveSession(view, meta, completedRef.current).catch((e) => console.warn('그림을 저장하지 못했습니다.', e));
  }, [view, meta]);

  useEffect(() => {
    onChangeRef.current = () => {
      dirtyRef.current = true;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveNow(), SAVE_DELAY_MS);
    };
    // 화면을 떠날 때는 기다리지 않고 바로 저장한다.
    const onHide = () => {
      if (document.visibilityState === 'hidden' && saveTimer.current !== null) void saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (saveTimer.current !== null) void saveNow();
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
      void saveNow();
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

  const paperRect = useCallback(() => paperRef.current?.paper ?? null, []);

  // ── 색칠 버프: 걸려 있는 동안 붓 범위 2배, 남은 시간 표시 ──
  useEffect(() => {
    const tick = () => {
      setBuffLeft(Math.ceil(paintBuffLeft() / 1000));
      view?.setBrushScale(brushScale());
    };
    tick();
    const timer = window.setInterval(tick, 500);
    const stop = onPaintBuff(tick);
    return () => {
      window.clearInterval(timer);
      stop();
    };
  }, [view]);

  // ── 붓, 설정 ───────────────────────────────────────
  useEffect(() => {
    if (!view || !meta) return;
    if (tool === null) {
      view.setBrush(null);
    } else if (tool === 'eraser') {
      view.setBrush({ kind: 'erase' });
    } else if (isCustomTool(tool)) {
      view.setBrush({ kind: 'paint', color: hexToRgb(tool) });
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

  const pickTool = useCallback(
    (next: Tool) => {
      setTool(next);
      sound.dip();
      if (next !== 'eraser') markHint('dip');
    },
    [markHint],
  );
  const onPaint = useCallback(() => {
    if (tool !== 'eraser') markHint('paint');
  }, [tool, markHint]);

  /** 붓 안내: 먼저 손잡이를 잡아 물감에 담그고, 그다음 붓 끝으로 칠한다 */
  const brushCue: 'handle' | 'tip' | null =
    tool === null ? (hintsDone.has('dip') ? null : 'handle') : tool !== 'eraser' && !hintsDone.has('paint') ? 'tip' : null;

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
      <span>{{ sound: '효과음', numbers: '번호 표시' }[key]}</span>
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
      />
    </label>
  );

  return (
    <div className="coloring" ref={rootRef}>
      {/* 화실 배경 자리: 3D 화실이면 여기에 이젤 앞 시점이 그려진다. */}
      <div className="coloring__backdrop" ref={backdropHostRef} />
      <div className="coloring__canvas" ref={hostRef} />
      {/* 색칠 버프가 걸려 있는 동안 캔버스 위로 떨어지는 별가루 */}
      <StardustOverlay active={buffLeft > 0} paperRect={paperRect} />

      {error && <p className="coloring__message">{error}</p>}
      {!error && !meta && <p className="coloring__message">그림을 불러오는 중…</p>}

      {meta && view && painting && (
        <>
          <header className="coloring__top">
            {onExit && (
              <button
                className="icon-button icon-button--labeled"
                aria-label="화실로 돌아가기"
                title="화실로 돌아가기"
                onClick={() => {
                  void saveNow().then(onExit);
                }}
              >
                <span aria-hidden="true">🏠</span>
                <span className="icon-button__label">화실</span>
              </button>
            )}
            {buffLeft > 0 && (
              <div className="pill pill--buff" aria-label={`색칠 버프: 붓 범위 2배, ${buffLeft}초 남음`} title="차를 마셔서 붓이 2배로 넓게 칠해져요">
                ✨ ×2 · {buffLeft}초
              </div>
            )}
            <div className="pill" aria-label="칠한 칸 수">
              🎨 {progress.filled} / {progress.total}
            </div>
            {onSwitchPainting ? (
              <button
                className="pill pill--title pill--button"
                aria-label={`${meta.title} · 다른 그림 고르기`}
                title="눌러서 다른 그림 고르기"
                onClick={() => {
                  void listStoredPaintings()
                    .catch(() => [])
                    .then(setChoices);
                }}
              >
                {meta.title} <span aria-hidden="true">▾</span>
              </button>
            ) : (
              <div className="pill pill--title">{meta.title}</div>
            )}
            <span className="coloring__spacer" />
            {/* 휴대폰 세로 화면에서 되돌리기·확대를 아랫줄로 내리는 줄바꿈 */}
            <span className="coloring__break" />
            <div className="segmented" role="group" aria-label="되돌리기">
              <button aria-label="되돌리기" disabled={!history.undo} onClick={() => view.undo()}>
                ↶
              </button>
              <button aria-label="다시 하기" disabled={!history.redo} onClick={() => view.redo()}>
                ↷
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

          {brushCue === 'handle' && <p className="coloring__hint">반짝이는 붓 손잡이를 잡고 물감에 붓끝을 담그거나, 물감을 눌러 골라요</p>}
          {brushCue === 'tip' && <p className="coloring__hint">원하는 칸에 붓 끝을 대고 끌어서 색을 칠해요</p>}

          <footer className="palette" ref={paletteRef} aria-label="물감">
            {meta.palette.map((p) => (
              <div
                key={p.number}
                className={`pot${tool === p.number ? ' pot--selected' : ''} pot--tappable${done.has(p.number) ? ' pot--done' : ''}`}
                style={{ background: p.color }}
                data-pot={p.number}
                aria-label={`${p.number}번 물감${done.has(p.number) ? ' (다 칠했어요)' : ''}`}
                title={done.has(p.number) ? '이 색은 다 칠했어요' : undefined}
                onClick={() => pickTool(p.number)}
              >
                {p.number}
              </div>
            ))}
            <span className="palette__divider" />
            <div
              className={`pot pot--eraser${tool === 'eraser' ? ' pot--selected' : ''} pot--tappable`}
              data-pot="eraser"
              aria-label="지우개"
              title="지우개"
              onClick={() => pickTool('eraser')}
            >
              {/* 비스듬히 놓인 지우개: 분홍 고무에 파란 종이 띠, 아래로 지운 자국 */}
              <svg className="pot__eraser" viewBox="0 0 40 40" aria-hidden="true">
                <path d="M6 33 H22" stroke="#c9b6a4" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 4" />
                <g transform="rotate(-38 20 20)">
                  <rect x="5" y="14" width="30" height="13" rx="3.5" fill="#f6a5b8" stroke="#8a5a4a" strokeWidth="2" />
                  <rect x="18" y="14" width="10" height="13" fill="#7fb2e5" stroke="#8a5a4a" strokeWidth="2" />
                  <path d="M8 17.5 H15" stroke="#fff" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
                </g>
              </svg>
            </div>
            {/* 나만의 물감: 화실 책상의 팔레트에서 만든 색 */}
            <button
              className={`pot pot--custom${isCustomTool(tool) ? ' pot--selected' : ''}`}
              style={isCustomTool(tool) ? { background: tool } : undefined}
              aria-label="내 물감"
              aria-expanded={customOpen}
              title="내 물감"
              data-testid="custom-colors-button"
              onClick={() => setCustomOpen((v) => !v)}
            >
              {!isCustomTool(tool) && <span aria-hidden="true">🎨</span>}
            </button>
          </footer>

          {customOpen && (
            <div className="custom-colors" role="group" aria-label="내 물감" data-testid="custom-colors">
              <p className="custom-colors__title">내 물감</p>
              {customColors.length === 0 ? (
                <p className="custom-colors__empty">화실 책상 위의 팔레트를 눌러 나만의 물감을 만들어 보세요</p>
              ) : (
                <div className="custom-colors__pots">
                  {customColors.map((c) => (
                    <div
                      key={c}
                      className={`pot pot--small pot--tappable${tool === c ? ' pot--selected' : ''}`}
                      style={{ background: c }}
                      data-pot={c}
                      aria-label={`내 물감 ${c}`}
                      onClick={() => pickTool(c as Tool)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <Brush view={view} palette={meta.palette} tool={tool} onDip={pickTool} onEmptyStroke={shakePalette} onPaint={onPaint} cue={brushCue} />

          {dialog === 'complete' && (
            <CompleteDialog artworkUrl={artworkUrl} onClose={closeDialog} onGallery={() => setDialog('gallery')} />
          )}
          {dialog === 'gallery' && <GalleryDialog onClose={closeDialog} />}
          {askExit && onExit && (
            <ConfirmDialog
              title="색칠을 마치고 화실로 갈까요?"
              text="지금까지 칠한 것은 저장돼요. 화실에서 이젤을 누르면 이어서 칠할 수 있어요."
              confirmLabel="화실로 나가기"
              onClose={() => {
                setAskExit(false);
                // 다시 처음 한 번은 넘어가도록
                firstBack.current = null;
              }}
              onConfirm={() => {
                setAskExit(false);
                firstBack.current = null;
                void saveNow().then(onExit);
              }}
            />
          )}
          {choices && onSwitchPainting && (
            <PaintingPicker
              builtins={BUILTIN_PAINTINGS}
              hung={new Set(loadDecor().wall.map((p) => p.paintingId).filter((id) => id !== paintingId))}
              photos={choices}
              onPick={(id) => {
                setChoices(null);
                if (id === paintingId) return;
                // 지금 그림을 저장한 뒤 바꾼다
                void saveNow().then(() => onSwitchPainting(id));
              }}
              onClose={() => setChoices(null)}
              onChange={setChoices}
            />
          )}
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
