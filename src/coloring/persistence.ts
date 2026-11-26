import { loadProgress, saveGalleryItem, saveProgress } from '../storage/db';
import { packPixels, unpackPixels } from '../storage/pixelStore';
import type { PaintingMeta } from './painting';
import type { ColoringView } from './view/ColoringView';

/** 저장된 칠이 있으면 불러온다. 이미 완성했던 그림인지 돌려준다. */
export async function restoreSession(view: ColoringView, meta: PaintingMeta): Promise<boolean> {
  const record = await loadProgress(meta.id);
  if (!record || record.width !== meta.width || record.height !== meta.height) return false;
  view.restore(await unpackPixels(record));
  return record.completed;
}

/** 지금의 칠을 저장한다. 완성한 그림이고 모든 칸이 칠해져 있으면 갤러리의 작품도 갱신한다. */
export async function saveSession(view: ColoringView, meta: PaintingMeta, completed: boolean): Promise<void> {
  const packed = await packPixels(view.engine.pixels);
  const updatedAt = Date.now();
  await saveProgress({
    paintingId: meta.id,
    width: meta.width,
    height: meta.height,
    ...packed,
    completed,
    updatedAt,
  });
  // 완성 후 일부를 지운 상태로는 갤러리의 작품을 덮어쓰지 않는다.
  if (completed && view.engine.filledCount() === view.engine.regionCount) {
    await saveGalleryItem({ paintingId: meta.id, title: meta.title, image: await view.renderArtwork(), updatedAt });
  }
}
