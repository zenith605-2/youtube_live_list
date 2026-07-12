-- 방문자 카운터: 브라우저별로 생성해 localStorage에 저장하는 visitor_key를
-- 하루에 한 번만 기록한다(unique(visit_date, visitor_key)). "오늘" = 오늘 기록된 행 수,
-- "전체" = 지금까지 한 번이라도 방문한 고유 visitor_key 수.
create table visit_log (
  id bigint generated always as identity primary key,
  visit_date date not null default current_date,
  visitor_key text not null,
  created_at timestamptz not null default now(),
  unique (visit_date, visitor_key)
);

alter table visit_log enable row level security;

create policy "visit_log_insert_anyone"
  on visit_log for insert
  to anon, authenticated
  with check (true);

create view visit_stats as
select
  (select count(*) from visit_log where visit_date = current_date) as today_count,
  (select count(distinct visitor_key) from visit_log) as total_count;

grant select on visit_stats to anon, authenticated;
