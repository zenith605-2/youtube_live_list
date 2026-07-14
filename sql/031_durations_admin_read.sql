-- 체류시간 원본을 관리자만 읽을 수 있게 (Recent Visitors 표에 방문자별 체류시간 표시용)
create policy "visit_durations_admin_read"
  on visit_durations for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
