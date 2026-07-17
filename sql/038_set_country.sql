-- 로그인 유저가 카드에서 영상의 국가를 수정 (자동 수집된 채널 국가가 틀리거나 비어있을 때)
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
  update streams set country = p_country where video_id = p_video_id;
end;
$$;
grant execute on function set_stream_country(text, text) to authenticated;
