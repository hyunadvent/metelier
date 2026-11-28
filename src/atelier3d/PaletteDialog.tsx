import { useState } from 'react';
import { LoginNudge } from '../auth/UserButton';
import { MAX_CUSTOM_COLORS } from './decor';

/** 고르기 쉽게 미리 놓아 둔 색 (요즘 많이 쓰는 부드러운 색) */
const SUGGESTED = ['#f4a7b9', '#ffcf9e', '#fff1a8', '#bfe3c0', '#a8d8ea', '#c9b6f2', '#e8c4a0', '#8fb9a8', '#f28c8c', '#6c7ae0'];

interface PaletteDialogProps {
  colors: readonly string[];
  onChange(colors: string[]): void;
  onClose(): void;
}

/**
 * 책상 위의 팔레트를 눌렀을 때 열리는 창: 나만의 물감을 만들고 치운다.
 * 만든 물감은 색칠할 때 물감 줄 오른쪽의 "내 물감" 에서 고른다.
 */
export function PaletteDialog({ colors, onChange, onClose }: PaletteDialogProps) {
  const [draft, setDraft] = useState('#f4a7b9');
  const full = colors.length >= MAX_CUSTOM_COLORS;
  const add = (hex: string) => {
    const color = hex.toLowerCase();
    if (full || colors.includes(color)) return;
    onChange([...colors, color]);
  };

  return (
    <div className="atelier3d__picker atelier3d__palette" role="dialog" aria-label="나만의 물감 만들기" data-testid="palette-dialog">
      <p className="atelier3d__picker-title">나만의 물감을 만들어요</p>
      <p className="atelier3d__palette-text">
        만든 물감은 색칠할 때 물감 줄 오른쪽의 <b>내 물감</b>에서 골라 쓸 수 있어요. ({colors.length}/{MAX_CUSTOM_COLORS})
      </p>
      <LoginNudge text="로그인하면 내 물감이 저장돼요" reason="로그인하면 만든 물감이 저장돼 다른 기기에서도 쓸 수 있어요." />

      <div className="atelier3d__palette-mine" aria-label="내 물감">
        {colors.length === 0 && <span className="atelier3d__palette-empty">아직 만든 물감이 없어요</span>}
        {colors.map((c) => (
          <button
            key={c}
            className="atelier3d__palette-swatch"
            style={{ background: c }}
            aria-label={`${c} 물감 치우기`}
            title="눌러서 치우기"
            onClick={() => onChange(colors.filter((x) => x !== c))}
          >
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>

      <div className="atelier3d__palette-add">
        <label className="atelier3d__palette-picker">
          <input type="color" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="물감 색 고르기" />
          <span style={{ background: draft }} aria-hidden="true" />
        </label>
        <button className="atelier3d__wallbar-button atelier3d__wallbar-button--primary" disabled={full || colors.includes(draft.toLowerCase())} onClick={() => add(draft)}>
          {full ? '팔레트가 가득 찼어요' : '이 색 물감 만들기'}
        </button>
      </div>

      <p className="atelier3d__palette-label">추천 색</p>
      <div className="atelier3d__palette-suggest">
        {SUGGESTED.map((c) => (
          <button
            key={c}
            className="atelier3d__palette-swatch atelier3d__palette-swatch--suggest"
            style={{ background: c }}
            aria-label={`${c} 물감 만들기`}
            disabled={full || colors.includes(c)}
            onClick={() => add(c)}
          />
        ))}
      </div>

      <button className="atelier3d__picker-close" aria-label="닫기" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
