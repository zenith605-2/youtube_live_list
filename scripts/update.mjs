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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${text}`);
  }
  return res.json();
}

// oEmbed로 화면 비율 확인 — 세로 영상(쇼츠 등)은 사이트 성격에 안 맞아 걸러낸다.
// API 쿼터를 안 쓰는 공개 엔드포인트. true=세로, false=가로, null=확인 불가(나중에 재시도)
async function isVerticalVideo(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.width || !data.height) return null;
    return data.height > data.width;
  } catch {
    return null;
  }
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }));
  return results;
}

// videoId -> {snippet, liveStreamingDetails, status} 맵으로 반환 (라이브/일반 영상 공통 조회)
async function getVideoInfo(videoIds) {
  const map = new Map();
  for (const batch of chunk(videoIds, 50)) {
    if (batch.length === 0) continue;
    const url = `${BASE}/videos?part=snippet,liveStreamingDetails,status&id=${batch.join(',')}&key=${API_KEY}`;
    const data = await fetchJson(url);
    for (const item of data.items || []) {
      map.set(item.id, {
        snippet: item.snippet,
        liveStreamingDetails: item.liveStreamingDetails || {},
        status: item.status || {},
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
  const [keywordsRaw, keywordsVideoRaw, excludeRaw, categoriesResult, blocklistResult, blockedChannelsResult] = await Promise.all([
    readFile(KEYWORDS_PATH, 'utf-8'),
    readFile(KEYWORDS_VIDEO_PATH, 'utf-8').catch(() => '{"keywords":[]}'),
    readFile(EXCLUDE_KEYWORDS_PATH, 'utf-8').catch(() => '{"keywords":[]}'),
    supabase.from('categories').select('key, keywords'),
    supabase.from('blocklist').select('video_id'),
    supabase.from('blocked_channels').select('channel_id'),
  ]);
  const keywords = JSON.parse(keywordsRaw).keywords || [];
  const keywordsVideo = JSON.parse(keywordsVideoRaw).keywords || [];
  const excludeKeywords = (JSON.parse(excludeRaw).keywords || []).map(k => k.toLowerCase());
  if (categoriesResult.error) throw categoriesResult.error;
  const categoryRows = (categoriesResult.data || []).filter(c => c.key !== 'other');
  const blockedIds = new Set((blocklistResult.data || []).map(r => r.video_id));
  const blockedChannelIds = new Set((blockedChannelsResult.data || []).map(r => r.channel_id));

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

  const { data: existingRows, error: fetchErr } = await supabase.from('streams').select('*');
  if (fetchErr) throw fetchErr;

  console.log(`기존 목록 ${existingRows.length}건 생존 확인 중...`);
  const existingIds = existingRows.map(r => r.video_id);
  const infoMap = await getVideoInfo(existingIds);

  const toDelete = []; // 오탐(제외 키워드) 확정 삭제
  const toUpdate = []; // 상태전환/정보보강 업데이트
  const creditRecipients = []; // 이번에 처음 검증 통과한 유저 제보의 제보자(added_by)
  let validCount = 0;
  let offlineCount = 0;

  for (const row of existingRows) {
    const contentType = row.content_type || 'live';
    const info = infoMap.get(row.video_id);

    if (!isValidFor(contentType, info)) {
      offlineCount += 1;
      if (row.status !== 'offline') {
        // 방금 오프라인으로 전환된 시점만 기록 (계속 오프라인이어도 최초 시점 유지 -> 7일 카운트 기준)
        toUpdate.push({ video_id: row.video_id, status: 'offline', offline_since: new Date().toISOString() });
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

  // 국가 정보가 비어있는 현재 유효한 행들에 한해 channels.list로 조회 후 채움
  const rowsNeedingCountry = existingRows.filter(r => !r.country && isValidFor(r.content_type || 'live', infoMap.get(r.video_id)));
  const countryChannelIds = rowsNeedingCountry.map(r => infoMap.get(r.video_id).snippet.channelId);
  const countryMap = await getChannelCountries(countryChannelIds);
  for (const row of rowsNeedingCountry) {
    const channelId = infoMap.get(row.video_id).snippet.channelId;
    const country = countryMap.get(channelId);
    if (country) {
      const { error } = await supabase.from('streams').update({ country }).eq('video_id', row.video_id);
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

  // 채널 단위 전체 스캔: 이미 아는 채널(생존 행 + 이번에 새로 찾은 후보)의 다른 라이브도 함께 수집.
  // 채널당 1회만 수행하도록 scanned_channels에 기록해 매일 반복 조회하지 않음(쿼터 절약).
  // 키워드 검색에 쓰고 남은 예산을 전부 여기에 투입 (채널 스캔이 신규 발견 효율이 가장 좋음).
  const { data: scannedRows } = await supabase.from('scanned_channels').select('channel_id');
  const scannedSet = new Set((scannedRows || []).map(r => r.channel_id));

  const observedChannelIds = new Set();
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

  const newCandidates = [...candidateMap.values()].filter(c => isValidFor(c.contentType, candidateInfoMap.get(c.videoId)));
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
      country: newCountryMap.get(c.channelId) || null,
      started_at: c.contentType === 'live' ? (info.liveStreamingDetails?.actualStartTime || null) : null,
      published_at: c.contentType === 'video' ? (info.snippet?.publishedAt || null) : null,
    };
  });

  console.log(`  -> 검증 통과 신규 ${newRows.length}건`);

  // 세로 영상(쇼츠 등)은 삽입 전에 거르고 차단목록에 올린다 (비율은 안 변하니 재수집 방지)
  let insertRows = newRows;
  if (newRows.length) {
    const flags = await mapConcurrent(newRows, 8, r => isVerticalVideo(r.video_id));
    const nowIso = new Date().toISOString();
    const verticalIds = [];
    insertRows = [];
    newRows.forEach((r, i) => {
      if (flags[i] === true) verticalIds.push(r.video_id);
      else insertRows.push(flags[i] === false ? { ...r, aspect_checked_at: nowIso } : r);
    });
    if (verticalIds.length) {
      await supabase.from('blocklist').upsert(
        verticalIds.map(video_id => ({ video_id })),
        { onConflict: 'video_id', ignoreDuplicates: true }
      );
      console.log(`  -> 세로 영상 제외: ${verticalIds.length}건 (차단목록 등록)`);
    }
  }

  if (insertRows.length) {
    const { error } = await supabase.from('streams').insert(insertRows);
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

  // 기존 행 화면 비율 검사 (하루 200건씩 점진 처리): 세로 영상은 삭제 + 차단목록
  let verticalDeleted = 0;
  const { data: aspectRows, error: aspectFetchErr } = await supabase
    .from('streams')
    .select('video_id')
    .is('aspect_checked_at', null)
    .limit(200);
  if (aspectFetchErr) {
    console.error('비율 검사 대상 조회 실패:', aspectFetchErr.message);
  } else if (aspectRows?.length) {
    const flags = await mapConcurrent(aspectRows, 8, r => isVerticalVideo(r.video_id));
    const verticalIds = aspectRows.filter((_, i) => flags[i] === true).map(r => r.video_id);
    const landscapeIds = aspectRows.filter((_, i) => flags[i] === false).map(r => r.video_id);
    if (verticalIds.length) {
      await supabase.from('streams').delete().in('video_id', verticalIds);
      await supabase.from('blocklist').upsert(
        verticalIds.map(video_id => ({ video_id })),
        { onConflict: 'video_id', ignoreDuplicates: true }
      );
      verticalDeleted = verticalIds.length;
      console.log(`세로 영상 삭제: ${verticalIds.length}건 (차단목록 등록)`);
    }
    if (landscapeIds.length) {
      await supabase.from('streams').update({ aspect_checked_at: new Date().toISOString() }).in('video_id', landscapeIds);
    }
  }

  // 오늘 실행 결과를 일일 집계 테이블에 기록 (관리자 대시보드용, 같은 날 재실행 시 덮어씀)
  const deletedTotal = toDelete.length + (expiredRows?.length || 0) + (staleOfflineRows?.length || 0) + verticalDeleted;
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
