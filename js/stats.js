const SUPABASE_URL = 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const statsGate = document.getElementById('statsGate');
const statsContent = document.getElementById('statsContent');
const statsSummary = document.getElementById('statsSummary');
const statsTableBody = document.getElementById('statsTableBody');

const DAYS_TO_SHOW = 30;

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

async function loadStats() {
  const [dailyRes, visitRes, signupRes, durationRes, streamCountRes, profileCountRes, pendingRes, offlineRes, visibleRes] = await Promise.all([
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

  statsTableBody.innerHTML = dates.map(d => {
    const s = dailyByDate.get(d);
    const dur = durationByDate.get(d);
    const dash = '<td class="stats-dash">–</td>';
    return `
      <tr>
        <td>${escapeHtml(d)}</td>
        ${s ? `<td>${s.existing_count}</td><td>${s.valid_count}</td><td>${s.offline_count}</td><td>${s.new_count}</td><td>${s.deleted_count}</td>` : dash.repeat(5)}
        <td>${signupsByDate.get(d) ?? 0}</td>
        <td>${visitsByDate.get(d) ?? 0}</td>
        <td>${fmtDur(dur?.avg_seconds)}</td>
        <td>${fmtDur(dur?.median_seconds)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="10">No data yet — the first row appears after the next daily update run.</td></tr>';

  const totalStreams = streamCountRes.count ?? '?';
  const totalUsers = profileCountRes.count ?? '?';
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 기준 오늘
  statsSummary.innerHTML = `
    <div class="stats-card"><span class="stats-card-num">${totalStreams}</span><span class="stats-card-label">Total streams</span><span class="stats-card-sub">Visible ${visibleRes.count ?? '?'} · Pending ${pendingRes.count ?? '?'} · Offline ${offlineRes.count ?? '?'}</span></div>
    <div class="stats-card"><span class="stats-card-num">${totalUsers}</span><span class="stats-card-label">Total users</span></div>
    <div class="stats-card"><span class="stats-card-num">${visitsByDate.get(today) ?? 0}</span><span class="stats-card-label">Visitors today</span></div>
    <div class="stats-card"><span class="stats-card-num">${signupsByDate.get(today) ?? 0}</span><span class="stats-card-label">Signups today</span></div>
  `;
}

async function loadSourceStats() {
  const body = document.getElementById('sourceTableBody');
  const { data, error } = await sb
    .from('visit_log')
    .select('source')
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
    const s = r.source || 'unknown'; // 043 이전 기록은 source가 없음 → unknown
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const total = data.length;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  body.innerHTML = rows.map(([source, n]) => {
    const pct = Math.round((n / total) * 1000) / 10;
    return `
      <tr>
        <td>${escapeHtml(source)}</td>
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

function fmtStay(secs) {
  if (!secs) return '–';
  const m = Math.floor(secs / 60), s = secs % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

async function loadRecentVisitors() {
  const body = document.getElementById('visitorTableBody');
  // RLS 정책상 관리자 토큰으로만 읽힌다 (일반 유저/게스트는 빈 결과)
  const { data, error } = await sb
    .from('visit_log')
    .select('created_at, country, ip, visitor_key')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    body.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = '<tr><td colspan="5">No visitor records yet.</td></tr>';
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
  body.innerHTML = data.map(r => `
    <tr>
      <td>${fmtTime(r.created_at)}</td>
      <td>${escapeHtml(r.country || '–')}</td>
      <td class="ip-cell">${escapeHtml(r.ip || '–')}</td>
      <td>${escapeHtml((r.visitor_key || '').slice(0, 8))}</td>
      <td>${fmtStay(stayByKeyDate.get(`${r.visitor_key}|${kstDateOf(r.created_at)}`))}</td>
    </tr>
  `).join('');
}

async function init() {
  if (!(await isAdminUser())) {
    statsGate.textContent = 'This page is for administrators only. Please sign in with an admin account on the main site first.';
    return;
  }
  statsGate.hidden = true;
  statsContent.hidden = false;
  await Promise.all([loadStats(), loadRecentVisitors(), loadSourceStats(), loadCountryStats()]);
}

init();
