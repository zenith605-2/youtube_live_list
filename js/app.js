// publishable key는 공개되어도 안전한 키입니다 (RLS로 보호됨)
const SUPABASE_URL = 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATEGORY_KEYS = ['beach', 'parking', 'traffic', 'harbor', 'mountain', 'downtown', 'dashcam', 'wildlife', 'crowd', 'other'];
const VIEW_MODE_KEY = 'viewMode';

const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const lastUpdatedEl = document.getElementById('lastUpdated');
const modal = document.getElementById('modal');
const modalPlayer = modal.querySelector('.modal-player');
const modalClose = document.getElementById('modalClose');
const modalOpenNewTab = document.getElementById('modalOpenNewTab');
const modalTitle = document.getElementById('modalTitle');
const modalUrlInput = document.getElementById('modalUrlInput');
const modalCopyBtn = document.getElementById('modalCopyBtn');
const authArea = document.getElementById('authArea');
const submitForm = document.getElementById('submitForm');
const submitUrl = document.getElementById('submitUrl');
const submitStatus = document.getElementById('submitStatus');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardClose = document.getElementById('leaderboardClose');
const leaderboardList = document.getElementById('leaderboardList');
const langSelect = document.getElementById('langSelect');
const contentTypeFilter = document.getElementById('contentTypeFilter');
const categoryFilter = document.getElementById('categoryFilter');
const countryFilter = document.getElementById('countryFilter');
const qualityFilter = document.getElementById('qualityFilter');
const statusFilter = document.getElementById('statusFilter');
const favoritesOnlyCheckbox = document.getElementById('favoritesOnlyCheckbox');
const gridViewBtn = document.getElementById('gridViewBtn');
const listViewBtn = document.getElementById('listViewBtn');

