import { useCallback, useEffect, useRef } from 'react';

/** 메틀리에가 넣어 두는 "뒤로 가기 막이" 기록 표시 */
const GUARD = 'metelier-back-guard';

/** 막이의 층: 0 이면 막이가 아니다. 여러 층으로 쌓아, 뒤로 가기를 빠르게 여러 번 눌러도 메틀리에 안에 머문다. */
const guardLevel = (state: unknown): number => {
  const v = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)[GUARD] : undefined;
  return v === true ? 2 : typeof v === 'number' ? v : 0;
};
/**
 * 막이를 이만큼까지 쌓는다. 한 번 만질 때 한 층씩만 쌓는다:
 * 크롬(안드로이드 웹뷰, 카카오톡 인앱 브라우저 포함)은 사용자가 만지지 않은 채 다음 기록을 넣은 항목을
 * 뒤로 가기에서 건너뛰고, 건너뛸 항목만 남으면 뒤로 가기가 창을 닫는다.
 * 그래서 뒤로 가기 직후(만지지 않은 때)에는 다시 쌓지 않고, 다음에 만질 때 쌓는다.
 */
const DEPTH = 3;

/**
 * 브라우저의 뒤로 가기(버튼, 휴대폰의 뒤로 가기 제스처)로 메틀리에가 바로 닫히지 않게 한다.
 * 방문 기록에 막이를 몇 층 쌓아 두고(만질 때마다 한 층씩), 뒤로 가기가 한 층을 지우면 onBack 을 부른다.
 * block 이 참이면 막이를 다 지나쳐 나가려 할 때 브라우저의 "사이트에서 나갈까요?" 확인도 건다.
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
    let lastArm = 0;
    const arm = () => {
      if (leaving.current) return;
      // 한 번 만질 때 한 층만 (손을 뗄 때와 눌림이 함께 오므로)
      const now = performance.now();
      if (now - lastArm < 250) return;
      lastArm = now;
      const base = typeof history.state === 'object' && history.state !== null ? (history.state as Record<string, unknown>) : {};
      const level = guardLevel(history.state);
      if (level < DEPTH) history.pushState({ ...base, [GUARD]: level + 1 }, '');
    };
    // 사용자가 만질 때마다 모자란 막이를 한 층 쌓는다. 크롬은 터치를 손을 뗄 때(pointerup, touchend, click)에야
    // 사용자의 동작으로 치므로, 누를 때(pointerdown, touchstart)가 아니라 뗄 때 쌓는다.
    const events = ['pointerup', 'touchend', 'click', 'keydown'] as const;
    const remove = () => events.forEach((name) => window.removeEventListener(name, arm, true));
    events.forEach((name) => window.addEventListener(name, arm, true));

    const onPop = () => {
      if (leaving.current) return;
      // 뒤로 가기가 막이 한 층을 지웠다. 여기서 다시 쌓으면 (만지지 않은 채 넣은 기록이 되어) 크롬이
      // 이 항목을 건너뛰게 되므로 쌓지 않는다. 다음에 만질 때 쌓는다. 무엇을 할지는 화면이 정한다.
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
