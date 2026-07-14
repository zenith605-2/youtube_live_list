// publishable key는 공개되어도 안전한 키입니다 (RLS로 보호됨)
const SUPABASE_URL = 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const VIEW_MODE_KEY = 'viewMode';
const NEW_WINDOW_MS = 7 * 24 * 3600 * 1000; // 7일 이내는 "신규" 링크로 취급 (열람권 게이팅 대상)
// 사이트 활성화 초기 단계라 신규 링크 열람 제한을 잠시 꺼둠. 다시 켜려면 true로 변경.
const VIEW_GATING_ENABLED = false;

const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const resultCountEl = document.getElementById('resultCount');
const visitorStatsEl = document.getElementById('visitorStats');
const modal = document.getElementById('modal');
const modalPlayer = modal.querySelector('.modal-player');
const modalClose = document.getElementById('modalClose');
const modalOpenNewTab = document.getElementById('modalOpenNewTab');
const modalTitle = document.getElementById('modalTitle');
const modalUrlInput = document.getElementById('modalUrlInput');
const modalCopyBtn = document.getElementById('modalCopyBtn');
const commentsList = document.getElementById('commentsList');
const commentForm = document.getElementById('commentForm');
const commentInput = document.getElementById('commentInput');
const bulkActionBar = document.getElementById('bulkActionBar');
const bulkActionCount = document.getElementById('bulkActionCount');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const bulkClearBtn = document.getElementById('bulkClearBtn');
const authArea = document.getElementById('authArea');
const submitSection = document.getElementById('submitSection');
const submitForm = document.getElementById('submitForm');
const submitUrl = document.getElementById('submitUrl');
const submitContentType = document.getElementById('submitContentType');
const submitCategory = document.getElementById('submitCategory');
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
const addedFilter = document.getElementById('addedFilter');
const sortSelect = document.getElementById('sortSelect');
const statusFilter = document.getElementById('statusFilter');
const visibilityFilter = document.getElementById('visibilityFilter');
const favoritesOnlyCheckbox = document.getElementById('favoritesOnlyCheckbox');
const gridViewBtn = document.getElementById('gridViewBtn');
const listViewBtn = document.getElementById('listViewBtn');
const quotaInfo = document.getElementById('quotaInfo');
const sidebar = document.getElementById('sidebar');

let streams = [];
let currentUser = null;
let isAdmin = false;
let showPendingOnly = false; // "대기중" 사이드바 항목을 눌렀을 때만 true
let selectedForDelete = new Set(); // 관리자 일괄삭제용 선택된 videoId
let channelGroupsFullySelected = new Map(); // groupIndex -> channelId ("채널 전체선택"으로 체크된 그룹만)
let submitterNames = new Map(); // userId -> display_name
let myDisplayName = null;
let myTierHtml = '';
let favorites = new Map(); // videoId -> note
let myUpvotes = new Set();
let myDownvotes = new Set();
let unlockedVideos = new Set();
let categoriesList = []; // [{key, label_en, label_ko, ...}]
const pageLoadTime = Date.now();

function categoryLabel(key) {
  const row = categoriesList.find(c => c.key === key);
  if (!row) return key;
  return row[`label_${currentLang}`] || row.label_en || key;
}

const QUALITY_LABELS = {
  hd2160: '4K', hd1440: '1440p', hd1080: '1080p', hd720: '720p',
  large: '480p', medium: '360p', small: '240p', tiny: '144p',
};
function qualityLabel(quality) {
  return QUALITY_LABELS[quality] || quality;
}

function isNewStream(s) {
  if (!s.addedAt) return false;
  return Date.now() - new Date(s.addedAt).getTime() < NEW_WINDOW_MS;
}

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
    matchedKeyword: row.source === 'user' ? '' : (row.matched_keyword || ''),
    addedAt: row.added_at,
    source: row.source,
    addedBy: row.added_by,
    upvoteCount: row.upvote_count || 0,
    downvoteCount: row.downvote_count || 0,
    visibility: row.visibility || 'listed',
    status: row.status || 'live',
    country: row.country || null,
    category: row.category || null,
    maxQuality: row.max_quality || null,
    startedAt: row.started_at || null,
    contentType: row.content_type || 'live',
    publishedAt: row.published_at || null,
    approvalStatus: row.approval_status || null,
    offlineSince: row.offline_since || null,
    durationSeconds: row.duration_seconds || null,
    commentCount: 0,
  };
}

function currentFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  const contentType = contentTypeFilter.value;
  const category = categoryFilter.value;
  const country = countryFilter.value;
  const quality = qualityFilter.value;
  const status = statusFilter.value;
  const visibility = visibilityFilter.value;
  const favoritesOnly = favoritesOnlyCheckbox.checked;
  const addedWithinDays = addedFilter.value ? Number(addedFilter.value) : null;
  const addedCutoff = addedWithinDays ? Date.now() - addedWithinDays * 24 * 3600 * 1000 : null;

  const filtered = streams.filter(s => {
    if (showPendingOnly) return s.approvalStatus === 'pending';
    if (s.approvalStatus === 'pending') return false;
    if (q && !s.title.toLowerCase().includes(q) && !s.channelTitle.toLowerCase().includes(q)) return false;
    if (contentType && s.contentType !== contentType) return false;
    if (category && s.category !== category) return false;
    if (country && s.country !== country) return false;
    if (quality && s.maxQuality !== quality) return false;
    if (status && s.status !== status) return false;
    if (visibility && s.visibility !== visibility) return false;
    if (favoritesOnly && !favorites.has(s.videoId)) return false;
    if (addedCutoff && (!s.addedAt || new Date(s.addedAt).getTime() < addedCutoff)) return false;
    return true;
  });

  switch (sortSelect.value) {
    case 'newest':
      return filtered.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
    case 'upvotes':
      return filtered.sort((a, b) => b.upvoteCount - a.upvoteCount);
    case 'downvotes':
      return filtered.sort((a, b) => b.downvoteCount - a.downvoteCount);
    case 'comments':
      return filtered.sort((a, b) => b.commentCount - a.commentCount);
    default:
      // 같은 채널의 영상들을 붙여서 보여주기 위해 채널명 기준으로 정렬
      return filtered.sort((a, b) =>
        a.channelTitle.localeCompare(b.channelTitle) || a.title.localeCompare(b.title)
      );
  }
}

// 무한 스크롤: 처음에 RENDER_CHUNK개만 그리고, 하단 센티널이 가까워지면 이어서 그린다
const RENDER_CHUNK = 60;
let renderFullList = [];
let renderedCount = 0;
let renderLastChannel;
let renderGroupIndex = -1;
let renderIsListView = false;

