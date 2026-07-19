// 매일 실행: Supabase streams 테이블을 갱신한다.
// 1) 기존 행 생존 확인 — 중지되면 삭제하지 않고 status='offline'으로 기록 보존, 다시 라이브면 'live'로 복귀
// 2) 오탐(제외 키워드)은 확정 삭제
// 3) 키워드 검색으로 신규 라이브 CCTV 후보 탐색 및 검증 후 추가
// 4) 카테고리 자동분류, 채널 국가, 라이브 시작 시각을 함께 채워넣음
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEYWORDS_PATH = path.join(ROOT, 'config', 'keywords.json');
const KEYWORDS_VIDEO_PATH = path.join(ROOT, 'config', 'keywords-video.json');
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

// Supabase는 조회당 최대 1000행만 반환하므로, 큰 테이블은 반드시 페이지를 돌며 전부 가져온다.
// (1000행을 넘긴 뒤 기존 행을 "신규"로 착각해 중복 삽입이 터지는 사고 방지)
async function fetchAllRows(table, columns = '*') {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
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

// 조건 태그(일반 영상 전용): 제목에서 날씨/시간/사건 태그를 뽑는다.
// 밤/낮/눈은 CLIP 썸네일 분석(classify_thumbnails.py)이 보완하고, 유저가 카드에서 교정 가능.
const TAG_KEYWORDS = {
  night: ['night', '밤 ', '야간', '심야', '夜', 'noche', 'nuit'],
  rain: ['rain', '빗길', '우천', '비오는', '雨', 'lluvia'],
  heavy_rain: ['heavy rain', 'torrential', '폭우', '호우', '豪雨', '暴雨'],
  snow: ['snow', '눈길', '눈오는', '雪', 'nieve'],
  heavy_snow: ['heavy snow', 'blizzard', '폭설', '大雪', '暴雪'],
  accident: ['accident', 'crash', '사고', '추돌', '충돌', '事故', 'accidente'],
  fire: ['fire', '화재', '火災', '火灾', 'incendio'],
  violence: ['fight', 'assault', 'brawl', '싸움', '폭행', '몸싸움', '난투'],
};

function tagsFromTitle(title) {
  const haystack = (title || '').toLowerCase();
  const tags = [];
  for (const [tag, kws] of Object.entries(TAG_KEYWORDS)) {
    if (tag === 'fire' && haystack.includes('firework')) continue;
    if (kws.some(k => haystack.includes(k))) tags.push(tag);
  }
  // 폭우/폭설이면 비/눈도 함께 (넓은 필터에 걸리게)
  if (tags.includes('heavy_rain') && !tags.includes('rain')) tags.push('rain');
  if (tags.includes('heavy_snow') && !tags.includes('snow')) tags.push('snow');
  return tags;
}

// 제목 지명 → 국가 추정. 채널 국가는 "운영자의 나라"라 촬영지와 다를 수 있어서,
// 제목에 명확한 도시/나라명이 있으면 그쪽을 우선한다 (모호한 지명은 넣지 않음).
// 배열 순서가 우선순위: 'new mexico'(US)가 'mexico'(MX)보다, 'venice beach'(US)가 'venice'(IT)보다 먼저.
const TITLE_COUNTRY_RULES = [
  ['US', ['usa', 'new york', 'nyc', 'times square', 'new mexico', 'venice beach', 'los angeles', 'san francisco', 'chicago', 'miami', 'seattle', 'las vegas', 'hawaii', 'florida', 'california', 'texas', 'alaska', 'boston', 'new orleans', 'washington dc', '미국', 'ニューヨーク']],
  ['KR', ['korea', 'seoul', 'busan', 'incheon', 'gangnam', 'jeju', '서울', '부산', '인천', '대구', '대전', '울산', '제주', '경기', '강원', '한국', '韓国', 'ソウル', '釜山']],
  ['JP', ['japan', 'tokyo', 'osaka', 'kyoto', 'shibuya', 'shinjuku', 'nagoya', 'fukuoka', 'sapporo', 'okinawa', 'akihabara', '일본', '도쿄', '오사카', '日本', '東京', '大阪', '京都', '渋谷', '新宿', '沖縄', '札幌', '福岡', '県', 'ライブカメラ']],
  ['CN', ['beijing', 'shanghai', 'shenzhen', 'guangzhou', 'chongqing', '中国', '北京', '上海', '深圳', '广州', '중국']],
  ['TW', ['taiwan', 'taipei', '台湾', '台灣', '台北', '대만']],
  ['HK', ['hong kong', '香港', '홍콩']],
  // 'タイ'는 リアルタイム(리얼타임) 등에 부분일치로 걸리는 오탐이 있어 제외
  ['TH', ['thailand', 'bangkok', 'pattaya', 'phuket', 'chiang mai', '태국', '방콕']],
  ['VN', ['vietnam', 'hanoi', 'saigon', 'ho chi minh', 'da nang', '베트남', '하노이']],
  ['PH', ['philippines', 'manila', 'cebu', '필리핀']],
  ['ID', ['indonesia', 'jakarta', 'bali', '인도네시아', '발리']],
  ['MY', ['malaysia', 'kuala lumpur', '말레이시아']],
  ['SG', ['singapore', '싱가포르', 'シンガポール']],
  ['IN', ['india', 'mumbai', 'delhi', 'bangalore', 'kolkata', '인도 ']],
  ['PK', ['pakistan', 'karachi', 'lahore']],
  ['BD', ['bangladesh', 'dhaka']],
  ['LK', ['sri lanka', 'colombo']],
  ['NP', ['nepal', 'kathmandu']],
  ['KH', ['cambodia', 'phnom penh', 'angkor', '캄보디아']],
  ['LA', ['laos', 'vientiane']],
  ['MM', ['myanmar', 'yangon']],
  ['GB', ['london', 'england', 'scotland', 'wales', 'manchester', 'liverpool', 'edinburgh', '영국', '런던', 'ロンドン']],
  ['DE', ['germany', 'berlin', 'munich', 'hamburg', 'frankfurt', 'cologne', 'deutschland', 'münchen', '독일', '베를린']],
  ['FR', ['france', 'paris', 'marseille', 'lyon', '프랑스', '파리', 'パリ']],
  ['IT', ['italy', 'italia', 'rome', 'roma', 'venice', 'venezia', 'milan', 'milano', 'naples', 'napoli', '이탈리아', '로마', '베네치아']],
  ['ES', ['spain', 'madrid', 'barcelona', 'sevilla', 'mallorca', 'tenerife', 'canary', 'espana', 'españa', '스페인', '바르셀로나']],
  ['PT', ['portugal', 'lisbon', 'lisboa', '포르투갈']],
  ['NL', ['netherlands', 'amsterdam', 'rotterdam', 'holland', '네덜란드']],
  ['BE', ['belgium', 'brussels', '벨기에']],
  ['CH', ['switzerland', 'zurich', 'geneva', '스위스']],
  ['AT', ['austria', 'vienna', 'wien', '오스트리아']],
  ['CZ', ['czech', 'prague', 'praha', '프라하']],
  ['PL', ['poland', 'warsaw', 'krakow', '폴란드']],
  ['HU', ['hungary', 'budapest', '헝가리', '부다페스트']],
  ['GR', ['greece', 'athens', 'santorini', 'crete', '그리스', '산토리니']],
  ['TR', ['turkey', 'türkiye', 'istanbul', 'antalya', '터키', '이스탄불']],
  ['RU', ['russia', 'moscow', 'петербург', 'москва', '러시아', '모스크바']],
  ['UA', ['ukraine', 'kyiv', 'kiev', 'odessa', '우크라이나']],
  ['RO', ['romania', 'bucharest', '루마니아']],
  ['HR', ['croatia', 'zagreb', 'dubrovnik', '크로아티아']],
  ['RS', ['serbia', 'belgrade']],
  ['NO', ['norway', 'oslo', '노르웨이']],
  ['SE', ['sweden', 'stockholm', '스웨덴']],
  ['FI', ['finland', 'helsinki', '핀란드']],
  ['DK', ['denmark', 'copenhagen', '덴마크']],
  ['IS', ['iceland', 'reykjavik', '아이슬란드']],
  ['IE', ['ireland', 'dublin', '아일랜드']],
  ['AE', ['dubai', 'abu dhabi', '두바이']],
  ['SA', ['saudi', 'riyadh', 'mecca']],
  ['IL', ['israel', 'tel aviv']],
  ['EG', ['egypt', 'cairo', '이집트']],
  ['MA', ['morocco', 'marrakech', '모로코']],
  ['KE', ['kenya', 'nairobi', '케냐']],
  ['NA', ['namibia', 'namib']],
  ['ZA', ['south africa', 'cape town', 'johannesburg', '남아공']],
  ['BR', ['brazil', 'brasil', 'rio de janeiro', 'sao paulo', 'copacabana', '브라질']],
  ['AR', ['argentina', 'buenos aires', '아르헨티나']],
  ['CL', ['chile', 'santiago', '칠레']],
  ['PE', ['peru', 'lima', 'machu picchu', '페루']],
  ['CO', ['colombia', 'bogota', 'medellin', '콜롬비아']],
  ['CR', ['costa rica', '코스타리카']],
  ['CU', ['cuba', 'havana', '쿠바']],
  ['MX', ['mexico', 'cancun', 'guadalajara', '멕시코', '칸쿤']],
  ['CA', ['canada', 'toronto', 'vancouver', 'montreal', 'niagara', '캐나다', '토론토', '나이아가라']],
  ['AU', ['australia', 'sydney', 'melbourne', 'brisbane', 'gold coast', '호주', '시드니']],
  ['NZ', ['new zealand', 'auckland', 'queenstown', '뉴질랜드']],
];

// 제목에 쓰인 문자(스크립트)로 나라를 추정 — 지명 사전으로 못 잡을 때의 보조 신호.
// 한 나라에서만 쓰는 문자만 사용한다: 히라가나/가타카나=일본, 한글=한국, 태국문자=태국 등.
// (한자는 중/일/한이 공유하므로 제외, 키릴/아랍은 여러 나라라 제외)
function inferCountryFromScript(title) {
  const s = String(title || '');
  if (/[぀-ヿ]/.test(s)) return 'JP'; // 히라가나·가타카나
  if (/[가-힣]/.test(s)) return 'KR'; // 한글
  if (/[฀-๿]/.test(s)) return 'TH'; // 태국
  if (/[֐-׿]/.test(s)) return 'IL'; // 히브리
  if (/[ऀ-ॿ]/.test(s)) return 'IN'; // 데바나가리
  if (/[ঀ-৿]/.test(s)) return 'BD'; // 벵골
  if (/[຀-໿]/.test(s)) return 'LA'; // 라오
  if (/[က-႟]/.test(s)) return 'MM'; // 미얀마
  return null;
}

// 제목으로 나라 추정: (1) 지명 사전 → (2) 문자(스크립트) 보조
function inferCountryFromTitle(title) {
  const lower = String(title || '').toLowerCase();
  for (const [code, patterns] of TITLE_COUNTRY_RULES) {
    for (const p of patterns) {
      if (/^[a-z0-9 .'-]+$/.test(p)) {
        // 라틴 문자 지명은 단어 경계로 검사 ('nice'류 오탐 방지를 위해 애초에 모호한 지명은 목록에서 제외)
        const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`).test(lower)) return code;
      } else if (lower.includes(p.toLowerCase())) {
        return code;
      }
    }
  }
  return inferCountryFromScript(title);
}

// 세로 영상(쇼츠 등) 판별 — videos.list의 player 파트에 maxHeight를 지정하면
// 실제 영상 비율대로 embedWidth/embedHeight가 내려온다 (oEmbed는 쇼츠에도 16:9를 돌려줘서 못 씀)
function isVerticalInfo(info) {
  const w = Number(info?.player?.embedWidth);
  const h = Number(info?.player?.embedHeight);
  return !!(w && h && h > w);
}

// ISO 8601 재생시간(PT1H2M3S)을 초 단위로 변환
function parseDurationSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

// videoId -> {snippet, liveStreamingDetails, status, player, contentDetails} 맵으로 반환 (라이브/일반 영상 공통 조회)
async function getVideoInfo(videoIds) {
  const map = new Map();
  for (const batch of chunk(videoIds, 50)) {
    if (batch.length === 0) continue;
    const url = `${BASE}/videos?part=snippet,liveStreamingDetails,status,player,contentDetails&maxHeight=720&id=${batch.join(',')}&key=${API_KEY}`;
    const data = await fetchJson(url);
    for (const item of data.items || []) {
      map.set(item.id, {
        snippet: item.snippet,
        liveStreamingDetails: item.liveStreamingDetails || {},
        status: item.status || {},
        player: item.player || {},
        contentDetails: item.contentDetails || {},
      });
    }
  }
  return map;
}

// content_type에 따라 "지금도 유효한지" 판단 기준이 다름: live는 방송 중인지, video는 공개 상태인지
function isValidFor(contentType, info) {
  if (!info) return false;
  if (contentType === 'video') {
    return info.status?.privacyStatus === 'public' || info.status?.privacyStatus === 'unlisted';
  }
  return info.snippet?.liveBroadcastContent === 'live';
}

// API 응답으로 실제 content_type을 판별한다. (등록 시 유저가 라이브/영상을 잘못 골랐어도 여기서 교정)
// 지금 방송 중이면 'live', 아니면서 공개/미등록 영상이면 'video', 둘 다 아니면(비공개·삭제·종료) null.
function trueContentType(info) {
  if (!info) return null;
  if (info.snippet?.liveBroadcastContent === 'live') return 'live';
  if (info.status?.privacyStatus === 'public' || info.status?.privacyStatus === 'unlisted') return 'video';
  return null;
}

async function getChannelCountries(channelIds) {
  const map = new Map();
  const uniqueIds = [...new Set(channelIds.filter(Boolean))];
  for (const batch of chunk(uniqueIds, 50)) {
    if (batch.length === 0) continue;
    const url = `${BASE}/channels?part=snippet&id=${batch.join(',')}&key=${API_KEY}`;
    const data = await fetchJson(url);
    for (const item of data.items || []) {
      if (item.snippet?.country) map.set(item.id, item.snippet.country);
    }
  }
  return map;
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
      channelId: item.snippet.channelId,
      thumbnail: snippetThumbnail(item.snippet),
      matchedKeyword: keyword,
      contentType: 'live',
    }));
}

// 이 채널이 지금 라이브 중인 다른 영상들도 찾는다 (다중 카메라 채널 대응)
async function searchChannelLive(channelId, maxResults = 25) {
  const url = `${BASE}/search?part=snippet&type=video&eventType=live&channelId=${channelId}&maxResults=${maxResults}&key=${API_KEY}`;
  const data = await fetchJson(url);
  return (data.items || [])
    .filter(item => item.id?.videoId)
    .map(item => ({
      videoId: item.id.videoId,
      title: decodeHtmlEntities(item.snippet.title),
      channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
      channelId: item.snippet.channelId,
      thumbnail: snippetThumbnail(item.snippet),
      matchedKeyword: 'channel scan',
      contentType: 'live',
    }));
}

// 시드 채널의 최근 일반 업로드 영상 수집 (구독 채널의 CCTV뷰 아카이브 영상 등)
async function searchChannelVideos(channelId, maxResults = 25) {
  const url = `${BASE}/search?part=snippet&type=video&order=date&channelId=${channelId}&maxResults=${maxResults}&key=${API_KEY}`;
  const data = await fetchJson(url);
  return (data.items || [])
    .filter(item => item.id?.videoId)
    .map(item => ({
      videoId: item.id.videoId,
      title: decodeHtmlEntities(item.snippet.title),
      channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
      channelId: item.snippet.channelId,
      thumbnail: snippetThumbnail(item.snippet),
      matchedKeyword: 'channel scan',
      contentType: item.snippet.liveBroadcastContent === 'live' ? 'live' : 'video',
    }));
}

// 라이브가 아닌 일반 업로드 영상(블랙박스/야생동물/군중 등) 탐색 — eventType 지정 안 함
async function searchVideoByKeyword(keyword, maxResults = 25) {
  const url = `${BASE}/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(keyword)}&key=${API_KEY}`;
  const data = await fetchJson(url);
  return (data.items || [])
    .filter(item => item.id?.videoId)
    .map(item => ({
      videoId: item.id.videoId,
      title: decodeHtmlEntities(item.snippet.title),
      channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
      channelId: item.snippet.channelId,
      thumbnail: snippetThumbnail(item.snippet),
      matchedKeyword: keyword,
      contentType: 'video',
    }));
}

// search.list는 유튜브 프로젝트 기본 할당량이 하루 100회로 고정이라(단가가 아니라 "횟수" 자체가 한도),
// 이 예산을 넘지 않게 안전 여유를 두고 최대한 활용한다. 실제 남는 만큼을 전부 채널 스캔에 몰아준다
// (채널 스캔이 키워드 검색보다 신규 발견 효율이 훨씬 좋음 — 채널당 카메라가 여러 개인 경우가 많아서).
const SEARCH_BUDGET_PER_RUN = 95;
const MAX_LIVE_KEYWORDS_PER_RUN = 20;
const MAX_VIDEO_KEYWORDS_PER_RUN = 15;

// 키워드 목록이 위 한도보다 길어지면, 매일 같은 키워드만 반복하지 않도록 날짜 기준으로 창을 옮겨가며 선택한다.
// (키워드가 한도 이하면 매일 전부 사용 — 지금은 두 목록 다 한도 이내라 항상 전체 사용됨)
function selectRotatingSubset(list, maxPerRun) {
  if (list.length <= maxPerRun) return list;
  const dayIndex = Math.floor(Date.now() / 86400000);
  const start = (dayIndex * maxPerRun) % list.length;
  const subset = [];
  for (let i = 0; i < maxPerRun; i++) {
    subset.push(list[(start + i) % list.length]);
  }
  return subset;
}

async function main() {
  const [keywordsRaw, keywordsVideoRaw, excludeRaw, categoriesResult, blocklistRows, blockedChannelRows] = await Promise.all([
    readFile(KEYWORDS_PATH, 'utf-8'),
    readFile(KEYWORDS_VIDEO_PATH, 'utf-8').catch(() => '{"keywords":[]}'),
    readFile(EXCLUDE_KEYWORDS_PATH, 'utf-8').catch(() => '{"keywords":[]}'),
    supabase.from('categories').select('key, keywords'),
    fetchAllRows('blocklist', 'video_id'),
    fetchAllRows('blocked_channels', 'channel_id'),
  ]);
  const keywords = JSON.parse(keywordsRaw).keywords || [];
  const keywordsVideo = JSON.parse(keywordsVideoRaw).keywords || [];
  const excludeKeywords = (JSON.parse(excludeRaw).keywords || []).map(k => k.toLowerCase());
  if (categoriesResult.error) throw categoriesResult.error;
  const categoryRows = (categoriesResult.data || []).filter(c => c.key !== 'other');
  const blockedIds = new Set(blocklistRows.map(r => r.video_id));
  const blockedChannelIds = new Set(blockedChannelRows.map(r => r.channel_id));

  const isExcluded = (title, channelTitle) => {
    const haystack = `${title} ${channelTitle}`.toLowerCase();
    return excludeKeywords.some(k => haystack.includes(k));
  };

  const classifyCategory = (title, channelTitle) => {
    const haystack = `${title} ${channelTitle}`.toLowerCase();
    for (const row of categoryRows) {
      if ((row.keywords || []).some(k => haystack.includes(k.toLowerCase()))) return row.key;
    }
    return 'other';
  };

  // ===== 일회성 초기화 (2026-07-15 아침 실행에서만 발동) =====
  // 홍보 시작 전 테스트 투표 청소: 추천/비추천만 리셋 (방문 기록은 보존하기로 함).
  // 날짜 가드라 그날 이후엔 절대 재실행되지 않음 — 나중에 이 블록은 지워도 무방.
  const todayKstStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (todayKstStr === '2026-07-15') {
    console.log('일회성 초기화 실행: 추천 / 비추천 리셋');
    await supabase.from('upvotes').delete().gte('video_id', '');
    await supabase.from('downvotes').delete().gte('video_id', '');
    await supabase.from('streams').update({ upvote_count: 0, downvote_count: 0 }).gte('video_id', '');
    console.log('일회성 초기화 완료');
  }

  const existingRows = await fetchAllRows('streams', '*');

  console.log(`기존 목록 ${existingRows.length}건 생존 확인 중...`);
  const existingIds = existingRows.map(r => r.video_id);
  const infoMap = await getVideoInfo(existingIds);

  const toDelete = []; // 오탐(제외 키워드) 확정 삭제
  const toUpdate = []; // 상태전환/정보보강 업데이트
  const creditRecipients = []; // 이번에 처음 검증 통과한 유저 제보의 제보자(added_by)
  const verticalIds = []; // 세로 영상(쇼츠 등) -> 삭제 + 차단목록
  const nonEmbeddableIds = []; // 임베드 차단 영상 -> 삭제만 (설정 변경 시 재수집 가능)
  let validCount = 0;
  let offlineCount = 0;

  for (const row of existingRows) {
    let contentType = row.content_type || 'live';
    const info = infoMap.get(row.video_id);

    // 세로 영상(쇼츠 등)은 사이트 성격에 안 맞음 -> 삭제 + 차단목록 (비율은 안 변하니 재수집 방지)
    if (info && isVerticalInfo(info)) {
      verticalIds.push(row.video_id);
      continue;
    }

    // 임베드 재생이 차단된 영상은 사이트에서 재생 불가 -> 삭제만 (설정이 풀리면 재수집 가능하게 차단목록엔 미등록)
    if (info && info.status?.embeddable === false) {
      nonEmbeddableIds.push(row.video_id);
      continue;
    }

    // content_type 자동 교정: 등록 시 라이브/영상을 잘못 골랐어도 실제 상태로 바로잡는다.
    // (라이브로 넣었는데 실제론 일반 공개영상 -> video로 전환해 offline 처리 대신 살려둠, 반대도 동일)
    const correctType = trueContentType(info);
    const contentTypeFixed = correctType && correctType !== contentType ? correctType : null;
    if (contentTypeFixed) contentType = contentTypeFixed; // 이후 유효성 판정·정보 갱신은 교정된 타입 기준

    if (!isValidFor(contentType, info)) {
      // 아직 승인 안 된 대기 영상이 라이브 종료/비공개가 됐으면 오프라인 유예(7일) 없이 바로 삭제한다.
      // (유예는 방문자가 다시 찾을 수 있는 "승인된" 영상용. 검색으로 재유입 가능하니 차단목록엔 안 올림)
      if (row.approval_status === 'pending') {
        toDelete.push(row.video_id);
        continue;
      }
      offlineCount += 1;
      if (row.status !== 'offline' || !row.offline_since) {
        // 방금 오프라인으로 전환된 시점만 기록 (계속 오프라인이어도 최초 시점 유지 -> 7일 카운트 기준)
        // offline인데 offline_since가 비어있는 행(컬럼 도입 전 데이터)도 여기서 채워 7일 카운트가 시작되게 한다
        toUpdate.push({ video_id: row.video_id, status: 'offline', offline_since: row.offline_since || new Date().toISOString() });
      }
      continue;
    }

    const { snippet, liveStreamingDetails } = info;
    const title = decodeHtmlEntities(snippet.title);
    const channelTitle = decodeHtmlEntities(snippet.channelTitle);
    if (isExcluded(title, channelTitle)) {
      toDelete.push(row.video_id);
      continue;
    }

    validCount += 1;
    const patch = { video_id: row.video_id };
    let needsUpdate = false;
    if (contentTypeFixed) {
      patch.content_type = contentTypeFixed;
      needsUpdate = true;
      // 라이브->영상으로 교정되면 라이브 전용 썸네일(hqdefault_live)이 깨지므로 일반 썸네일로 교체
      if (contentTypeFixed === 'video' && (row.thumbnail || '').includes('hqdefault_live')) {
        patch.thumbnail = `https://i.ytimg.com/vi/${row.video_id}/hqdefault.jpg`;
      }
    }
    if (row.status !== 'live') {
      patch.status = 'live';
      patch.offline_since = null; // 다시 살아났으니 오프라인 카운트 초기화
      needsUpdate = true;
    }
    if (!row.title || !row.channel_title) {
      patch.title = title;
      patch.channel_title = channelTitle;
      patch.thumbnail = row.thumbnail || snippetThumbnail(snippet);
      needsUpdate = true;
    }
    if (!row.channel_id && snippet.channelId) {
      patch.channel_id = snippet.channelId;
      needsUpdate = true;
      // 유저 제보는 제출 시점엔 channel_id를 알 수 없어(oEmbed는 채널ID를 안 줌), 여기서 처음 채워지는
      // 순간이 곧 "실제 유효함이 검증된 최초 시점" -> 제보자에게 열람권 크레딧 적립 대상
      if (row.source === 'user' && row.added_by) {
        creditRecipients.push(row.added_by);
      }
    }
    if (!row.category) {
      patch.category = classifyCategory(title, channelTitle);
      patch.category_source = 'keyword';
      needsUpdate = true;
      // 유저 제보인데 어떤 카테고리 키워드에도 안 걸리면(=관련성 불명) 바로 공개하지 않고
      // 숨김 처리해 관리자 승인(admin.html)을 거치게 한다. 자동 검색/채널스캔으로 찾은 항목은 대상 아님.
      if (row.source === 'user' && patch.category === 'other') {
        patch.visibility = 'hidden';
      }
    }
    if (contentType === 'live' && !row.started_at && liveStreamingDetails?.actualStartTime) {
      patch.started_at = liveStreamingDetails.actualStartTime;
      needsUpdate = true;
    }
    if (contentType === 'video' && !row.published_at && snippet.publishedAt) {
      patch.published_at = snippet.publishedAt;
      needsUpdate = true;
    }
    if (contentType === 'video' && row.duration_seconds == null) {
      const dur = parseDurationSeconds(info.contentDetails?.duration);
      if (dur) {
        patch.duration_seconds = dur;
        needsUpdate = true;
      }
    }
    // 조건 태그가 아직 없는 일반 영상은 제목에서 1회 추출 (유저가 수정한 뒤엔 건드리지 않음)
    if (contentType === 'video' && (!row.tags || row.tags.length === 0)) {
      const titleTags = tagsFromTitle(title);
      if (titleTags.length) {
        patch.tags = titleTags;
        needsUpdate = true;
      }
    }
    if (needsUpdate) toUpdate.push(patch);
  }

  console.log(`  -> 유효 ${validCount}건, 오프라인 전환 ${offlineCount}건, 오탐 삭제 ${toDelete.length}건, 정보 갱신 ${toUpdate.length}건`);

  if (toDelete.length) {
    const { error } = await supabase.from('streams').delete().in('video_id', toDelete);
    if (error) console.error('삭제 실패:', error.message);
  }
  for (const u of toUpdate) {
    const { video_id, ...patch } = u;
    const { error } = await supabase.from('streams').update(patch).eq('video_id', video_id);
    if (error) console.error('업데이트 실패:', video_id, error.message);
  }

  for (const userId of new Set(creditRecipients)) {
    const { error } = await supabase.rpc('grant_bonus_credit', { p_user_id: userId, p_amount: 1 });
    if (error) console.error('크레딧 적립 실패:', userId, error.message);
  }
  if (creditRecipients.length) {
    console.log(`  -> 열람권 크레딧 적립: ${new Set(creditRecipients).size}명`);
  }

  // (1차) 제목(지명+언어)으로 나라를 (재)분류한다. 유저 수정('user')은 절대 건드리지 않고,
  // 채널 국가로 잘못 분류됐던 기존 행도 제목이 명확하면 여기서 교정된다.
  const titleInferredIds = new Set();
  const byInferredCountry = new Map();
  for (const row of existingRows) {
    if (row.country_source === 'user') continue; // 유저가 지정한 값은 보존
    const inferred = inferCountryFromTitle(row.title);
    if (!inferred || inferred === row.country) continue; // 이미 같으면 스킵
    if (!byInferredCountry.has(inferred)) byInferredCountry.set(inferred, []);
    byInferredCountry.get(inferred).push(row.video_id);
    titleInferredIds.add(row.video_id);
  }
  for (const [code, ids] of byInferredCountry) {
    // country_source=user 행은 배치에 안 담기지만, 경합 안전을 위해 쿼리에서도 한 번 더 배제
    const { error } = await supabase.from('streams')
      .update({ country: code, country_source: 'title' })
      .in('video_id', ids)
      .or('country_source.is.null,country_source.neq.user');
    if (error) console.error('제목 기반 국가 추정 실패:', code, error.message);
  }
  if (titleInferredIds.size) console.log(`제목으로 국가 분류/교정: ${titleInferredIds.size}건`);

  // (2차) 여전히 국가가 비어있는 유효한 행들은 channels.list의 채널 국가로 채움
  const rowsNeedingCountry = existingRows.filter(r => !r.country && !titleInferredIds.has(r.video_id) && isValidFor(r.content_type || 'live', infoMap.get(r.video_id)));
  const countryChannelIds = rowsNeedingCountry.map(r => infoMap.get(r.video_id).snippet.channelId);
  const countryMap = await getChannelCountries(countryChannelIds);
  for (const row of rowsNeedingCountry) {
    const channelId = infoMap.get(row.video_id).snippet.channelId;
    const country = countryMap.get(channelId);
    if (country) {
      const { error } = await supabase.from('streams').update({ country, country_source: 'channel' }).eq('video_id', row.video_id);
      if (error) console.error('국가 업데이트 실패:', row.video_id, error.message);
    }
  }

  // 신규 탐색: 이미 DB에 존재하는(라이브/오프라인 불문) videoId는 후보에서 제외
  const knownIds = new Set([
    ...existingRows.map(r => r.video_id).filter(id => !toDelete.includes(id)),
    ...blockedIds,
  ]);
  const candidateMap = new Map();
  let searchCallsUsed = 0;

  const liveKeywordsToday = selectRotatingSubset(keywords, MAX_LIVE_KEYWORDS_PER_RUN);
  console.log(`라이브 키워드 검색: 전체 ${keywords.length}개 중 오늘 ${liveKeywordsToday.length}개 사용`);
  for (const keyword of liveKeywordsToday) {
    try {
      const results = await searchLiveByKeyword(keyword);
      searchCallsUsed += 1;
      for (const r of results) {
        if (knownIds.has(r.videoId) || candidateMap.has(r.videoId)) continue;
        if (r.channelId && blockedChannelIds.has(r.channelId)) continue;
        if (isExcluded(r.title, r.channelTitle)) continue;
        candidateMap.set(r.videoId, r);
      }
      console.log(`  검색 "${keyword}": ${results.length}건 조회`);
    } catch (err) {
      searchCallsUsed += 1;
      console.error(`  검색 실패 "${keyword}":`, err.message);
    }
  }

  // 라이브 외 일반 영상(블랙박스/야생동물/군중 등) 탐색
  const videoKeywordsToday = selectRotatingSubset(keywordsVideo, MAX_VIDEO_KEYWORDS_PER_RUN);
  console.log(`영상 키워드 검색: 전체 ${keywordsVideo.length}개 중 오늘 ${videoKeywordsToday.length}개 사용`);
  for (const keyword of videoKeywordsToday) {
    try {
      const results = await searchVideoByKeyword(keyword);
      searchCallsUsed += 1;
      for (const r of results) {
        if (knownIds.has(r.videoId) || candidateMap.has(r.videoId)) continue;
        if (r.channelId && blockedChannelIds.has(r.channelId)) continue;
        if (isExcluded(r.title, r.channelTitle)) continue;
        candidateMap.set(r.videoId, r);
      }
      console.log(`  영상 검색 "${keyword}": ${results.length}건 조회`);
    } catch (err) {
      searchCallsUsed += 1;
      console.error(`  영상 검색 실패 "${keyword}":`, err.message);
    }
  }

  // ===== 부족 카테고리 부스트 검색 =====
  // 카탈로그가 교통/도심 등 몇몇 카테고리로 쏠리는 것을 완화하기 위해,
  // 현재 영상 수가 가장 적은 카테고리들의 키워드로 라이브 검색을 추가한다.
  // (채널 스캔은 이미 있는 채널 위주라 쏠림을 강화하는 경향이 있어서, 그 전에 예산을 먼저 배정)
  const BOOST_SEARCHES_PER_RUN = 12;
  const BOOST_CATEGORY_COUNT = 6;
  const categoryCounts = new Map(categoryRows.map(c => [c.key, 0]));
  for (const row of existingRows) {
    if (categoryCounts.has(row.category)) categoryCounts.set(row.category, categoryCounts.get(row.category) + 1);
  }
  const underfilled = [...categoryCounts.entries()].sort((a, b) => a[1] - b[1]).slice(0, BOOST_CATEGORY_COUNT);
  console.log(`부족 카테고리 부스트: ${underfilled.map(([k, n]) => `${k}(${n})`).join(', ')}`);
  const boostDayIndex = Math.floor(Date.now() / 86400000);
  const perBoostCategory = Math.max(1, Math.floor(BOOST_SEARCHES_PER_RUN / BOOST_CATEGORY_COUNT));
  for (const [catKey] of underfilled) {
    const catKeywords = categoryRows.find(c => c.key === catKey)?.keywords || [];
    if (!catKeywords.length) continue;
    for (let i = 0; i < perBoostCategory; i++) {
      const kw = catKeywords[(boostDayIndex + i) % catKeywords.length];
      // 영문 키워드는 'cam'을 붙여 정확도를 높이고, 한/일/중 키워드는 그대로 검색 (eventType=live가 이미 라이브로 제한)
      const query = /^[\x20-\x7e]+$/.test(kw) && !/cam|webcam/i.test(kw) ? `${kw} cam` : kw;
      try {
        const results = await searchLiveByKeyword(query);
        searchCallsUsed += 1;
        for (const r of results) {
          if (knownIds.has(r.videoId) || candidateMap.has(r.videoId)) continue;
          if (r.channelId && blockedChannelIds.has(r.channelId)) continue;
          if (isExcluded(r.title, r.channelTitle)) continue;
          candidateMap.set(r.videoId, r);
        }
        console.log(`  부스트 검색 [${catKey}] "${query}": ${results.length}건 조회`);
      } catch (err) {
        searchCallsUsed += 1;
        console.error(`  부스트 검색 실패 [${catKey}] "${query}":`, err.message);
      }
    }
  }

  // 시드 채널(구독 목록 등)의 일반 업로드 영상 수집: 채널당 1회, 최근 영상 25개.
  // 라이브만 찾는 일반 채널 스캔과 달리, 신뢰할 수 있는 시드 채널은 아카이브 영상도 가치가 있음.
  // 결과는 승인 대기로 들어가고 CLIP이 썸네일 기반으로 카테고리를 분류한다.
  const { data: seedVideoRows, error: seedVideoErr } = await supabase
    .from('channel_seeds')
    .select('channel_id')
    .is('video_scanned_at', null);
  if (seedVideoErr) {
    if (!/does not exist/.test(seedVideoErr.message)) console.error('시드 영상스캔 대상 조회 실패:', seedVideoErr.message);
  } else if (seedVideoRows?.length) {
    const seedVideoBudget = Math.max(0, SEARCH_BUDGET_PER_RUN - searchCallsUsed);
    const seedsToVideoScan = seedVideoRows
      .map(r => r.channel_id)
      .filter(id => !blockedChannelIds.has(id))
      .slice(0, seedVideoBudget);
    console.log(`시드 채널 일반영상 스캔: 대상 ${seedVideoRows.length}개 중 ${seedsToVideoScan.length}개 처리`);
    for (const channelId of seedsToVideoScan) {
      try {
        const results = await searchChannelVideos(channelId);
        searchCallsUsed += 1;
        for (const r of results) {
          if (knownIds.has(r.videoId) || candidateMap.has(r.videoId)) continue;
          if (isExcluded(r.title, r.channelTitle)) continue;
          candidateMap.set(r.videoId, r);
        }
      } catch (err) {
        searchCallsUsed += 1;
        console.error(`  시드 영상스캔 실패 ${channelId}:`, err.message);
      }
    }
    if (seedsToVideoScan.length) {
      const { error: markErr } = await supabase
        .from('channel_seeds')
        .update({ video_scanned_at: new Date().toISOString() })
        .in('channel_id', seedsToVideoScan);
      if (markErr) console.error('시드 영상스캔 기록 실패:', markErr.message);
    }
  }

  // 채널 단위 전체 스캔: 이미 아는 채널(생존 행 + 이번에 새로 찾은 후보)의 다른 라이브도 함께 수집.
  // 채널당 1회만 수행하도록 scanned_channels에 기록해 매일 반복 조회하지 않음(쿼터 절약).
  // 키워드 검색에 쓰고 남은 예산을 전부 여기에 투입 (채널 스캔이 신규 발견 효율이 가장 좋음).
  const scannedRows = await fetchAllRows('scanned_channels', 'channel_id');
  const scannedSet = new Set(scannedRows.map(r => r.channel_id));

  const observedChannelIds = new Set();

  // 수동 등록된 시드 채널(관리자의 유튜브 구독 목록 등)도 스캔 대상에 합류
  const { data: seedRows, error: seedErr } = await supabase.from('channel_seeds').select('channel_id');
  if (seedErr) {
    if (!/does not exist/.test(seedErr.message)) console.error('시드 채널 조회 실패:', seedErr.message);
  } else {
    for (const r of seedRows || []) observedChannelIds.add(r.channel_id);
  }
  for (const row of existingRows) {
    if ((row.content_type || 'live') !== 'live') continue;
    const channelId = infoMap.get(row.video_id)?.snippet.channelId;
    if (channelId && isValidFor('live', infoMap.get(row.video_id))) observedChannelIds.add(channelId);
  }
  for (const c of candidateMap.values()) if (c.contentType === 'live' && c.channelId) observedChannelIds.add(c.channelId);

  const channelScanBudget = Math.max(0, SEARCH_BUDGET_PER_RUN - searchCallsUsed);
  const unscannedChannelIds = [...observedChannelIds].filter(id => !scannedSet.has(id) && !blockedChannelIds.has(id));
  const channelIdsToScan = unscannedChannelIds.slice(0, channelScanBudget);
  console.log(`채널 전체 스캔: 대상 ${unscannedChannelIds.length}개 중 ${channelIdsToScan.length}개 처리 (남은 검색 예산 ${channelScanBudget}회, 나머지는 다음 실행에 이어서)`);

  for (const channelId of channelIdsToScan) {
    try {
      const results = await searchChannelLive(channelId);
      for (const r of results) {
        if (knownIds.has(r.videoId) || candidateMap.has(r.videoId)) continue;
        if (isExcluded(r.title, r.channelTitle)) continue;
        candidateMap.set(r.videoId, r);
      }
    } catch (err) {
      console.error(`  채널 스캔 실패 ${channelId}:`, err.message);
    }
  }

  if (channelIdsToScan.length) {
    const { error } = await supabase
      .from('scanned_channels')
      .upsert(channelIdsToScan.map(channel_id => ({ channel_id })), { onConflict: 'channel_id' });
    if (error) console.error('scanned_channels 기록 실패:', error.message);
  }

  console.log(`신규 후보 ${candidateMap.size}건 검증 중...`);
  const candidateIds = [...candidateMap.keys()];
  const candidateInfoMap = await getVideoInfo(candidateIds);

  // 임베드 재생이 차단된(embeddable=false) 영상은 사이트에서 재생이 안 되므로 애초에 제외
  const newCandidates = [...candidateMap.values()].filter(c => {
    const info = candidateInfoMap.get(c.videoId);
    return isValidFor(c.contentType, info) && info?.status?.embeddable !== false;
  });
  const newCountryMap = await getChannelCountries(newCandidates.map(c => c.channelId));

  const newRows = newCandidates.map(c => {
    const info = candidateInfoMap.get(c.videoId);
    return {
      video_id: c.videoId,
      title: c.title,
      channel_title: c.channelTitle,
      channel_id: c.channelId || null,
      thumbnail: c.thumbnail,
      matched_keyword: c.matchedKeyword,
      source: 'keyword',
      content_type: c.contentType,
      status: 'live',
      // 자동 수집분도 관리자 검수를 거치도록 승인 대기로 넣는다 (7일 내 미승인 시 기존 만료 로직으로 삭제됨)
      approval_status: 'pending',
      category: classifyCategory(c.title, c.channelTitle),
      category_source: 'keyword',
      // 제목의 지명이 채널 국가보다 촬영지에 가까우므로 우선한다 (여행 채널/모음집 채널 대응)
      country: inferCountryFromTitle(c.title) || newCountryMap.get(c.channelId) || null,
      country_source: inferCountryFromTitle(c.title) ? 'title' : (newCountryMap.get(c.channelId) ? 'channel' : null),
      started_at: c.contentType === 'live' ? (info.liveStreamingDetails?.actualStartTime || null) : null,
      published_at: c.contentType === 'video' ? (info.snippet?.publishedAt || null) : null,
      duration_seconds: c.contentType === 'video' ? parseDurationSeconds(info.contentDetails?.duration) : null,
      tags: c.contentType === 'video' ? tagsFromTitle(c.title) : [],
    };
  });

  // 세로 영상(쇼츠 등)은 삽입 전에 거르고 차단목록에 올린다 (비율은 안 변하니 재수집 방지)
  const newVerticalIds = newCandidates
    .filter(c => isVerticalInfo(candidateInfoMap.get(c.videoId)))
    .map(c => c.videoId);
  const insertRows = newRows.filter(r => !newVerticalIds.includes(r.video_id));
  if (newVerticalIds.length) {
    await supabase.from('blocklist').upsert(
      newVerticalIds.map(video_id => ({ video_id })),
      { onConflict: 'video_id', ignoreDuplicates: true }
    );
    console.log(`  -> 세로 영상 제외: ${newVerticalIds.length}건 (차단목록 등록)`);
  }

  console.log(`  -> 검증 통과 신규 ${insertRows.length}건`);

  if (insertRows.length) {
    // upsert(ignoreDuplicates): 만에 하나 기존 행과 겹쳐도 그 행만 무시되고 나머지는 들어가게
    // (plain insert는 중복 1건 때문에 배치 전체가 실패함)
    const { error } = await supabase.from('streams').upsert(insertRows, {
      onConflict: 'video_id',
      ignoreDuplicates: true,
    });
    if (error) console.error('삽입 실패:', error.message);
  }

  // 7일 임시등록 만료 처리: 승인(3추천 또는 관리자 승인)도 못 받고 7일이 지난 유저 제보는 삭제한다.
  // (차단목록에는 올리지 않음 — 나중에 다시 제보하면 새로 기회를 준다)
  // 자동 수집(keyword) 대기분은 만료 대상에서 제외 — 삭제하면 다음날 검색에서 또 발견돼
  // 대기→삭제→재발견을 반복하며 쿼터만 낭비하므로, 관리자가 승인/삭제할 때까지 대기 상태로 둔다.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: expiredRows, error: expiredFetchErr } = await supabase
    .from('streams')
    .select('video_id')
    .eq('approval_status', 'pending')
    .eq('source', 'user')
    .lt('added_at', sevenDaysAgo);
  if (expiredFetchErr) {
    console.error('임시등록 만료 대상 조회 실패:', expiredFetchErr.message);
  } else if (expiredRows.length) {
    const { error: expireErr } = await supabase
      .from('streams')
      .delete()
      .in('video_id', expiredRows.map(r => r.video_id));
    if (expireErr) console.error('임시등록 만료 삭제 실패:', expireErr.message);
    else console.log(`임시등록 만료로 삭제: ${expiredRows.length}건`);
  }

  // 7일 연속 오프라인(방송 중지/영상 삭제) 상태인 항목 정리. 나중에 다시 살아날 수도 있으니
  // 차단목록에는 절대 올리지 않는다 — 그냥 삭제만 해서 재검색/재제보로 다시 들어올 수 있게 둔다.
  const { data: staleOfflineRows, error: staleOfflineFetchErr } = await supabase
    .from('streams')
    .select('video_id')
    .eq('status', 'offline')
    .lt('offline_since', sevenDaysAgo);
  if (staleOfflineFetchErr) {
    console.error('오프라인 만료 대상 조회 실패:', staleOfflineFetchErr.message);
  } else if (staleOfflineRows.length) {
    const { error: staleOfflineErr } = await supabase
      .from('streams')
      .delete()
      .in('video_id', staleOfflineRows.map(r => r.video_id));
    if (staleOfflineErr) console.error('오프라인 만료 삭제 실패:', staleOfflineErr.message);
    else console.log(`7일 연속 오프라인으로 삭제: ${staleOfflineRows.length}건 (차단목록에는 미등록)`);
  }

  // 카테고리 변경 이력 90일 보관: 오래된 로그는 매일 정리
  const { error: catLogCleanErr } = await supabase
    .from('category_changes')
    .delete()
    .lt('changed_at', new Date(Date.now() - 90 * 86400 * 1000).toISOString());
  if (catLogCleanErr) console.error('카테고리 이력 정리 실패:', catLogCleanErr.message);

  // 같은 채널 + 완전 동일 제목 중복 정리: 대표 1개만 남긴다.
  // (채널이 같은 캠을 여러 스트림/아카이브로 반복 올리면 그리드에 똑같은 카드가 나란히 뜸)
  // 라이브 우선, 그다음 최신 등록순으로 대표를 고르고 나머지는 삭제 + 차단목록(재수집 방지).
  try {
    const dupRows = await fetchAllRows('streams', 'video_id, title, channel_title, content_type, added_at');
    const dupGroups = new Map();
    for (const r of dupRows || []) {
      if (!r.title || !r.channel_title) continue;
      const k = `${r.channel_title}||${r.title}`;
      if (!dupGroups.has(k)) dupGroups.set(k, []);
      dupGroups.get(k).push(r);
    }
    const dupIds = [];
    for (const rows of dupGroups.values()) {
      if (rows.length < 2) continue;
      rows.sort((a, b) =>
        ((b.content_type === 'live') - (a.content_type === 'live'))
        || String(b.added_at || '').localeCompare(String(a.added_at || '')));
      dupIds.push(...rows.slice(1).map(r => r.video_id));
    }
    if (dupIds.length) {
      const { error: dupDelErr } = await supabase.from('streams').delete().in('video_id', dupIds);
      if (dupDelErr) console.error('중복 삭제 실패:', dupDelErr.message);
      else {
        await supabase.from('blocklist').upsert(dupIds.map(id => ({ video_id: id })), { onConflict: 'video_id' });
        console.log(`동일 제목+채널 중복 삭제: ${dupIds.length}건 (차단목록 등록으로 재수집 방지)`);
      }
    }
  } catch (err) {
    console.error('중복 검사 실패:', err.message);
  }

  // 생존확인 루프에서 발견한 기존 세로 영상 삭제 + 차단목록 등록
  if (verticalIds.length) {
    const { error: verticalErr } = await supabase.from('streams').delete().in('video_id', verticalIds);
    if (verticalErr) console.error('세로 영상 삭제 실패:', verticalErr.message);
    else {
      await supabase.from('blocklist').upsert(
        verticalIds.map(video_id => ({ video_id })),
        { onConflict: 'video_id', ignoreDuplicates: true }
      );
      console.log(`세로 영상 삭제: ${verticalIds.length}건 (차단목록 등록)`);
    }
  }

  // 임베드 차단으로 전환된 영상 삭제 (차단목록 미등록 — 설정이 풀리면 자동 재수집)
  if (nonEmbeddableIds.length) {
    const { error: embErr } = await supabase.from('streams').delete().in('video_id', nonEmbeddableIds);
    if (embErr) console.error('임베드 차단 영상 삭제 실패:', embErr.message);
    else console.log(`임베드 차단 영상 삭제: ${nonEmbeddableIds.length}건`);
  }

  // 오늘 실행 결과를 일일 집계 테이블에 기록 (관리자 대시보드용, 같은 날 재실행 시 덮어씀)
  const deletedTotal = toDelete.length + (expiredRows?.length || 0) + (staleOfflineRows?.length || 0) + verticalIds.length + nonEmbeddableIds.length;
  // 21:00 UTC(= KST 06:00)에 돌기 때문에 UTC 날짜를 쓰면 한국 기준으로 하루 밀린다 -> KST 날짜 사용
  const { error: statsErr } = await supabase.from('daily_stats').upsert({
    stat_date: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
    existing_count: existingRows.length,
    valid_count: validCount,
    offline_count: offlineCount,
    new_count: insertRows.length,
    deleted_count: deletedTotal,
  }, { onConflict: 'stat_date' });
  if (statsErr) console.error('일일 집계 기록 실패:', statsErr.message);

  console.log(`완료: 유효 ${validCount}, 오프라인 ${offlineCount}, 오탐삭제 ${toDelete.length}, 신규 ${insertRows.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
