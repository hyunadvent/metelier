import { useCallback, useEffect, useRef } from 'react';
import { isCustomTool, type PaletteEntry, type Tool } from './painting';
import type { ColoringView } from './view/ColoringView';

/** 붓이 기울어진 각도. 붓끝이 왼쪽 아래, 손잡이가 오른쪽 위를 향한다. */
const ANGLE = -35;
const PAINTING_ANGLE = -29;
const CLEAN_BRISTLE = '#ecd9b6';
const EDGE = 8;
/** 붓의 기준점에서 손잡이 끝까지의 거리 (오른쪽, 위쪽). 처음 놓을 때 손잡이가 화면 밖으로 나가지 않게 한다. */
const HANDLE_REACH = { x: 256, y: 178 };
/** 위쪽 버튼 줄의 아래 끝 (처음 놓을 때 손잡이 끝이 버튼을 가리지 않게). 세로 휴대폰은 두 줄이다. */
const topBarBottom = () => (window.innerWidth <= 600 && window.innerHeight > window.innerWidth ? 122 : 72);

type Mode = 'idle' | 'move' | 'paint';

/** 붓을 반대로 기울였는지 (왼손잡이 등). 이 기기에 기억한다. */
const FLIP_KEY = 'metelier.brushFlip';
function loadFlip(): boolean {
  try {
    return localStorage.getItem(FLIP_KEY) === '1';
  } catch {
    return false;
  }
}
function saveFlip(flip: boolean): void {
  try {
    localStorage.setItem(FLIP_KEY, flip ? '1' : '0');
  } catch {
    // 저장이 안 되는 브라우저면 이번에만
  }
}
/** 붓의 모양 변환: 기울기, 반대로 기울였으면 좌우를 뒤집는다 (붓 끝을 기준으로) */
const bodyTransform = (angle: number, flip: boolean) => (flip ? `scale(-1 1) rotate(${angle})` : `rotate(${angle})`);

/** 붓털 모양: 평소, 그리고 종이에 대고 칠할 때 (붓 끝이 아래로 꺾여 눌린다) */
// 붓 끝은 (-14, 0) 이다. 붓 전체를 오른쪽으로 TIP 만큼 옮겨 그려, 붓 끝이 칠하는 점(원점)에 딱 오게 한다.
// 눌린 모양도 붓 끝은 그대로 두고, 몸통이 위로 휘어 끝이 종이 쪽으로 꺾여 보이게 한다.
const TIP = 14;
const TUFT = {
  rest: 'M -14 0 C -6 -9, 14 -13, 42 -12 L 42 12 C 14 13, -6 9, -14 0 Z',
  pressed: 'M -14 0 C -14 -11, 0 -21, 42 -12 L 42 12 C 20 9, -2 9, -14 0 Z',
};
const TUFT_SHINE = {
  rest: 'M 2 -3 C 14 -6, 26 -7, 38 -7',
  pressed: 'M -6 -9 C 6 -16, 26 -15, 38 -8',
};

interface Pot {
  tool: Tool;
  x: number;
  y: number;
  r: number;
}

interface BrushProps {
  view: ColoringView;
  palette: PaletteEntry[];
  /** 붓에 묻은 물감. null 이면 깨끗한 붓. */
  tool: Tool | null;
  /** 손잡이를 잡고 붓끝을 물감(또는 지우개)에 가져갔을 때. */
  onDip(tool: Tool): void;
  /** 물감이 묻지 않은 붓으로 칠하려 했을 때. */
  onEmptyStroke(): void;
  /** 붓 끝으로 칸을 칠하기 시작했을 때 */
  onPaint?(): void;
  /**
   * 어디를 잡아야 하는지 깜빡여 알려 준다. handle: 손잡이(잡고 옮겨 물감에 담근다), tip: 붓 끝(대고 끌어 칠한다).
   * 붓을 잡고 있는 동안에는 깜빡이지 않는다.
   */
  cue?: 'handle' | 'tip' | null;
}

