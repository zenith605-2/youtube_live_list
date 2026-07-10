// publishable key는 공개되어도 안전한 키입니다 (RLS로 보호됨)
const SUPABASE_URL = 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const lastUpdatedEl = document.getElementById('lastUpdated');
const modal = document.getElementById('modal');
const modalPlayer = modal.querySelector('.modal-player');
const modalClose = document.getElementById('modalClose');
const modalOpenNewTab = document.getElementById('modalOpenNewTab');
const modalTitle = document.getElementById('modalTitle');
const authArea = document.getElementById('authArea');
const submitForm = document.getElementById('submitForm');
const submitUrl = document.getElementById('submitUrl');
const submitStatus = document.getElementById('submitStatus');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardClose = document.getElementById('leaderboardClose');
const leaderboardList = document.getElementById('leaderboardList');
const langSelect = document.getElementById('langSelect');

let streams = [];
let currentUser = null;
const pageLoadTime = Date.now();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function mapRow(row) {
  return {
    videoId: row.video_id,
    title: row.title || t('info_pending'),
    channelTitle: row.channel_title || '',
    thumbnail: row.thumbnail,
    matchedKeyword: row.source === 'user' ? t('source_user') : (row.matched_keyword || ''),
    addedAt: row.added_at,
    source: row.source,
    addedBy: row.added_by,
    upvoteCount: row.upvote_count || 0,
  };
}

function currentFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return streams;
  return streams.filter(s =>
    s.title.toLowerCase().includes(q) ||
    s.channelTitle.toLowerCase().includes(q)
  );
}

function render(list) {
  grid.innerHTML = '';
  emptyState.hidden = list.length > 0;

  for (const s of list) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.videoId = s.videoId;
    card.dataset.title = s.title;
    const liveSnapshot = `https://i.ytimg.com/vi/${encodeURIComponent(s.videoId)}/hqdefault_live.jpg?cb=${pageLoadTime}`;
    // 대표 썸네일이 이미 유튜브 자동 라이브 스냅샷이면(=커스텀 썸네일이 아니면) 굳이 두 개를 비교해서 보여줄 필요가 없음
    const hasCustomThumbnail = !!s.thumbnail && !s.thumbnail.includes('_live');
    const thumbHtml = hasCustomThumbnail
      ? `
        <div class="thumb-half">
          <img src="${s.thumbnail}" alt="${escapeHtml(s.title)} - ${t('thumb_official')}" loading="lazy">
          <span class="thumb-label">${t('thumb_official')}</span>
        </div>
        <div class="thumb-half">
          <img src="${liveSnapshot}" alt="${escapeHtml(s.title)} - ${t('thumb_live')}" loading="lazy" onerror="this.closest('.thumb-half').style.display='none'">
          <span class="thumb-label">${t('thumb_live')}</span>
        </div>
      `
      : `
        <div class="thumb-half">
          <img src="${liveSnapshot}" alt="${escapeHtml(s.title)}" loading="lazy" onerror="this.src='${s.thumbnail}'">
        </div>
      `;
    card.innerHTML = `
      <div class="thumb-wrap">
        <span class="live-badge">LIVE</span>
        ${thumbHtml}
      </div>
      <div class="card-body">
        <p class="card-title">${escapeHtml(s.title)}</p>
        <p class="card-channel">${escapeHtml(s.channelTitle)}</p>
        <span class="card-keyword">${escapeHtml(s.matchedKeyword || '')}</span>
        ${s.source === 'user' && s.upvoteCount > 0 ? `<span class="card-keyword">👍 ${s.upvoteCount}</span>` : ''}
        ${currentUser ? `
          <div class="card-actions">
            ${s.source === 'user' && s.addedBy !== currentUser.id ? `<button type="button" class="upvote-btn" data-video-id="${escapeHtml(s.videoId)}">${t('upvote_button')}</button>` : ''}
            <button type="button" class="report-btn" data-video-id="${escapeHtml(s.videoId)}">${t('report_button')}</button>
          </div>
        ` : ''}
      </div>
    `;
    grid.appendChild(card);
  }
}

grid.addEventListener('click', async (e) => {
  const reportBtn = e.target.closest('.report-btn');
  if (reportBtn) {
    await handleReport(reportBtn);
    return;
  }
  const upvoteBtn = e.target.closest('.upvote-btn');
  if (upvoteBtn) {
    await handleUpvote(upvoteBtn);
    return;
  }
  const card = e.target.closest('.card');
  if (card) {
    openModal(card.dataset.videoId, card.dataset.title);
  }
});

async function handleReport(btn) {
  if (!currentUser) return;
  btn.disabled = true;
  const videoId = btn.dataset.videoId;
  const { error } = await sb.from('reports').insert({ video_id: videoId, user_id: currentUser.id });
  if (error) {
    btn.textContent = error.code === '23505' ? t('report_already') : t('report_failed');
  } else {
    btn.textContent = t('report_done');
  }
}

async function handleUpvote(btn) {
  if (!currentUser) return;
  btn.disabled = true;
  const videoId = btn.dataset.videoId;
  const { error } = await sb.from('upvotes').insert({ video_id: videoId, user_id: currentUser.id });
  if (error) {
    btn.textContent = error.code === '23505' ? t('upvote_already') : t('upvote_failed');
  } else {
    btn.textContent = t('upvote_done');
    const s = streams.find(x => x.videoId === videoId);
    if (s) s.upvoteCount += 1;
  }
}

let currentPlayer = null;
let ytApiReady = false;
const ytApiQueue = [];

