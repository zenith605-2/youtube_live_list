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
  const [dailyRes, visitRes, signupRes, durationRes, streamCountRes, profileCountRes] = await Promise.all([
    sb.from('daily_stats').select('*').order('stat_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('daily_visit_counts').select('*').order('visit_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('daily_signup_counts').select('*').order('signup_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('daily_duration_stats').select('*').order('stat_date', { ascending: false }).limit(DAYS_TO_SHOW),
    sb.from('streams').select('video_id', { count: 'exact', head: true }),
    sb.from('profiles').select('id', { count: 'exact', head: true }),
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
    <div class="stats-card"><span class="stats-card-num">${totalStreams}</span><span class="stats-card-label">Total streams</span></div>
    <div class="stats-card"><span class="stats-card-num">${totalUsers}</span><span class="stats-card-label">Total users</span></div>
    <div class="stats-card"><span class="stats-card-num">${visitsByDate.get(today) ?? 0}</span><span class="stats-card-label">Visitors today</span></div>
    <div class="stats-card"><span class="stats-card-num">${signupsByDate.get(today) ?? 0}</span><span class="stats-card-label">Signups today</span></div>
  `;
}

async function init() {
  if (!(await isAdminUser())) {
    statsGate.textContent = 'This page is for administrators only. Please sign in with an admin account on the main site first.';
    return;
  }
  statsGate.hidden = true;
  statsContent.hidden = false;
  await loadStats();
}

init();
