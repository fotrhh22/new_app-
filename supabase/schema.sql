-- Circle 전체 데이터베이스 스키마
-- Supabase Dashboard > SQL Editor > New query에서 전체 내용을 실행하세요.

create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- ============================================================
-- 1. 회원 프로필
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

insert into public.profiles (id, email, display_name, avatar_url, created_at)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'display_name', ''),
  raw_user_meta_data ->> 'avatar_url',
  created_at
from auth.users
on conflict (id) do nothing;

-- ============================================================
-- 2. 게시글
-- ============================================================

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  post_number bigint generated always as identity unique,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  title varchar(200) not null check (char_length(btrim(title)) between 1 and 200),
  content text not null check (char_length(btrim(content)) > 0),
  password_hash text not null,
  is_secret boolean not null default false,
  like_count integer not null default 0 check (like_count >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- 이전 버전 스키마가 이미 실행된 프로젝트에도 조회수 컬럼을 추가합니다.
alter table public.posts add column if not exists view_count integer not null default 0;
alter table public.posts drop constraint if exists posts_view_count_check;
alter table public.posts add constraint posts_view_count_check check (view_count >= 0);

comment on table public.posts is 'Circle 게시판 게시글';
comment on column public.posts.password_hash is '수정 및 삭제 확인용 bcrypt 해시. API 조회 권한 없음';

create index if not exists posts_post_number_idx on public.posts (post_number desc);
create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_title_search_idx on public.posts using gin (to_tsvector('simple', title));
create index if not exists posts_author_name_search_idx on public.posts (lower(author_name));

alter table public.posts enable row level security;

-- 일반글은 모든 로그인 회원에게, 비밀글은 작성자 본인에게만 표시됩니다.
drop policy if exists "Authenticated users can view visible posts" on public.posts;
create policy "Authenticated users can view visible posts"
on public.posts for select to authenticated
using (is_secret = false or author_id = (select auth.uid()));

-- INSERT/UPDATE/DELETE는 공개 테이블에서 직접 허용하지 않습니다.
-- 아래 비밀번호 검증 RPC만 게시글을 생성·수정·삭제할 수 있습니다.

drop trigger if exists set_posts_updated_at on public.posts;
create trigger set_posts_updated_at
  before update on public.posts
  for each row execute procedure public.set_updated_at();

-- 게시글 작성: 비밀번호는 DB에서 bcrypt 해시로 변환됩니다.
create or replace function public.create_board_post(
  p_title text,
  p_content text,
  p_password text,
  p_is_secret boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_author_name text;
  v_post_id uuid;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if char_length(btrim(p_title)) not between 1 and 200 then
    raise exception '제목은 1자 이상 200자 이하여야 합니다.';
  end if;
  if char_length(btrim(p_content)) < 1 then
    raise exception '내용을 입력해 주세요.';
  end if;
  if char_length(p_password) < 4 then
    raise exception '게시글 비밀번호는 4자 이상이어야 합니다.';
  end if;

  select coalesce(nullif(display_name, ''), '회원')
  into v_author_name
  from public.profiles
  where id = v_user_id;

  insert into public.posts (
    author_id, author_name, title, content, password_hash, is_secret
  ) values (
    v_user_id,
    coalesce(v_author_name, '회원'),
    btrim(p_title),
    btrim(p_content),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    coalesce(p_is_secret, false)
  )
  returning id into v_post_id;

  return v_post_id;
end;
$$;

-- 게시글 수정: 작성자 ID와 게시글 비밀번호를 모두 검증합니다.
create or replace function public.update_board_post(
  p_post_id uuid,
  p_title text,
  p_content text,
  p_password text,
  p_is_secret boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if char_length(btrim(p_title)) not between 1 and 200 then
    raise exception '제목은 1자 이상 200자 이하여야 합니다.';
  end if;
  if char_length(btrim(p_content)) < 1 then
    raise exception '내용을 입력해 주세요.';
  end if;

  update public.posts
  set title = btrim(p_title),
      content = btrim(p_content),
      is_secret = coalesce(p_is_secret, false)
  where id = p_post_id
    and author_id = auth.uid()
    and password_hash = extensions.crypt(p_password, password_hash);

  if not found then
    raise exception '작성자 또는 게시글 비밀번호가 올바르지 않습니다.';
  end if;
end;
$$;

-- 게시글 삭제: 작성자 ID와 게시글 비밀번호를 모두 검증합니다.
create or replace function public.delete_board_post(
  p_post_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  delete from public.posts
  where id = p_post_id
    and author_id = auth.uid()
    and password_hash = extensions.crypt(p_password, password_hash);

  if not found then
    raise exception '작성자 또는 게시글 비밀번호가 올바르지 않습니다.';
  end if;
end;
$$;

-- 게시글 상세 화면 진입 시 조회수를 1 증가시킵니다.
-- 비밀글은 작성자 본인만 증가시킬 수 있습니다.
create or replace function public.increment_post_view(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view_count integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  update public.posts
  set view_count = view_count + 1
  where id = p_post_id
    and (is_secret = false or author_id = auth.uid())
  returning view_count into v_view_count;

  if not found then
    raise exception '게시글을 찾을 수 없거나 조회 권한이 없습니다.';
  end if;

  return v_view_count;
end;
$$;

-- ============================================================
-- 3. 게시글 첨부파일 메타데이터
-- ============================================================

create table if not exists public.post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text,
  file_size bigint not null check (file_size >= 0 and file_size <= 10485760),
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists post_attachments_post_id_idx
on public.post_attachments (post_id);

alter table public.post_attachments enable row level security;

-- 게시글 하나에 첨부할 수 있는 파일은 최대 5개입니다.
create or replace function public.limit_post_attachments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.post_attachments
    where post_id = new.post_id
  ) >= 5 then
    raise exception '게시글당 첨부파일은 최대 5개입니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists limit_post_attachments_before_insert on public.post_attachments;
create trigger limit_post_attachments_before_insert
  before insert on public.post_attachments
  for each row execute procedure public.limit_post_attachments();

drop policy if exists "Users can view attachments of visible posts" on public.post_attachments;
create policy "Users can view attachments of visible posts"
on public.post_attachments for select to authenticated
using (
  exists (
    select 1 from public.posts
    where posts.id = post_attachments.post_id
      and (posts.is_secret = false or posts.author_id = (select auth.uid()))
  )
);

drop policy if exists "Authors can add post attachments" on public.post_attachments;
create policy "Authors can add post attachments"
on public.post_attachments for insert to authenticated
with check (
  exists (
    select 1 from public.posts
    where posts.id = post_attachments.post_id
      and posts.author_id = (select auth.uid())
  )
);

drop policy if exists "Authors can delete post attachments" on public.post_attachments;
create policy "Authors can delete post attachments"
on public.post_attachments for delete to authenticated
using (
  exists (
    select 1 from public.posts
    where posts.id = post_attachments.post_id
      and posts.author_id = (select auth.uid())
  )
);

-- ============================================================
-- 4. 게시글 좋아요
-- ============================================================

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_id_idx on public.post_likes (user_id);

alter table public.post_likes enable row level security;

drop policy if exists "Users can view likes of visible posts" on public.post_likes;
create policy "Users can view likes of visible posts"
on public.post_likes for select to authenticated
using (
  exists (
    select 1 from public.posts
    where posts.id = post_likes.post_id
      and (posts.is_secret = false or posts.author_id = (select auth.uid()))
  )
);

drop policy if exists "Users can add their own likes" on public.post_likes;
create policy "Users can add their own likes"
on public.post_likes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.posts
    where posts.id = post_likes.post_id
      and (posts.is_secret = false or posts.author_id = (select auth.uid()))
  )
);

drop policy if exists "Users can remove their own likes" on public.post_likes;
create policy "Users can remove their own likes"
on public.post_likes for delete to authenticated
using (user_id = (select auth.uid()));

-- 좋아요 개수를 posts.like_count에 동기화합니다.
create or replace function public.sync_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts
  set like_count = (
    select count(*)::integer
    from public.post_likes
    where post_id = v_post_id
  )
  where id = v_post_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_post_like_count_after_change on public.post_likes;
create trigger sync_post_like_count_after_change
  after insert or delete on public.post_likes
  for each row execute procedure public.sync_post_like_count();

-- ============================================================
-- 5. 첨부파일용 Supabase Storage
-- 저장 경로 규칙: {사용자ID}/{게시글ID}/{고유파일명}
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'board-files',
  'board-files',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-zip-compressed'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read files of visible posts" on storage.objects;
create policy "Users can read files of visible posts"
on storage.objects for select to authenticated
using (
  bucket_id = 'board-files'
  and exists (
    select 1 from public.posts
    where posts.id::text = (storage.foldername(name))[2]
      and (posts.is_secret = false or posts.author_id = (select auth.uid()))
  )
);

drop policy if exists "Authors can upload board files" on storage.objects;
create policy "Authors can upload board files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'board-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.posts
    where posts.id::text = (storage.foldername(name))[2]
      and posts.author_id = (select auth.uid())
  )
);