function render(list) {
  clearHoverPreview();
  grid.innerHTML = '';
  emptyState.hidden = list.length > 0;
  resultCountEl.textContent = t('total_count', { n: list.length });

  // 승인 대기 뷰에서 관리자에게 일괄 승인 버튼을 보여준다
  document.getElementById('approveAllBtn')?.remove();
  if (showPendingOnly && isAdmin && list.length) {
    const approveAllBtn = document.createElement('button');
    approveAllBtn.type = 'button';
    approveAllBtn.id = 'approveAllBtn';
    approveAllBtn.className = 'approve-all-btn';
    approveAllBtn.textContent = t('approve_all_button', { n: list.length });
    approveAllBtn.addEventListener('click', handleApproveAll);
    resultCountEl.after(approveAllBtn);
  }
  renderIsListView = grid.classList.contains('list-view') && sortSelect.value === 'default';
  renderFullList = list;
  renderedCount = 0;
  renderLastChannel = undefined;
  renderGroupIndex = -1;

  setupViewportAutoplay();
  ensureLoadMoreSentinel();
  appendMoreCards();
  maybeAppendMore(); // 첫 청크가 화면을 못 채우는 경우(짧은 리스트뷰 등) 바로 이어서 채움
}

function appendMoreCards() {
  const end = Math.min(renderedCount + RENDER_CHUNK, renderFullList.length);

  for (let i = renderedCount; i < end; i++) {
    const s = renderFullList[i];
    if (s.channelTitle !== renderLastChannel) {
      renderGroupIndex += 1;
      if (renderIsListView) {
        const header = document.createElement('div');
        header.className = 'channel-header';
        header.dataset.channelGroup = String(renderGroupIndex);
        if (s.channelId) header.dataset.channelId = s.channelId;
        header.innerHTML = `
          ${isAdmin ? `<input type="checkbox" class="channel-select-all" data-channel-group="${renderGroupIndex}">` : ''}
          <span>${escapeHtml(s.channelTitle || t('anonymous'))}</span>
        `;
        grid.appendChild(header);
      }
      renderLastChannel = s.channelTitle;
    }
    const groupIndex = renderGroupIndex;

    const isLocked = VIEW_GATING_ENABLED && isNewStream(s) && !unlockedVideos.has(s.videoId);
    const card = document.createElement('div');
    card.className = 'card' + (isLocked ? ' locked' : '');
    card.dataset.videoId = s.videoId;
    card.dataset.title = s.title;
    card.dataset.channelGroup = String(groupIndex);
    card.innerHTML = cardInnerHtml(s, groupIndex);
    grid.appendChild(card);
    const wrap = card.querySelector('.thumb-wrap');
    if (wrap && viewportPreviewObserver) viewportPreviewObserver.observe(wrap);
  }

  renderedCount = end;
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function cardInnerHtml(s, groupIndex) {
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
          ${categoriesList.map(c => `<option value="${c.key}" ${(s.category || 'other') === c.key ? 'selected' : ''}>${escapeHtml(categoryLabel(c.key))}</option>`).join('')}
        </select>`
      : (s.category ? `<span class="card-keyword">${escapeHtml(categoryLabel(s.category))}</span>` : '');
    const countryHtml = s.country ? `<span class="card-keyword">${escapeHtml(countryDisplayName(s.country))}</span>` : '';
    const qualityHtml = s.maxQuality ? `<span class="card-keyword">${escapeHtml(qualityLabel(s.maxQuality))}</span>` : '';
    const dateHtml = isLiveType
      ? (s.startedAt ? `<span class="card-started">🕐 ${escapeHtml(formatRelativeTime(s.startedAt))}</span>` : '')
      : (s.publishedAt ? `<span class="card-started">📅 ${escapeHtml(formatRelativeTime(s.publishedAt))}</span>` : '');
    const addedHtml = s.addedAt ? `<span class="card-added">📌 ${escapeHtml(formatRelativeTime(s.addedAt))}</span>` : '';
    const isRecentlyAdded = s.addedAt && (Date.now() - new Date(s.addedAt).getTime() < 3 * 24 * 3600 * 1000);
    const offlineDaysLeft = s.offlineSince
      ? Math.max(0, 7 - Math.floor((Date.now() - new Date(s.offlineSince).getTime()) / 86400000))
      : null;
    const offlineNoticeHtml = !isAvailable && s.offlineSince
      ? `<div class="offline-notice">${escapeHtml(t('offline_notice', { days: offlineDaysLeft }))}</div>`
      : '';

    const actionsHtml = `
      <div class="card-actions">
        <button type="button" class="copy-link-btn" data-video-id="${escapeHtml(s.videoId)}">${t('copy_url')}</button>
        ${s.channelId ? `<a class="subscribe-btn" href="https://www.youtube.com/channel/${encodeURIComponent(s.channelId)}?sub_confirmation=1" target="_blank" rel="noopener">${t('subscribe_button')}</a>` : ''}
        ${currentUser ? `
          <button type="button" class="upvote-btn ${myUpvotes.has(s.videoId) ? 'active' : ''}" data-video-id="${escapeHtml(s.videoId)}" ${s.source === 'user' && s.addedBy === currentUser.id ? 'disabled title="' + escapeHtml(t('upvote_own_disabled')) + '"' : ''}>${t('upvote_button')}</button>
          <button type="button" class="downvote-btn ${myDownvotes.has(s.videoId) ? 'active' : ''}" data-video-id="${escapeHtml(s.videoId)}">${t('downvote_button')}</button>
          <button type="button" class="favorite-btn ${isFav ? 'active' : ''}" data-video-id="${escapeHtml(s.videoId)}">${isFav ? t('favorite_remove') : t('favorite_add')}</button>
          ${isFav ? `<button type="button" class="note-btn" data-video-id="${escapeHtml(s.videoId)}">📝</button>` : ''}
          ${isAdmin && s.approvalStatus === 'pending' ? `<button type="button" class="admin-approve-btn" data-video-id="${escapeHtml(s.videoId)}">${t('approve_button')}</button>` : ''}
          ${isAdmin ? `<button type="button" class="admin-delete-btn" data-video-id="${escapeHtml(s.videoId)}">${t('admin_delete_button')}</button>` : ''}
        ` : ''}
      </div>
    `;

    return `
      <div class="thumb-wrap">
        ${isAdmin ? `<input type="checkbox" class="admin-select-checkbox" data-video-id="${escapeHtml(s.videoId)}" data-channel-group="${groupIndex}" ${selectedForDelete.has(s.videoId) ? 'checked' : ''}>` : ''}
        <span class="live-badge ${badgeClass}">${badgeText}</span>
        ${s.approvalStatus === 'pending' ? `<span class="new-badge pending-badge">${t('pending_badge')}</span>` : (isRecentlyAdded ? '<span class="new-badge">NEW</span>' : '')}
        ${!isLiveType && s.durationSeconds ? `<span class="duration-badge">${formatDuration(s.durationSeconds)}</span>` : ''}
        ${offlineNoticeHtml}
        ${thumbHtml}
      </div>
      <div class="card-body">
        <p class="card-title">${escapeHtml(s.title)}</p>
        <p class="card-channel">${escapeHtml(s.channelTitle)}</p>
        <span class="card-keyword">👍 ${s.upvoteCount} · 👎 ${s.downvoteCount}</span>
        ${s.source === 'user'
          ? `<span class="card-keyword">👤 ${escapeHtml(submitterNames.get(s.addedBy) || t('anonymous'))}</span>`
          : (s.matchedKeyword ? `<span class="card-keyword">${escapeHtml(s.matchedKeyword)}</span>` : '')}
        ${dateHtml}
        ${addedHtml}
        ${countryHtml}
        ${qualityHtml}
        ${categoryHtml}
        ${actionsHtml}
      </div>
    `;
}

// 그리드 전체를 다시 그리지 않고 카드 하나만 제자리에서 갱신한다.
// 전체 재렌더는 재생 중인 모든 미리보기 iframe을 초기화해버리기 때문에,
// 추천/승인 같은 단일 카드 액션에서는 이 함수를 써서 다른 카드의 재생을 유지한다.
function refreshCard(videoId) {
  const card = grid.querySelector(`.card[data-video-id="${CSS.escape(videoId)}"]`);
  if (!card) return;
  const s = streams.find(x => x.videoId === videoId);
  const oldWrap = card.querySelector('.thumb-wrap');
  if (oldWrap && viewportPreviewObserver) viewportPreviewObserver.unobserve(oldWrap);

  // 삭제됐거나 현재 필터 조건에서 빠진 카드(예: 대기 뷰에서 승인됨)는 그 카드만 제거
  if (!s || !currentFiltered().some(x => x.videoId === videoId)) {
    card.remove();
    resultCountEl.textContent = t('total_count', { n: currentFiltered().length });
    return;
  }

  card.innerHTML = cardInnerHtml(s, card.dataset.channelGroup);
  const wrap = card.querySelector('.thumb-wrap');
  if (wrap && viewportPreviewObserver) viewportPreviewObserver.observe(wrap);
}

let loadMoreObserver = null;

function ensureLoadMoreSentinel() {
  if (document.getElementById('loadMoreSentinel')) return;
  const sentinel = document.createElement('div');
  sentinel.id = 'loadMoreSentinel';
  grid.after(sentinel);
  loadMoreObserver = new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) maybeAppendMore();
  }, { rootMargin: '800px' });
  loadMoreObserver.observe(sentinel);
}

function maybeAppendMore() {
  const sentinel = document.getElementById('loadMoreSentinel');
  if (!sentinel) return;
  // 센티널이 계속 관측 범위 안에 머물러 있으면 IntersectionObserver가 다시 안 울리므로,
  // 범위를 벗어나거나 목록이 끝날 때까지 직접 반복해서 채운다
  let guard = 0;
  while (
    renderedCount < renderFullList.length &&
    sentinel.getBoundingClientRect().top < window.innerHeight + 800 &&
    guard++ < 30
  ) {
    appendMoreCards();
  }
}

grid.addEventListener('click', async (e) => {
  if (e.target.closest('select')) return; // 카테고리 select 클릭은 모달을 열지 않음
  if (e.target.closest('.admin-select-checkbox') || e.target.closest('.channel-select-all')) return; // 체크박스는 모달을 열지 않음
  if (e.target.closest('.subscribe-btn')) return; // 구독 링크는 새 탭으로만 열고 모달은 열지 않음

  const copyLinkBtn = e.target.closest('.copy-link-btn');
  if (copyLinkBtn) return handleCopyLink(copyLinkBtn);

  const upvoteBtn = e.target.closest('.upvote-btn');
  if (upvoteBtn) return handleUpvote(upvoteBtn);

  const downvoteBtn = e.target.closest('.downvote-btn');
  if (downvoteBtn) return handleDownvote(downvoteBtn);

  const favoriteBtn = e.target.closest('.favorite-btn');
  if (favoriteBtn) return handleFavorite(favoriteBtn);

  const noteBtn = e.target.closest('.note-btn');
  if (noteBtn) return handleNoteEdit(noteBtn);

  const adminDeleteBtn = e.target.closest('.admin-delete-btn');
  if (adminDeleteBtn) return handleAdminDelete(adminDeleteBtn);

  const adminApproveBtn = e.target.closest('.admin-approve-btn');
  if (adminApproveBtn) return handleAdminApprove(adminApproveBtn);

  const card = e.target.closest('.card');
  if (card) {
    await openCard(card.dataset.videoId, card.dataset.title);
  }
});

async function openCard(videoId, title) {
  const s = streams.find(x => x.videoId === videoId);
  if (VIEW_GATING_ENABLED && s && isNewStream(s) && !unlockedVideos.has(videoId)) {
    const result = await tryUnlock(videoId);
    if (!result.ok) {
      showUnlockBlocked(result.reason, title);
      return;
    }
    unlockedVideos.add(videoId);
    refreshQuotaInfo();
    render(currentFiltered()); // 잠금 아이콘 해제 반영
  }
  openModal(videoId, title);
}

async function tryUnlock(videoId) {
  const { data, error } = await sb.rpc('unlock_video', { p_video_id: videoId });
  if (error) return { ok: false, reason: 'error' };
  return data;
}

grid.addEventListener('change', async (e) => {
  const sel = e.target.closest('.card-category-select');
  if (sel && currentUser) {
    const videoId = sel.dataset.videoId;
    const category = sel.value;
    const { error } = await sb.rpc('set_stream_category', { p_video_id: videoId, p_category: category });
    if (!error) {
      const s = streams.find(x => x.videoId === videoId);
      if (s) s.category = category;
      renderSidebar();
    }
    return;
  }

  const checkbox = e.target.closest('.admin-select-checkbox');
  if (checkbox && isAdmin) {
    if (checkbox.checked) {
      selectedForDelete.add(checkbox.dataset.videoId);
    } else {
      selectedForDelete.delete(checkbox.dataset.videoId);
      // 채널 전체선택 중이었는데 개별 항목을 해제했으면, 더 이상 "채널 전체 삭제"가 아니므로 채널 차단 후보에서 뺀다.
      channelGroupsFullySelected.delete(checkbox.dataset.channelGroup);
    }
    updateBulkActionBar();
    return;
  }

  const selectAll = e.target.closest('.channel-select-all');
  if (selectAll && isAdmin) {
    const group = selectAll.dataset.channelGroup;
    grid.querySelectorAll(`.admin-select-checkbox[data-channel-group="${group}"]`).forEach(cb => {
      cb.checked = selectAll.checked;
      if (selectAll.checked) selectedForDelete.add(cb.dataset.videoId);
      else selectedForDelete.delete(cb.dataset.videoId);
    });
    if (selectAll.checked) {
      const header = grid.querySelector(`.channel-header[data-channel-group="${group}"]`);
      if (header?.dataset.channelId) channelGroupsFullySelected.set(group, header.dataset.channelId);
    } else {
      channelGroupsFullySelected.delete(group);
    }
    updateBulkActionBar();
  }
});

function updateBulkActionBar() {
  bulkActionBar.hidden = selectedForDelete.size === 0;
  bulkActionCount.textContent = t('bulk_selected_count', { n: selectedForDelete.size });
}

bulkClearBtn.addEventListener('click', () => {
  selectedForDelete.clear();
  channelGroupsFullySelected.clear();
  updateBulkActionBar();
  render(currentFiltered());
});

bulkDeleteBtn.addEventListener('click', async () => {
  if (!isAdmin || selectedForDelete.size === 0) return;
  if (!confirm(t('bulk_delete_confirm', { n: selectedForDelete.size }))) return;
  const ids = [...selectedForDelete];
  const { error } = await sb.from('streams').delete().in('video_id', ids);
  if (error) {
    alert(t('admin_delete_failed', { message: error.message }));
    return;
  }
  await sb.from('blocklist').insert(ids.map(video_id => ({ video_id, blocked_by: currentUser.id })));
  const channelIds = [...channelGroupsFullySelected.values()];
  if (channelIds.length) {
    await sb.from('blocked_channels').insert(channelIds.map(channel_id => ({ channel_id, blocked_by: currentUser.id })));
  }
  streams = streams.filter(s => !selectedForDelete.has(s.videoId));
  selectedForDelete.clear();
  channelGroupsFullySelected.clear();
  updateBulkActionBar();
  render(currentFiltered());
});

async function blockAndDelete(videoId) {
  const { error } = await sb.from('streams').delete().eq('video_id', videoId);
  if (error) return error;
  // 삭제한 videoId를 차단 목록에 기록해, 다음날 자동 검색/채널스캔이 다시 넣지 못하게 한다.
  await sb.from('blocklist').insert({ video_id: videoId, blocked_by: currentUser.id });
  return null;
}

async function handleAdminDelete(btn) {
  if (!isAdmin) return;
  const videoId = btn.dataset.videoId;
  if (!confirm(t('admin_delete_confirm'))) return;
  btn.disabled = true;
  const error = await blockAndDelete(videoId);
  if (error) {
    alert(t('admin_delete_failed', { message: error.message }));
    btn.disabled = false;
    return;
  }
  streams = streams.filter(s => s.videoId !== videoId);
  refreshCard(videoId);
  renderSidebar();
  updateSidebarActiveState();
}

async function handleAdminApprove(btn) {
  if (!isAdmin) return;
  const videoId = btn.dataset.videoId;
  btn.disabled = true;
  const { error } = await sb.from('streams').update({ approval_status: 'approved' }).eq('video_id', videoId);
  if (error) {
    alert(t('approve_failed', { message: error.message }));
    btn.disabled = false;
    return;
  }
  const s = streams.find(x => x.videoId === videoId);
  if (s) s.approvalStatus = 'approved';
  refreshCard(videoId);
  renderSidebar();
  updateSidebarActiveState();
}

async function handleApproveAll() {
  if (!isAdmin) return;
  const pendingIds = currentFiltered().filter(s => s.approvalStatus === 'pending').map(s => s.videoId);
  if (!pendingIds.length) return;
  if (!confirm(t('approve_all_confirm', { n: pendingIds.length }))) return;
  const btn = document.getElementById('approveAllBtn');
  if (btn) btn.disabled = true;
  // URL 길이 제한을 피하려고 200개씩 나눠서 업데이트
  for (let i = 0; i < pendingIds.length; i += 200) {
    const chunk = pendingIds.slice(i, i + 200);
    const { error } = await sb.from('streams').update({ approval_status: 'approved' }).in('video_id', chunk);
    if (error) {
      alert(t('approve_failed', { message: error.message }));
      if (btn) btn.disabled = false;
      return;
    }
    for (const s of streams) {
      if (chunk.includes(s.videoId)) s.approvalStatus = 'approved';
    }
  }
  renderSidebar();
  updateSidebarActiveState();
  render(currentFiltered());
}

async function handleCopyLink(btn) {
  const videoId = btn.dataset.videoId;
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const tmp = document.createElement('textarea');
    tmp.value = url;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
  }
  const original = btn.textContent;
  btn.textContent = t('copy_done');
  setTimeout(() => { btn.textContent = original; }, 1500);
}

async function handleUpvote(btn) {
  if (!currentUser) return;
  btn.disabled = true;
  const videoId = btn.dataset.videoId;
  const s = streams.find(x => x.videoId === videoId);
  if (myUpvotes.has(videoId)) {
    const { error } = await sb.from('upvotes').delete().eq('video_id', videoId).eq('user_id', currentUser.id);
    if (!error) {
      myUpvotes.delete(videoId);
      if (s) s.upvoteCount = Math.max(0, s.upvoteCount - 1);
    }
  } else {
    const { error } = await sb.from('upvotes').insert({ video_id: videoId, user_id: currentUser.id });
    if (!error) {
      myUpvotes.add(videoId);
      if (s) s.upvoteCount += 1;
    } else if (error.code !== '23505') {
      alert(t('upvote_failed'));
    }
  }
  btn.disabled = false;
  refreshCard(videoId);
}

async function handleDownvote(btn) {
  if (!currentUser) return;
  btn.disabled = true;
  const videoId = btn.dataset.videoId;
  const s = streams.find(x => x.videoId === videoId);
  if (myDownvotes.has(videoId)) {
    const { error } = await sb.from('downvotes').delete().eq('video_id', videoId).eq('user_id', currentUser.id);
    if (!error) {
      myDownvotes.delete(videoId);
      if (s) s.downvoteCount = Math.max(0, s.downvoteCount - 1);
    }
  } else {
    const { error } = await sb.from('downvotes').insert({ video_id: videoId, user_id: currentUser.id });
    if (!error) {
      myDownvotes.add(videoId);
      if (s) s.downvoteCount += 1;
    } else if (error.code !== '23505') {
      alert(t('downvote_failed'));
    }
  }
  btn.disabled = false;
  refreshCard(videoId);
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
  refreshCard(videoId);
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

async function loadSubmitterNames(list) {
  const userIds = [...new Set(list.filter(s => s.source === 'user' && s.addedBy).map(s => s.addedBy))]
    .filter(id => !submitterNames.has(id));
  if (!userIds.length) return;
  const { data, error } = await sb.from('profiles').select('id, display_name').in('id', userIds);
  if (error) return;
  for (const row of data || []) submitterNames.set(row.id, row.display_name);
}

async function loadCommentCounts() {
  const { data, error } = await sb.from('comments').select('video_id');
  if (error || !data) return;
  const counts = new Map();
  for (const row of data) counts.set(row.video_id, (counts.get(row.video_id) || 0) + 1);
  for (const s of streams) s.commentCount = counts.get(s.videoId) || 0;
}

async function checkAdmin() {
  if (!currentUser) {
    isAdmin = false;
    return;
  }
  const { data } = await sb.from('profiles').select('is_admin').eq('id', currentUser.id).maybeSingle();
  isAdmin = !!data?.is_admin;
}

const TIERS = [
  { min: 50, emoji: '💎', key: 'tier_diamond' },
  { min: 20, emoji: '🥇', key: 'tier_gold' },
  { min: 5, emoji: '🥈', key: 'tier_silver' },
  { min: 1, emoji: '🥉', key: 'tier_bronze' },
  { min: 0, emoji: '🌱', key: 'tier_newcomer' },
];
function tierFor(submissions) {
  return TIERS.find(tier => submissions >= tier.min);
}
function tierBadgeHtml(submissions) {
  const tier = tierFor(submissions);
  return `<span class="tier-badge" title="${escapeHtml(t('tier_title', { count: submissions }))}">${tier.emoji} ${escapeHtml(t(tier.key))}</span>`;
}

async function loadMyProfile() {
  if (!currentUser) {
    myDisplayName = null;
    myTierHtml = '';
    return;
  }
  const { data } = await sb.from('profiles').select('display_name').eq('id', currentUser.id).maybeSingle();
  myDisplayName = data?.display_name || null;
  if (myDisplayName) submitterNames.set(currentUser.id, myDisplayName);
  const { count } = await sb.from('streams').select('*', { count: 'exact', head: true }).eq('added_by', currentUser.id);
  myTierHtml = tierBadgeHtml(count || 0);
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

async function loadMyVotes() {
  if (!currentUser) {
    myUpvotes = new Set();
    myDownvotes = new Set();
    return;
  }
  const [{ data: upData, error: upErr }, { data: downData, error: downErr }] = await Promise.all([
    sb.from('upvotes').select('video_id').eq('user_id', currentUser.id),
    sb.from('downvotes').select('video_id').eq('user_id', currentUser.id),
  ]);
  if (!upErr && upData) myUpvotes = new Set(upData.map(r => r.video_id));
  if (!downErr && downData) myDownvotes = new Set(downData.map(r => r.video_id));
}

let currentPlayer = null;
let currentModalVideoId = null;
let viewportPreviewObserver = null;
const viewportPreviewTimers = new Map(); // videoId -> pending start timer

function startViewportPreview(thumbWrap, videoId) {
  if (thumbWrap.querySelector('.hover-preview-iframe')) return;
  const iframe = document.createElement('iframe');
  iframe.className = 'hover-preview-iframe';
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1`;
  iframe.setAttribute('allow', 'autoplay; encrypted-media');
  iframe.setAttribute('frameborder', '0');
  thumbWrap.appendChild(iframe);
}

function stopViewportPreview(thumbWrap) {
  const iframe = thumbWrap.querySelector('.hover-preview-iframe');
  if (iframe) iframe.remove();
}

function clearHoverPreview() {
  if (viewportPreviewObserver) viewportPreviewObserver.disconnect();
  viewportPreviewTimers.forEach(timer => clearTimeout(timer));
  viewportPreviewTimers.clear();
  grid.querySelectorAll('.hover-preview-iframe').forEach(el => el.remove());
}

function setupViewportAutoplay() {
  viewportPreviewObserver = new IntersectionObserver((entries) => {
    if (previewMode() !== 'auto') return; // hover 모드에선 자동 재생 안 함
    for (const entry of entries) {
      const thumbWrap = entry.target;
      const card = thumbWrap.closest('.card');
      if (!card) continue;
      const videoId = card.dataset.videoId;
      clearTimeout(viewportPreviewTimers.get(videoId));
      if (entry.isIntersecting) {
        // 스크롤 중 잠깐 지나치는 카드마다 iframe을 만들지 않도록 짧은 지연
        viewportPreviewTimers.set(videoId, setTimeout(() => startViewportPreview(thumbWrap, videoId), 400));
      } else {
        viewportPreviewTimers.delete(videoId);
        stopViewportPreview(thumbWrap);
      }
    }
  }, { threshold: 0.6 });
  grid.querySelectorAll('.thumb-wrap').forEach(el => viewportPreviewObserver.observe(el));
}
let ytApiReady = false;
let qualityReportedFor = null;
const ytApiQueue = [];

window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  ytApiQueue.splice(0).forEach(fn => fn());
};

