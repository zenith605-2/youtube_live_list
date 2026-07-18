-- AI 검수 판정 로그: 관리자가 Gemini의 승인/거절 판단을 이유와 함께 검토할 수 있게 기록.
-- 거절은 즉시 삭제하지 않고 여기에 남겨, 관리자가 확인 후 실제 삭제하거나 되살린다.
create table ai_review_log (
  id bigint generated always as identity primary key,
  video_id text not null,
  title text,
  channel_title text,
  verdict text not null check (verdict in ('approve', 'reject', 'unsure')),
  reason text,
  suggested_category text,
  suggested_country text,
  reviewed_at timestamptz not null default now(),
  -- 관리자 처리 상태: 거절 판정을 어떻게 마무리했는지
  resolution text default 'pending' check (resolution in ('pending', 'deleted', 'restored'))
);
alter table ai_review_log enable row level security;
-- 관리자만 읽기 (stats/visit_log와 동일 패턴)
create policy "ai_log_admin_read" on ai_review_log for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin));
create index ai_review_log_reviewed_idx on ai_review_log (reviewed_at desc);

-- 로그를 남기는 것은 service_role(스크립트)만 하므로 insert 정책은 두지 않는다 (RLS 우회).

-- 관리자가 로그에서 "AI 거절"을 확정 삭제 / 되살리기 하는 RPC
create or replace function resolve_ai_rejection(p_video_id text, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'admin only';
  end if;
  if p_action = 'delete' then
    delete from streams where video_id = p_video_id;
    update ai_review_log set resolution = 'deleted' where video_id = p_video_id and resolution = 'pending';
  elsif p_action = 'restore' then
    -- 되살리기 = 승인 상태로 공개 (AI가 잘못 거절한 경우)
    update streams set approval_status = 'approved' where video_id = p_video_id;
    update ai_review_log set resolution = 'restored' where video_id = p_video_id and resolution = 'pending';
  else
    raise exception 'invalid action';
  end if;
end;
$$;
grant execute on function resolve_ai_rejection(text, text) to authenticated;
