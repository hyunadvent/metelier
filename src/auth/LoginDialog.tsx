import { useEffect, useState } from 'react';
import { LOGIN_PROVIDERS, type LoginProviderId } from './auth';
import { useAuth } from './AuthContext';

/** 구글 로고 (공식 네 가지 색) */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function KakaoMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="#191600" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.4.3.7.6.5l4.3-2.8c.5.1.9.1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z" />
    </svg>
  );
}

/** 로그인 화면: 지금은 구글로만 로그인한다. 카카오는 준비 중으로 보여 준다. */
export function LoginDialog({ reason, onClose }: { reason: string; onClose(): void }) {
  const { mode, signIn } = useAuth();
  const [busy, setBusy] = useState<LoginProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = async (provider: LoginProviderId) => {
    setBusy(provider);
    setError(null);
    try {
      // Supabase 는 여기서 구글 로그인 페이지로 떠났다가, 로그인을 마치면 화실로 돌아온다.
      await signIn(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인하지 못했어요. 잠시 뒤 다시 해 주세요.');
      setBusy(null);
    }
  };

  return (
    <div className="auth-dialog" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="auth-dialog__card" role="dialog" aria-modal="true" aria-label="로그인" data-testid="login-dialog">
        <button className="auth-dialog__close" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <p className="auth-dialog__logo">Metelier</p>
        <h2 className="auth-dialog__title">로그인</h2>
        {reason && <p className="auth-dialog__reason">{reason}</p>}
        <p className="auth-dialog__text">
          로그인하면 꾸민 화실과 칠하던 그림을 다른 브라우저나 다른 PC에서도 이어서 쓸 수 있어요. 둘러보기와 색칠은 로그인하지 않아도 할 수 있어요.
        </p>
        <div className="auth-dialog__providers">
          {LOGIN_PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={`auth-provider auth-provider--${p.id}`}
              data-provider={p.id}
              disabled={!p.available || mode === 'off' || busy !== null}
              onClick={() => void start(p.id)}
            >
              {p.id === 'google' ? <GoogleMark /> : <KakaoMark />}
              <span>{busy === p.id ? '로그인 화면으로 가는 중…' : p.label}</span>
              {!p.available && <em>준비 중</em>}
            </button>
          ))}
        </div>
        {mode === 'off' && <p className="auth-dialog__note">로그인은 준비 중이에요. 지금은 이 브라우저에만 저장돼요.</p>}
        {mode === 'dev' && <p className="auth-dialog__note">개발용 가짜 로그인이에요 (Supabase 설정이 없어 어디에도 접속하지 않아요).</p>}
        {error && (
          <p className="auth-dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
