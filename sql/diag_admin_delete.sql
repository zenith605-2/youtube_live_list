-- 진단용(스키마 변경 없음). "삭제/카테고리 변경이 화면에선 되는데 새로고침하면 되돌아온다"의 원인을 찾는다.
-- 인시크리트에서도 동일하게 재현되므로 세션 문제가 아니라 서버(RLS) 쪽 문제로 보고 확인한다.

-- (1) 내 계정이 관리자로 표시돼 있는지 — 여기서 is_admin이 false/없음이면 그게 원인
select u.email, p.id, p.is_admin
from auth.users u
join profiles p on p.id = u.id
order by u.created_at desc
limit 20;

-- (2) streams 테이블에 걸린 delete 정책이 지금도 그대로인지
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'streams'::regclass;

-- (3) streams 테이블에 RLS가 켜져 있는지 (꺼져 있으면 이 문제와 무관 — 대신 아예 안 되는 게 정상이 아님)
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'streams';

-- (4) streams에 걸린 트리거 목록 (056에서 추가한 after-delete 트리거가 뭔가를 막고 있는지 확인)
select tgname, tgtype, tgenabled
from pg_trigger
where tgrelid = 'streams'::regclass and not tgisinternal;
