-- 사람이 국가를 수정하면 country_source='user'로 표시해, 야간 AI 검수/채널 추정이
-- 그 값을 다시 덮어쓰지 않게 한다 (update.mjs와 ai_review.mjs 모두 user 값은 보존함).
-- 038 정의 대체.
create or replace function set_stream_country(p_video_id text, p_country text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;
  if p_country is not null and p_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid country code';
  end if;
  update streams set country = p_country, country_source = 'user' where video_id = p_video_id;
end;
$$;
grant execute on function set_stream_country(text, text) to authenticated;
