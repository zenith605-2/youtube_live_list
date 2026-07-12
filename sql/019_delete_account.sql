-- 회원탈퇴 기능. 탈퇴해도 그 유저가 제보한 링크/차단 기록 자체는 사이트에 남기고
-- (커뮤니티 자산이라 삭제하지 않음) "누가 했는지"만 사라지게 ON DELETE SET NULL로 바꾼다.
-- (즐겨찾기/추천/비추천/댓글처럼 순전히 개인 데이터인 것들은 기존 그대로 on delete cascade로 같이 삭제됨)
alter table streams drop constraint streams_added_by_fkey;
alter table streams add constraint streams_added_by_fkey
  foreign key (added_by) references auth.users(id) on delete set null;

alter table blocklist drop constraint blocklist_blocked_by_fkey;
alter table blocklist add constraint blocklist_blocked_by_fkey
  foreign key (blocked_by) references auth.users(id) on delete set null;

alter table blocked_channels drop constraint blocked_channels_blocked_by_fkey;
alter table blocked_channels add constraint blocked_channels_blocked_by_fkey
  foreign key (blocked_by) references auth.users(id) on delete set null;

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function delete_my_account() to authenticated;
