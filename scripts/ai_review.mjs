// AI 검수: 승인 대기 큐를 Gemini(무료 티어)로 자동 판정한다.
// - approve: 진짜 고정 라이브캠 / 실환경 앰비언트·주행·워킹 영상 -> 바로 공개
// - reject:  뉴스/음악/게임/토크/리액션 등 성격에 안 맞는 것 -> 삭제(차단 안 함, 재검색으로 재유입 가능)
// - unsure:  애매하면 대기 큐에 남겨 사람이 검수
// GEMINI_API_KEY 시크릿이 없으면 아무것도 안 하고 조용히 종료(워크플로 안 깨짐).
import { createClient } from '@supabase/supabase-js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GEMINI_API_KEY) {
  console.log('GEMINI_API_KEY 없음 — AI 검수 건너뜀');
  process.exit(0);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE 환경변수 없음');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MODEL = 'gemini-2.0-flash';
const BATCH = 15;            // 한 요청에 15개 (요청 수 절약)
const MAX_PER_RUN = 450;     // 무료 하루 한도(1500) 안에서 안전하게
const DELAY_MS = 4500;       // 요청 간 간격 (15 RPM 한도 여유)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPending() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; from < MAX_PER_RUN; from += PAGE) {
    const to = Math.min(from + PAGE, MAX_PER_RUN) - 1;
    const { data, error } = await supabase
      .from('streams')
      .select('video_id, title, channel_title, category, country, country_source, content_type')
      .eq('approval_status', 'pending')
      .order('added_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function buildPrompt(items, categoryKeys) {
  return `You are a strict moderator for a directory of REAL-WORLD live cameras and ambient footage: fixed/mounted live cams (traffic, city streets, beaches, harbors, airports, train stations, nature/wildlife, skylines, plazas), dashcam driving footage, and first-person walking-tour videos.

APPROVE only if the video is genuinely one of these — a fixed camera view, or real-world ambient / walking / driving footage, with NO host talking to the camera and no edited entertainment.

REJECT if it is: news broadcast, talk show, music video, gaming, reaction/commentary, tutorial, product review, talking-head vlog, sports match broadcast, movie/TV clip, or clearly unrelated/staged content.

If you cannot tell from the title and channel, use "unsure".

Also pick the best category key from this list (or "other"): ${categoryKeys.join(', ')}.
And give the country as an uppercase ISO 3166-1 alpha-2 code ONLY if the title clearly names a place, else null.

Items to judge:
${JSON.stringify(items.map((s, i) => ({ i, title: s.title, channel: s.channel_title, type: s.content_type })))}

Respond ONLY as a compact JSON array, one object per item:
[{"i":0,"verdict":"approve|reject|unsure","category":"<key>","country":"<ISO2 or null>"}]`;
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  return JSON.parse(text);
}

async function main() {
  const [{ data: cats }, pending] = await Promise.all([
    supabase.from('categories').select('key').neq('key', 'other'),
    fetchPending(),
  ]);
  const categoryKeys = (cats || []).map((c) => c.key);
  const validCat = new Set([...categoryKeys, 'other']);

  if (!pending.length) {
    console.log('AI 검수: 대기 큐가 비어 있음');
    return;
  }
  console.log(`AI 검수 대상: ${pending.length}건 (배치 ${BATCH})`);

  let approved = 0, rejected = 0, unsure = 0, failed = 0;

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    let verdicts;
    try {
      verdicts = await callGemini(buildPrompt(batch, categoryKeys));
    } catch (err) {
      console.error(`배치 ${i / BATCH} 실패:`, err.message);
      failed += batch.length;
      await sleep(DELAY_MS);
      continue;
    }
    const byIndex = new Map((verdicts || []).map((v) => [v.i, v]));

    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const v = byIndex.get(j);
      if (!v) { unsure += 1; continue; }

      if (v.verdict === 'approve') {
        const patch = { approval_status: 'approved' };
        if (v.category && validCat.has(v.category) && v.category !== s.category) {
          patch.category = v.category;
          patch.category_source = 'ai';
        }
        if (v.country && /^[A-Z]{2}$/.test(v.country) && s.country_source !== 'user' && v.country !== s.country) {
          patch.country = v.country;
          patch.country_source = 'ai';
        }
        const { error } = await supabase.from('streams').update(patch).eq('video_id', s.video_id);
        if (error) { console.error('승인 실패:', s.video_id, error.message); failed += 1; }
        else approved += 1;
      } else if (v.verdict === 'reject') {
        // 삭제만 — 차단목록엔 안 올림 (오판이어도 재검색으로 다시 들어올 수 있게)
        const { error } = await supabase.from('streams').delete().eq('video_id', s.video_id);
        if (error) { console.error('거절 삭제 실패:', s.video_id, error.message); failed += 1; }
        else rejected += 1;
      } else {
        unsure += 1; // 애매 -> 대기 유지 (사람 검수)
      }
    }
    console.log(`  진행 ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
    if (i + BATCH < pending.length) await sleep(DELAY_MS);
  }

  console.log(`AI 검수 완료 — 승인 ${approved} / 거절 ${rejected} / 보류 ${unsure} / 실패 ${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
