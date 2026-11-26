import { useEffect, useState, type ReactNode } from 'react';
import { listGallery } from '../storage/db';

function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog__card" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const CONFETTI = ['#F48FB1', '#F9D65C', '#7CB86A', '#6FB7E9', '#B388EB', '#F4A24C', '#5CC8B8'];

export function CompleteDialog(props: {
  artworkUrl: string | null;
  onClose(): void;
  onGallery(): void;
}) {
  return (
    <Dialog title="완성했어요!" onClose={props.onClose}>
      <div className="confetti" aria-hidden="true">
        {Array.from({ length: 21 }, (_, k) => (
          <span
            key={k}
            style={{
              left: `${(k * 37) % 100}%`,
              background: CONFETTI[k % CONFETTI.length],
              animationDelay: `${(k % 7) * 0.12}s`,
              animationDuration: `${1.6 + (k % 5) * 0.25}s`,
            }}
          />
        ))}
      </div>
      {props.artworkUrl ? (
        <img className="dialog__artwork" src={props.artworkUrl} alt="완성한 그림" />
      ) : (
        <div className="dialog__artwork dialog__artwork--loading" />
      )}
      <p className="dialog__text">작품이 갤러리에 저장되었어요.</p>
      <div className="dialog__actions">
        <button className="button" onClick={props.onClose}>
          계속 칠하기
        </button>
        <button className="button button--primary" onClick={props.onGallery}>
          갤러리 보기
        </button>
      </div>
    </Dialog>
  );
}

interface GalleryEntry {
  paintingId: string;
  title: string;
  url: string;
  updatedAt: number;
}

export function GalleryDialog({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<GalleryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    listGallery()
      .then((list) => {
        if (cancelled) return;
        const entries = list.map((item) => ({
          paintingId: item.paintingId,
          title: item.title,
          url: URL.createObjectURL(item.image),
          updatedAt: item.updatedAt,
        }));
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
    <Dialog title="내 갤러리" onClose={onClose}>
      {items === null && <p className="dialog__text">불러오는 중…</p>}
      {items?.length === 0 && <p className="dialog__text">아직 완성한 그림이 없어요. 모든 칸을 칠하면 여기에 걸려요.</p>}
      {items && items.length > 0 && (
        <ul className="gallery">
          {items.map((item) => (
            <li key={item.paintingId} className="gallery__item">
              <img src={item.url} alt={item.title} />
              <div className="gallery__caption">
                <strong>{item.title}</strong>
                <span>{new Date(item.updatedAt).toLocaleDateString('ko-KR')}</span>
                <a className="gallery__download" href={item.url} download={`${item.title}.png`}>
                  내려받기
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog__actions">
        <button className="button button--primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  );
}

export function ConfirmDialog(props: { title: string; text: string; confirmLabel: string; onConfirm(): void; onClose(): void }) {
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <p className="dialog__text">{props.text}</p>
      <div className="dialog__actions">
        <button className="button" onClick={props.onClose}>
          취소
        </button>
        <button className="button button--danger" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
