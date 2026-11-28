import { useEffect, useRef, useState } from 'react';
import { describeSync, useSync } from '../sync/SyncContext';
import { useAuth } from './AuthContext';

/** 화실 오른쪽 위의 로그인 버튼. 로그인하면 이름과 사진을 보여 주고, 누르면 로그아웃 메뉴가 열린다. */
export function UserButton() {
  const { user, loading, openLogin, signOut } = useAuth();
  const { status, flush, retry } = useSync();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  if (loading) return <div className="user-button user-button--loading" aria-hidden="true" />;

  if (!user) {
    return (
      <button className="user-button" data-testid="login-button" onClick={() => openLogin()}>
        로그인
      </button>
    );
  }

  return (
    <div className="user-menu" ref={ref}>
      <button
        className="user-button user-button--signed-in"
        data-testid="user-button"
        data-sync={status?.state ?? 'none'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {user.avatarUrl ? (
          <img className="user-button__avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="user-button__avatar user-button__avatar--initial">{user.name.slice(0, 1)}</span>
        )}
        <span className="user-button__name">{user.name}</span>
        {status && status.state !== 'idle' && <span className={`user-button__sync user-button__sync--${status.state}`} aria-hidden="true" />}
      </button>
      {menuOpen && (
        <div className="user-menu__panel" role="menu">
          {user.email && <p className="user-menu__email">{user.email}</p>}
          {status && (
            <p className={`user-menu__sync user-menu__sync--${status.state}`} data-testid="sync-status">
              {describeSync(status)}
            </p>
          )}
          {status?.state === 'error' && (
            <button className="user-menu__item" role="menuitem" onClick={retry}>
              다시 저장하기
            </button>
          )}
          <button
            className="user-menu__item"
            role="menuitem"
            data-testid="logout"
            disabled={signingOut}
            onClick={async () => {
              // 기다리던 것을 먼저 올리고 로그아웃한다
              setSigningOut(true);
              try {
                await flush();
              } finally {
                setSigningOut(false);
                setMenuOpen(false);
                await signOut();
              }
            }}
          >
            {signingOut ? '저장하고 로그아웃하는 중…' : '로그아웃'}
          </button>
        </div>
      )}
    </div>
  );
}

/** 로그인하지 않았을 때만 보이는 작은 권유 띠 (꾸미기, 사진 등록 창 안에 둔다) */
export function LoginNudge({ text, reason }: { text: string; reason: string }) {
  const { user, loading, openLogin } = useAuth();
  if (loading || user) return null;
  return (
    <div className="login-nudge" data-testid="login-nudge">
      <span>{text}</span>
      <button onClick={() => openLogin(reason)}>로그인</button>
    </div>
  );
}
