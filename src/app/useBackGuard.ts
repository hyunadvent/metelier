import { useCallback, useEffect, useRef } from 'react';

/** 메틀리에가 넣어 두는 "뒤로 가기 막이" 기록 표시 */
const GUARD = 'metelier-back-guard';

const isGuard = (state: unknown) => typeof state === 'object' && state !== null && (state as Record<string, unknown>)[GUARD] === true;

/**
 * 브라우저의 뒤로 가기(버튼, 휴대폰의 뒤로 가기 제스처)로 메틀리에가 바로 닫히지 않게 한다.
 * 방문 기록에 막이 하나를 더 넣어 두고, 뒤로 가기가 그 막이를 지우면 다시 넣은 뒤 onBack 을 부른다.
 *
 * 휴대폰 크롬은 사용자가 화면을 만지기 전에 넣은 기록을 뒤로 가기에서 건너뛰므로,
 * 막이는 첫 터치·클릭·키 입력 때 넣는다.
 *
 * @returns leave: 정말 나갈 때 부른다 (막이와 그 앞의 메틀리에 기록을 지나 이전 페이지로 간다)
 */
export function useBackGuard(onBack: () => void): { leave(): void } {
  const onBackRef = useRef(onBack);
  const leaving = useRef(false);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const arm = () => {
      if (leaving.current || isGuard(history.state)) return;
      history.pushState({ ...(history.state ?? {}), [GUARD]: true }, '');
    };
    const onFirstInput = () => {
      arm();
      remove();
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const remove = () => events.forEach((name) => window.removeEventListener(name, onFirstInput, true));
    events.forEach((name) => window.addEventListener(name, onFirstInput, true));

    const onPop = () => {
      if (leaving.current) return;
      // 뒤로 가기가 막이를 지웠다: 다시 넣고, 무엇을 할지는 화면이 정한다
      arm();
      onBackRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      remove();
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  const leave = useCallback(() => {
    leaving.current = true;
    // 막이 하나와 메틀리에 기록 하나를 지나 이전 페이지로 간다.
    // 이전 페이지가 없으면(새 탭으로 연 경우) 창을 닫아 본다. 닫히지 않으면 그대로 남는다.
    history.go(isGuard(history.state) ? -2 : -1);
    window.setTimeout(() => {
      window.close();
      leaving.current = false;
    }, 400);
  }, []);

  return { leave };
}
