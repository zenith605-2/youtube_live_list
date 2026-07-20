-- 'space' 카테고리의 다국어 라벨이 전부 한국어("우주")로 들어가 있어, 영어/일본어/중국어/스페인어
-- 페이지에서도 "우주"로 노출됐다 (홈 정적 색인의 "우주 live cams" 등).
-- categories 테이블은 RLS상 service_role만 쓰기가 가능해 Supabase SQL Editor에서 실행해야 한다.
update categories
set label_en = 'Space',
    label_ja = '宇宙',
    label_zh = '太空',
    label_es = 'Espacio'
where key = 'space';

-- 확인용
-- select key, label_en, label_ko, label_ja, label_zh, label_es from categories where key = 'space';
