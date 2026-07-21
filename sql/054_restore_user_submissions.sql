-- 첫 재검수(2026-07-21)가 사람이 직접 제보/등록한 영상(source='user')까지 숨겨버렸다
-- (베네수엘라 지진 CCTV, 타이베이 라이브캠 등 오판정 포함).
-- 재검수가 숨긴 유저 등록분을 일괄 복구하고, 해당 로그를 'restored'로 확정해
-- 앞으로의 재검수 루프(복구→2주 뒤 또 숨김)에도 걸리지 않게 한다.
-- (스크립트 쪽도 함께 수정됨: 재검수는 이제 source='user'를 아예 건드리지 않는다)

-- (1) 재검수가 숨긴 유저 등록분 → 다시 공개
update streams set visibility = 'listed'
where visibility = 'hidden'
  and source = 'user'
  and video_id in (
    select video_id from ai_review_log
    where verdict = 'reject' and reason like '재검수:%'
  );

-- (2) 그 재검수 거절 로그를 '살림'으로 확정 (미처리 pending으로 남지 않게)
update ai_review_log set resolution = 'restored'
where verdict = 'reject'
  and reason like '재검수:%'
  and resolution = 'pending'
  and video_id in (select video_id from streams where source = 'user');
