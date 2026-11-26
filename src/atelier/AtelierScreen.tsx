import { useEffect, useRef, useState } from 'react';
import { AtelierView } from './AtelierView';
import type { AtelierLayout } from './scene';
import './atelier.css';

interface AtelierScreenProps {
  layout: AtelierLayout;
  /** 색칠을 마치고 돌아왔을 때는 의자에 앉은 채로 시작한다. */
  startSeated: boolean;
  onStartColoring(): void;
}

export function AtelierScreen({ layout, startSeated, onStartColoring }: AtelierScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(onStartColoring);
  const [seated, setSeated] = useState(startSeated);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startRef.current = onStartColoring;
  }, [onStartColoring]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: AtelierView | null = null;

    AtelierView.create(
      host,
      layout,
      {
        onSeatedChange: setSeated,
        onEasel: () => startRef.current(),
        onUnavailable: (hotspot) => setToast(`"${hotspot.label}"는 곧 만나요`),
      },
      { startSeated },
    )
      .then((created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        view = created;
        setReady(true);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
      view?.destroy();
      setReady(false);
    };
  }, [layout, startSeated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="atelier" data-seated={seated} data-ready={ready}>
      <div className="atelier__canvas" ref={hostRef} />
      <header className="atelier__top">
        <div className="atelier__pill">Metelier</div>
      </header>
      {error && <p className="atelier__message">{error}</p>}
      {!error && !ready && <p className="atelier__message">화실에 들어가는 중…</p>}
      {ready && (
        <p className="atelier__hint">
          {seated ? '이젤을 눌러 색칠을 시작하세요' : '바닥을 누르면 걸어가요. 의자를 눌러 앉아 보세요'}
        </p>
      )}
      {toast && <p className="atelier__toast">{toast}</p>}
    </div>
  );
}
