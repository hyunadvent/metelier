import { useState } from 'react';
import { builtinThumbnail, type BuiltinPainting } from '../coloring/builtinPaintings';
import { deleteStoredPainting, type StoredPaintingSummary } from '../storage/db';
import './photoDialog.css';

interface PaintingPickerProps {
  /** 처음부터 들어 있는 그림들 */
  builtins: BuiltinPainting[];
  /** 사진으로 만든 그림들 */
  photos: StoredPaintingSummary[];
  /** 그림 벽에 걸린 그림. 벽에서 치우기 전에는 칠할 수 없다. */
  hung: ReadonlySet<string>;
  onPick(paintingId: string): void;
  onClose(): void;
  /** 그림을 지운 뒤 남은 목록을 알려 준다 */
  onChange(photos: StoredPaintingSummary[]): void;
}

const HUNG_HINT = '그림 벽에 걸린 그림이에요. 다시 칠하려면 벽에서 치워 주세요.';

/** 이젤을 눌렀을 때, 칠할 수 있는 그림이 여러 장이면 열리는 창. */
export function PaintingPicker({ builtins, photos, hung, onPick, onClose, onChange }: PaintingPickerProps) {
  /** 지울지 한 번 더 묻는 중인 그림 */
  const [asking, setAsking] = useState<string | null>(null);

  const remove = async (id: string) => {
    if (asking !== id) {
      setAsking(id);
      return;
    }
    await deleteStoredPainting(id);
    setAsking(null);
    onChange(photos.filter((p) => p.id !== id));
  };

  return (
    <div className="photo-dialog__backdrop" role="presentation">
      <div className="photo-dialog" role="dialog" aria-modal="true" aria-label="칠할 그림 고르기" data-testid="painting-picker">
        <button className="photo-dialog__close" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <h2 className="photo-dialog__title">🎨 어떤 그림을 칠할까요?</h2>
        <ul className="painting-picker__list">
          {builtins.map((b) => (
            <li key={b.id} className="painting-picker__item">
              <button
                className="painting-picker__open"
                data-painting={b.id}
                disabled={hung.has(b.id)}
                title={hung.has(b.id) ? HUNG_HINT : undefined}
                onClick={() => onPick(b.id)}
              >
                <img src={builtinThumbnail(b.id)} alt="" loading="lazy" />
                <span>{hung.has(b.id) ? '🖼️ 벽에 걸려 있어요' : b.title}</span>
              </button>
            </li>
          ))}
          {photos.map((p) => (
            <li key={p.id} className="painting-picker__item">
              <button
                className="painting-picker__open"
                data-painting={p.id}
                disabled={hung.has(p.id)}
                title={hung.has(p.id) ? HUNG_HINT : undefined}
                onClick={() => onPick(p.id)}
              >
                <img src={p.thumbnail} alt="" />
                <span>{asking === p.id ? '한 번 더 누르면 지워요' : hung.has(p.id) ? '🖼️ 벽에 걸려 있어요' : p.title}</span>
              </button>
              <button className="painting-picker__delete" aria-label={`${p.title} 지우기`} onClick={() => void remove(p.id)}>
                {asking === p.id ? '✓' : '×'}
              </button>
            </li>
          ))}
        </ul>
        {hung.size > 0 && <p className="photo-dialog__count">벽에 걸린 그림은 벽에서 치우면 다시 칠할 수 있어요</p>}
        <p className="photo-dialog__count">문 옆의 카메라를 누르면 사진으로 새 그림을 만들 수 있어요</p>
      </div>
    </div>
  );
}
