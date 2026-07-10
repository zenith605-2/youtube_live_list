-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 Run 하세요.

create table streams (
  video_id text primary key,
  title text,
  channel_title text,
  thumbnail text,
  matched_keyword text,
  source text not null default 'keyword' check (source in ('keyword', 'user')),
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now(),
  report_count int not null default 0,
  upvote_count int not null default 0
);

alter table streams enable row level security;

create policy "streams_public_read"
  on streams for select
  using (true);

create policy "streams_user_submit"
  on streams for insert
  to authenticated
  with check (auth.uid() = added_by and source = 'user');

create table reports (
  video_id text not null references streams(video_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

alter table reports enable row level security;

create policy "reports_user_insert"
  on reports for insert
  to authenticated
  with check (auth.uid() = user_id);

create or replace function handle_new_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update streams set report_count = report_count + 1 where video_id = new.video_id;
  delete from streams where video_id = new.video_id and report_count >= 10;
  return new;
end;
$$;

create trigger on_report_insert
after insert on reports
for each row execute function handle_new_report();

-- 유저 공개 프로필 (구글 로그인 시 이름/아바타를 자동으로 복사)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_public_read"
  on profiles for select
  using (true);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- 추천(업보트): 자기 제보는 추천 불가, 한 사람당 한 영상에 1회만
create table upvotes (
  video_id text not null references streams(video_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

alter table upvotes enable row level security;

create policy "upvotes_user_insert"
  on upvotes for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from streams s where s.video_id = upvotes.video_id and s.added_by = auth.uid()
    )
  );

create or replace function handle_new_upvote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update streams set upvote_count = upvote_count + 1 where video_id = new.video_id;
  return new;
end;
$$;

create trigger on_upvote_insert
after insert on upvotes
for each row execute function handle_new_upvote();

-- 기여도 랭킹: 유저가 제보한 스트림들이 받은 추천수 합계
create view leaderboard as
select
  p.id as user_id,
  p.display_name,
  p.avatar_url,
  coalesce(sum(s.upvote_count), 0) as score,
  count(s.video_id) as submissions
from profiles p
join streams s on s.added_by = p.id
group by p.id, p.display_name, p.avatar_url
order by score desc, submissions desc;

grant select on leaderboard to anon, authenticated;
