-- 방문 기록에 IP/국가 추가 + 관리자 전용 열람
-- (visit_log는 지금까지 insert만 가능하고 select 정책이 없어 아무도 못 읽었음 —
--  관리자에게만 읽기를 연다. 개인정보처리방침에 수집 항목 고지 필요)
alter table visit_log add column ip text;
alter table visit_log add column country text;

create policy "visit_log_admin_read"
  on visit_log for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
