import { useEffect, useRef } from 'react';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StardustOverlayProps {
  /** 색칠 버프가 걸려 있는가. 꺼지면 서서히 사라진다. */
  active: boolean;
  /** 지금 종이가 화면에 놓인 자리 (확대·이동하면 바뀐다) */
  paperRect(): Rect | null;
}

/** 알갱이 수 */
const COUNT = 46;

interface Grain {
  /** 종이 안의 위치 (0~1) */
  u: number;
  v: number;
  speed: number;
  size: number;
  phase: number;
  drift: number;
}

/**
 * 색칠 버프가 걸려 있는 동안 캔버스(종이) 위로 떨어지는 작은 별가루.
 * 화실에서 캐릭터 머리 위로 떨어지던 것과 같은 느낌이다. 칠하는 데는 끼어들지 않는다.
 */
export function StardustOverlay({ active, paperRect }: StardustOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const rectRef = useRef(paperRect);
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    rectRef.current = paperRect;
  }, [paperRect]);

  useEffect(() => {
    activeRef.current = active;
    if (active) startRef.current();
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const spawn = (g: Grain, top: boolean) => {
      g.u = Math.random();
      g.v = top ? -0.05 - Math.random() * 0.1 : Math.random();
      g.speed = 0.06 + Math.random() * 0.08;
      g.size = 2.5 + Math.random() * 3.5;
      g.phase = Math.random() * Math.PI * 2;
      g.drift = (Math.random() - 0.5) * 0.03;
    };
    const grains: Grain[] = Array.from({ length: COUNT }, () => {
      const g = { u: 0, v: 0, speed: 0, size: 0, phase: 0, drift: 0 };
      spawn(g, false);
      return g;
    });
    let strength = 0;
    let frame = 0;
    let last = performance.now();
    let time = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      strength = Math.min(1, Math.max(0, strength + (activeRef.current ? dt * 2.5 : -dt * 1.2)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const rect = rectRef.current();
      if (strength <= 0) {
        frame = 0;
        return;
      }
      if (!rect) {
        // 종이 자리를 아직 모른다 (그림을 불러오는 중): 다음 프레임에 다시 본다
        frame = requestAnimationFrame(draw);
        return;
      }
      ctx.save();
      // 종이 밖으로는 그리지 않는다
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      for (const g of grains) {
        g.v += g.speed * dt;
        g.u += g.drift * dt;
        if (g.v > 1.05) spawn(g, true);
        const x = rect.x + g.u * rect.width;
        const y = rect.y + g.v * rect.height;
        const fade = Math.min(1, (1.05 - g.v) / 0.25) * Math.min(1, (g.v + 0.05) / 0.1);
        const twinkle = 0.6 + 0.4 * Math.sin(time * 8 + g.phase);
        const a = Math.max(0, fade) * twinkle * strength;
        if (a <= 0.01) continue;
        star(ctx, x, y, g.size, a);
      }
      ctx.restore();
      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    startRef.current = start;
    if (activeRef.current) start();
    return () => {
      cancelAnimationFrame(frame);
      frame = 0;
      startRef.current = () => {};
    };
  }, []);

  return <canvas ref={canvasRef} className="coloring__stardust" aria-hidden="true" />;
}

/** 빛이 번지는 네 갈래 별 하나 */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  glow.addColorStop(0, `rgba(255, 236, 160, ${0.75 * alpha})`);
  glow.addColorStop(1, 'rgba(255, 220, 120, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 214, 92, ${alpha})`;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.6);
  ctx.quadraticCurveTo(x + r * 0.3, y - r * 0.3, x + r * 1.6, y);
  ctx.quadraticCurveTo(x + r * 0.3, y + r * 0.3, x, y + r * 1.6);
  ctx.quadraticCurveTo(x - r * 0.3, y + r * 0.3, x - r * 1.6, y);
  ctx.quadraticCurveTo(x - r * 0.3, y - r * 0.3, x, y - r * 1.6);
  ctx.fill();
}
