-- 비슷한 카테고리끼리 묶어서 정렬
-- 그룹: 자연/물(10대) → 도시 풍경(30대) → 교통(50대) → 시점(70대) → 기타(999)
-- 그룹 사이 번호를 띄워놨으므로 새 카테고리는 어울리는 그룹 번호대에 끼워넣으면 된다
-- (제안 승인으로 생기는 카테고리는 90으로 들어가 '시점' 뒤, '기타' 앞에 위치)

update categories set sort_order = v.sort_order
from (values
  -- 자연/물
  ('beach', 10),
  ('coast', 11),
  ('harbor', 12),
  ('river', 13),
  ('mountain', 14),
  ('wildlife', 15),
  -- 도시 풍경
  ('downtown', 30),
  ('skyline', 31),
  ('plaza', 32),
  ('park', 33),
  ('alley', 34),
  ('crowd', 35),
  ('indoor', 36),
  ('construction', 37),
  -- 교통
  ('traffic', 50),
  ('parking', 51),
  ('airport', 52),
  ('train', 53),
  ('dashcam', 54),
  -- 시점(촬영 방식)
  ('walk', 70),
  ('aerial', 71),
  -- 기타
  ('other', 999)
) as v(key, sort_order)
where categories.key = v.key;
