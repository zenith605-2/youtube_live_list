-- Storyful처럼 저작권 관리(Content ID)로 외부 표시가 막힌 영상은 API상 embeddable=true라
-- 우리 사이트가 임베드를 시도하다 '재생할 수 없음'만 뜬다. 삭제하지 않고 embeddable=false로
-- 바꿔 썸네일 + '외부재생불가' 배지 + 유튜브 링크로 노출되게 한다.
-- (앞으로 수집되는 Storyful 영상은 config/no-embed-keywords.json + update.mjs가 자동 처리)
update streams
set embeddable = false
where embeddable is true
  and (channel_title ilike '%storyful%' or title ilike '%storyful%');