window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  ytApiQueue.splice(0).forEach(fn => fn());
};

function withYtApi(fn) {
  if (ytApiReady && window.YT && window.YT.Player) fn();
  else ytApiQueue.push(fn);
}

function playerErrorMessage(code) {
  const key = { 2: 'player_error_2', 5: 'player_error_5', 100: 'player_error_100', 101: 'player_error_101', 150: 'player_error_101' }[code];
  return key ? t(key) : t('player_error_generic');
}

function showPlayerError(code) {
  modalPlayer.innerHTML = `<div class="player-error">${escapeHtml(playerErrorMessage(code))}<br>${escapeHtml(t('player_error_watch_hint'))}</div>`;
}

function openModal(videoId, title) {
  modalPlayer.innerHTML = `<div class="player-loading">${escapeHtml(t('loading'))}</div>`;
  modalOpenNewTab.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  modalTitle.textContent = title || '';
  modal.hidden = false;

  withYtApi(() => {
    if (modal.hidden) return; // 로딩 중 닫혔으면 재생하지 않음
    modalPlayer.innerHTML = '<div id="ytPlayerMount"></div>';
    currentPlayer = new YT.Player('ytPlayerMount', {
      videoId,
      playerVars: { autoplay: 1, mute: 1, playsinline: 1 },
      events: {
        onReady: (e) => e.target.playVideo(),
        onError: (e) => showPlayerError(e.data),
      },
    });
  });
}

function closeModal() {
  modal.hidden = true;
  if (currentPlayer && currentPlayer.destroy) {
    currentPlayer.destroy();
  }
  currentPlayer = null;
  modalPlayer.innerHTML = '';
}

modalClose.addEventListener('click', closeModal);
modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) closeModal();
});

searchInput.addEventListener('input', () => render(currentFiltered()));

async function openLeaderboard() {
  leaderboardModal.hidden = false;
  leaderboardList.innerHTML = `<li class="leaderboard-empty">${escapeHtml(t('leaderboard_loading'))}</li>`;

  const { data, error } = await sb
    .from('leaderboard')
    .select('*')
    .order('score', { ascending: false })
    .limit(50);

  if (error) {
    leaderboardList.innerHTML = `<li class="leaderboard-empty">${escapeHtml(t('leaderboard_failed'))}</li>`;
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    leaderboardList.innerHTML = `<li class="leaderboard-empty">${escapeHtml(t('leaderboard_empty'))}</li>`;
    return;
  }

  leaderboardList.innerHTML = data.map((row, i) => `
    <li class="leaderboard-item">
      <span class="leaderboard-rank">${i + 1}</span>
      ${row.avatar_url ? `<img class="leaderboard-avatar" src="${row.avatar_url}" alt="">` : '<span class="leaderboard-avatar"></span>'}
      <span class="leaderboard-name">${escapeHtml(row.display_name || t('anonymous'))}</span>
      <span class="leaderboard-score">${escapeHtml(t('leaderboard_score', { score: row.score, submissions: row.submissions }))}</span>
    </li>
  `).join('');
}

function closeLeaderboard() {
  leaderboardModal.hidden = true;
}

leaderboardBtn.addEventListener('click', openLeaderboard);
leaderboardClose.addEventListener('click', closeLeaderboard);
leaderboardModal.querySelector('.modal-backdrop').addEventListener('click', closeLeaderboard);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !leaderboardModal.hidden) closeLeaderboard();
});

function renderAuthArea() {
  if (currentUser) {
    const name = currentUser.user_metadata?.full_name || currentUser.email || t('anonymous');
    authArea.innerHTML = `
      <span class="auth-user">${escapeHtml(t('greeting', { name }))}</span>
      <button type="button" id="logoutBtn" class="auth-btn">${escapeHtml(t('logout_button'))}</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', () => sb.auth.signOut());
    submitForm.hidden = false;
  } else {
    authArea.innerHTML = `<button type="button" id="loginBtn" class="auth-btn">${escapeHtml(t('login_button'))}</button>`;
    document.getElementById('loginBtn').addEventListener('click', () => {
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href },
      });
    });
    submitForm.hidden = true;
  }
}

function extractVideoId(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || null;
    }
  } catch {
    // 잘못된 URL 형식
  }
  return null;
}

submitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const videoId = extractVideoId(submitUrl.value);
  if (!videoId) {
    submitStatus.textContent = t('submit_invalid_url');
    return;
  }
  submitStatus.textContent = t('submitting');
  const { error } = await sb.from('streams').insert({
    video_id: videoId,
    source: 'user',
    added_by: currentUser.id,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault_live.jpg`,
  });
  if (error) {
    submitStatus.textContent = error.code === '23505' ? t('submit_duplicate') : t('submit_failed', { message: error.message });
    return;
  }
  submitStatus.textContent = t('submit_success');
  submitUrl.value = '';
  await loadStreams();
});

async function loadStreams() {
  const { data, error } = await sb
    .from('streams')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) {
    emptyState.textContent = t('load_failed');
    emptyState.hidden = false;
    console.error(error);
    return;
  }

  streams = (data || []).map(mapRow);
  lastUpdatedEl.textContent = t('total_count', { n: streams.length });
  render(currentFiltered());
}

sb.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  renderAuthArea();
  render(currentFiltered());
});

langSelect.addEventListener('change', () => {
  setLang(langSelect.value);
  applyStaticTranslations();
  renderAuthArea();
  loadStreams();
});

async function init() {
  langSelect.value = currentLang;
  applyStaticTranslations();

  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  renderAuthArea();
  await loadStreams();
}

init();
