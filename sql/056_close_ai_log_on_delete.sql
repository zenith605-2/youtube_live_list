-- AI 검수 로그의 resolution은 지금까지 resolve_ai_rejection RPC(로그 화면의 버튼)로만 정리됐다.
-- 그래서 관리자가 승인 대기 화면이나 카드에서 직접 삭제하면 streams 행만 사라지고
-- 로그는 계속 'pending'으로 남아, 이미 없는 영상이 "거절 제안" 목록을 가득 채웠다
-- (Type/Category/국가가 전부 '–'로 뜨던 행들).
-- 삭제 경로와 무관하게 로그가 마감되도록 트리거로 처리한다.

create or replace function close_ai_log_on_stream_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update ai_review_log set resolution = 'deleted'
  where video_id = old.video_id and resolution = 'pending';
  return old;
end; $$;

create trigger on_stream_delete_close_ai_log
  after delete on streams
  for each row execute function close_ai_log_on_stream_delete();

-- 백필: 이미 삭제됐는데 미처리로 남아 있는 로그를 정리한다
update ai_review_log l set resolution = 'deleted'
where l.resolution = 'pending'
  and not exists (select 1 from streams s where s.video_id = l.video_id);
