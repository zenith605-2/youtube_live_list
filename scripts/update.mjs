// 매일 실행: Supabase streams 테이블을 갱신한다.
// 1) 기존 행 생존 확인 (중지/오탐 제거, 유저 제보의 빈 제목/채널명 보강)
// 2) 키워드 검색으로 신규 라이브 CCTV 후보 탐색 및 검증 후 추가
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEYWORDS_PATH = path.join(ROOT, 'config', 'keywords.json');
const EXCLUDE_KEYWORDS_PATH = path.join(ROOT, 'config', 'exclude-keywords.json');

const API_KEY = process.env.YOUTUBE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

if (!API_KEY) {
  console.error('환경변수 YOUTUBE_API_KEY 가 설정되어 있지 않습니다.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('환경변수 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 설정되어 있지 않습니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${text}`);
  }
  return res.json();
}

// videoIds 중 현재 실제로 라이브 중인 것만 videoId -> snippet 맵으로 반환
async function getLiveSnippets(videoIds) {
  const liveMap = new Map();
  for (const batch of chunk(videoIds, 50)) {
    if (batch.length === 0) continue;
    const url = `${BASE}/videos?part=snippet&id=${batch.join(',')}&key=${API_KEY}`;
    const data = await fetchJson(url);
    for (const item of data.items || []) {
      if (item.snippet?.liveBroadcastContent === 'live') {
        liveMap.set(item.id, item.snippet);
      }
    }
  }
  return liveMap;
}

// search.list는 title/channelTitle을 HTML 엔티티로 이스케이프해서 반환하므로 디코딩 필요
const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};
function decodeHtmlEntities(str) {
  return (str || '').replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, m => HTML_ENTITIES[m]);
}

function snippetThumbnail(snippet) {
  return (
    snippet.thumbnails?.high?.url ||
    snippet.thumbnails?.medium?.url ||
    snippet.thumbnails?.default?.url
  );
}

async function searchLiveByKeyword(keyword, maxResults = 25) {
  const url = `${BASE}/search?part=snippet&type=video&eventType=live&maxResults=${maxResults}&q=${encodeURIComponent(keyword)}&key=${API_KEY}`;
  const data = await fetchJson(url);
  return (data.items || [])
    .filter(item => item.id?.videoId)
    .map(item => ({
      videoId: item.id.videoId,
      title: decodeHtmlEntities(item.snippet.title),
      channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
      thumbnail: snippetThumbnail(item.snippet),
      matchedKeyword: keyword,
    }));
}

async function main() {
  const [keywordsRaw, excludeRaw] = await Promise.all([
    readFile(KEYWORDS_PATH, 'utf-8'),
    readFile(EXCLUDE_KEYWORDS_PATH, 'utf-8').catch(() => '{"keywords":[]}'),
  ]);
  const keywords = JSON.parse(keywordsRaw).keywords || [];
  const excludeKeywords = (JSON.parse(excludeRaw).keywords || []).map(k => k.toLowerCase());

  const isExcluded = (title, channelTitle) => {
    const haystack = `${title} ${channelTitle}`.toLowerCase();
    return excludeKeywords.some(k => haystack.includes(k));
  };

  const { data: existingRows, error: fetchErr } = await supabase.from('streams').select('*');
  if (fetchErr) throw fetchErr;

  console.log(`기존 목록 ${existingRows.length}건 생존 확인 중...`);
  const existingIds = existingRows.map(r => r.video_id);
  const liveMap = await getLiveSnippets(existingIds);

  const toDelete = [];
  const toUpdate = [];
  let survivorCount = 0;

  for (const row of existingRows) {
    const snippet = liveMap.get(row.video_id);
    if (!snippet) {
      toDelete.push(row.video_id);
      continue;
    }
    const title = decodeHtmlEntities(snippet.title);
    const channelTitle = decodeHtmlEntities(snippet.channelTitle);
    if (isExcluded(title, channelTitle)) {
      toDelete.push(row.video_id);
      continue;
    }
    survivorCount += 1;
    if (!row.title || !row.channel_title) {
      toUpdate.push({
        video_id: row.video_id,
        title,
        channel_title: channelTitle,
        thumbnail: row.thumbnail || snippetThumbnail(snippet),
      });
    }
  }

  console.log(`  -> 생존 ${survivorCount}건, 제거 ${toDelete.length}건, 정보 보강 ${toUpdate.length}건`);

  if (toDelete.length) {
    const { error } = await supabase.from('streams').delete().in('video_id', toDelete);
    if (error) console.error('삭제 실패:', error.message);
  }
  for (const u of toUpdate) {
    const { error } = await supabase.from('streams').update(u).eq('video_id', u.video_id);
    if (error) console.error('업데이트 실패:', u.video_id, error.message);
  }

  const survivorIds = new Set(existingRows.map(r => r.video_id).filter(id => !toDelete.includes(id)));
  const candidateMap = new Map();

  for (const keyword of keywords) {
    try {
      const results = await searchLiveByKeyword(keyword);
      for (const r of results) {
        if (survivorIds.has(r.videoId) || candidateMap.has(r.videoId)) continue;
        if (isExcluded(r.title, r.channelTitle)) continue;
        candidateMap.set(r.videoId, r);
      }
      console.log(`  검색 "${keyword}": ${results.length}건 조회`);
    } catch (err) {
      console.error(`  검색 실패 "${keyword}":`, err.message);
    }
  }

  console.log(`신규 후보 ${candidateMap.size}건 검증 중...`);
  const candidateIds = [...candidateMap.keys()];
  const verifiedLive = await getLiveSnippets(candidateIds);

  const newRows = [...candidateMap.values()]
    .filter(c => verifiedLive.has(c.videoId))
    .map(c => ({
      video_id: c.videoId,
      title: c.title,
      channel_title: c.channelTitle,
      thumbnail: c.thumbnail,
      matched_keyword: c.matchedKeyword,
      source: 'keyword',
    }));

  console.log(`  -> 검증 통과 신규 ${newRows.length}건`);

  if (newRows.length) {
    const { error } = await supabase.from('streams').insert(newRows);
    if (error) console.error('삽입 실패:', error.message);
  }

  console.log(`완료: 생존 ${survivorCount}, 제거 ${toDelete.length}, 신규 ${newRows.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
