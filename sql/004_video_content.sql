-- 4단계: 라이브 외 일반 영상(블랙박스/야생동물/군중 등) 지원
alter table streams add column content_type text not null default 'live' check (content_type in ('live', 'video'));
alter table streams add column published_at timestamptz;