// iframe_api 스크립트가 이 코드보다 먼저 로드를 끝내버리면 onYouTubeIframeAPIReady 콜백이
// 우리가 정의하기 전에 이미 호출되고 지나가버려서(YT.Player는 있는데 ytApiReady는 영원히 false),
// 모달이 "불러오는 중..."에서 멈추는 문제가 생긴다. 이미 로드가 끝나 있으면 즉시 ready 처리.
if (window.YT && window.YT.Player) {
  window.onYouTubeIframeAPIReady();
}

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

function showUnlockBlocked(reason, title) {
  modalTitle.textContent = title || '';
  modal.querySelector('.modal-url-row').hidden = true;
  modalPlayer.innerHTML = `<div class="unlock-message">${escapeHtml(t(reason === 'login_required' ? 'unlock_login_required' : 'unlock_no_quota'))}</div>`;
  modal.hidden = false;
}

function openModal(videoId, title) {
  modal.querySelector('.modal-url-row').hidden = false;
  modalPlayer.innerHTML = `<div class="player-loading">${escapeHtml(t('loading'))}</div>`;
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  modalOpenNewTab.href = url;
  modalUrlInput.value = url;
  modalTitle.textContent = title || '';
  modal.hidden = false;
  qualityReportedFor = null;
  currentModalVideoId = videoId;
  commentForm.hidden = !currentUser;
  loadComments(videoId);

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
  currentModalVideoId = null;
  commentsList.innerHTML = '';
  commentInput.value = '';
}

