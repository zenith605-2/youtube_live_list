-- 진단용(스키마 변경 없음). 오늘 방문자 수가 튄 원인을 찾는다.
-- Supabase SQL Editor에서 실행하고 결과를 공유하면 원인을 특정할 수 있다.

-- (1) 오늘 유입 경로별 — 특정 source에 몰려 있으면 그쪽이 원인
select source,
       count(*)            as visits,
       count(distinct ip)  as distinct_ips
from visit_log
where visit_date = (now() at time zone 'Asia/Seoul')::date
group by source
order by visits desc;

-- (2) 오늘 IP별 상위 — 한 IP가 수십 건이면 크롤러/자동화(또는 본인 시크릿창)
select ip,
       count(*)                     as rows_today,
       count(distinct visitor_key)  as keys,
       min(created_at)              as first_seen,
       max(created_at)              as last_seen
from visit_log
where visit_date = (now() at time zone 'Asia/Seoul')::date
group by ip
order by rows_today desc
limit 15;

-- (3) 오늘 전체 요약 — 행 수 대비 고유 IP가 훨씬 적으면 소수 IP가 부풀린 것
select count(*)                    as rows_today,
       count(distinct ip)          as distinct_ips,
       count(distinct visitor_key) as distinct_keys
from visit_log
where visit_date = (now() at time zone 'Asia/Seoul')::date;
