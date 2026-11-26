/**
 * regions.png 의 RGBA 픽셀을 칸 ID 배열로 바꾼다.
 * ID = R | G << 8. 0 은 칸 없음 (선 또는 그림 밖).
 */
export function decodeRegionIds(rgba: Uint8ClampedArray | Uint8Array): Uint16Array {
  const ids = new Uint16Array(rgba.length / 4);
  for (let i = 0; i < ids.length; i++) {
    ids[i] = rgba[i * 4] | (rgba[i * 4 + 1] << 8);
  }
  return ids;
}
