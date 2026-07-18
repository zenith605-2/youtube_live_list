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

// 키가 무료로 접근 가능한 모델이 계정/지역마다 달라, 후보를 순서대로 시도해 먼저 되는 걸 쓴다.
// (gemini-flash-latest가 이 키에서 유일하게 되는 걸로 확인돼 맨 앞에 둠 — 나머지는 폴백)
const MODEL_CANDIDATES = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  .concat(['gemini-flash-latest', 'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash']);
let MODEL = null; // 첫 성공한 모델로 고정
const BATCH = 15;            // 한 요청에 15개 (요청 수 절약)
const MAX_PER_RUN = 450;     // 무료 하루 한도 안에서 안전하게
const DELAY_MS = 8000;       // 요청 간 간격 (무료 모델 분당 요청 한도 여유)

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

Determine the country where the camera is physically located, as an uppercase ISO 3166-1 alpha-2 code, using ALL available clues together:
- place names / cities / landmarks in the title,
- the language and script of the title (e.g. Japanese kana -> JP, Korean hangul -> KR, Thai script -> TH),
- the channel name (e.g. "Webcams de México" -> MX, a Japanese news channel -> JP),
- any other geographic hint.
Prefer the FILMING location over the channel owner's country when they conflict (a Japan walking-tour video on a Philippine channel is JP). Use null only when there is genuinely no clue. The "hint" field is the current best guess — confirm or correct it.

Items to judge:
${JSON.stringify(items.map((s, i) => ({ i, title: s.title, channel: s.channel_title, type: s.content_type, hint: s.country || null })))}

Give a short reason (<= 12 words) for each verdict.

Respond ONLY as a compact JSON array, one object per item:
[{"i":0,"verdict":"approve|reject|unsure","category":"<key>","country":"<ISO2 or null>","reason":"<short>"}]`;
}

async function requestModel(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  return res;
}

async function callGemini(prompt) {
  // 아직 모델을 못 정했으면 후보를 순서대로 시도해 200 나오는 걸 채택
  if (!MODEL) {
    for (const cand of MODEL_CANDIDATES) {
      const res = await requestModel(cand, prompt);
      if (res.ok) {
        MODEL = cand;
        console.log(`AI 검수 모델 선택: ${cand}`);
        const data = await res.json();
        return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]');
      }
      const body = (await res.text()).slice(0, 120);
      console.log(`  모델 ${cand} 사용 불가 (${res.status}) ${res.status === 429 ? '· 할당량/무료티어 문제' : body}`);
      if (res.status !== 404 && res.status !== 400) await sleep(2000); // 429 등은 잠깐 쉬고 다음 후보
    }
    throw new Error('사용 가능한 무료 모델 없음 (키/할당량 확인 필요)');
  }
  // 모델 고정 후: 429면 백오프 후 최대 2회 재시도 (무료 분당 한도 회복 대기)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await requestModel(MODEL, prompt);
    if (res.ok) {
      const data = await res.json();
      return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]');
    }
    if (res.status === 429 && attempt < 2) { await sleep(20000); continue; }
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
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

    const logRows = [];
    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const v = byIndex.get(j);
      if (!v) { unsure += 1; continue; }

      const verdict = ['approve', 'reject', 'unsure'].includes(v.verdict) ? v.verdict : 'unsure';
      logRows.push({
        video_id: s.video_id, title: s.title, channel_title: s.channel_title,
        verdict, reason: (v.reason || '').slice(0, 200),
        suggested_category: v.category || null, suggested_country: v.country || null,
      });

      // 거절이어도 즉시 삭제하지 않는다 — 로그에 남기고 대기 유지, 관리자가 로그에서 확정 삭제/복구.
      if (verdict === 'reject') { rejected += 1; continue; }

      // 승인 또는 보류: 카테고리·국가 교정을 함께 반영 (보류여도 큐에서 정확도 개선)
      const patch = {};
      if (verdict === 'approve') patch.approval_status = 'approved';
      if (v.category && validCat.has(v.category) && v.category !== s.category) {
        patch.category = v.category;
        patch.category_source = 'ai';
      }
      if (v.country && /^[A-Z]{2}$/.test(v.country) && s.country_source !== 'user' && v.country !== s.country) {
        patch.country = v.country;
        patch.country_source = 'ai';
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('streams').update(patch).eq('video_id', s.video_id);
        if (error) { console.error('반영 실패:', s.video_id, error.message); failed += 1; continue; }
      }
      if (verdict === 'approve') approved += 1;
      else unsure += 1;
    }
    if (logRows.length) {
      const { error } = await supabase.from('ai_review_log').insert(logRows);
      if (error) console.error('AI 로그 기록 실패:', error.message);
    }
    console.log(`  진행 ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
    if (i + BATCH < pending.length) await sleep(DELAY_MS);
  }

  console.log(`AI 검수 완료 — 승인 ${approved} / 거절제안 ${rejected}(대기유지·관리자 확인 필요) / 보류 ${unsure} / 실패 ${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
