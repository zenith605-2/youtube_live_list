-- 유저 제보 7일 임시등록 제도: 제보 즉시는 approval_status='pending'으로 들어가고,
-- (a) 본인 외 다른 유저 3명의 추천을 받거나 (b) 관리자가 승인하면 'approved'로 정식 전환된다.
-- 7일 안에 둘 다 없으면 update.mjs가 자동으로 삭제한다(차단목록에는 안 올림 - 나중에 다시 제보 가능).
alter table streams add column approval_status text check (approval_status in ('pending', 'approved'));

-- 유저가 제보할 때 반드시 'pending'으로만 들어가게 강제한다(클라이언트가 임의로 approved를 보내도 막힘).
drop policy if exists "streams_user_submit" on streams;
create policy "streams_user_submit"
  on streams for insert
  to authenticated
  with check (auth.uid() = added_by and source = 'user' and approval_status = 'pending');

-- 추천이 쌓일 때마다, 대기 중인 제보가 3추천에 도달하면 그 자리에서 바로 승인 처리한다.
create or replace function handle_new_upvote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update streams set upvote_count = upvote_count + 1 where video_id = new.video_id;
  update streams set approval_status = 'approved'
    where video_id = new.video_id and approval_status = 'pending' and upvote_count >= 3;
  return new;
end;
$$;
