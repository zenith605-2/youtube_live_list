-- 044: 같은 채널 + 완전 동일 제목 중복 1회 정리 (즉시 실행용)
--
-- 채널이 같은 캠을 여러 스트림/아카이브로 반복 올리면 그리드에 똑같은 카드가
-- 나란히 뜬다 (예: 엘리시안강촌 8개, Axis 데모캠 등). 라이브 우선 → 최신 등록순으로
-- 대표 1개만 남기고 나머지는 삭제 + 차단목록 등록(재수집 방지).
-- 앞으로는 매일 밤 update.mjs가 같은 정리를 자동으로 수행한다.
--
-- Supabase SQL Editor에서 1회 실행하세요.

with ranked as (
  select video_id,
         row_number() over (
           partition by channel_title, title
           order by (content_type = 'live')::int desc, added_at desc nulls last
         ) as rn
  from streams
  where title is not null and channel_title is not null
),
doomed as (
  select video_id from ranked where rn > 1
),
del as (
  delete from streams where video_id in (select video_id from doomed)
  returning video_id
)
insert into blocklist (video_id)
select video_id from del
on conflict (video_id) do nothing;
