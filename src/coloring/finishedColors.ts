/**
 * 필요한 곳을 모두 칠한 물감 번호.
 * 한 번호의 칸이 (칠할 수 있는 칸 기준으로) 모두 칠해졌으면 그 번호는 다 쓴 것이다.
 * 칠할 칸이 하나도 없는 번호는 다 쓴 것으로 보지 않는다.
 */
export function finishedColors(
  regions: readonly { id: number; number: number }[],
  sizeOf: (region: number) => number,
  isFilled: (region: number) => boolean,
): Set<number> {
  const open = new Set<number>();
  const used = new Set<number>();
  for (const r of regions) {
    if (sizeOf(r.id) === 0) continue;
    used.add(r.number);
    if (!isFilled(r.id)) open.add(r.number);
  }
  const done = new Set<number>();
  for (const n of used) if (!open.has(n)) done.add(n);
  return done;
}
