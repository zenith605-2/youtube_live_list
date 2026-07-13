-- 세로 영상(쇼츠 등) 필터: update.mjs가 유튜브 oEmbed로 화면 비율을 확인한 행을 기록한다.
-- 세로 영상은 삭제 + 차단목록에 올리고(비율은 변하지 않으므로 재수집 방지),
-- 가로 영상은 이 타임스탬프만 찍어서 매일 다시 검사하지 않게 한다.
alter table streams add column aspect_checked_at timestamptz;
