-- 일반 영상(content_type='video') 채널의 업로드 목록을 playlistItems.list로 스캔하기 위한 큐 테이블.
-- search.list(하루 100회 한도)와 달리 playlistItems.list는 호출당 1 unit이라 훨씬 저렴하게
-- 채널 하나당 업로드 영상 전체를 훑을 수 있다. 채널 하나가 한 번에 다 안 끝나면
-- next_page_token에 이어서 다음 실행 때 마저 진행하고, 끝까지 다 돌면 done=true로 표시해 재스캔하지 않는다.
create table scanned_video_channels (
  channel_id text primary key,
  next_page_token text,
  done boolean not null default false,
  scanned_at timestamptz not null default now()
);