drop policy if exists "Authors can delete board files" on storage.objects;
create policy "Authors can delete board files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'board-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ============================================================
-- 6. API 권한
-- ============================================================

grant usage on schema public to authenticated;
grant select, update on table public.profiles to authenticated;

-- password_hash는 브라우저 API에 절대 노출하지 않습니다.
revoke all on table public.posts from anon, authenticated;
grant select (
  id, post_number, author_id, author_name, title, content,
  is_secret, like_count, view_count, created_at, updated_at
) on table public.posts to authenticated;

grant select, insert, delete on table public.post_attachments to authenticated;
grant select, insert, delete on table public.post_likes to authenticated;

revoke all on function public.create_board_post(text, text, text, boolean) from public, anon;
revoke all on function public.update_board_post(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.delete_board_post(uuid, text) from public, anon;
revoke all on function public.increment_post_view(uuid) from public, anon;
grant execute on function public.create_board_post(text, text, text, boolean) to authenticated;
grant execute on function public.update_board_post(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.delete_board_post(uuid, text) to authenticated;
grant execute on function public.increment_post_view(uuid) to authenticated;

-- ============================================================
-- 7. AI 요청 기록
-- ============================================================

create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null check (char_length(btrim(question)) > 0),
  answer text,
  model text not null default 'gemini-2.5-flash',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error_message text,
  is_favorite boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists ai_requests_user_created_idx on public.ai_requests (user_id, created_at desc);
create index if not exists ai_requests_user_favorite_idx on public.ai_requests (user_id, is_favorite);
alter table public.ai_requests enable row level security;

drop policy if exists "Users can view their own AI requests" on public.ai_requests;
create policy "Users can view their own AI requests" on public.ai_requests for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users can update their own AI requests" on public.ai_requests;
create policy "Users can update their own AI requests" on public.ai_requests for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users can delete their own AI requests" on public.ai_requests;
create policy "Users can delete their own AI requests" on public.ai_requests for delete to authenticated using (user_id = (select auth.uid()));

drop trigger if exists set_ai_requests_updated_at on public.ai_requests;
create trigger set_ai_requests_updated_at before update on public.ai_requests for each row execute procedure public.set_updated_at();

create table if not exists public.ai_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ai_requests(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text,
  file_size bigint not null check (file_size >= 0 and file_size <= 10485760),
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists ai_request_attachments_request_idx on public.ai_request_attachments (request_id);
alter table public.ai_request_attachments enable row level security;
drop policy if exists "Users can view their own AI attachments" on public.ai_request_attachments;
create policy "Users can view their own AI attachments" on public.ai_request_attachments for select to authenticated using (exists (select 1 from public.ai_requests where ai_requests.id = ai_request_attachments.request_id and ai_requests.user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit)
values ('ai-request-files', 'ai-request-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "Users can read their own AI files" on storage.objects;
create policy "Users can read their own AI files" on storage.objects for select to authenticated using (bucket_id = 'ai-request-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

grant select, update (is_favorite), delete on public.ai_requests to authenticated;
grant select on public.ai_request_attachments to authenticated;
