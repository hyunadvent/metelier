import { useState } from 'react';
import { AtelierScreen } from '../atelier/AtelierScreen';
import { PLACEHOLDER_ATELIER } from '../atelier/scene';
import { ColoringScreen } from '../coloring/ColoringScreen';

const DEFAULT_PAINTING = 'hill-house';

/** 주소에 ?painting=<id> 가 있으면 그 그림의 색칠 화면으로 바로 들어간다 (그림 제작 도구에서 확인할 때 쓴다). */
function requestedPainting(): string | null {
  const id = new URLSearchParams(location.search).get('painting');
  return id && /^[a-z0-9][a-z0-9-]{0,40}$/.test(id) ? id : null;
}

export function App() {
  const [direct] = useState(requestedPainting);
  const [screen, setScreen] = useState<'atelier' | 'coloring'>(direct ? 'coloring' : 'atelier');
  // 색칠을 하다가 돌아오면 의자에 앉은 채로 화실이 열린다.
  const [returning, setReturning] = useState(false);

  if (screen === 'coloring') {
    return (
      <ColoringScreen
        paintingId={direct ?? DEFAULT_PAINTING}
        atelier={PLACEHOLDER_ATELIER}
        onExit={() => {
          setReturning(true);
          setScreen('atelier');
        }}
      />
    );
  }
  return <AtelierScreen layout={PLACEHOLDER_ATELIER} startSeated={returning} onStartColoring={() => setScreen('coloring')} />;
}
