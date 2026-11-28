import { useState } from 'react';
import { AtelierScreen } from '../atelier/AtelierScreen';
import { PLACEHOLDER_ATELIER } from '../atelier/scene';
import { Atelier3DScreen } from '../atelier3d/Atelier3DScreen';
import { useAuth } from '../auth/AuthContext';
import { SaveLoginPrompt } from '../auth/SaveLoginPrompt';
import { useSync } from '../sync/SyncContext';
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
  const { user, loading, openLogin } = useAuth();
  const { retry: syncNow } = useSync();
  /** 로그인하지 않은 채 색칠을 마치려 할 때 띄우는 안내 */
  const [askLogin, setAskLogin] = useState(false);
  const [screen, setScreen] = useState<'atelier' | 'coloring'>(launch.painting ? 'coloring' : 'atelier');
  // 색칠을 하다가 돌아오면 의자에 앉은 채로 화실이 열린다.
  const [returning, setReturning] = useState(false);
  const [paintingId, setPaintingId] = useState(launch.painting ?? DEFAULT_PAINTING);
  const startColoring = (id: string = launch.painting ?? DEFAULT_PAINTING) => {
    setPaintingId(id);
    setScreen('coloring');
  };

  const backToAtelier = () => {
    // 칠하던 것은 모아 두었다가 올리므로, 색칠을 마치면 바로 올린다
    syncNow();
    setAskLogin(false);
    setReturning(true);
    setScreen('atelier');
  };

  if (screen === 'coloring') {
    return (
      <>
        <ColoringScreen
          paintingId={paintingId}
          backdrop={launch.atelier === '2d' ? { kind: '2d', layout: PLACEHOLDER_ATELIER } : { kind: '3d' }}
          onSwitchPainting={setPaintingId}
          onExit={() => {
            // 칠한 것은 이미 이 브라우저에 저장했다. 로그인하지 않았으면 로그인을 권한다.
            if (user || loading) backToAtelier();
            else setAskLogin(true);
          }}
        />
        {askLogin && (
          <SaveLoginPrompt
            onLogin={() => {
              setAskLogin(false);
              openLogin('로그인하면 칠하던 그림이 저장돼 다른 기기에서도 이어서 칠할 수 있어요.');
            }}
            onSkip={backToAtelier}
            onClose={() => setAskLogin(false)}
          />
        )}
      </>
    );
  }
  return launch.atelier === '2d' ? (
    <AtelierScreen layout={PLACEHOLDER_ATELIER} startSeated={returning} onStartColoring={() => startColoring()} />
  ) : (
    <Atelier3DScreen startSeated={returning} onStartColoring={startColoring} />
  );
}
