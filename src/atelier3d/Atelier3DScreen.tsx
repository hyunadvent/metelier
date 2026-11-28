import { useEffect, useRef, useState } from 'react';
import { Atelier3DView } from './Atelier3DView';
import { WALL_SIZE_INFO, WALL_SIZE_KINDS, type WallPictureSizeKind, FRAME_INFO, FRAME_KINDS, loadDecor, MAX_WALL_PICTURES, PLANT_INFO, PLANT_KINDS, saveDecor, type PlantKind, type PlantSlot } from './decor';
import { WallPicker } from './WallPicker';
import { LoginNudge, UserButton } from '../auth/UserButton';
import { onRemoteApplied } from '../storage/changes';
import { useSync } from '../sync/SyncContext';
import { isTouchDevice } from '../app/device';
import type { Activity } from './room';
import { hintItems } from './hints';
import { useHintsDone } from '../app/useHintsDone';
import { useAuth } from '../auth/AuthContext';
import { PaintingPicker } from '../photo/PaintingPicker';
import { PaletteDialog } from './PaletteDialog';
import { PhotoDialog } from '../photo/PhotoDialog';
import { listStoredPaintings, type StoredPaintingSummary } from '../storage/db';
import { BUILTIN_PAINTINGS } from '../coloring/builtinPaintings';
import '../atelier/atelier.css';
import './atelier3d.css';

interface Atelier3DScreenProps {
  /** 색칠을 마치고 돌아왔을 때는 의자에 앉은 채로 시작한다. */
  startSeated: boolean;
  /** @param paintingId 칠할 그림. 주지 않으면 기본 그림 */
  onStartColoring(paintingId?: string): void;
}



