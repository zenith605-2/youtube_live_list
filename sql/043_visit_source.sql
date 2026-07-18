-- 043: 방문 유입 경로(referrer) 기록
--
-- 배경: Google Search Console은 "구글 검색으로 온 방문"만 보여준다. Reddit·직접·타 사이트
--   유입은 GSC에 안 나와서, 실제로 사람들이 어디서 오는지 알 수가 없었다. 방문 기록 시
--   document.referrer를 정규화한 source('reddit'|'google'|'direct'|'x'|호스트명 등)를 남겨,
--   관리자 통계(stats.html)에서 유입 경로 분포를 보게 한다.
--
-- Supabase SQL Editor에서 1회 실행하세요. (기존 행은 source=NULL → 통계에서 'unknown'으로 표시)

alter table visit_log add column source text;