async function loadComments(videoId) {
  commentsList.innerHTML = `<div class="comment-empty">${escapeHtml(t('loading'))}</div>`;
  const { data, error } = await sb
    .from('comments')
    .select('*')
    .eq('video_id', videoId)
    .order('created_at', { ascending: true });
  if (currentModalVideoId !== videoId) return; // 로딩 중 다른 영상으로 넘어갔으면 무시
  if (error) {
    commentsList.innerHTML = `<div class="comment-empty">${escapeHtml(t('comments_failed'))}</div>`;
    return;
  }
  await loadSubmitterNames(data.map(c => ({ source: 'user', addedBy: c.user_id })));
  renderComments(data || []);
}

function renderComments(list) {
  if (!list.length) {
    commentsList.innerHTML = `<div class="comment-empty">${escapeHtml(t('comments_empty'))}</div>`;
    return;
  }
  commentsList.innerHTML = list.map(c => {
    const canDelete = currentUser && (currentUser.id === c.user_id || isAdmin);
    return `
      <div class="comment-item" data-comment-id="${c.id}">
        <span class="comment-author">${escapeHtml(submitterNames.get(c.user_id) || t('anonymous'))}</span>
        <span class="comment-text">${escapeHtml(c.content)}</span>
        <span class="comment-time">${escapeHtml(formatRelativeTime(c.created_at))}</span>
        ${canDelete ? `<button type="button" class="comment-delete-btn" data-comment-id="${c.id}">✕</button>` : ''}
      </div>
    `;
  }).join('');
}

commentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser || !currentModalVideoId) return;
  const content = commentInput.value.trim();
  if (!content) return;
  const { error } = await sb.from('comments').insert({
    video_id: currentModalVideoId,
    user_id: currentUser.id,
    content,
  });
  if (error) {
    alert(t('comment_failed', { message: error.message }));
    return;
  }
  commentInput.value = '';
  loadComments(currentModalVideoId);
});

commentsList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.comment-delete-btn');
  if (!btn || !currentModalVideoId) return;
  if (!confirm(t('comment_delete_confirm'))) return;
  const { error } = await sb.from('comments').delete().eq('id', btn.dataset.commentId);
  if (error) {
    alert(t('comment_failed', { message: error.message }));
    return;
  }
  loadComments(currentModalVideoId);
});

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

// 딥링크: 현재 필터 상태를 URL 쿼리에 반영해 공유/북마크가 가능하게 한다
function syncUrlFromFilters() {
  const p = new URLSearchParams();
  if (contentTypeFilter.value) p.set('type', contentTypeFilter.value);
  if (categoryFilter.value) p.set('category', categoryFilter.value);
  if (qualityFilter.value) p.set('quality', qualityFilter.value);
  if (addedFilter.value) p.set('added', addedFilter.value);
  if (sortSelect.value !== 'default') p.set('sort', sortSelect.value);
  if (searchInput.value.trim()) p.set('q', searchInput.value.trim());
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function applyFiltersFromUrl() {
  const p = new URLSearchParams(location.search);
  const setIfValid = (el, value) => {
    if (value && [...el.options].some(o => o.value === value)) el.value = value;
  };
  setIfValid(contentTypeFilter, p.get('type'));
  setIfValid(categoryFilter, p.get('category'));
  setIfValid(qualityFilter, p.get('quality'));
  setIfValid(addedFilter, p.get('added'));
  setIfValid(sortSelect, p.get('sort'));
  if (p.get('q')) searchInput.value = p.get('q');
}

searchInput.addEventListener('input', () => {
  syncUrlFromFilters();
  render(currentFiltered());
});
[contentTypeFilter, categoryFilter, countryFilter, qualityFilter, statusFilter, visibilityFilter, addedFilter, sortSelect].forEach(el => {
  el.addEventListener('change', () => {
    syncUrlFromFilters();
    updateSidebarActiveState();
    render(currentFiltered());
  });
});
favoritesOnlyCheckbox.addEventListener('change', () => render(currentFiltered()));

document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  searchInput.value = '';
  contentTypeFilter.value = '';
  categoryFilter.value = '';
  countryFilter.value = '';
  qualityFilter.value = '';
  addedFilter.value = '';
  sortSelect.value = 'default';
  statusFilter.value = 'live';       // 기본값: 라이브만
  visibilityFilter.value = 'listed'; // 기본값: 정상 노출만
  favoritesOnlyCheckbox.checked = false;
  showPendingOnly = false;
  syncUrlFromFilters();
  updateSidebarActiveState();
  render(currentFiltered());
});

