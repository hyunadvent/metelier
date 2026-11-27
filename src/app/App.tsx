import { useState } from 'react';
import { AtelierScreen } from '../atelier/AtelierScreen';
import { PLACEHOLDER_ATELIER } from '../atelier/scene';
import { Atelier3DScreen } from '../atelier3d/Atelier3DScreen';
import { ColoringScreen } from '../coloring/ColoringScreen';

const DEFAULT_PAINTING = 'hill-house';

interface Launch {
  /** ?painting=<id>: 그 그림의 색칠 화면으로 바로 들어간다 (그림 제작 도구에서 확인할 때 쓴다). */
  painting: string | null;
  /** ?atelier=2d: 예전 2D 화실을 연다. 기본은 3D 화실. */
  atelier: '2d' | '3d';
}

function readLaunch(): Launch {
  const params = new URLSearchParams(location.search);
  const id = params.get('painting');
  return {
    painting: id && /^[a-z0-9][a-z0-9-]{0,40}$/.test(id) ? id : null,
    atelier: params.get('atelier') === '2d' ? '2d' : '3d',
  };
}

export function App() {
  const [launch] = useState(readLaunch);
  const [screen, setScreen] = useState<'atelier' | 'coloring'>(launch.painting ? 'coloring' : 'atelier');
  // 색칠을 하다가 돌아오면 의자에 앉은 채로 화실이 열린다.
  const [returning, setReturning] = useState(false);
  const [paintingId, setPaintingId] = useState(launch.painting ?? DEFAULT_PAINTING);
  const startColoring = (id: string = launch.painting ?? DEFAULT_PAINTING) => {
    setPaintingId(id);
    setScreen('coloring');
  };

  if (screen === 'coloring') {
    return (
      <ColoringScreen
        paintingId={paintingId}
        backdrop={launch.atelier === '2d' ? { kind: '2d', layout: PLACEHOLDER_ATELIER } : { kind: '3d' }}
        onExit={() => {
          setReturning(true);
          setScreen('atelier');
        }}
      />
    );
  }
  return launch.atelier === '2d' ? (
    <AtelierScreen layout={PLACEHOLDER_ATELIER} startSeated={returning} onStartColoring={() => startColoring()} />
  ) : (
    <Atelier3DScreen startSeated={returning} onStartColoring={startColoring} />
  );
}
