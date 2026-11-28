import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LoginNudge } from '../auth/UserButton';
import type { PaintingMeta } from '../coloring/painting';
import type { StoredPainting } from '../storage/db';
import { packPhotoPainting, storePhotoPainting, titleFromFileName } from './photoStore';
import { DEFAULT_PHOTO_OPTIONS, photoToPainting, type PhotoStage } from './photoToPainting';
import { readPhoto, type Photo } from './readPhoto';
import './photoDialog.css';

const STAGE_LABEL: Record<PhotoStage | 'read' | 'pack', string> = {
  read: '사진을 읽는 중…',
  smooth: '만화풍으로 다듬는 중…',
  colors: '색을 묶는 중…',
  regions: '칸을 나누는 중…',
  lines: '선과 번호를 넣는 중…',
  pack: '그림을 마무리하는 중…',
};
const STAGE_ORDER: (PhotoStage | 'read' | 'pack')[] = ['read', 'smooth', 'colors', 'regions', 'lines', 'pack'];

/** 그림의 난이도: 칸과 색이 많을수록 원본에 가깝지만 칠하기 어렵다. */
export const PHOTO_LEVELS = {
  // narrowStrip: 이 폭(긴 변에 대한 비율, 절반 폭)보다 좁은 띠는 선 한 줄로 합친다. 쉬울수록 넓은 띠까지 합친다.
  easy: { label: '쉽게', colors: 10, maxRegions: 80, narrowStrip: 1 / 95 },
  normal: { label: '보통', colors: DEFAULT_PHOTO_OPTIONS.colors, maxRegions: DEFAULT_PHOTO_OPTIONS.maxRegions, narrowStrip: DEFAULT_PHOTO_OPTIONS.narrowStrip },
  fine: { label: '세밀하게', colors: 18, maxRegions: 260, narrowStrip: 1 / 260 },
} as const;
export type PhotoLevel = keyof typeof PHOTO_LEVELS;

interface PhotoDialogProps {
  onClose(): void;
  /** 그림을 등록(저장)했을 때. 칠할 그림은 이젤에서 고른다. */
  onSaved(title: string): void;
}

/** 그림 제목의 최대 길이 */
const MAX_TITLE = 30;