function applyViewMode() {
  const mode = localStorage.getItem(VIEW_MODE_KEY) || 'grid';
  grid.classList.toggle('list-view', mode === 'list');
  gridViewBtn.classList.toggle('active', mode === 'grid');
  listViewBtn.classList.toggle('active', mode === 'list');
}
gridViewBtn.addEventListener('click', () => { localStorage.setItem(VIEW_MODE_KEY, 'grid'); applyViewMode(); render(currentFiltered()); });
listViewBtn.addEventListener('click', () => { localStorage.setItem(VIEW_MODE_KEY, 'list'); applyViewMode(); render(currentFiltered()); });

// 미리보기 모드: 'auto' = 화면에 보이는 카드 전부 자동 재생 / 'hover' = 마우스를 올린 카드만 재생
const PREVIEW_MODE_KEY = 'previewMode';
const previewAutoBtn = document.getElementById('previewAutoBtn');
const previewHoverBtn = document.getElementById('previewHoverBtn');

function previewMode() {
  return localStorage.getItem(PREVIEW_MODE_KEY) || 'auto';
}

function applyPreviewMode() {
  if (!previewAutoBtn || !previewHoverBtn) return; // 캐시된 옛 HTML엔 버튼이 없을 수 있음
  const mode = previewMode();
  previewAutoBtn.classList.toggle('active', mode === 'auto');
  previewHoverBtn.classList.toggle('active', mode === 'hover');
}

previewAutoBtn?.addEventListener('click', () => { localStorage.setItem(PREVIEW_MODE_KEY, 'auto'); applyPreviewMode(); render(currentFiltered()); });
previewHoverBtn?.addEventListener('click', () => { localStorage.setItem(PREVIEW_MODE_KEY, 'hover'); applyPreviewMode(); render(currentFiltered()); });

