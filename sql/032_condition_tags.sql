-- 조건 태그 시스템 (일반 영상 전용): 밤/낮/비/폭우/눈/폭설/사고/화재/폭력
-- 카테고리(장소)와 별개의 축. 라이브는 조건이 계속 변하므로 태그를 달지 않는다.
alter table streams add column tags text[] not null default '{}';

-- 로그인 유저가 카드에서 태그를 수정 (허용된 태그만 저장되도록 서버에서 거른다)
create or replace function set_stream_tags(p_video_id text, p_tags text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  update streams set tags = (
    select coalesce(array_agg(distinct t), '{}')
    from unnest(p_tags) t
    where t in ('night', 'day', 'rain', 'heavy_rain', 'snow', 'heavy_snow', 'accident', 'fire', 'violence')
  )
  where video_id = p_video_id and content_type = 'video';
end;
$$;
grant execute on function set_stream_tags(text, text[]) to authenticated;

-- 기존 일반 영상들을 다음 AI 검사 때 다시 보게 해서 밤/낮/눈 태그를 붙이게 함
update streams set ai_checked_at = null where content_type = 'video';
