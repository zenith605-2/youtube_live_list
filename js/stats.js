const SUPABASE_URL = 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const statsGate = document.getElementById('statsGate');
const statsContent = document.getElementById('statsContent');
const statsSummary = document.getElementById('statsSummary');
const statsTableBody = document.getElementById('statsTableBody');

const DAYS_TO_SHOW = 30;
const PAGE_SIZE = 10;

// 여러 표(일일 집계/재방문자/최근 방문자)가 전부 "N개씩 페이지네이션"이 필요해서 하나로 통일.
// account.js의 renderVisitorPage와 같은 패턴 — 행 HTML을 캐시해두고 슬라이스만 다시 그린다.
function makePager(tbodyId, pageSize = PAGE_SIZE) {
  const state = { page: 0, rows: [] };
  function render() {
    const body = document.getElementById(tbodyId);
    if (!body) return;
    const pages = Math.max(1, Math.ceil(state.rows.length / pageSize));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    body.innerHTML = state.rows.slice(state.page * pageSize, (state.page + 1) * pageSize).join('');
    let pager = document.getElementById(tbodyId + 'Pager');
    if (!pager) {
      pager = document.createElement('div');
      pager.id = tbodyId + 'Pager';
      pager.className = 'admin-pager';
      body.closest('.stats-table-wrap').after(pager);
      pager.addEventListener('click', (e) => {
        const b = e.target.closest('.pager-btn');
        if (!b || b.disabled) return;
        state.page += Number(b.dataset.nav);
        render();
      });
    }
    pager.hidden = pages <= 1;
    pager.innerHTML = `
      <button type="button" class="pager-btn" data-nav="-1" ${state.page === 0 ? 'disabled' : ''}>◀</button>
      <span class="pager-info">${state.page + 1} / ${pages} · ${state.rows.length}</span>
      <button type="button" class="pager-btn" data-nav="1" ${state.page === pages - 1 ? 'disabled' : ''}>▶</button>`;
  }
  return {
    setRows(rows) { state.rows = rows; state.page = 0; render(); },
    gotoPage(p) { state.page = p; render(); },
    get pageCount() { return Math.max(1, Math.ceil(state.rows.length / pageSize)); },
  };
}

// 저장/필터 변경 등 즉시 반응을 보여줄 때 쓰는 짧은 강조 깜빡임 (계정 페이지의 .saved 패턴과 같은 취지)
function flashRow(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.add('stats-row-flash');
  setTimeout(() => el.classList.remove('stats-row-flash'), 1600);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function isAdminUser() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) return false;
  const { data } = await sb.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle();
  return !!data?.is_admin;
}

const dailyPager = makePager('statsTableBody');
let dailyCalMonth = new Date();
let dailyDatesSet = new Set(); // 데이터가 있는 날짜(YYYY-MM-DD) — 달력에 표시용
let dailySortedDates = []; // 최신순 정렬된 날짜 목록 — 달력 클릭 시 몇 페이지인지 계산용

// 계정 페이지 AI 로그 달력과 같은 구조(cal-head/cal-grid/cal-day 등 CSS 재사용).
// 데이터가 있는 날만 클릭 가능하며, 클릭하면 그 날짜가 있는 페이지로 이동 + 해당 행을 잠깐 강조한다.
function renderDailyCalendar() {
  const el = document.getElementById('dailyStatsCalendar');
  if (!el) return;
  const y = dailyCalMonth.getFullYear();
  const m = dailyCalMonth.getMonth();
  const startDow = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const monthLabel = new Date(y, m, 1).toLocaleString(undefined, { year: 'numeric', month: 'long' });
  const wd = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + i).toLocaleString(undefined, { weekday: 'narrow' }));
  let html = `<div class="cal-head">
    <button type="button" class="cal-nav" data-nav="-1">◀</button>
    <span class="cal-title">${escapeHtml(monthLabel)}</span>
    <button type="button" class="cal-nav" data-nav="1">▶</button>
  </div><div class="cal-grid">`;
  html += wd.map(w => `<span class="cal-wd">${escapeHtml(w)}</span>`).join('');
  for (let i = 0; i < startDow; i++) html += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const has = dailyDatesSet.has(key);
    html += `<button type="button" class="cal-day${has ? ' has' : ''}" data-date="${key}" ${has ? '' : 'disabled'}>${d}</button>`;
  }
  el.innerHTML = html + '</div>';
}

