export type PixelEncoding = 'gzip' | 'raw';

export interface PackedPixels {
  data: Blob;
  encoding: PixelEncoding;
}

/** 칠 버퍼를 저장용 Blob 으로 만든다. 가능하면 gzip 으로 압축한다 (무손실). */
export async function packPixels(pixels: Uint8ClampedArray<ArrayBuffer>): Promise<PackedPixels> {
  // Blob 은 만드는 순간의 내용을 복사하므로, 압축하는 동안 칠이 바뀌어도 섞이지 않는다.
  const blob = new Blob([pixels]);
  if (typeof CompressionStream === 'undefined') return { data: blob, encoding: 'raw' };
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return { data: await new Response(stream).blob(), encoding: 'gzip' };
}

export async function unpackPixels(packed: PackedPixels): Promise<Uint8ClampedArray> {
  const stream =
    packed.encoding === 'gzip' ? packed.data.stream().pipeThrough(new DecompressionStream('gzip')) : packed.data.stream();
  return new Uint8ClampedArray(await new Response(stream).arrayBuffer());
}
