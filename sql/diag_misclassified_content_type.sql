-- 진단용(스키마 변경 없음). content_type='video'인데 등록된 지 얼마 안 됐거나 status가
-- 최근에 안 바뀐 행들 — "아직 재검증을 못 거친" 케이스를 찾는다.
select video_id, title, channel_title, content_type, status, added_at, updated_at
from streams
where content_type = 'video'
  and title ilike '%maui%'
order by added_at desc
limit 10;
