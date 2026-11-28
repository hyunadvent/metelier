-- Metelier 저장 공간 (Supabase → SQL Editor 에서 한 번 실행한다)
-- 로그인한 사람마다 자기 화실 꾸밈, 칠하던 그림, 작품집, 사진 그림을 둔다.
-- 표의 행과 파일은 모두 그 사람만 읽고 쓸 수 있다 (RLS).

-- ── 목록 표 ─────────────────────────────────────
-- kind: decor(화실 꾸밈) | progress(칠하던 그림) | gallery(완성한 작품) | painting(사진으로 만든 그림)
-- key: 그림 ID (꾸밈은 'main')
-- updated_at: 마지막으로 바꾼 때 (밀리초). 동기화는 나중에 바뀐 쪽을 따른다.
-- deleted: 지운 것. 다른 기기에서도 지워지도록 행을 남겨 둔다.
-- data: 작은 정보 (꾸밈 자체, 그림 크기, 제목 등). 큰 것은 아래 파일 저장소에 둔다.
create table if not exists public.metelier_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('decor', 'progress', 'gallery', 'painting')),
  key text not null check (char_length(key) between 1 and 80),
  updated_at bigint not null,
  deleted boolean not null default false,
  data jsonb,
  primary key (user_id, kind, key)
);

alter table public.metelier_items enable row level security;

-- 로그인한 사람(authenticated)만 표를 쓸 수 있게 한다. 로그인하지 않은 사람(anon)에게는 주지 않는다.
-- 어느 줄을 볼 수 있는지는 아래 RLS 정책이 정한다 (자기 줄만).
revoke all on public.metelier_items from anon;
grant select, insert, update, delete on public.metelier_items to authenticated;

drop policy if exists "metelier_items_select_own" on public.metelier_items;
drop policy if exists "metelier_items_insert_own" on public.metelier_items;
drop policy if exists "metelier_items_update_own" on public.metelier_items;
drop policy if exists "metelier_items_delete_own" on public.metelier_items;

create policy "metelier_items_select_own" on public.metelier_items
  for select to authenticated using (user_id = auth.uid());
create policy "metelier_items_insert_own" on public.metelier_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "metelier_items_update_own" on public.metelier_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "metelier_items_delete_own" on public.metelier_items
  for delete to authenticated using (user_id = auth.uid());

-- ── 파일 저장소 ─────────────────────────────────
-- 경로: <사용자 ID>/<kind>/<key>. 사람마다 자기 이름의 폴더만 쓸 수 있다. 공개하지 않는다.
-- 파일 하나의 최대 크기: 20MB (사진 그림 하나가 몇 MB 이다)
insert into storage.buckets (id, name, public, file_size_limit)
values ('metelier', 'metelier', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "metelier_files_select_own" on storage.objects;
drop policy if exists "metelier_files_insert_own" on storage.objects;
drop policy if exists "metelier_files_update_own" on storage.objects;
drop policy if exists "metelier_files_delete_own" on storage.objects;

create policy "metelier_files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'metelier' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "metelier_files_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'metelier' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "metelier_files_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'metelier' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'metelier' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "metelier_files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'metelier' and (storage.foldername(name))[1] = auth.uid()::text);
