import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { loadHintsDone, markHintDone, type HintAction } from '../atelier3d/hints';

/**
 * 안내에 나오는 조작 가운데 이미 해 본 것과, 해 봤다고 알리는 함수.
 * 로그인하지 않았으면 접속할 때마다 안내가 처음부터 나오고, 로그인했으면 이 기기에 기억한다.
 * mark 는 바뀌지 않는 함수라 자주 불러도 된다 (이미 해 본 것이면 아무것도 하지 않는다).
 */
export function useHintsDone(): [ReadonlySet<HintAction>, (action: HintAction) => void] {
  const { user } = useAuth();
  const loggedIn = user !== null;
  const loggedInRef = useRef(loggedIn);
  const [done, setDone] = useState(() => loadHintsDone(loggedIn));
  const doneRef = useRef(done);

  useEffect(() => {
    // 로그인 상태가 바뀌면 (로그인 확인이 끝났을 때 등) 저장된 것을 다시 읽는다
    loggedInRef.current = loggedIn;
    const next = loadHintsDone(loggedIn);
    doneRef.current = next;
    setDone(next);
  }, [loggedIn]);

  const mark = useCallback((action: HintAction) => {
    if (doneRef.current.has(action)) return;
    markHintDone(action, loggedInRef.current);
    const next = new Set(doneRef.current).add(action);
    doneRef.current = next;
    setDone(next);
  }, []);

  return [done, mark];
}