export function Atelier3DScreen({ startSeated, onStartColoring }: Atelier3DScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(onStartColoring);
  const [activity, setActivity] = useState<Activity | null>(startSeated ? 'paint' : null);
  const viewRef = useRef<Atelier3DView | null>(null);
  const [decor, setDecor] = useState(loadDecor);
  /** 화분을 고르는 중인 자리. 고르는 창이 닫혀 있으면 null. */
  const [plantSlot, setPlantSlot] = useState<PlantSlot | null>(null);
  /** 책상 위의 팔레트를 눌러 나만의 물감을 만드는 창이 열려 있는지 */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** 카메라를 눌러 사진을 올리는 창이 열려 있는지 */
  const [photoOpen, setPhotoOpen] = useState(false);
  /** 이젤에서 그림을 고르는 중이면 사진으로 만든 그림의 목록 */
  const [choices, setChoices] = useState<StoredPaintingSummary[] | null>(null);
  /** 그림 벽에 걸 그림을 고르는 창이 열려 있는지 */
  const [wallPickerOpen, setWallPickerOpen] = useState(false);
  /** 그림 벽에서 고른 그림 (옮기거나 치우는 중) */
  const [wallSelected, setWallSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** 손가락으로 쓰는 기기인가 (휴대폰, 태블릿): 안내 문구와 조작이 다르다 */
  const [touch] = useState(isTouchDevice);
  /** 이젤 캔버스에 올라 있는 그림 (누르면 이어서 칠한다) */
  const [easelPainting, setEaselPainting] = useState<string | null>(null);
  const { status: syncStatus } = useSync();
  /** 다른 기기에서 꾸민 것과 작품을 받아 오는 중 */
  const loadingSaved = syncStatus?.state === 'syncing' && (syncStatus.downloading ?? 0) > 0;
  const [error, setError] = useState<string | null>(null);
  /**
   * 그림 걸기, 사진으로 그림 만들기는 로그인해야 쓸 수 있다 (만든 것을 계정에 저장하므로).
   * 로그인 기능이 꺼진 곳(설정이 없는 개발 환경)에서는 막지 않는다.
   */
  const auth = useAuth();
  const needLoginRef = useRef<(reason: string) => boolean>(() => false);
  needLoginRef.current = (reason: string) => {
    if (auth.mode === 'off' || auth.user) return false;
    if (auth.loading) setToast('로그인을 확인하는 중이에요. 잠시 뒤에 다시 눌러 주세요');
    else auth.openLogin(reason);
    return true;
  };
  /** 안내 문구에서 이미 해 본 조작. 로그인하지 않았으면 접속할 때마다 처음부터 보여 준다. */
  const [hintsDone, markHint] = useHintsDone();
  const markRef = useRef(markHint);
  /** 바로 전의 활동 (차 마시기나 책 읽기에서 일어났는지 알려고) */
  const lastActivity = useRef(activity);

  useEffect(() => {
    startRef.current = onStartColoring;
  }, [onStartColoring]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let view: Atelier3DView | null = null;
    try {
      view = new Atelier3DView(
        host,
        {
          onActivityChange: (next) => {
            if (next === null && (lastActivity.current === 'tea' || lastActivity.current === 'read')) markRef.current('standUp');
            lastActivity.current = next;
            setActivity(next);
          },
          onControl: (kind) => markRef.current(kind),
          onPaintBuff: () => setToast('✨ 색칠 버프! 1분 동안 붓이 2배로 넓게 칠해져요'),
          onEasel: () => {
            markRef.current('pick');
            // 사진으로 만든 그림이 있으면 고르게 하고, 없으면 기본 그림을 바로 연다
            // 처음부터 들어 있는 그림과 사진으로 만든 그림 가운데 고른다
            listStoredPaintings()
              .catch(() => [])
              .then(setChoices);
          },
          onContinuePainting: (id) => {
            markRef.current('continue');
            startRef.current(id);
          },
          onEaselPicture: setEaselPainting,
          onCamera: () => {
            if (needLoginRef.current('사진으로 색칠 그림을 만들려면 로그인해 주세요. 만든 그림은 계정에 저장돼요.')) return;
            setPhotoOpen(true);
          },
          canUseGalleryWall: () => !needLoginRef.current('완성한 그림을 벽에 걸려면 로그인해 주세요. 꾸민 화실은 계정에 저장돼요.'),
          onPaletteSpot: () => setPaletteOpen(true),
          onGalleryWall: () => setWallPickerOpen(true),
          onWallPictureSelect: setWallSelected,
          // 걷기 시작하면 그림 벽 꾸미기를 마친다 ("다 했어요" 와 같다)
          onCharacterMove: () => {
            setWallPickerOpen(false);
            setPaletteOpen(false);
          },
          onWallChange: (wall) =>
            setDecor((previous) => {
              const next = { ...previous, wall };
              saveDecor(next);
              return next;
            }),
          onPlantSpot: setPlantSlot,
          onUnavailable: (hotspot) => setToast(`"${hotspot.label}"는 곧 만나요`),
        },
        { startSeated },
      );
    } catch (e) {
      console.warn(e);
      setError('이 브라우저에서는 3D 화실을 열 수 없습니다 (WebGL 필요).');
    }
    viewRef.current = view;
    return () => {
      view?.destroy();
      viewRef.current = null;
    };
  }, [startSeated]);

  /** 화분을 바꾸고 저장한다. 색칠 화면 배경도 같은 저장값을 읽는다. */
  const choosePlant = (slot: PlantSlot, kind: PlantKind) => {
    const next = { ...decor, plants: { ...decor.plants, [slot]: kind } };
    setDecor(next);
    saveDecor(next);
    viewRef.current?.setPlant(slot, kind);
    setPlantSlot(null);
  };

  /** 고른 완성작을 벽에 건다. 이미 걸려 있으면 그 그림을 고른다. */
  const hangPicture = async (paintingId: string) => {
    setWallPickerOpen(false);
    const view = viewRef.current;
    if (!view) return;
    const id = await view.addWallPicture(paintingId);
    if (!id) {
      setToast('그림을 걸지 못했어요');
      return;
    }
    view.selectWallPicture(id);
    setWallSelected(id);
  };

  const finishWall = () => {
    viewRef.current?.selectWallPicture(null);
    setWallSelected(null);
  };

  /** 고른 벽 그림의 액자 */
  const selectedFrame = decor.wall.find((p) => p.id === wallSelected)?.frame ?? 'wood';

  const selectedSize = decor.wall.find((p) => p.id === wallSelected)?.size ?? 'medium';
  const chooseSize = (size: WallPictureSizeKind) => {
    if (wallSelected) void viewRef.current?.setWallPictureSize(wallSelected, size);
  };

  const chooseFrame = (frame: (typeof FRAME_KINDS)[number]) => {
    if (wallSelected) void viewRef.current?.setWallPictureFrame(wallSelected, frame);
  };

  const removeWallPicture = () => {
    if (!wallSelected) return;
    viewRef.current?.removeWallPicture(wallSelected);
    setWallSelected(null);
  };

  // 다른 기기에서 꾸민 것을 받아 오면 바로 바꿔 보여 준다
  useEffect(
    () =>
      onRemoteApplied((kinds) => {
        // 다른 기기에서 칠한 것을 받으면 이젤의 그림도 바꾼다
        if (kinds.has('progress') || kinds.has('painting')) void viewRef.current?.refreshEasel();
        // 작품만 새로 받았어도 벽에 걸린 그림이 보이도록 다시 건다
        if (!kinds.has('decor') && !kinds.has('gallery')) return;
        const next = loadDecor();
        setDecor(next);
        viewRef.current?.applyDecor(next);
        setWallSelected((id) => (id && next.wall.some((p) => p.id === id) ? id : null));
      }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.length > 24 ? 3200 : 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const hints = hintItems({ activity, touch, easelPainting: easelPainting !== null }, hintsDone);

  return (
    <div className="atelier atelier3d" data-seated={activity === 'paint'} data-activity={activity ?? 'none'} data-touch={touch}>
      <div className="atelier__canvas" ref={hostRef} />
      <header className="atelier__top">
        <div className="atelier__pill">Metelier</div>
      </header>
      <div className="atelier3d__account">
        <UserButton />
      </div>
      {loadingSaved && (
        <p className="atelier3d__loading" role="status" data-testid="sync-loading">
          <span className="atelier3d__loading-dot" aria-hidden="true" />
          저장된 화실을 불러오는 중…
        </p>
      )}
      {error && <p className="atelier__message">{error}</p>}
      {!error && !wallSelected && !paletteOpen && hints.length > 0 && (
        <p className="atelier__hint" data-testid="atelier-hint">
          {hints.map((h) => (
            <span key={h.action} className="atelier__hint-item">
              {h.text}
            </span>
          ))}
        </p>
      )}
      {wallSelected && (
        <div className="atelier3d__wallbar" role="toolbar" aria-label="벽 그림 옮기기" data-testid="wall-bar">
          <span className="atelier3d__wallbar-text">끌어서 옮겨요 · {FRAME_INFO[selectedFrame].label}</span>
          <div className="atelier3d__frames" role="group" aria-label="액자 고르기">
            {FRAME_KINDS.map((kind) => (
              <button
                key={kind}
                className="atelier3d__frame"
                style={{ background: FRAME_INFO[kind].swatch }}
                aria-label={FRAME_INFO[kind].label}
                aria-pressed={selectedFrame === kind}
                title={FRAME_INFO[kind].label}
                data-frame={kind}
                onClick={() => chooseFrame(kind)}
              />
            ))}
          </div>
          <div className="atelier3d__sizes" role="group" aria-label="액자 크기">
            {WALL_SIZE_KINDS.map((kind) => (
              <button
                key={kind}
                className="atelier3d__size"
                aria-label={`액자 ${WALL_SIZE_INFO[kind].label}`}
                aria-pressed={selectedSize === kind}
                title={`액자 ${WALL_SIZE_INFO[kind].label}`}
                data-size={kind}
                onClick={() => chooseSize(kind)}
              >
                <span className="atelier3d__size-box" aria-hidden="true" />
              </button>
            ))}
          </div>
          <button className="atelier3d__wallbar-button" data-testid="wall-remove" onClick={removeWallPicture}>
            치우기
          </button>
          <button className="atelier3d__wallbar-button atelier3d__wallbar-button--primary" data-testid="wall-done" onClick={finishWall}>
            다 했어요
          </button>
        </div>
      )}
      {wallPickerOpen && (
        <WallPicker
          hung={new Set(decor.wall.map((p) => p.paintingId))}
          full={decor.wall.length >= MAX_WALL_PICTURES}
          onPick={(id) => void hangPicture(id)}
          onClose={() => setWallPickerOpen(false)}
        />
      )}
      {plantSlot && (
        <div className="atelier3d__picker" role="dialog" aria-label="화분 고르기">
          <p className="atelier3d__picker-title">어떤 화분을 놓을까요?</p>
          <LoginNudge text="로그인하면 꾸민 화실이 저장돼요" reason="로그인하면 꾸민 화실이 저장돼 다른 기기에서도 그대로 볼 수 있어요." />
          <div className="atelier3d__picker-options">
            {PLANT_KINDS.map((kind) => (
              <button
                key={kind}
                className="atelier3d__picker-option"
                aria-pressed={decor.plants[plantSlot] === kind}
                data-plant={kind}
                onClick={() => choosePlant(plantSlot, kind)}
              >
                <span aria-hidden="true">{PLANT_INFO[kind].icon}</span>
                {PLANT_INFO[kind].label}
              </button>
            ))}
          </div>
          <button className="atelier3d__picker-close" aria-label="닫기" onClick={() => setPlantSlot(null)}>
            ×
          </button>
        </div>
      )}
      {paletteOpen && (
        <PaletteDialog
          colors={decor.colors ?? []}
          onChange={(colors) =>
            setDecor((previous) => {
              const { colors: _old, ...rest } = previous;
              void _old;
              const next = colors.length ? { ...rest, colors } : rest;
              saveDecor(next);
              return next;
            })
          }
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {photoOpen && (
        <PhotoDialog
          onClose={() => setPhotoOpen(false)}
          onSaved={(title) => {
            setPhotoOpen(false);
            setToast(`"${title}" 그림을 등록했어요 · 이젤에서 골라 칠해 보세요`);
          }}
        />
      )}
      {choices && (
        <PaintingPicker
          builtins={BUILTIN_PAINTINGS}
          hung={new Set(decor.wall.map((p) => p.paintingId))}
          photos={choices}
          onPick={(id) => onStartColoring(id)}
          onClose={() => setChoices(null)}
          onChange={setChoices}
        />
      )}
      {toast && <p className="atelier__toast">{toast}</p>}
    </div>
  );
}
