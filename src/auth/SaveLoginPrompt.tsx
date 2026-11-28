import { useEffect } from 'react';

interface SaveLoginPromptProps {
  /** 로그인 화면을 연다 */
  onLogin(): void;
  /** 로그인하지 않고 화실로 돌아간다 */
  onSkip(): void;
  /** 색칠 화면에 남는다 */
  onClose(): void;
}

/** 로그인하지 않은 채 색칠을 마치고 화실로 돌아가려 할 때 띄운다. */
export function SaveLoginPrompt({ onLogin, onSkip, onClose }: SaveLoginPromptProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="auth-dialog" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="auth-dialog__card" role="dialog" aria-modal="true" aria-label="저장하려면 로그인이 필요해요" data-testid="save-login-prompt">
        <button className="auth-dialog__close" aria-label="색칠로 돌아가기" onClick={onClose}>
          ×
        </button>
        <h2 className="auth-dialog__title">저장하려면 로그인이 필요해요</h2>
        <p className="auth-dialog__text">
          지금 칠한 그림은 이 브라우저에만 임시로 저장돼 있어요. 로그인하면 다른 브라우저나 다른 PC에서도 이어서 칠할 수 있어요.
        </p>
        <p className="save-prompt__warning">
          로그인하지 않으면 브라우저 데이터를 지우거나 시간이 지나 저장 공간이 정리될 때 칠한 그림이 초기화될 수 있어요.
        </p>
        <div className="save-prompt__actions">
          <button className="save-prompt__button save-prompt__button--primary" data-testid="save-login" onClick={onLogin}>
            로그인하고 저장하기
          </button>
          <button className="save-prompt__button" data-testid="save-skip" onClick={onSkip}>
            로그인 없이 화실로 가기
          </button>
        </div>
      </div>
    </div>
  );
}
