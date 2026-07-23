-- 059의 후속 수정 — 카테고리 변경이 새로고침 후에도 여전히 옛값으로 보이는 문제.
--
-- 원인: 059에서 updated_at을 default now()로 추가하자 기존 3,000여 행 전부가
-- "마이그레이션 실행 시각"으로 찍혔다. 그 시각이 어젯밤 스냅샷보다 뒤라서
-- "스냅샷 이후 수정된 행" 델타가 테이블 전체를 반환하게 됐고, Supabase의 1000행
-- 응답 한도에 걸려 실제로 수정한 행이 델타에서 누락될 수 있었다.
--
-- 해결: updated_at을 각 행의 added_at(등록 시각)으로 되돌린다. 그러면 델타는
-- 진짜로 수정된 행만 반환한다. 백필 UPDATE 자체가 touch 트리거를 발동시키면
-- 다시 now()가 되므로, 트리거를 잠깐 끄고 채운 뒤 다시 켠다.

alter table streams disable trigger streams_touch_updated_at;

update streams set updated_at = coalesce(added_at, now() - interval '30 days');

alter table streams enable trigger streams_touch_updated_at;

-- 확인용: 최근 1시간 내 updated_at 행 수 — 0이어야 정상 (이후 실제 수정부터 다시 찍힘)
select count(*) as recently_updated
from streams
where updated_at > now() - interval '1 hour';