let streams = [];
let currentUser = null;
let favorites = new Map(); // videoId -> note
const pageLoadTime = Date.now();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function countryDisplayName(code) {
  try {
    return new Intl.DisplayNames([currentLang], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const rtf = new Intl.RelativeTimeFormat(currentLang, { numeric: 'auto' });
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  return rtf.format(Math.round(diffHr / 24), 'day');
}

function mapRow(row) {
  return {
    videoId: row.video_id,
    title: row.title || t('info_pending'),
    channelTitle: row.channel_title || '',
    channelId: row.channel_id || null,
    thumbnail: row.thumbnail,
    matchedKeyword: row.source === 'user' ? t('source_user') : (row.matched_keyword || ''),
    addedAt: row.added_at,
    source: row.source,
    addedBy: row.added_by,
    upvoteCount: row.upvote_count || 0,
    status: row.status || 'live',
    country: row.country || null,
    category: row.category || null,
    maxQuality: row.max_quality || null,
    startedAt: row.started_at || null,
    contentType: row.content_type || 'live',
    publishedAt: row.published_at || null,
  };
}

function currentFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  const contentType = contentTypeFilter.value;
  const category = categoryFilter.value;
  const country = countryFilter.value;
  const quality = qualityFilter.value;
  const status = statusFilter.value;
  const favoritesOnly = favoritesOnlyCheckbox.checked;

  const filtered = streams.filter(s => {
    if (q && !s.title.toLowerCase().includes(q) && !s.channelTitle.toLowerCase().includes(q)) return false;
    if (contentType && s.contentType !== contentType) return false;
    if (category && s.category !== category) return false;
    if (country && s.country !== country) return false;
    if (quality && s.maxQuality !== quality) return false;
    if (status && s.status !== status) return false;
    if (favoritesOnly && !favorites.has(s.videoId)) return false;
    return true;
  });

  // 같은 채널의 영상들을 붙여서 보여주기 위해 채널명 기준으로 정렬
  return filtered.sort((a, b) =>
    a.channelTitle.localeCompare(b.channelTitle) || a.title.localeCompare(b.title)
  );
}

function render(list) {
  grid.innerHTML = '';
  emptyState.hidden = list.length > 0;
  let lastChannel = undefined;

  for (const s of list) {
    if (s.channelTitle !== lastChannel) {
      const header = document.createElement('div');
      header.className = 'channel-header';
      header.textContent = s.channelTitle || t('anonymous');
      grid.appendChild(header);
      lastChannel = s.channelTitle;
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.videoId = s.videoId;
    card.dataset.title = s.title;
    const isLiveType = s.contentType === 'live';
    const isAvailable = s.status === 'live'; // 'live' 상태값은 두 타입 모두 "지금도 유효함"을 의미

    let thumbHtml;
    if (isLiveType) {
      const liveSnapshot = `https://i.ytimg.com/vi/${encodeURIComponent(s.videoId)}/hqdefault_live.jpg?cb=${pageLoadTime}`;
      // 대표 썸네일이 이미 유튜브 자동 라이브 스냅샷이면(=커스텀 썸네일이 아니면) 굳이 두 개를 비교해서 보여줄 필요가 없음
      const hasCustomThumbnail = !!s.thumbnail && !s.thumbnail.includes('_live');
      thumbHtml = hasCustomThumbnail
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
    } else {
      thumbHtml = `
        <div class="thumb-half">
          <img src="${s.thumbnail}" alt="${escapeHtml(s.title)}" loading="lazy">
        </div>
      `;
    }

    const badgeText = !isAvailable ? t('status_offline') : (isLiveType ? 'LIVE' : t('content_type_video'));
    const badgeClass = isAvailable && isLiveType ? '' : 'offline-badge';
    const isFav = favorites.has(s.videoId);

    const categoryHtml = currentUser
      ? `<select class="card-category-select" data-video-id="${escapeHtml(s.videoId)}">
          ${CATEGORY_KEYS.map(c => `<option value="${c}" ${(s.category || 'other') === c ? 'selected' : ''}>${escapeHtml(t('category_' + c))}</option>`).join('')}
        </select>`
      : (s.category ? `<span class="card-keyword">${escapeHtml(t('category_' + s.category))}</span>` : '');
    const countryHtml = s.country ? `<span class="card-keyword">${escapeHtml(countryDisplayName(s.country))}</span>` : '';
    const dateHtml = isLiveType
      ? (s.startedAt ? `<span class="card-started">🕐 ${escapeHtml(formatRelativeTime(s.startedAt))}</span>` : '')
      : (s.publishedAt ? `<span class="card-started">📅 ${escapeHtml(formatRelativeTime(s.publishedAt))}</span>` : '');

    const actionsHtml = currentUser ? `
      <div class="card-actions">
        ${s.source === 'user' && s.addedBy !== currentUser.id ? `<button type="button" class="upvote-btn" data-video-id="${escapeHtml(s.videoId)}">${t('upvote_button')}</button>` : ''}
        <button type="button" class="favorite-btn ${isFav ? 'active' : ''}" data-video-id="${escapeHtml(s.videoId)}">${isFav ? t('favorite_remove') : t('favorite_add')}</button>
        ${isFav ? `<button type="button" class="note-btn" data-video-id="${escapeHtml(s.videoId)}">📝</button>` : ''}
        <button type="button" class="report-btn" data-video-id="${escapeHtml(s.videoId)}">${t('report_button')}</button>
      </div>
    ` : '';

    card.innerHTML = `
      <div class="thumb-wrap">
        <span class="live-badge ${badgeClass}">${badgeText}</span>
        ${thumbHtml}
      </div>
      <div class="card-body">
        <p class="card-title">${escapeHtml(s.title)}</p>
        <p class="card-channel">${escapeHtml(s.channelTitle)}</p>
        <span class="card-keyword">${escapeHtml(s.matchedKeyword || '')}</span>
        ${s.source === 'user' && s.upvoteCount > 0 ? `<span class="card-keyword">👍 ${s.upvoteCount}</span>` : ''}
        ${countryHtml}
        ${categoryHtml}
        ${dateHtml}
        ${actionsHtml}
      </div>
    `;
    grid.appendChild(card);
  }
}

grid.addEventListener('click', async (e) => {
  if (e.target.closest('select')) return; // 카테고리 select 클릭은 모달을 열지 않음

  const reportBtn = e.target.closest('.report-btn');
  if (reportBtn) return handleReport(reportBtn);

  const upvoteBtn = e.target.closest('.upvote-btn');
  if (upvoteBtn) return handleUpvote(upvoteBtn);

  const favoriteBtn = e.target.closest('.favorite-btn');
  if (favoriteBtn) return handleFavorite(favoriteBtn);

  const noteBtn = e.target.closest('.note-btn');
  if (noteBtn) return handleNoteEdit(noteBtn);

  const card = e.target.closest('.card');
  if (card) {
    openModal(card.dataset.videoId, card.dataset.title);
  }
});

grid.addEventListener('change', async (e) => {
  const sel = e.target.closest('.card-category-select');
  if (!sel || !currentUser) return;
  const videoId = sel.dataset.videoId;
  const category = sel.value;
  const { error } = await sb.rpc('set_stream_category', { p_video_id: videoId, p_category: category });
  if (!error) {
    const s = streams.find(x => x.videoId === videoId);
    if (s) s.category = category;
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

async function handleFavorite(btn) {
  if (!currentUser) return;
  const videoId = btn.dataset.videoId;
  btn.disabled = true;
  if (favorites.has(videoId)) {
    const { error } = await sb.from('favorites').delete().eq('user_id', currentUser.id).eq('video_id', videoId);
    if (!error) favorites.delete(videoId);
  } else {
    const { error } = await sb.from('favorites').insert({ user_id: currentUser.id, video_id: videoId });
    if (!error) favorites.set(videoId, null);
  }
  btn.disabled = false;
  render(currentFiltered());
}

async function handleNoteEdit(btn) {
  if (!currentUser) return;
  const videoId = btn.dataset.videoId;
  const existing = favorites.get(videoId) || '';
  const note = prompt(t('favorite_note_prompt'), existing);
  if (note === null) return;
  const { error } = await sb.from('favorites').update({ note }).eq('user_id', currentUser.id).eq('video_id', videoId);
  if (!error) favorites.set(videoId, note);
}

async function loadFavorites() {
  if (!currentUser) {
    favorites = new Map();
    return;
  }
  const { data, error } = await sb.from('favorites').select('video_id, note').eq('user_id', currentUser.id);
  if (!error && data) {
    favorites = new Map(data.map(f => [f.video_id, f.note]));
  }
}

let currentPlayer = null;
let ytApiReady = false;
let qualityReportedFor = null;
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

async function reportQualityOnce(videoId, player) {
  if (qualityReportedFor === videoId) return;
  qualityReportedFor = videoId;
  try {
    const levels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels() : [];
    const best = levels && levels[0];
    if (best && best !== 'auto') {
      await sb.rpc('report_stream_quality', { p_video_id: videoId, p_quality: best });
    }
  } catch (err) {
    console.error(err);
  }
}

function openModal(videoId, title) {
  modalPlayer.innerHTML = `<div class="player-loading">${escapeHtml(t('loading'))}</div>`;
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  modalOpenNewTab.href = url;
  modalUrlInput.value = url;
  modalTitle.textContent = title || '';
  modal.hidden = false;
  qualityReportedFor = null;

  withYtApi(() => {
    if (modal.hidden) return; // 로딩 중 닫혔으면 재생하지 않음
    modalPlayer.innerHTML = '<div id="ytPlayerMount"></div>';
    currentPlayer = new YT.Player('ytPlayerMount', {
      videoId,
      playerVars: { autoplay: 1, mute: 1, playsinline: 1 },
      events: {
        onReady: (e) => e.target.playVideo(),
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) reportQualityOnce(videoId, e.target);
        },
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

modalCopyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(modalUrlInput.value);
  } catch {
    modalUrlInput.select();
    document.execCommand('copy');
  }
  const original = t('copy_url');
  modalCopyBtn.textContent = t('copy_done');
  setTimeout(() => { modalCopyBtn.textContent = original; }, 1500);
});

searchInput.addEventListener('input', () => render(currentFiltered()));
[contentTypeFilter, categoryFilter, countryFilter, qualityFilter, statusFilter].forEach(el => {
  el.addEventListener('change', () => render(currentFiltered()));
});
favoritesOnlyCheckbox.addEventListener('change', () => render(currentFiltered()));

function applyViewMode() {
  const mode = localStorage.getItem(VIEW_MODE_KEY) || 'grid';
  grid.classList.toggle('list-view', mode === 'list');
  gridViewBtn.classList.toggle('active', mode === 'grid');
  listViewBtn.classList.toggle('active', mode === 'list');
}
gridViewBtn.addEventListener('click', () => { localStorage.setItem(VIEW_MODE_KEY, 'grid'); applyViewMode(); });
listViewBtn.addEventListener('click', () => { localStorage.setItem(VIEW_MODE_KEY, 'list'); applyViewMode(); });

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

function populateCountryFilter() {
  const countries = [...new Set(streams.map(s => s.country).filter(Boolean))].sort();
  const current = countryFilter.value;
  countryFilter.innerHTML = `<option value="">${t('filter_all')}</option>` +
    countries.map(c => `<option value="${c}">${escapeHtml(countryDisplayName(c))}</option>`).join('');
  countryFilter.value = countries.includes(current) ? current : '';
}

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
  populateCountryFilter();
  render(currentFiltered());
}

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  await loadFavorites();
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
  applyViewMode();

  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  await loadFavorites();
  renderAuthArea();
  await loadStreams();
}

init();
