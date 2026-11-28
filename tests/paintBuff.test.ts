import { beforeEach, describe, expect, it } from 'vitest';
import {
  brushScale,
  clearPaintBuff,
  grantPaintBuff,
  onPaintBuff,
  PAINT_BUFF_MS,
  paintBuffLeft,
  teaBuffReached,
} from '../src/app/paintBuff';

describe('색칠 버프', () => {
  beforeEach(() => clearPaintBuff());

  it('차를 5초 마신 순간 한 번만 걸린다', () => {
    expect(teaBuffReached(4.98, 5.01)).toBe(true);
    expect(teaBuffReached(3, 4)).toBe(false);
    expect(teaBuffReached(5.01, 5.03)).toBe(false);
  });

  it('1분 동안 붓 범위가 2배이고, 지나면 돌아온다', () => {
    expect(brushScale(1000)).toBe(1);
    grantPaintBuff(1000);
    expect(brushScale(1000 + PAINT_BUFF_MS - 1)).toBe(2);
    expect(paintBuffLeft(1000 + 30_000)).toBe(30_000);
    expect(brushScale(1000 + PAINT_BUFF_MS)).toBe(1);
  });

  it('다시 걸면 다시 1분이고, 걸릴 때 알린다', () => {
    let heard = 0;
    const stop = onPaintBuff(() => heard++);
    grantPaintBuff(0);
    grantPaintBuff(50_000);
    expect(paintBuffLeft(100_000)).toBe(10_000);
    expect(heard).toBe(2);
    stop();
    grantPaintBuff(0);
    expect(heard).toBe(2);
  });
});