/**
 * 화면 위에 놓인 붓.
 * - 손잡이를 누르고 끌면 붓이 움직인다. 붓끝이 물감에 닿으면 그 색이 묻는다.
 * - 붓털을 누르고 끌면 붓끝이 지나가는 자리가 칠해진다.
 * 붓의 위치는 붓털이 종이에 닿는 점(붓끝에서 조금 안쪽)을 기준으로 한다.
 */
export function Brush({ view, palette, tool, onDip, onEmptyStroke, onPaint, cue = null }: BrushProps) {
  const rootRef = useRef<SVGSVGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const flipRef = useRef(loadFlip());
  const angleRef = useRef(ANGLE);
  const pos = useRef({ x: 0, y: 0 });
  const drag = useRef({ mode: 'idle' as Mode, pointerId: -1, dx: 0, dy: 0, stroking: false });
  const pots = useRef<Pot[]>([]);
  const insidePot = useRef<Tool | null>(null);
  const tuftRef = useRef<SVGPathElement>(null);
  const shineRef = useRef<SVGPathElement>(null);
  /** 붓 끝을 꺾는다(칠하는 중) / 편다 */
  const pressTuft = (pressed: boolean) => {
    tuftRef.current?.setAttribute('d', pressed ? TUFT.pressed : TUFT.rest);
    shineRef.current?.setAttribute('d', pressed ? TUFT_SHINE.pressed : TUFT_SHINE.rest);
  };

  const moveTo = useCallback((x: number, y: number) => {
    const nx = Math.min(window.innerWidth - EDGE, Math.max(EDGE, x));
    const ny = Math.min(window.innerHeight - EDGE, Math.max(EDGE, y));
    pos.current = { x: nx, y: ny };
    if (rootRef.current) rootRef.current.style.transform = `translate(${nx}px, ${ny}px)`;
  }, []);

  // 휴대폰: 붓을 누른 손가락으로 브라우저가 화면을 밀거나 확대하면 포인터가 취소되어 붓이 따라오지 않는다.
  // touch-action 만으로는 막히지 않는 브라우저(iOS Safari 등)가 있어 터치를 직접 막는다.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const block = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    root.addEventListener('touchstart', block, { passive: false });
    root.addEventListener('touchmove', block, { passive: false });
    return () => {
      root.removeEventListener('touchstart', block);
      root.removeEventListener('touchmove', block);
    };
  }, []);

  useEffect(() => {
    // 처음에는 그림 오른쪽 위에 놓아 둔다. 좁은 화면에서도 손잡이가 화면 안에 들어오게 한다.
    const place = () =>
      moveTo(
        flipRef.current
          ? Math.max(window.innerWidth * 0.26, HANDLE_REACH.x)
          : Math.min(window.innerWidth * 0.74, window.innerWidth - HANDLE_REACH.x),
        Math.max(window.innerHeight * 0.3, HANDLE_REACH.y + topBarBottom()),
      );
    let size = { w: window.innerWidth, h: window.innerHeight };
    place();
    // 창 크기가 바뀌면 화면에서의 상대 위치를 유지한다.
    const onResize = () => {
      const next = { w: window.innerWidth, h: window.innerHeight };
      if (size.w < 50 || size.h < 50) place();
      else moveTo((pos.current.x / size.w) * next.w, (pos.current.y / size.h) * next.h);
      size = next;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [moveTo]);

  const setAngle = (angle: number) => {
    angleRef.current = angle;
    bodyRef.current?.setAttribute('transform', bodyTransform(angle, flipRef.current));
  };

  /** 손잡이 끝의 화살표: 붓을 반대 방향으로 기울인다 */
  const onFlip = (e: React.PointerEvent<SVGElement>) => {
    if (drag.current.mode !== 'idle' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    flipRef.current = !flipRef.current;
    saveFlip(flipRef.current);
    setAngle(angleRef.current);
    // 뒤집은 손잡이가 화면 밖으로 나가면 붓을 안으로 들인다
    const { x, y } = pos.current;
    moveTo(flipRef.current ? Math.max(x, HANDLE_REACH.x) : Math.min(x, window.innerWidth - HANDLE_REACH.x), Math.max(y, HANDLE_REACH.y));
  };

  const readPots = () => {
    pots.current = [...document.querySelectorAll<HTMLElement>('[data-pot]')].map((el) => {
      const r = el.getBoundingClientRect();
      const id = el.dataset.pot!;
      return {
        tool: (id === 'eraser' ? 'eraser' : id.startsWith('#') ? id : Number(id)) as Tool,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        r: r.width / 2,
      };
    });
  };

  const checkDip = () => {
    const { x, y } = pos.current;
    const hit = pots.current.find((p) => Math.hypot(p.x - x, p.y - y) <= p.r);
    const hitTool = hit ? hit.tool : null;
    if (hitTool === insidePot.current) return;
    insidePot.current = hitTool;
    if (hitTool === null) return;
    onDip(hitTool);
    rootRef.current?.animate(
      [{ translate: '0 0' }, { translate: '0 7px' }, { translate: '0 -3px' }, { translate: '0 0' }],
      { duration: 320, easing: 'ease-out' },
    );
  };

  const onPointerDown = (mode: 'move' | 'paint') => (e: React.PointerEvent<SVGElement>) => {
    if (drag.current.mode !== 'idle' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 캡처가 안 되는 포인터여도 계속한다.
    }
    rootRef.current?.setAttribute('data-dragging', 'true');
    drag.current = {
      mode,
      pointerId: e.pointerId,
      dx: pos.current.x - e.clientX,
      dy: pos.current.y - e.clientY,
      stroking: false,
    };
    if (mode === 'move') {
      readPots();
      insidePot.current = null;
      return;
    }
    setAngle(PAINTING_ANGLE);
    // 칠하는 동안 붓털이 종이에 눌린 모양이 된다
    rootRef.current?.setAttribute('data-painting', 'true');
    pressTuft(true);
    if (tool === null) {
      onEmptyStroke();
      return;
    }
    drag.current.stroking = view.beginStrokeAt(pos.current.x, pos.current.y);
    if (drag.current.stroking) onPaint?.();
  };

  const onPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (d.mode === 'idle' || e.pointerId !== d.pointerId) return;

    if (d.mode === 'move') {
      moveTo(e.clientX + d.dx, e.clientY + d.dy);
      checkDip();
      return;
    }

    // 빠르게 움직여도 끊기지 않도록 프레임 사이의 중간 좌표까지 모두 쓴다.
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length ? coalesced : [e.nativeEvent];
    for (const s of samples) {
      moveTo(s.clientX + d.dx, s.clientY + d.dy);
      if (tool === null) continue;
      const { x, y } = pos.current;
      // 칸 밖에서 누르기 시작했다면, 처음 들어간 칸에 고정된다.
      if (d.stroking) view.strokeToClient(x, y);
      else if ((d.stroking = view.beginStrokeAt(x, y))) onPaint?.();
    }
    view.commitStroke();
  };

  const onPointerUp = (e: React.PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (d.mode === 'idle' || e.pointerId !== d.pointerId) return;
    if (d.mode === 'paint') {
      view.endStroke();
      setAngle(ANGLE);
      // 칠하던 붓끝을 물감 위에 놓고 떼면, 칠하기를 마친 뒤 그 물감을 묻힌다
      readPots();
      insidePot.current = null;
      checkDip();
    }
    drag.current = { mode: 'idle', pointerId: -1, dx: 0, dy: 0, stroking: false };
    rootRef.current?.removeAttribute('data-dragging');
    rootRef.current?.removeAttribute('data-painting');
    pressTuft(false);
  };

  const bristle =
    tool === null || tool === 'eraser'
      ? CLEAN_BRISTLE
      : isCustomTool(tool)
        ? tool
        : (palette.find((p) => p.number === tool)?.color ?? CLEAN_BRISTLE);

  const handlers = (mode: 'move' | 'paint') => ({
    onPointerDown: onPointerDown(mode),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  });

  return (
    <svg ref={rootRef} className="brush" width="1" height="1" aria-hidden="true" data-cue={cue ?? undefined}>
      <g ref={bodyRef} transform={bodyTransform(ANGLE, flipRef.current)}>
        <g transform={`translate(${TIP} 0)`}>
        {/* 손잡이 */}
        <path d="M 70 -11 L 250 -5 Q 259 0 250 5 L 70 11 Z" fill="#b5713c" stroke="#7a4a25" strokeWidth="2" />
        <path d="M 78 -6 L 240 -2" stroke="#d99a63" strokeWidth="3" strokeLinecap="round" />
        {/* 쇠테 */}
        <rect x="40" y="-13" width="32" height="26" rx="4" fill="#cfd4dc" stroke="#7d8590" strokeWidth="2" />
        <path d="M 50 -12 V 12 M 62 -12 V 12" stroke="#9aa2ad" strokeWidth="1.5" />
        {/* 붓털: 칠하는 동안 쇠테 쪽으로 살짝 눌린다 */}
        <g className="brush__tuft">
        <path
          ref={tuftRef}
          d={TUFT.rest}
          fill={bristle}
          stroke="#5b4636"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeDasharray={tool === 'eraser' ? '5 4' : undefined}
        />
        <path ref={shineRef} d={TUFT_SHINE.rest} stroke="rgb(255 255 255 / 45%)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </g>

        {/* 어디를 잡을지 알려 주는 깜빡임: 손잡이 테두리 */}
        <rect className="brush__cue brush__cue--handle" x="66" y="-17" width="196" height="34" rx="17" />

        {/* 잡는 영역: 손잡이(이동) 위에 붓털(칠하기)을 겹쳐 둔다 */}
        {/* 나무 손잡이만 이동, 붓털과 쇠테까지는 칠하기 (휴대폰에서 손가락으로 붓끝을 잡기 쉽게 넓게 잡는다) */}
        <rect className="brush__handle" x="76" y="-26" width="188" height="52" rx="26" {...handlers('move')} />
        <rect className="brush__bristle" x="-32" y="-32" width="108" height="64" rx="30" {...handlers('paint')} />

        {/* 손잡이 끝의 뒤집기 표시 (좌우 대칭 아이콘): 누르면 붓이 반대 방향으로 기울어진다.
            붓의 기울기만큼 되돌려 화면에서 똑바로 서 보이게 한다 */}
        <g className="brush__flip" transform={`translate(280 0) rotate(${-ANGLE})`} onPointerDown={onFlip} aria-label="붓 방향 뒤집기">
          <circle className="brush__flip-hit" r="22" />
          <circle className="brush__flip-face" r="14" />
          {/* 가운데 거울선, 왼쪽은 채운 삼각형, 오른쪽은 비춰진 빈 삼각형 */}
          <path className="brush__flip-mirror" d="M 0 -9 V 9" />
          <path className="brush__flip-solid" d="M -2.5 -6 L -9 6 L -2.5 6 Z" />
          <path className="brush__flip-outline" d="M 2.5 -6 L 9 6 L 2.5 6 Z" />
        </g>
        </g>
        {/* 붓 끝(칠하는 점) 깜빡임: 칠해지는 자리와 같은 원점 */}
        <circle className="brush__cue brush__cue--tip" cx="0" cy="0" r="15" />
        <circle className="brush__cue brush__cue--tip brush__cue--tip-dot" cx="0" cy="0" r="4" />
      </g>
    </svg>
  );
}
