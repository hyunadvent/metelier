import { useState } from 'react';
import { deleteStoredPainting, type StoredPaintingSummary } from '../storage/db';
import './photoDialog.css';

interface PaintingPickerProps {
  /** 처음부터 들어 있는 그림 */
  builtin: { id: string; title: string; thumbnail: string };
  /** 사진으로 만든 그림들 */
  photos: StoredPaintingSummary[];
  onPick(paintingId: string): void;
  onClose(): void;
  /** 그림을 지운 뒤 남은 목록을 알려 준다 */
  onChange(photos: StoredPaintingSummary[]): void;
}

/** 이젤을 눌렀을 때, 칠할 수 있는 그림이 여러 장이면 열리는 창. */
export function PaintingPicker({ builtin, photos, onPick, onClose, onChange }: PaintingPickerProps) {
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
          <li className="painting-picker__item">
            <button className="painting-picker__open" data-painting={builtin.id} onClick={() => onPick(builtin.id)}>
              <img src={builtin.thumbnail} alt="" />
              <span>{builtin.title}</span>
            </button>
          </li>
          {photos.map((p) => (
            <li key={p.id} className="painting-picker__item">
              <button className="painting-picker__open" data-painting={p.id} onClick={() => onPick(p.id)}>
                <img src={p.thumbnail} alt="" />
                <span>{asking === p.id ? '한 번 더 누르면 지워요' : p.title}</span>
              </button>
              <button className="painting-picker__delete" aria-label={`${p.title} 지우기`} onClick={() => void remove(p.id)}>
                {asking === p.id ? '✓' : '×'}
              </button>
            </li>
          ))}
        </ul>
        <p className="photo-dialog__count">문 옆의 카메라를 누르면 사진으로 새 그림을 만들 수 있어요</p>
      </div>
    </div>
  );
}
