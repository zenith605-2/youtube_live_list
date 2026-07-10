// 1회용: 기존 data/streams.json을 Supabase streams 테이블로 이관한다.
// 사용법: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-seed.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STREAMS_PATH = path.join(ROOT, 'data', 'streams.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const raw = await readFile(STREAMS_PATH, 'utf-8');
  const { streams } = JSON.parse(raw);

  const rows = streams.map(s => ({
    video_id: s.videoId,
    title: s.title,
    channel_title: s.channelTitle,
    thumbnail: s.thumbnail,
    matched_keyword: s.matchedKeyword || null,
    source: 'keyword',
    added_by: null,
    added_at: s.addedAt || new Date().toISOString(),
  }));

  console.log(`${rows.length}건 이관 중...`);
  const { error, count } = await supabase
    .from('streams')
    .upsert(rows, { onConflict: 'video_id', count: 'exact' });

  if (error) {
    console.error('이관 실패:', error.message);
    process.exit(1);
  }
  console.log(`완료: ${count ?? rows.length}건 이관됨`);
}

main();
