-- 041: Crowd 카테고리 폐지 → City Street(번화가)의 반대 개념 'Quiet Place' 신설
--
-- 배경: Crowd(군중)와 downtown(City Street)의 키워드가 겹쳐서(거리/보행자/city 등)
--       신주쿠·시부야 같은 번화가 라이브캠이 두 카테고리에 동시에 걸렸다. 게다가
--       '붐빔'은 장소 유형이 아니라 '상태'라(같은 카메라가 시간대에 따라 붐볐다 한산했다 함)
--       카테고리로 두기엔 부적절했다. 대신 City Street의 반대편(한적한 곳)을 장소
--       카테고리로 추가해, 번화가 ↔ 한적한 곳 이라는 명확한 대비 축을 만든다.
--
-- Supabase SQL Editor에서 1회 실행하세요.

-- (1) 기존 crowd 영상은 붐비는 거리·번화가이므로 City Street(downtown)로 이관
update streams set category = 'downtown' where category = 'crowd';

-- (2) crowd 카테고리 삭제 (라벨/키워드/아이콘/정렬 모두 이 한 행에 있음)
delete from categories where key = 'crowd';

-- (3) Quiet Place 카테고리 추가 (City Street의 반대 개념)
--     keywords는 (a) 제목 기반 자동 분류, (b) '부족 카테고리 부스트 검색'의 검색어로
--     이중 사용된다. 부스트 검색은 영문 키워드에 자동으로 'cam'을 붙여
--     "quiet cam", "peaceful cam" 등으로 유튜브에서 한적한 라이브캠을 찾아온다.
insert into categories (key, keywords, label_en, label_ko, label_ja, label_zh, label_es, sort_order, icon) values
  ('quiet',
   array['quiet','peaceful','calm','serene','tranquil','한적','조용','시골','countryside',
         '静か','のどか','閑静','田舎','宁静','安静','乡村','tranquilo','apacible'],
   'Quiet Place', '한적한 곳', '静かな場所', '宁静之地', 'Lugar tranquilo', 38, '🍃');
