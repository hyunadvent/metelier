import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncKind } from '../storage/changes';
import type { RemoteItem, SyncStore } from './store';

/** 목록 표 (supabase/schema.sql) */
const TABLE = 'metelier_items';
/** 파일 저장소. 사람마다 자기 이름(사용자 ID)의 폴더만 읽고 쓸 수 있다. */
const BUCKET = 'metelier';

interface Row {
  kind: SyncKind;
  key: string;
  updated_at: number;
  deleted: boolean;
  data: unknown;
}

/** Supabase 의 표와 파일 저장소에 둔다. 표의 행과 파일은 로그인한 사람만 보고 쓴다 (RLS). */
export function supabaseStore(client: SupabaseClient, userId: string): SyncStore {
  const path = (kind: SyncKind, key: string) => `${userId}/${kind}/${encodeURIComponent(key)}`;
  return {
    async list() {
      const { data, error } = await client.from(TABLE).select('kind, key, updated_at, deleted, data').eq('user_id', userId);
      if (error) throw error;
      return (data as Row[]).map(
        (r): RemoteItem => ({ kind: r.kind, key: r.key, updatedAt: Number(r.updated_at), deleted: r.deleted, data: r.data }),
      );
    },
    async put(item, file) {
      if (file) {
        const { error } = await client.storage.from(BUCKET).upload(path(item.kind, item.key), file, {
          upsert: true,
          contentType: file.type || 'application/octet-stream',
        });
        if (error) throw error;
      }
      const { error } = await client.from(TABLE).upsert({
        user_id: userId,
        kind: item.kind,
        key: item.key,
        updated_at: item.updatedAt,
        deleted: false,
        data: item.data,
      });
      if (error) throw error;
    },
    async markDeleted(kind, key, deletedAt) {
      const { error } = await client.from(TABLE).upsert({ user_id: userId, kind, key, updated_at: deletedAt, deleted: true, data: null });
      if (error) throw error;
      // 파일이 원래 없던 것(꾸밈)이어도 괜찮다
      await client.storage.from(BUCKET).remove([path(kind, key)]);
    },
    async fetchFile(kind, key) {
      const { data, error } = await client.storage.from(BUCKET).download(path(kind, key));
      if (error || !data) throw error ?? new Error(`파일이 없습니다: ${kind}/${key}`);
      return data;
    },
  };
}