// hover 모드: 마우스가 올라간 카드만 재생, 벗어나면 정지
grid.addEventListener('mouseover', (e) => {
  if (previewMode() !== 'hover') return;
  const card = e.target.closest('.card');
  if (!card || card.contains(e.relatedTarget)) return;
  const wrap = card.querySelector('.thumb-wrap');
  if (wrap) startViewportPreview(wrap, card.dataset.videoId);
});
grid.addEventListener('mouseout', (e) => {
  if (previewMode() !== 'hover') return;
  const card = e.target.closest('.card');
  if (!card || card.contains(e.relatedTarget)) return;
  const wrap = card.querySelector('.thumb-wrap');
  if (wrap) stopViewportPreview(wrap);
});

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
      <span class="leaderboard-name">${escapeHtml(row.display_name || t('anonymous'))} ${tierBadgeHtml(row.submissions)}</span>
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
    const name = myDisplayName || currentUser.user_metadata?.full_name || currentUser.email || t('anonymous');
    authArea.innerHTML = `
      <span class="auth-user">${escapeHtml(t('greeting', { name }))}</span>
      ${myTierHtml}
      <a href="account.html" class="icon-btn" title="${escapeHtml(t('account_title'))}">⚙️</a>
      <a href="feedback.html" class="icon-btn" title="${escapeHtml(t('feedback_title'))}">💡</a>
      <button type="button" id="logoutBtn" class="auth-btn">${escapeHtml(t('logout_button'))}</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', () => sb.auth.signOut());
    submitSection.hidden = false;
  } else {
    authArea.innerHTML = `<button type="button" id="loginBtn" class="auth-btn">${escapeHtml(t('login_button'))}</button>`;
    document.getElementById('loginBtn').addEventListener('click', () => {
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
    });
    submitSection.hidden = true;
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

async function fetchOEmbed(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
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
  const { data: blocked } = await sb.from('blocklist').select('video_id').eq('video_id', videoId).maybeSingle();
  if (blocked) {
    submitStatus.textContent = t('submit_blocked');
    return;
  }
  const contentType = submitContentType.value;
  const oembed = await fetchOEmbed(videoId).catch(() => null);
  if (!oembed) {
    submitStatus.textContent = t('submit_video_unavailable');
    return;
  }
  const { error } = await sb.from('streams').insert({
    video_id: videoId,
    source: 'user',
    added_by: currentUser.id,
    content_type: contentType,
    category: submitCategory.value || null,
    title: oembed.title || null,
    channel_title: oembed.author_name || null,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/${contentType === 'live' ? 'hqdefault_live' : 'hqdefault'}.jpg`,
    approval_status: 'pending',
  });
  if (error) {
    submitStatus.textContent = error.code === '23505' ? t('submit_duplicate') : t('submit_failed', { message: error.message });
    return;
  }
  submitStatus.textContent = t('submit_success');
  submitUrl.value = '';
  await loadStreams();
});

async function loadCategories() {
  const { data, error } = await sb.from('categories').select('*').order('sort_order');
  if (!error && data) categoriesList = data;
}

function populateCategoryFilter() {
  const current = categoryFilter.value;
  categoryFilter.innerHTML = `<option value="">${t('filter_all')}</option>` +
    categoriesList.map(c => `<option value="${c.key}">${escapeHtml(categoryLabel(c.key))}</option>`).join('');
  categoryFilter.value = categoriesList.some(c => c.key === current) ? current : '';
  renderSidebar();
  populateSubmitCategory();
}

function populateSubmitCategory() {
  const current = submitCategory.value;
  submitCategory.innerHTML = `<option value="">${t('submit_category_auto')}</option>` +
    categoriesList.map(c => `<option value="${c.key}">${escapeHtml(categoryLabel(c.key))}</option>`).join('');
  submitCategory.value = categoriesList.some(c => c.key === current) ? current : '';
}

const SIDEBAR_GROUPS = [
  { type: 'live', labelKey: 'content_type_live', icon: '🔴' },
  { type: 'video', labelKey: 'content_type_video', icon: '🎬' },
];

function sidebarCount(type, category) {
  return streams.filter(s =>
    s.contentType === type &&
    (!category || s.category === category) &&
    s.status === 'live' &&
    s.visibility === 'listed'
  ).length;
}

function pendingCount() {
  return streams.filter(s => s.approvalStatus === 'pending').length;
}

function renderSidebar() {
  // 대기 건이 없으면 일반 방문자에겐 굳이 빈 섹션을 보여주지 않는다 (관리자는 항상 표시)
  const pendingHtml = (pendingCount() > 0 || isAdmin) ? `
    <div class="sidebar-section">
      <button type="button" id="sidebarPendingBtn" class="sidebar-group-btn">⏳ ${escapeHtml(t('sidebar_pending'))} <span class="sidebar-count">${pendingCount()}</span></button>
    </div>
  ` : '';
  const suggestHtml = currentUser ? `
    <div class="sidebar-section">
      <button type="button" id="suggestCategoryBtn" class="sidebar-cat-btn suggest-category-btn">＋ ${escapeHtml(t('suggest_category_button'))}</button>
    </div>
  ` : '';
  sidebar.innerHTML = pendingHtml + suggestHtml + SIDEBAR_GROUPS.map(g => `
    <div class="sidebar-section">
      <button type="button" class="sidebar-group-btn" data-content-type="${g.type}" data-category="">${g.icon} ${escapeHtml(t(g.labelKey))} <span class="sidebar-count">${sidebarCount(g.type, null)}</span></button>
      <ul class="sidebar-sublist">
        ${categoriesList
          .map(c => ({ c, count: sidebarCount(g.type, c.key) }))
          .filter(({ c, count }) => count > 0 || c.key === categoryFilter.value) // 빈 카테고리는 숨김 (채워지면 자동 등장)
          .map(({ c, count }) => `
          <li><button type="button" class="sidebar-cat-btn" data-content-type="${g.type}" data-category="${c.key}">${escapeHtml(categoryLabel(c.key))} <span class="sidebar-count">${count}</span></button></li>
        `).join('')}
      </ul>
    </div>
  `).join('');
  updateSidebarActiveState();
}

function updateSidebarActiveState() {
  const activeType = contentTypeFilter.value;
  const activeCategory = categoryFilter.value;
  sidebar.querySelectorAll('button[data-content-type]').forEach(btn => {
    const isGroupBtn = btn.classList.contains('sidebar-group-btn');
    const matches = !showPendingOnly && (isGroupBtn
      ? btn.dataset.contentType === activeType && activeCategory === ''
      : btn.dataset.contentType === activeType && btn.dataset.category === activeCategory);
    btn.classList.toggle('active', matches);
  });
  const pendingBtn = document.getElementById('sidebarPendingBtn');
  if (pendingBtn) pendingBtn.classList.toggle('active', showPendingOnly);
}