/** 화실의 카메라를 눌렀을 때 열리는 창: 사진을 골라 색칠 그림으로 바꾼다. */
export function PhotoDialog({ onClose, onSaved }: PhotoDialogProps) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [level, setLevel] = useState<PhotoLevel>('normal');
  const [stage, setStage] = useState<PhotoStage | 'read' | 'pack' | null>(null);
  const [result, setResult] = useState<StoredPainting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 등록할 그림의 제목. 사진을 고르면 파일 이름으로 채워 두고, 바꿀 수 있다. */
  const [title, setTitle] = useState('');
  const { user, loading, openLogin } = useAuth();
  /** 로그인하지 않은 채 등록하려 할 때: 로그인을 권하는 중 */
  const [askLogin, setAskLogin] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setAskLogin(false);
    setError(null);
    setResult(null);
    setStage('read');
    try {
      const read = await readPhoto(file);
      setPhoto(read);
      setTitle(titleFromFileName(read.name));
    } catch {
      setStage(null);
      setError('사진을 읽지 못했습니다. JPG, PNG, WebP 사진인지 확인해 주세요.');
    }
  };

  // 사진이나 난이도가 바뀌면 다시 변환한다
  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    const pause = async (next: PhotoStage | 'pack') => {
      if (cancelled) throw new Error('cancelled');
      setStage(next);
      // 진행 문구가 화면에 그려질 틈을 준다
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    const timer = window.setTimeout(async () => {
      try {
        const { colors, maxRegions, narrowStrip } = PHOTO_LEVELS[level];
        const painting = await photoToPainting(photo.rgba, photo.width, photo.height, { ...DEFAULT_PHOTO_OPTIONS, colors, maxRegions, narrowStrip }, pause, photo.detail);
        await pause('pack');
        const packed = await packPhotoPainting(titleFromFileName(photo.name), painting);
        if (cancelled) return;
        if (packed.meta && (packed.meta as PaintingMeta).regions.length === 0) throw new Error('이 사진에서는 칠할 칸을 찾지 못했습니다. 다른 사진을 골라 주세요.');
        setResult(packed);
        setStage(null);
      } catch (e) {
        if (cancelled) return;
        setStage(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [photo, level]);

  /** 그림을 이 브라우저에 저장한다. andLogin 이면 저장한 뒤 로그인 화면을 연다. */
  const register = async (andLogin = false) => {
    if (!result || saving) return;
    if (!user && !loading && !askLogin && !andLogin) {
      setAskLogin(true);
      return;
    }
    setSaving(true);
    try {
      const name = title.trim().slice(0, MAX_TITLE) || result.title;
      const named: StoredPainting = { ...result, title: name, meta: { ...(result.meta as PaintingMeta), title: name } };
      await storePhotoPainting(named);
      onSaved(name);
      if (andLogin) openLogin('로그인하면 등록한 그림이 저장돼 다른 기기에서도 칠할 수 있어요.');
    } catch {
      setSaving(false);
      setError('그림을 저장하지 못했습니다. 브라우저의 저장 공간이 부족할 수 있습니다.');
    }
  };

  const meta = result?.meta as PaintingMeta | undefined;
  const busy = stage !== null;

  return (
    <div className="photo-dialog__backdrop" role="presentation">
      <div className="photo-dialog" role="dialog" aria-modal="true" aria-label="사진으로 색칠 그림 만들기" data-testid="photo-dialog">
        <button className="photo-dialog__close" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <h2 className="photo-dialog__title">📷 사진으로 색칠 그림 만들기</h2>

        {!photo && !busy && (
          <label className="photo-dialog__drop">
            <strong>사진 고르기</strong>
            <span>사진은 이 기기 안에서만 바뀌고, 어디에도 보내지 않아요</span>
            <input type="file" accept="image/*" data-testid="photo-file" onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
        )}

        {busy && (
          <div className="photo-dialog__progress" data-testid="photo-progress">
            <div className="photo-dialog__bar">
              <span style={{ width: `${((STAGE_ORDER.indexOf(stage) + 1) / STAGE_ORDER.length) * 100}%` }} />
            </div>
            <p>{STAGE_LABEL[stage]}</p>
          </div>
        )}

        {result && meta && !busy && (
          <>
            <div className="photo-dialog__previews">
              <figure>
                <img className="photo-dialog__lines" src={result.lines} alt="색칠할 그림" />
                <figcaption>색칠할 그림</figcaption>
              </figure>
              <figure>
                <img src={result.reference} alt="다 칠한 모습" />
                <figcaption>다 칠한 모습</figcaption>
              </figure>
            </div>
            <p className="photo-dialog__count" data-testid="photo-count">
              칸 {meta.regions.length}개 · 물감 {meta.palette.length}색
            </p>
            <label className="photo-dialog__name">
              <span>그림 제목</span>
              <input
                type="text"
                value={title}
                maxLength={MAX_TITLE}
                placeholder={result.title}
                disabled={saving}
                data-testid="photo-title"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          </>
        )}

        {error && (
          <p className="photo-dialog__error" role="alert">
            {error}
          </p>
        )}

        {photo && (
          <div className="photo-dialog__levels" role="group" aria-label="난이도">
            {(Object.keys(PHOTO_LEVELS) as PhotoLevel[]).map((key) => (
              <button key={key} aria-pressed={level === key} disabled={busy || saving} data-level={key} onClick={() => setLevel(key)}>
                {PHOTO_LEVELS[key].label}
              </button>
            ))}
          </div>
        )}

        {askLogin && result && !busy && (
          <div className="photo-dialog__ask" data-testid="photo-login-ask">
            <p>
              <strong>로그인하면 이 그림이 저장돼요.</strong> 로그인하지 않으면 이 브라우저에만 임시로 저장되고, 브라우저 데이터를 지우면 사라질 수
              있어요.
            </p>
            <div className="photo-dialog__actions">
              <button className="photo-dialog__button" data-testid="photo-register-anyway" disabled={saving} onClick={() => void register(false)}>
                로그인 없이 등록
              </button>
              <button
                className="photo-dialog__button photo-dialog__button--primary"
                data-testid="photo-register-login"
                disabled={saving}
                onClick={() => void register(true)}
              >
                등록하고 로그인하기
              </button>
            </div>
          </div>
        )}

        {photo && !askLogin && <LoginNudge text="로그인하면 만든 그림이 저장돼요" reason="로그인하면 사진으로 만든 그림이 저장돼 다른 기기에서도 칠할 수 있어요." />}

        {photo && !askLogin && (
          <div className="photo-dialog__actions">
            <label className={`photo-dialog__button${busy || saving ? ' photo-dialog__button--disabled' : ''}`}>
              다른 사진
              <input type="file" accept="image/*" disabled={busy || saving} onChange={(e) => void choose(e.target.files?.[0])} />
            </label>
            <button className="photo-dialog__button photo-dialog__button--primary" data-testid="photo-register" disabled={!result || busy || saving} onClick={() => void register()}>
              그림 등록하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
