import { useEffect, useRef, useState } from 'react';
import { Atelier3DView } from './Atelier3DView';
import { loadDecor, PLANT_INFO, PLANT_KINDS, saveDecor, type PlantKind, type PlantSlot } from './decor';
import type { Activity } from './room';
import { PaintingPicker } from '../photo/PaintingPicker';
import { PhotoDialog } from '../photo/PhotoDialog';
import { listStoredPaintings, type StoredPaintingSummary } from '../storage/db';
import '../atelier/atelier.css';
import './atelier3d.css';

interface Atelier3DScreenProps {
  /** 색칠을 마치고 돌아왔을 때는 의자에 앉은 채로 시작한다. */
  startSeated: boolean;
  /** @param paintingId 칠할 그림. 주지 않으면 기본 그림 */
  onStartColoring(paintingId?: string): void;
}

/** 처음부터 들어 있는 그림 (고르는 창의 첫 칸) */
const BUILTIN_PAINTING = {
  id: 'hill-house',
  title: '언덕 위의 집',
  thumbnail: `${import.meta.env.BASE_URL}paintings/hill-house/reference.png`,
};

const HINTS: Record<Activity | 'none', string> = {
  none: '바닥을 누르거나 WASD로 걷기 · 캐릭터나 스페이스로 점프 · 끌어서 둘러보기',
  paint: '이젤을 눌러 색칠을 시작하세요',
  tea: '창밖을 보며 차를 마시고 있어요 · 바닥을 누르면 일어나요',
  read: '책을 읽고 있어요 · 바닥을 누르면 일어나요',
};

export function Atelier3DScreen({ startSeated, onStartColoring }: Atelier3DScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(onStartColoring);
  const [activity, setActivity] = useState<Activity | null>(startSeated ? 'paint' : null);
  const viewRef = useRef<Atelier3DView | null>(null);
  const [decor, setDecor] = useState(loadDecor);
  /** 화분을 고르는 중인 자리. 고르는 창이 닫혀 있으면 null. */
  const [plantSlot, setPlantSlot] = useState<PlantSlot | null>(null);
  /** 카메라를 눌러 사진을 올리는 창이 열려 있는지 */
  const [photoOpen, setPhotoOpen] = useState(false);
  /** 이젤에서 그림을 고르는 중이면 사진으로 만든 그림의 목록 */
  const [choices, setChoices] = useState<StoredPaintingSummary[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          onActivityChange: setActivity,
          onEasel: () => {
            // 사진으로 만든 그림이 있으면 고르게 하고, 없으면 기본 그림을 바로 연다
            listStoredPaintings()
              .catch(() => [])
              .then((photos) => (photos.length > 0 ? setChoices(photos) : startRef.current()));
          },
          onCamera: () => setPhotoOpen(true),
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.length > 24 ? 3200 : 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="atelier atelier3d" data-seated={activity === 'paint'} data-activity={activity ?? 'none'}>
      <div className="atelier__canvas" ref={hostRef} />
      <header className="atelier__top">
        <div className="atelier__pill">Metelier</div>
      </header>
      {error && <p className="atelier__message">{error}</p>}
      {!error && (
        <p className="atelier__hint">
          {HINTS[activity ?? 'none']}
        </p>
      )}
      {plantSlot && (
        <div className="atelier3d__picker" role="dialog" aria-label="화분 고르기">
          <p className="atelier3d__picker-title">어떤 화분을 놓을까요?</p>
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
          builtin={BUILTIN_PAINTING}
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
