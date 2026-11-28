import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authBackend, type AuthBackend, type AuthMode, type LoginProviderId, type MetelierUser } from './auth';
import { LoginDialog } from './LoginDialog';
import './auth.css';

export interface AuthValue {
  mode: AuthMode;
  /** 로그인 상태를 확인하는 중이면 true */
  loading: boolean;
  user: MetelierUser | null;
  /** 로그인 화면을 연다. reason 은 화면 위쪽에 보여 줄 안내 */
  openLogin(reason?: string): void;
  signIn(provider: LoginProviderId): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children, backend = authBackend }: { children: ReactNode; backend?: AuthBackend }) {
  const [user, setUser] = useState<MetelierUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** 로그인 화면이 열려 있으면 그 안내 문구 (안내가 없으면 빈 문자열) */
  const [loginReason, setLoginReason] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const stop = backend.subscribe((next) => {
      if (!alive) return;
      setUser(next);
      setLoading(false);
    });
    backend
      .currentUser()
      .then((current) => alive && setUser(current))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      stop();
    };
  }, [backend]);

  const openLogin = useCallback((reason?: string) => setLoginReason(reason ?? ''), []);
  const signIn = useCallback((provider: LoginProviderId) => backend.signIn(provider), [backend]);
  const signOut = useCallback(() => backend.signOut(), [backend]);

  // 로그인되면 로그인 화면을 닫는다 (개발용 가짜 로그인처럼 페이지를 떠나지 않는 경우)
  useEffect(() => {
    if (user) setLoginReason(null);
  }, [user]);

  const value = useMemo<AuthValue>(
    () => ({ mode: backend.mode, loading, user, openLogin, signIn, signOut }),
    [backend.mode, loading, user, openLogin, signIn, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {loginReason !== null && !user && <LoginDialog reason={loginReason} onClose={() => setLoginReason(null)} />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 안에서만 쓸 수 있습니다.');
  return value;
}
