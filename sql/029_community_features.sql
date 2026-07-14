-- 029: 커뮤니티 기능 묶음
-- (1) 카테고리 변경 이력 + 관리자 되돌리기
-- (2) 응원 한마디 (게스트/유저 공용)
-- (3) 카테고리 제안 + 관리자 승인
-- (4) 체류시간 측정
-- (5) 신규 카테고리 7종 (기차/강/광장/공원/골목/공사장/항공드론)

-- ========== (1) 카테고리 변경 이력 ==========
create table category_changes (
  id bigint generated always as identity primary key,
  video_id text not null,
  old_category text,
  new_category text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table category_changes enable row level security;
create policy "category_changes_admin_read"
  on category_changes for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- 카테고리 변경 시 이력을 자동 기록하도록 RPC 교체
create or replace function set_stream_category(p_video_id text, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into category_changes (video_id, old_category, new_category, changed_by)
    select video_id, category, p_category, auth.uid()
    from streams where video_id = p_video_id and category is distinct from p_category;
  update streams set category = p_category, category_source = 'user' where video_id = p_video_id;
end;
$$;

-- ========== (2) 응원 한마디 ==========
create table cheers (
  id bigint generated always as identity primary key,
  name text check (name is null or char_length(name) <= 30),
  content text not null check (char_length(content) between 1 and 200),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table cheers enable row level security;
create policy "cheers_read" on cheers for select using (true);
create policy "cheers_insert_anyone" on cheers for insert to anon, authenticated with check (true);
create policy "cheers_admin_delete"
  on cheers for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- ========== (3) 카테고리 제안 ==========
create table category_suggestions (
  id bigint generated always as identity primary key,
  suggestion text not null check (char_length(suggestion) between 2 and 40),
  suggested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
alter table category_suggestions enable row level security;
create policy "catsug_read" on category_suggestions for select using (true);
create policy "catsug_insert" on category_suggestions for insert to authenticated
  with check (auth.uid() = suggested_by);
create policy "catsug_admin_update"
  on category_suggestions for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));

-- 승인: 카테고리를 실제로 생성 (라벨은 우선 영문 하나로 넣고, 필요하면 SQL로 다듬기)
create or replace function approve_category_suggestion(p_id bigint, p_key text, p_label text, p_sort int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'admin only';
  end if;
  insert into categories (key, keywords, label_en, label_ko, label_ja, label_zh, label_es, sort_order)
  values (p_key, array[lower(p_label)], p_label, p_label, p_label, p_label, p_label, p_sort)
  on conflict (key) do nothing;
  update category_suggestions set status = 'approved' where id = p_id;
end;
$$;
grant execute on function approve_category_suggestion(bigint, text, text, int) to authenticated;

-- ========== (4) 체류시간 ==========
create table visit_durations (
  id bigint generated always as identity primary key,
  visitor_key text not null,
  seconds int not null check (seconds between 1 and 43200),
  created_at timestamptz not null default now()
);
alter table visit_durations enable row level security;
create policy "visit_durations_insert" on visit_durations for insert to anon, authenticated with check (true);

create view daily_duration_stats as
  select (created_at at time zone 'Asia/Seoul')::date as stat_date,
         count(*)::int as sessions,
         round(avg(seconds))::int as avg_seconds,
         round((percentile_cont(0.5) within group (order by seconds))::numeric)::int as median_seconds
  from visit_durations
  group by 1;
grant select on daily_duration_stats to anon, authenticated;

-- ========== (5) 신규 카테고리 ==========
insert into categories (key, keywords, label_en, label_ko, label_ja, label_zh, label_es, sort_order) values
  ('train', array['train station','train cam','railway','railroad','기차','철도','전철','電車','鉄道','駅 ライブ','火车','铁路','tren','ferrocarril','bahn'], 'Train / Railway', '기차/철도', '電車・鉄道', '火车/铁路', 'Tren', 47),
  ('river', array['river','riverside','canal','강변','강 라이브','川 ライブ','河川','运河','河流','río','fluss'], 'River / Canal', '강/운하', '川・運河', '河流/运河', 'Río', 48),
  ('plaza', array['plaza','square','광장','広場','广场','praça','platz'], 'Plaza / Square', '광장', '広場', '广场', 'Plaza', 62),
  ('park', array['park','공원','公園','公园','parque'], 'Park', '공원', '公園', '公园', 'Parque', 63),
  ('alley', array['alley','골목','진입로','路地','小巷','callejón','back street'], 'Alley', '골목/진입로', '路地', '小巷', 'Callejón', 64),
  ('construction', array['construction','공사장','공사현장','건설현장','工事','建設現場','工地','construcción','obra','baustelle','crane cam'], 'Construction', '공사장', '建設現場', '工地', 'Construcción', 96),
  ('aerial', array['aerial','drone','드론','항공촬영','ドローン','空撮','无人机','航拍','dron','aéreo'], 'Aerial / Drone', '항공/드론', '空撮・ドローン', '航拍/无人机', 'Aéreo/Dron', 98)
on conflict (key) do nothing;

-- 'car park'(주차장)가 신설 park 카테고리로 오분류되지 않게 parking 키워드 보강
update categories set keywords = array_append(keywords, 'car park')
where key = 'parking' and not ('car park' = any(keywords));