sidebar.addEventListener('click', async (e) => {
  if (e.target.closest('#suggestCategoryBtn')) {
    if (!currentUser) return;
    const suggestion = prompt(t('suggest_category_prompt'));
    if (!suggestion || suggestion.trim().length < 2) return;
    const { error } = await sb.from('category_suggestions').insert({
      suggestion: suggestion.trim().slice(0, 40),
      suggested_by: currentUser.id,
    });
    alert(error ? t('suggest_failed', { message: error.message }) : t('suggest_thanks'));
    return;
  }
  if (e.target.closest('#sidebarPendingBtn')) {
    showPendingOnly = true;
    updateSidebarActiveState();
    render(currentFiltered());
    return;
  }
  const btn = e.target.closest('button[data-content-type]');
  if (!btn) return;
  showPendingOnly = false;
  contentTypeFilter.value = btn.dataset.contentType;
  categoryFilter.value = btn.dataset.category || '';
  syncUrlFromFilters();
  updateSidebarActiveState();
  render(currentFiltered());
});

async function loadUnlockedVideos() {
  if (!currentUser) {
    unlockedVideos = new Set();
    return;
  }
  const { data, error } = await sb.from('unlocked_videos').select('video_id').eq('user_id', currentUser.id);
  if (!error && data) unlockedVideos = new Set(data.map(d => d.video_id));
}

async function refreshQuotaInfo() {
  if (!VIEW_GATING_ENABLED || !currentUser) {
    quotaInfo.hidden = true;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: viewLogRow }, { data: profileRow }] = await Promise.all([
    sb.from('view_log').select('view_count').eq('user_id', currentUser.id).eq('view_date', today).maybeSingle(),
    sb.from('profiles').select('bonus_credits').eq('id', currentUser.id).maybeSingle(),
  ]);
  const remaining = Math.max(0, 5 - (viewLogRow?.view_count || 0));
  const credits = profileRow?.bonus_credits || 0;
  quotaInfo.textContent = t('quota_status', { remaining, credits });
  quotaInfo.hidden = false;
}

function populateCountryFilter() {
  const countries = [...new Set(streams.map(s => s.country).filter(Boolean))].sort();
  const current = countryFilter.value;
  countryFilter.innerHTML = `<option value="">${t('filter_all')}</option>` +
    countries.map(c => `<option value="${c}">${escapeHtml(countryDisplayName(c))}</option>`).join('');
  countryFilter.value = countries.includes(current) ? current : '';
}

async function loadStreams() {
  selectedForDelete.clear();
  channelGroupsFullySelected.clear();
  updateBulkActionBar();
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
  await loadSubmitterNames(streams);
  await loadCommentCounts();
  populateCountryFilter();
  renderSidebar();
  render(currentFiltered());
}

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  await Promise.all([loadFavorites(), loadUnlockedVideos(), checkAdmin(), loadMyProfile(), loadMyVotes()]);
  renderAuthArea();
  await refreshQuotaInfo();
  loadCheers();
  render(currentFiltered());
});

langSelect.addEventListener('change', () => {
  setLang(langSelect.value);
  applyStaticTranslations();
  renderAuthArea();
  populateCategoryFilter();
  refreshQuotaInfo();
  loadStreams();
});

// ===== 응원 한마디 (게스트/유저 공용) =====
const cheerList = document.getElementById('cheerList');
const cheerForm = document.getElementById('cheerForm');
const cheerInput = document.getElementById('cheerInput');

async function loadCheers() {
  if (!cheerList) return;
  const { data, error } = await sb
    .from('cheers')
    .select('id, name, content, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error || !data) return;
  cheerList.innerHTML = data.map(c => `
    <span class="cheer-chip" data-cheer-id="${c.id}">
      <b>${escapeHtml(c.name || t('anonymous'))}</b> ${escapeHtml(c.content)}
      ${isAdmin ? `<button type="button" class="cheer-delete-btn" data-cheer-id="${c.id}" title="delete">✕</button>` : ''}
    </span>
  `).join('') || `<span class="cheer-empty">${escapeHtml(t('cheer_empty'))}</span>`;
}

cheerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = cheerInput.value.trim();
  if (!content) return;
  const name = currentUser ? (myDisplayName || currentUser.user_metadata?.full_name || null) : null;
  const { error } = await sb.from('cheers').insert({ content, name, user_id: currentUser?.id || null });
  if (!error) {
    cheerInput.value = '';
    loadCheers();
  }
});

cheerList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.cheer-delete-btn');
  if (!btn || !isAdmin) return;
  await sb.from('cheers').delete().eq('id', btn.dataset.cheerId);
  loadCheers();
});

// ===== 체류시간 측정 (관리자 통계용) — 탭이 가려지거나 닫힐 때 머문 시간을 기록 =====
let visitSegmentStart = Date.now();

function sendVisitDuration() {
  const seconds = Math.round((Date.now() - visitSegmentStart) / 1000);
  visitSegmentStart = Date.now();
  if (seconds < 3 || seconds > 43200) return;
  const visitorKey = localStorage.getItem('visitorKey');
  if (!visitorKey) return;
  // pagehide 이후에도 전송되도록 keepalive fetch 사용 (sendBeacon은 인증 헤더를 못 실음)
  fetch(`${SUPABASE_URL}/rest/v1/visit_durations`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ visitor_key: visitorKey, seconds }),
  }).catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sendVisitDuration();
  else visitSegmentStart = Date.now();
});
window.addEventListener('pagehide', sendVisitDuration);

async function trackVisit() {
  let visitorKey = localStorage.getItem('visitorKey');
  if (!visitorKey) {
    visitorKey = crypto.randomUUID();
    localStorage.setItem('visitorKey', visitorKey);
  }
  // "오늘"의 기준은 한국 자정 (UTC 기준이면 KST 09:00에 리셋되어 헷갈림)
  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  await sb.from('visit_log').insert({ visit_date: todayKst, visitor_key: visitorKey });
  // 같은 날 중복 방문 시 유니크 제약 위반 에러가 나는데, 의도된 동작이라 무시한다.
}

async function loadVisitStats() {
  const { data, error } = await sb.from('visit_stats').select('*').maybeSingle();
  if (error || !data) return;
  visitorStatsEl.textContent = t('visitor_stats', { today: data.today_count, total: data.total_count });
}

async function init() {
  langSelect.value = currentLang;
  applyStaticTranslations();
  applyViewMode();
  applyPreviewMode();

  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  await loadCategories();
  populateCategoryFilter();
  applyFiltersFromUrl(); // 딥링크(?category=... 등)로 들어온 경우 필터 상태 복원
  await Promise.all([loadFavorites(), loadUnlockedVideos(), checkAdmin(), loadMyProfile(), loadMyVotes()]);
  renderAuthArea();
  await refreshQuotaInfo();
  await trackVisit();
  await loadVisitStats();
  loadCheers();
  await loadStreams();
}

init();
