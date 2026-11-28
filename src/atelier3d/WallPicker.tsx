import { useEffect, useState } from 'react';
import { listGallery } from '../storage/db';
import { LoginNudge } from '../auth/UserButton';
import '../photo/photoDialog.css';

interface Entry {
  paintingId: string;
  title: string;
  url: string;
}

interface WallPickerProps {
  /** 이미 벽에 걸려 있는 완성작 */
  hung: Set<string>;
  /** 벽이 가득 찼는지 */
  full: boolean;
  onPick(paintingId: string): void;
  onClose(): void;
}

/** 그림 벽의 표시를 눌렀을 때 열리는 창: 완성한 그림 가운데 벽에 걸 것을 고른다. */
export function WallPicker({ hung, full, onPick, onClose }: WallPickerProps) {
  const [items, setItems] = useState<Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    listGallery()
      .then((list) => {
        if (cancelled) return;
        const entries = list.map((item) => ({ paintingId: item.paintingId, title: item.title, url: URL.createObjectURL(item.image) }));
        urls = entries.map((e) => e.url);
        setItems(entries);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  return (
    <div className="photo-dialog__backdrop photo-dialog__backdrop--clear" role="presentation">
      <div className="photo-dialog" role="dialog" aria-modal="true" aria-label="벽에 걸 그림 고르기" data-testid="wall-picker">
        <button className="photo-dialog__close" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <h2 className="photo-dialog__title">🖼️ 어떤 그림을 걸까요?</h2>
        <LoginNudge text="로그인하면 꾸민 그림 벽이 저장돼요" reason="로그인하면 꾸민 화실이 저장돼 다른 기기에서도 그대로 볼 수 있어요." />
        {items === null && <p className="photo-dialog__count">불러오는 중…</p>}
        {items?.length === 0 && (
          <p className="photo-dialog__count">아직 완성한 그림이 없어요. 이젤에서 그림을 끝까지 칠하면 여기에 걸 수 있어요.</p>
        )}
        {items && items.length > 0 && (
          <ul className="painting-picker__list">
            {items.map((item) => {
              const isHung = hung.has(item.paintingId);
              return (
                <li key={item.paintingId} className="painting-picker__item">
                  <button
                    className="painting-picker__open"
                    data-painting={item.paintingId}
                    disabled={full && !isHung}
                    onClick={() => onPick(item.paintingId)}
                  >
                    <img src={item.url} alt="" />
                    <span>{isHung ? `${item.title} · 걸려 있음` : item.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="photo-dialog__count">
          {full ? '벽이 가득 찼어요. 걸린 그림을 눌러 치우면 새로 걸 수 있어요.' : '나무 액자에 넣어 걸어요 · 걸린 그림은 끌어서 옮길 수 있어요'}
        </p>
      </div>
    </div>
  );
}
