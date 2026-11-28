import { useCallback, useEffect, useRef } from 'react';

/** 메틀리에가 넣어 두는 "뒤로 가기 막이" 기록 표시 */
const GUARD = 'metelier-back-guard';

/** 막이의 층: 0 이면 막이가 아니다. 막이는 두 층으로 쌓아, 뒤로 가기를 빠르게 두 번 눌러도 메틀리에 안에 머문다. */
const guardLevel = (state: unknown): number => {
  const v = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)[GUARD] : undefined;
  return v === true ? 2 : typeof v === 'number' ? v : 0;
};
const DEPTH = 2;

/**
 * 브라우저의 뒤로 가기(버튼, 휴대폰의 뒤로 가기 제스처)로 메틀리에가 바로 닫히지 않게 한다.
 * 방문 기록에 막이 하나를 더 넣어 두고, 뒤로 가기가 그 막이를 지우면 다시 넣은 뒤 onBack 을 부른다.
 *
 * 휴대폰 크롬은 사용자가 화면을 만지지 않은 채 넣은 기록을 뒤로 가기에서 건너뛰므로,
 * 막이는 터치·클릭·키 입력 때마다 (없으면) 다시 넣는다. 뒤로 가기를 아주 빠르게 두 번 누르면
 * 막이를 다시 넣기 전에 나가질 수 있어, block 이 참이면 브라우저의 "사이트에서 나갈까요?" 확인도 건다.
 *
 * @param block 참이면 페이지를 떠날 때 브라우저가 한 번 더 묻는다 (색칠 중)
 * @returns leave: 정말 나갈 때 부른다 (막이와 그 앞의 메틀리에 기록을 지나 이전 페이지로 간다)
 */
export function useBackGuard(onBack: () => void, block = false): { leave(): void } {
  const onBackRef = useRef(onBack);
  const leaving = useRef(false);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const arm = () => {
      if (leaving.current) return;
      const base = typeof history.state === 'object' && history.state !== null ? (history.state as Record<string, unknown>) : {};
      for (let level = guardLevel(history.state) + 1; level <= DEPTH; level++) history.pushState({ ...base, [GUARD]: level }, '');
    };
    // 사용자가 만질 때마다: 막이가 없으면 (뒤로 가기로 지워진 뒤) 다시 넣는다
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const remove = () => events.forEach((name) => window.removeEventListener(name, arm, true));
    events.forEach((name) => window.addEventListener(name, arm, true));

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

  // 막이를 지나쳐 나가려 할 때의 마지막 확인 (브라우저가 띄운다)
  useEffect(() => {
    if (!block) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [block]);

  const leave = useCallback(() => {
    leaving.current = true;
    // 쌓인 막이와 그 앞의 메틀리에 기록을 지나 이전 페이지로 간다.
    // 이전 페이지가 없으면(새 탭으로 연 경우) 창을 닫아 본다. 닫히지 않으면 그대로 남는다.
    history.go(-(guardLevel(history.state) + 1));
    window.setTimeout(() => {
      window.close();
      leaving.current = false;
    }, 400);
  }, []);

  return { leave };
}
