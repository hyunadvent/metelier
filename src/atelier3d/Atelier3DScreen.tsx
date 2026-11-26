import { useEffect, useRef, useState } from 'react';
import { Atelier3DView } from './Atelier3DView';
import '../atelier/atelier.css';
import './atelier3d.css';

interface Atelier3DScreenProps {
  /** 색칠을 마치고 돌아왔을 때는 의자에 앉은 채로 시작한다. */
  startSeated: boolean;
  onStartColoring(): void;
}

export function Atelier3DScreen({ startSeated, onStartColoring }: Atelier3DScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(onStartColoring);
  const [seated, setSeated] = useState(startSeated);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startRef.current = onStartColoring;
  }, [onStartColoring]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let view: Atelier3DView | null = null;
    try {
      view = new Atelier3DView(
        host,
        {
          onSeatedChange: setSeated,
          onEasel: () => startRef.current(),
          onUnavailable: (hotspot) => setToast(`"${hotspot.label}"는 곧 만나요`),
        },
        { startSeated },
      );
    } catch (e) {
      console.warn(e);
      setError('이 브라우저에서는 3D 화실을 열 수 없습니다 (WebGL 필요).');
    }
    return () => view?.destroy();
  }, [startSeated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="atelier atelier3d" data-seated={seated}>
      <div className="atelier__canvas" ref={hostRef} />
      <header className="atelier__top">
        <div className="atelier__pill">Metelier</div>
      </header>
      {error && <p className="atelier__message">{error}</p>}
      {!error && (
        <p className="atelier__hint">
          {seated
            ? '이젤을 눌러 색칠을 시작하세요'
            : '바닥을 누르거나 WASD로 걸어요 · 화면을 끌면 둘러봐요 · 의자를 눌러 앉아 보세요'}
        </p>
      )}
      {toast && <p className="atelier__toast">{toast}</p>}
    </div>
  );
}