document.getElementById('dailyStatsCalendar')?.addEventListener('click', (e) => {
  const nav = e.target.closest('.cal-nav');
  if (nav) {
    dailyCalMonth = new Date(dailyCalMonth.getFullYear(), dailyCalMonth.getMonth() + Number(nav.dataset.nav), 1);
    renderDailyCalendar();
    return;
  }
  const day = e.target.closest('.cal-day');
  if (!day || day.disabled) return;
  const idx = dailySortedDates.indexOf(day.dataset.date);
  if (idx === -1) return;
  dailyPager.gotoPage(Math.floor(idx / PAGE_SIZE));
  setTimeout(() => flashRow(`#statsTableBody tr[data-date="${day.dataset.date}"]`), 50);
});

async function loadStats() {
  const [dailyRes, visitRes, signupRes, durationRes, streamCountRes, profileCountRes, pendingRes, offlineRes, visibleRes, visitStatsRes] = await Promise.all([
    sb.from('daily_stats').select('*').order('stat_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('daily_visit_counts').select('*').order('visit_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('daily_signup_counts').select('*').order('signup_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('daily_duration_stats').select('*').order('stat_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('streams').select('video_id', { count: 'exact', head: true }),
    sb.from('profiles').select('id', { count: 'exact', head: true }),
    // Total의 내역: 승인 대기 / 오프라인(유예 중) / 실제 메인 노출 수 (Total = Visible + Pending + Offline)
    sb.from('streams').select('video_id', { count: 'exact', head: true })
      .eq('approval_status', 'pending'),
    sb.from('streams').select('video_id', { count: 'exact', head: true })
      .eq('status', 'offline')
      .or('approval_status.is.null,approval_status.neq.pending'),
    sb.from('streams').select('video_id', { count: 'exact', head: true })
      .eq('status', 'live')
      .or('approval_status.is.null,approval_status.neq.pending')
      .or('visibility.is.null,visibility.eq.listed'),
    sb.from('visit_stats').select('total_count').maybeSingle(), // 전체 기간 순 방문자 (방문 기록은 영구 보관, IP만 90일 후 익명화)
  ]);

  const daily = dailyRes.data || [];
  const visitsByDate = new Map((visitRes.data || []).map(r => [r.visit_date, r.visitors]));
  const signupsByDate = new Map((signupRes.data || []).map(r => [r.signup_date, r.signups]));
  const durationByDate = new Map((durationRes.data || []).map(r => [r.stat_date, r]));

  const fmtDur = (secs) => {
    if (secs == null) return '–';
    const m = Math.floor(secs / 60), s = secs % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  };

  // 표에 보여줄 날짜 목록: daily_stats + 방문/가입 기록이 있는 날짜를 합쳐 최근 30일
  const allDates = new Set([
    ...daily.map(r => r.stat_date),
    ...visitsByDate.keys(),
    ...signupsByDate.keys(),
  ]);
  const dates = [...allDates].sort().reverse().slice(0, DAYS_TO_SHOW);
  const dailyByDate = new Map(daily.map(r => [r.stat_date, r]));

  dailyDatesSet = new Set(dates);
  dailySortedDates = dates; // 이미 최신순 정렬돼 있음
  dailyCalMonth = dates.length ? new Date(dates[0]) : new Date();
  renderDailyCalendar();

  dailyPager.setRows(dates.map(d => {
    const s = dailyByDate.get(d);
    const dur = durationByDate.get(d);
    const dash = '<td class="stats-dash">–</td>';
    return `
      <tr data-date="${escapeHtml(d)}">
        <td>${escapeHtml(d)}</td>
        ${s ? `<td>${s.existing_count}</td><td>${s.valid_count}</td><td>${s.offline_count}</td><td>${s.new_count}</td><td>${s.deleted_count}</td>` : dash.repeat(5)}
        <td>${signupsByDate.get(d) ?? 0}</td>
        <td>${visitsByDate.get(d) ?? 0}</td>
        <td>${fmtDur(dur?.avg_seconds)}</td>
        <td>${fmtDur(dur?.median_seconds)}</td>
      </tr>
    `;
  }));
  if (!dates.length) {
    statsTableBody.innerHTML = '<tr><td colspan="10">No data yet — the first row appears after the next daily update run.</td></tr>';
  }

  const totalStreams = streamCountRes.count ?? '?';
  const totalUsers = profileCountRes.count ?? '?';
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 기준 오늘
  statsSummary.innerHTML = `
    <div class="stats-card"><span class="stats-card-num">${totalStreams}</span><span class="stats-card-label">Total streams</span><span class="stats-card-sub">Visible ${visibleRes.count ?? '?'} · Pending ${pendingRes.count ?? '?'} · Offline ${offlineRes.count ?? '?'}</span></div>
    <div class="stats-card"><span class="stats-card-num">${totalUsers}</span><span class="stats-card-label">Total users</span></div>
    <div class="stats-card"><span class="stats-card-num">${visitsByDate.get(today) ?? 0}</span><span class="stats-card-label">Visitors today</span></div>
    <div class="stats-card"><span class="stats-card-num">${visitStatsRes.data?.total_count ?? '?'}</span><span class="stats-card-label">Total visitors</span><span class="stats-card-sub">all time</span></div>
    <div class="stats-card"><span class="stats-card-num">${signupsByDate.get(today) ?? 0}</span><span class="stats-card-label">Signups today</span></div>
  `;
}

// KST 기준 날짜 문자열(YYYY-MM-DD): visit_log.visit_date와 같은 형식
function kstDateStr(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 - offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}
async function loadSourceStats() {
  const body = document.getElementById('sourceTableBody');
  const { data, error } = await sb
    .from('visit_log')
    .select('source, visit_date')
    .limit(50000);
  if (error) {
    body.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = '<tr><td colspan="4">No visitor records yet.</td></tr>';
    return;
  }
  const today = kstDateStr(0);
  const sevenAgo = kstDateStr(6); // 오늘 포함 최근 7일
  const stat = new Map(); // source -> {today, week, all}
  let tToday = 0, tWeek = 0, tAll = 0;
  for (const r of data) {
    const s = r.source || 'unknown'; // 043 이전 기록은 source 없음 → unknown
    const e = stat.get(s) || { today: 0, week: 0, all: 0 };
    e.all += 1; tAll += 1;
    if (r.visit_date >= sevenAgo) { e.week += 1; tWeek += 1; }
    if (r.visit_date === today) { e.today += 1; tToday += 1; }
    stat.set(s, e);
  }
  const rows = [...stat.entries()].sort((a, b) => b[1].week - a[1].week); // 최근 흐름 기준 정렬
  body.innerHTML = rows.map(([source, e]) => {
    const pct = tWeek ? Math.round((e.week / tWeek) * 1000) / 10 : 0;
    return `
      <tr>
        <td>${escapeHtml(source)}</td>
        <td><strong>${e.today}</strong></td>
        <td>${e.week}</td>
        <td>
          <div class="country-bar-wrap">
            <div class="country-bar" style="width:${pct}%"></div>
            <span class="country-pct">${e.all} · ${pct}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('') + `
      <tr style="border-top:2px solid var(--border);font-weight:600">
        <td>Total</td><td>${tToday}</td><td>${tWeek}</td>
        <td><span class="country-pct">${tAll} all-time</span></td>
      </tr>`;
}

async function loadCountryStats() {
  const body = document.getElementById('countryTableBody');
  const { data, error } = await sb
    .from('visit_log')
    .select('country')
    .limit(50000);
  if (error) {
    body.innerHTML = `<tr><td colspan="3">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = '<tr><td colspan="3">No visitor records yet.</td></tr>';
    return;
  }
  const counts = new Map();
  for (const r of data) {
    const c = r.country || 'Unknown';
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const total = data.length;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  body.innerHTML = rows.map(([country, n]) => {
    const pct = Math.round((n / total) * 1000) / 10;
    return `
      <tr>
        <td>${escapeHtml(country)}</td>
        <td>${n}</td>
        <td>
          <div class="country-bar-wrap">
            <div class="country-bar" style="width:${pct}%"></div>
            <span class="country-pct">${pct}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function kstDateOf(ts) {
  return new Date(new Date(ts).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 오늘 방문이 특정 IP에 몰려 있는지 (크롤러·시크릿창 반복 접속 등) 한눈에 보기 위한 표.
// 방문자 수가 갑자기 튀었을 때 원인을 SQL 없이 바로 확인하려고 만든 것.
async function loadTodayTopIps() {
  const body = document.getElementById('todayIpTableBody');
  if (!body) return;
  const today = kstDateStr(0);
  const { data, error } = await sb
    .from('visit_log')
    .select('ip, country, source, created_at')
    .eq('visit_date', today)
    .limit(5000);
  if (error) { body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`; return; }
  if (!data?.length) { body.innerHTML = '<tr><td colspan="6">No visits recorded today yet.</td></tr>'; return; }
  const byIp = new Map();
  for (const r of data) {
    const ip = r.ip || '(no ip)';
    const e = byIp.get(ip) || { hits: 0, country: r.country || '–', sources: new Set(), first: r.created_at, last: r.created_at };
    e.hits += 1;
    if (r.country) e.country = r.country;
    if (r.source) e.sources.add(r.source);
    if (r.created_at < e.first) e.first = r.created_at;
    if (r.created_at > e.last) e.last = r.created_at;
    byIp.set(ip, e);
  }
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
  const rows = [...byIp.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, 20);
  body.innerHTML = rows.map(([ip, e], i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="ip-cell">${escapeHtml(ip)}</td>
      <td>${escapeHtml(e.country)}</td>
      <td>${escapeHtml([...e.sources].join(', ') || '–')}</td>
      <td><strong${e.hits >= 5 ? ' style="color:#ff7b72"' : ''}>${e.hits}</strong></td>
      <td>${fmtTime(e.first)} → ${fmtTime(e.last)}</td>
    </tr>`).join('') + `
    <tr style="border-top:2px solid var(--border);font-weight:600">
      <td>Total</td><td colspan="3">${byIp.size} unique IPs</td><td>${data.length}</td><td></td>
    </tr>`;
}

function fmtStay(secs) {
  if (!secs) return '–';
  const m = Math.floor(secs / 60), s = secs % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

const visitorPager = makePager('visitorTableBody');

async function loadRecentVisitors() {
  const body = document.getElementById('visitorTableBody');
  // RLS 정책상 관리자 토큰으로만 읽힌다 (일반 유저/게스트는 빈 결과)
  const { data, error } = await sb
    .from('visit_log')
    .select('created_at, country, ip, visitor_key, source')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = '<tr><td colspan="6">No visitor records yet.</td></tr>';
    return;
  }

  // 같은 방문자의 그날 체류시간 세그먼트를 합산해서 붙인다
  const keys = [...new Set(data.map(r => r.visitor_key))];
  const oldest = data[data.length - 1].created_at;
  const stayByKeyDate = new Map();
  const { data: durs } = await sb
    .from('visit_durations')
    .select('visitor_key, seconds, created_at')
    .in('visitor_key', keys)
    .gte('created_at', new Date(new Date(oldest).getTime() - 24 * 3600 * 1000).toISOString())
    .limit(10000);
  for (const d of durs || []) {
    const k = `${d.visitor_key}|${kstDateOf(d.created_at)}`;
    stayByKeyDate.set(k, (stayByKeyDate.get(k) || 0) + d.seconds);
  }

  const fmtTime = (ts) => new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  visitorPager.setRows(data.map(r => `
    <tr>
      <td>${fmtTime(r.created_at)}</td>
      <td>${escapeHtml(r.country || '–')}</td>
      <td class="ip-cell">${escapeHtml(r.ip || '–')}</td>
      <td>${escapeHtml(r.source || '–')}</td>
      <td>${escapeHtml((r.visitor_key || '').slice(0, 8))}</td>
      <td>${fmtStay(stayByKeyDate.get(`${r.visitor_key}|${kstDateOf(r.created_at)}`))}</td>
    </tr>
  `));
}

const returningPager = makePager('returningTableBody');

// IP 기준 재방문자: 같은 IP가 서로 다른 날짜에 2번 이상 방문한 목록 (방문 일수 많은 순)
async function loadReturningVisitors() {
  const body = document.getElementById('returningTableBody');
  const { data, error } = await sb
    .from('visit_log')
    .select('ip, visit_date, created_at, country')
    .limit(50000);
  if (error) { body.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`; return; }
  if (!data?.length) { body.innerHTML = '<tr><td colspan="5">No visitor records yet.</td></tr>'; return; }
  const byIp = new Map();
  for (const r of data) {
    if (!r.ip) continue;
    const day = r.visit_date || kstDateOf(r.created_at);
    let e = byIp.get(r.ip);
    if (!e) { e = { days: new Set(), country: r.country || '–', first: day, last: day }; byIp.set(r.ip, e); }
    e.days.add(day);
    if (r.country) e.country = r.country;
    if (day < e.first) e.first = day;
    if (day > e.last) e.last = day;
  }
  const rows = [...byIp.entries()]
    .map(([ip, e]) => ({ ip, country: e.country, days: e.days.size, first: e.first, last: e.last }))
    .filter(r => r.days >= 2)
    .sort((a, b) => b.days - a.days || (a.last < b.last ? 1 : -1));
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5">No returning visitors yet (same IP on 2+ days).</td></tr>';
    return;
  }
  returningPager.setRows(rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="ip-cell">${escapeHtml(r.ip)}</td>
      <td>${escapeHtml(r.country)}</td>
      <td><strong>${r.days}</strong></td>
      <td>${escapeHtml(r.first)} → ${escapeHtml(r.last)}</td>
    </tr>`));
}

async function init() {
  if (!(await isAdminUser())) {
    statsGate.textContent = 'This page is for administrators only. Please sign in with an admin account on the main site first.';
    return;
  }
  statsGate.hidden = true;
  statsContent.hidden = false;
  // 실제 화면 순서(달력+일일집계 → Today's Top IPs → Traffic Sources → 국가별(접힘) → 재방문자 → 최근 방문자)와 맞춰 나열
  await Promise.all([loadStats(), loadTodayTopIps(), loadSourceStats(), loadCountryStats(), loadReturningVisitors(), loadRecentVisitors()]);
}

init();
