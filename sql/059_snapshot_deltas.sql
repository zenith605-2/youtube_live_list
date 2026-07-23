-- 스냅샷 전환(f18235b)의 후속 수정 — 관리자/유저의 변경이 새로고침 후 "되돌아가는" 문제.
--
-- 원인: 방문자는 이제 어젯밤 구운 data/streams.json을 로드한다. 신규 행·투표수 델타는
-- 있었지만 "삭제된 행"과 "수정된 행"(카테고리·국가·태그 변경) 델타가 없어서,
-- DB에는 반영됐는데 화면은 스냅샷의 옛 상태를 보여줬다. 삭제가 안 먹히는 게 아니라
-- 화면이 하루 전 목록을 그리는 것이었다.
--
-- 해결: (1) streams.updated_at — 수정된 행을 스냅샷 시각 이후로 골라올 수 있게
--       (2) deleted_stream_ids 뷰 — 삭제는 전부 blocklist에 기록되므로 그 시각을 공개 조회

-- (1) 수정 시각 추적
alter table streams add column if not exists updated_at timestamptz not null default now();

create or replace function touch_streams_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists streams_touch_updated_at on streams;
create trigger streams_touch_updated_at before update on streams
for each row execute function touch_streams_updated_at();

-- (2) 삭제된 videoId 공개 조회 (blocklist 본체는 관리자 전용 RLS 유지 —
--     뷰는 소유자 권한으로 실행되므로 video_id와 시각 두 컬럼만 안전하게 노출된다)
create or replace view deleted_stream_ids as
  select video_id, created_at from blocklist;
grant select on deleted_stream_ids to anon, authenticated;

-- 확인용
select count(*) as deleted_ids_visible from deleted_stream_ids;
