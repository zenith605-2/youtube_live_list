const SUPABASE_URL = 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const accountLoggedOut = document.getElementById('accountLoggedOut');
const accountContent = document.getElementById('accountContent');
const accountEmail = document.getElementById('accountEmail');
const accountNickname = document.getElementById('accountNickname');
const accountEditNicknameBtn = document.getElementById('accountEditNicknameBtn');
const accountDeleteBtn = document.getElementById('accountDeleteBtn');
const accountFavoritesCount = document.getElementById('accountFavoritesCount');
const favoritesList = document.getElementById('favoritesList');
const exportXlsxBtn = document.getElementById('exportXlsxBtn');
const exportTxtBtn = document.getElementById('exportTxtBtn');
const accountTab = document.getElementById('accountTab');
const adminTab = document.getElementById('adminTab');
const adminTabBtn = document.getElementById('adminTabBtn');
const adminFlaggedList = document.getElementById('adminFlaggedList');
const adminUserList = document.getElementById('adminUserList');

// 탭 전환: '내 계정' / '관리자'
document.querySelectorAll('.account-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.account-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    const tab = btn.dataset.tab;
    accountTab.hidden = tab !== 'account';
    adminTab.hidden = tab !== 'admin';
  });
});

let currentUser = null;
let isAdmin = false;

// ===== 관리자 테이블 공용: 엑셀식 열 필터 + 50개 단위 페이지네이션 =====
// 헤더 아래에 필터 행을 삽입한다. 열의 고유값이 적으면(≤12) 드롭다운, 많으면 검색 입력.
// 빈 헤더(버튼 열)는 필터 없음. 필터 통과분을 50개씩 나눠 보여주고 아래에 ◀ 1/N ▶ 페이저.
// 테이블은 리로드 때마다 다시 그려지므로 매번 호출한다.
function enhanceAdminTable(container) {
  const table = container.querySelector('.admin-table');
  if (!table) return;
  const headRow = table.querySelector('thead tr');
  const bodyRows = [...table.querySelectorAll('tbody tr')];
  if (!headRow || bodyRows.length < 2) return; // 1행이면 필터 무의미

  const colCount = headRow.children.length;
  const PAGE_SIZE = 10;
  // 삭제 등으로 표를 다시 그려도 보던 페이지가 유지되도록 컨테이너에 기억해둔다
  // (innerHTML을 갈아끼워도 컨테이너 자신의 dataset은 남는다)
  let page = Number(container.dataset.adminPage) || 0;
  const filterRow = document.createElement('tr');
  filterRow.className = 'admin-filter-row';
  const controls = []; // 열별 필터 컨트롤 (없으면 null)

  const pager = document.createElement('div');
  pager.className = 'admin-pager';
  container.appendChild(pager);
  pager.addEventListener('click', (e) => {
    const b = e.target.closest('.pager-btn');
    if (!b || b.disabled) return;
    page += Number(b.dataset.nav);
    applyView();
  });

  // 셀의 필터용 텍스트: 드롭다운은 "선택된 옵션", 조건 칩은 "켜진 칩"만 읽는다
  // (select.textContent는 모든 옵션이 합쳐져 나오고, 칩 셀은 꺼진 칩까지 섞이므로 그대로 쓰면 필터가 깨진다)
  const cellText = (cell) => {
    if (!cell) return '';
    const sel = cell.querySelector('select');
    if (sel) return (sel.options[sel.selectedIndex]?.textContent || '').trim();
    if (cell.querySelector('.ailog-tag-chip')) {
      return [...cell.querySelectorAll('.ailog-tag-chip.on')].map(c => c.textContent.trim()).join(', ');
    }
    return (cell.textContent || '').trim();
  };

  const matchRow = (row) => {
    for (let i = 0; i < colCount; i++) {
      const ctrl = controls[i];
      if (!ctrl || !ctrl.value) continue;
      const cell = cellText(row.children[i]);
      if (ctrl.tagName === 'SELECT' ? cell !== ctrl.value : !cell.toLowerCase().includes(ctrl.value.toLowerCase())) return false;
    }
    return true;
  };

  const applyView = () => {
    const matching = bodyRows.filter(matchRow);
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    if (page >= pages) page = pages - 1;
    if (page < 0) page = 0;
    container.dataset.adminPage = page; // 다시 그릴 때 복원용
    const shown = new Set(matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
    for (const row of bodyRows) row.hidden = !shown.has(row);
    pager.hidden = pages <= 1;
    pager.innerHTML = `
      <button type="button" class="pager-btn" data-nav="-1" ${page === 0 ? 'disabled' : ''}>◀</button>
      <span class="pager-info">${page + 1} / ${pages} · ${matching.length}</span>
      <button type="button" class="pager-btn" data-nav="1" ${page === pages - 1 ? 'disabled' : ''}>▶</button>`;
  };

  const applyFilters = () => { page = 0; applyView(); }; // 필터 바뀌면 1페이지로

  for (let i = 0; i < colCount; i++) {
    const th = document.createElement('th');
    const label = headRow.children[i].textContent.trim();
    // 빈 헤더(썸네일·액션)와 행번호(#) 열은 필터를 만들지 않음
    if (!label || label === '#') { controls.push(null); filterRow.appendChild(th); continue; }

    const values = [...new Set(bodyRows.map(r => cellText(r.children[i])))].filter(Boolean);
    if (!values.length) { controls.push(null); filterRow.appendChild(th); continue; } // 텍스트 없는 열(썸네일 등)은 필터 생략
    let ctrl;
    if (values.length <= 12) {
      ctrl = document.createElement('select');
      const all = document.createElement('option');
      all.value = '';
      all.textContent = t('admin_filter_all');
      ctrl.appendChild(all);
      for (const v of values.sort((a, b) => a.localeCompare(b))) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v.length > 28 ? v.slice(0, 27) + '…' : v;
        ctrl.appendChild(opt);
      }
      ctrl.addEventListener('change', applyFilters);
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'search';
      ctrl.placeholder = '🔍';
      ctrl.addEventListener('input', applyFilters);
    }
    ctrl.className = 'admin-filter-ctrl';
    controls.push(ctrl);
    th.appendChild(ctrl);
    filterRow.appendChild(th);
  }
  headRow.parentElement.appendChild(filterRow);
  applyView(); // 초기 페이징 적용 (50개 초과분 숨김 + 페이저 표시)
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function checkAdmin() {
  if (!currentUser) {
    isAdmin = false;
    return;
  }
  const { data } = await sb.from('profiles').select('is_admin').eq('id', currentUser.id).maybeSingle();
  isAdmin = !!data?.is_admin;
}

function flaggedRowHtml(r) {
  return `
    <tr class="admin-row" data-video-id="${escapeHtml(r.video_id)}" data-visibility="${r.visibility}">
      <td class="admin-td-thumb"><img class="admin-thumb-sm" src="https://i.ytimg.com/vi/${encodeURIComponent(r.video_id)}/mqdefault.jpg" alt="" loading="lazy"></td>
      <td class="admin-td-title">
        <a href="#" class="panel-play-link" data-video-id="${escapeHtml(r.video_id)}" data-title="${escapeHtml((r.title || '').slice(0, 80))}">${escapeHtml((r.title || r.video_id).slice(0, 60))}</a>
      </td>
      <td>${escapeHtml(r.channel_title || t('admin_no_info'))}</td>
      <td>👎 ${r.downvote_count || 0}</td>
      <td>${r.visibility === 'hidden' ? t('admin_status_hidden') : t('admin_status_listed')}</td>
      <td class="admin-td-actions">
        <button type="button" class="toggle-visibility-btn">${r.visibility === 'hidden' ? t('admin_show_button') : t('admin_hide_button')}</button>
        <button type="button" class="delete-btn">${t('admin_delete_button')}</button>
      </td>
    </tr>
  `;
}

async function loadFlagged() {
  adminFlaggedList.textContent = t('loading');
  const { data, error } = await sb
    .from('streams')
    .select('*')
    .or('visibility.eq.hidden,downvote_count.gt.0')
    .order('downvote_count', { ascending: false });

  if (error) {
    adminFlaggedList.textContent = t('admin_flagged_load_failed', { message: error.message });
    return;
  }
  if (!data || data.length === 0) {
    adminFlaggedList.textContent = t('admin_flagged_empty');
    return;
  }
  adminFlaggedList.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th>${escapeHtml(t('account_export_thumbnail_label'))}</th>
        <th>${escapeHtml(t('admin_col_title'))}</th>
        <th>${escapeHtml(t('admin_col_channel'))}</th>
        <th>👎</th>
        <th>${escapeHtml(t('admin_col_status'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${data.map(flaggedRowHtml).join('')}</tbody>
    </table></div>`;
  enhanceAdminTable(adminFlaggedList);
}

adminFlaggedList.addEventListener('click', async (e) => {
  // 제목 클릭은 유튜브로 나가지 않고 오른쪽 프리뷰 패널에서 재생
  const play = e.target.closest('.panel-play-link');
  if (play) {
    e.preventDefault();
    openVideoPanel(play.dataset.videoId, play.dataset.title);
    return;
  }
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const videoId = row.dataset.videoId;

  if (e.target.closest('.toggle-visibility-btn')) {
    const next = row.dataset.visibility === 'hidden' ? 'listed' : 'hidden';
    const { error } = await sb.from('streams').update({ visibility: next }).eq('video_id', videoId);
    if (error) {
      alert(t('admin_action_failed', { message: error.message }));
      return;
    }
    await loadFlagged();
  }

  if (e.target.closest('.delete-btn')) {
    if (!confirm(t('admin_delete_confirm'))) return;
    // 삭제 전에 채널·제목을 읽어둔다 — 라이브 재시작(새 videoId) 재수집 차단용 (sql/058)
    const { data: row2 } = await sb.from('streams').select('channel_id,title').eq('video_id', videoId).maybeSingle();
    const { error } = await sb.from('streams').delete().eq('video_id', videoId);
    if (error) {
      alert(t('admin_delete_failed', { message: error.message }));
      return;
    }
    await sb.from('blocklist').insert({
      video_id: videoId, blocked_by: currentUser.id,
      channel_id: row2?.channel_id || null, title: row2?.title || null,
    });
    await loadFlagged();
  }
});

// ===== 차단목록 (삭제 시 등록된 영상/채널 — 자정 수집에서 영구 제외) =====
const adminBlocklist = document.getElementById('adminBlocklist');
const adminBlockedChannels = document.getElementById('adminBlockedChannels');

async function loadBlocklist() {
  if (!adminBlocklist) return;
  const [{ data: vids, error: vErr }, { data: chans, error: cErr }] = await Promise.all([
    sb.from('blocklist').select('video_id, created_at').order('created_at', { ascending: false }).limit(2000),
    sb.from('blocked_channels').select('channel_id, created_at').order('created_at', { ascending: false }).limit(500),
  ]);
  const fmtDate = (ts) => new Date(ts).toLocaleDateString();

  if (vErr) adminBlocklist.textContent = vErr.message;
  else if (!vids?.length) adminBlocklist.innerHTML = `<p class="empty-state">${escapeHtml(t('admin_blocklist_empty'))}</p>`;
  else {
    adminBlocklist.innerHTML = `
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr>
          <th>#</th>
          <th>${escapeHtml(t('account_export_thumbnail_label'))}</th>
          <th>${escapeHtml(t('admin_col_title'))}</th>
          <th>${escapeHtml(t('admin_col_date'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${vids.map((r, i) => `
          <tr class="admin-row">
            <td class="admin-td-num">${i + 1}</td>
            <td class="admin-td-thumb"><img class="admin-thumb-sm" src="https://i.ytimg.com/vi/${encodeURIComponent(r.video_id)}/mqdefault.jpg" alt="" loading="lazy"></td>
            <td class="admin-td-title"><a href="#" class="panel-play-link" data-video-id="${escapeHtml(r.video_id)}" data-title="${escapeHtml(r.video_id)}">${escapeHtml(r.video_id)}</a></td>
            <td class="admin-td-date">${fmtDate(r.created_at)}</td>
            <td><button type="button" class="unblock-btn" data-video-id="${escapeHtml(r.video_id)}">${escapeHtml(t('admin_unblock_button'))}</button></td>
          </tr>`).join('')}</tbody>
      </table></div>`;
    enhanceAdminTable(adminBlocklist);
  }

  if (!adminBlockedChannels) return;
  if (cErr) adminBlockedChannels.textContent = cErr.message;
  else if (!chans?.length) adminBlockedChannels.innerHTML = `<p class="empty-state">${escapeHtml(t('admin_blocklist_empty'))}</p>`;
  else {
    adminBlockedChannels.innerHTML = `
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr>
          <th>#</th>
          <th>${escapeHtml(t('admin_col_channel'))}</th>
          <th>${escapeHtml(t('admin_col_date'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${chans.map((r, i) => `
          <tr class="admin-row">
            <td class="admin-td-num">${i + 1}</td>
            <td class="admin-td-title"><a href="https://www.youtube.com/channel/${encodeURIComponent(r.channel_id)}" target="_blank" rel="noopener">${escapeHtml(r.channel_id)}</a></td>
            <td class="admin-td-date">${fmtDate(r.created_at)}</td>
            <td><button type="button" class="unblock-chan-btn" data-channel-id="${escapeHtml(r.channel_id)}">${escapeHtml(t('admin_unblock_button'))}</button></td>
          </tr>`).join('')}</tbody>
      </table></div>`;
    enhanceAdminTable(adminBlockedChannels);
  }
}

adminBlocklist?.addEventListener('click', async (e) => {
  const play = e.target.closest('.panel-play-link');
  if (play) {
    e.preventDefault();
    openVideoPanel(play.dataset.videoId, play.dataset.title);
    return;
  }
  const btn = e.target.closest('.unblock-btn');
  if (!btn) return;
  btn.disabled = true;
  const { error } = await sb.from('blocklist').delete().eq('video_id', btn.dataset.videoId);
  if (error) { alert(error.message); btn.disabled = false; return; }
  await loadBlocklist();
});

adminBlockedChannels?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.unblock-chan-btn');
  if (!btn) return;
  btn.disabled = true;
  const { error } = await sb.from('blocked_channels').delete().eq('channel_id', btn.dataset.channelId);
  if (error) { alert(error.message); btn.disabled = false; return; }
  await loadBlocklist();
});

function userRowHtml(u) {
  return `
    <tr class="admin-row" data-user-id="${escapeHtml(u.id)}" data-is-admin="${u.is_admin}">
      <td class="admin-td-title"><img class="admin-avatar-sm" src="${u.avatar_url || ''}" alt=""> ${escapeHtml(u.display_name || t('admin_no_nickname'))}</td>
      <td>${u.submissionCount}</td>
      <td>${u.catEditCount}</td>
      <td>${u.condEditCount}</td>
      <td class="admin-td-date">${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${u.is_admin ? t('admin_role_admin') : t('admin_role_user')}</td>
      <td><button type="button" class="toggle-admin-btn">${u.is_admin ? t('admin_revoke_button') : t('admin_promote_button')}</button></td>
    </tr>
  `;
}

async function loadUsers() {
  adminUserList.textContent = t('loading');
  const [
    { data: profiles, error: profileErr },
    { data: submissions, error: subErr },
    { data: catChanges },
    { data: tagChanges },
  ] = await Promise.all([
    sb.from('profiles').select('id, display_name, avatar_url, is_admin, created_at').order('created_at'),
    sb.from('streams').select('added_by').not('added_by', 'is', null),
    sb.from('category_changes').select('changed_by').not('changed_by', 'is', null),
    sb.from('tag_changes').select('changed_by').not('changed_by', 'is', null),
  ]);
  if (profileErr) {
    adminUserList.textContent = t('admin_users_load_failed', { message: profileErr.message });
    return;
  }
  const tally = (rowsArr, key) => {
    const m = new Map();
    for (const row of rowsArr || []) m.set(row[key], (m.get(row[key]) || 0) + 1);
    return m;
  };
  const counts = subErr ? new Map() : tally(submissions, 'added_by');
  const catCounts = tally(catChanges, 'changed_by'); // 카테고리 수정 횟수
  const tagCounts = tally(tagChanges, 'changed_by');  // 조건(태그) 수정 횟수
  const rows = (profiles || []).map(u => ({
    ...u,
    submissionCount: counts.get(u.id) || 0,
    catEditCount: catCounts.get(u.id) || 0,
    condEditCount: tagCounts.get(u.id) || 0,
  }));
  if (!rows.length) {
    adminUserList.textContent = t('admin_users_empty');
    return;
  }
  adminUserList.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th>${escapeHtml(t('admin_col_user'))}</th>
        <th>${escapeHtml(t('admin_col_submissions'))}</th>
        <th>${escapeHtml(t('admin_col_cat_edits'))}</th>
        <th>${escapeHtml(t('admin_col_cond_edits'))}</th>
        <th>${escapeHtml(t('admin_col_joined'))}</th>
        <th>${escapeHtml(t('admin_col_role'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${rows.map(userRowHtml).join('')}</tbody>
    </table></div>`;
  enhanceAdminTable(adminUserList);
}

adminUserList.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row || !e.target.closest('.toggle-admin-btn')) return;
  const userId = row.dataset.userId;
  const nextIsAdmin = row.dataset.isAdmin !== 'true';
  if (!confirm(nextIsAdmin ? t('admin_promote_confirm') : t('admin_revoke_confirm'))) return;
  const { error } = await sb.rpc('set_user_admin', { p_user_id: userId, p_is_admin: nextIsAdmin });
  if (error) {
    alert(t('admin_action_failed', { message: error.message }));
    return;
  }
  await loadUsers();
});

// 조건 태그 라벨: 기본 태그는 i18n 번역, 유저 제안 태그는 condition_tags의 라벨 사용
let conditionTagLabels = null;
async function getTagLabelMap() {
  if (conditionTagLabels) return conditionTagLabels;
  const { data } = await sb.from('condition_tags').select('key, label');
  conditionTagLabels = new Map((data || []).map(r => [r.key, r.label]));
  return conditionTagLabels;
}

async function loadMyFavorites() {
  const { data: favRows, error: favErr } = await sb
    .from('favorites')
    .select('video_id, note')
    .eq('user_id', currentUser.id);
  if (favErr || !favRows.length) return [];

  const videoIds = favRows.map(f => f.video_id);
  const [{ data: streamRows }, tagMap] = await Promise.all([
    sb.from('streams')
      .select('video_id, title, channel_title, thumbnail, content_type, tags')
      .in('video_id', videoIds),
    getTagLabelMap(),
  ]);
  const streamMap = new Map((streamRows || []).map(s => [s.video_id, s]));

  const labelOf = (key) => {
    const i18nKey = `tag_${key}`;
    const v = t(i18nKey);
    return v !== i18nKey ? v : (tagMap.get(key) || key);
  };

  return favRows.map(f => {
    const s = streamMap.get(f.video_id) || {};
    return {
      videoId: f.video_id,
      title: s.title || '',
      channel: s.channel_title || '',
      contentType: s.content_type || 'live',
      url: `https://www.youtube.com/watch?v=${f.video_id}`,
      thumbnail: s.thumbnail || `https://i.ytimg.com/vi/${f.video_id}/hqdefault.jpg`,
      note: f.note || '',
      conditions: (s.tags || []).map(labelOf).join(', '),
    };
  });
}

function favoriteRowHtml(item, index) {
  return `
    <tr class="admin-row" data-video-id="${escapeHtml(item.videoId)}">
      <td class="admin-td-num">${index + 1}</td>
      <td class="admin-td-thumb"><img class="admin-thumb-sm" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy"></td>
      <td class="admin-td-title"><a href="#" class="panel-play-link" data-video-id="${escapeHtml(item.videoId)}">${escapeHtml((item.title || item.videoId).slice(0, 60))}</a></td>
      <td>${escapeHtml(item.channel)}</td>
      <td>${item.contentType === 'live' ? t('content_type_live') : t('content_type_video')}</td>
      <td>${escapeHtml(item.conditions)}</td>
      <td class="admin-td-reason">${escapeHtml(item.note)}</td>
      <td><button type="button" class="favorite-remove-btn" data-video-id="${escapeHtml(item.videoId)}">${t('account_favorite_remove_button')}</button></td>
    </tr>
  `;
}

async function refreshFavoritesSection() {
  const { count } = await sb.from('favorites').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
  const items = await loadMyFavorites();
  const liveCount = items.filter(i => i.contentType === 'live').length;
  const videoCount = items.filter(i => i.contentType === 'video').length;
  accountFavoritesCount.textContent = t('account_favorites_count_breakdown', { n: count || 0, live: liveCount, video: videoCount });
  if (!items.length) {
    favoritesList.innerHTML = `<p class="empty-state">${escapeHtml(t('account_export_empty'))}</p>`;
    return;
  }
  favoritesList.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th>#</th>
        <th>${escapeHtml(t('account_export_thumbnail_label'))}</th>
        <th>${escapeHtml(t('admin_col_title'))}</th>
        <th>${escapeHtml(t('admin_col_channel'))}</th>
        <th>${escapeHtml(t('filter_type'))}</th>
        <th>${escapeHtml(t('account_export_conditions_label'))}</th>
        <th>${escapeHtml(t('account_export_note_label'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${items.map(favoriteRowHtml).join('')}</tbody>
    </table></div>`;
  enhanceAdminTable(favoritesList);
}

favoritesList.addEventListener('click', async (e) => {
  const play = e.target.closest('.panel-play-link');
  if (play) {
    e.preventDefault();
    openVideoPanel(play.dataset.videoId);
    return;
  }
  const btn = e.target.closest('.favorite-remove-btn');
  if (!btn) return;
  const videoId = btn.dataset.videoId;
  btn.disabled = true;
  const { error } = await sb.from('favorites').delete().eq('user_id', currentUser.id).eq('video_id', videoId);
  if (error) {
    alert(t('admin_action_failed', { message: error.message }));
    btn.disabled = false;
    return;
  }
  await refreshFavoritesSection();
});

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildTxt(items) {
  return items
    .map((i, idx) => `${idx + 1}. ${i.title}\n${t('account_export_channel_label')}: ${i.channel}${i.conditions ? `\n${t('account_export_conditions_label')}: ${i.conditions}` : ''}\n${t('account_export_url_label')}: ${i.url}\n${t('account_export_thumbnail_label')}: ${i.thumbnail}${i.note ? `\n${t('account_export_note_label')}: ${i.note}` : ''}`)
    .join('\n\n---\n\n');
}

function buildAndDownloadXlsx(items) {
  const header = ['No.', 'Thumbnail', 'Title', 'Channel', 'Conditions', 'YouTube URL', 'Thumbnail URL', 'Note'];
  const rows = items.map((i, idx) => [idx + 1, '', i.title, i.channel, i.conditions, i.url, i.thumbnail, i.note]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  rows.forEach((_row, i) => {
    const rowNum = i + 2;
    // 썸네일 칸: =IMAGE() 수식으로 셀 안에 이미지 렌더링 (Microsoft 365/웹 엑셀 기준.
    // 이미지 바이트를 직접 심는 건 유튜브 이미지 서버의 CORS 제한 때문에 브라우저에선 불가)
    ws[`B${rowNum}`] = { t: 'n', f: `_xlfn.IMAGE("${items[i].thumbnail.replace(/"/g, '')}")` };
    // 유튜브/썸네일 URL 칸은 클릭 가능한 링크로
    if (ws[`F${rowNum}`]) ws[`F${rowNum}`].l = { Target: items[i].url };
    if (ws[`G${rowNum}`]) ws[`G${rowNum}`].l = { Target: items[i].thumbnail };
  });
  ws['!cols'] = [{ wch: 5 }, { wch: 22 }, { wch: 50 }, { wch: 25 }, { wch: 25 }, { wch: 45 }, { wch: 45 }, { wch: 30 }];
  // 이미지가 보이도록 데이터 행 높이를 키운다
  ws['!rows'] = [{ hpx: 20 }, ...rows.map(() => ({ hpx: 80 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Favorites');
  XLSX.writeFile(wb, 'favorites.xlsx');
}

exportXlsxBtn.addEventListener('click', async () => {
  const items = await loadMyFavorites();
  if (!items.length) {
    alert(t('account_export_empty'));
    return;
  }
  buildAndDownloadXlsx(items);
});

exportTxtBtn.addEventListener('click', async () => {
  const items = await loadMyFavorites();
  if (!items.length) {
    alert(t('account_export_empty'));
    return;
  }
  downloadFile('favorites.txt', buildTxt(items), 'text/plain;charset=utf-8');
});

// ===== AI 검수 로그 (승인/거절제안 검토 + 확정삭제/복구) =====
const adminAiLog = document.getElementById('adminAiLog');
let aiLogVerdict = ''; // 기본: 전체 (탭 순서 = 전체 / 승인됨 / 거절 제안)
let aiLogDate = null;              // 'YYYY-MM-DD' — 달력에서 날짜 선택 시 그날 것만
let aiLogCalMonth = new Date();    // 달력에 표시 중인 월
let aiLogCounts = new Map();       // 'YYYY-MM-DD' -> 검수 건수 (달력 표시용)

function localDateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 날짜별 검수 건수를 모아 달력을 그린다 (최근 3000건이면 몇 달치 충분)
async function loadAiLogCalendar() {
  const { data } = await sb.from('ai_review_log')
    .select('reviewed_at')
    .order('reviewed_at', { ascending: false })
    .limit(3000);
  aiLogCounts = new Map();
  for (const r of data || []) {
    const k = localDateKey(r.reviewed_at);
    aiLogCounts.set(k, (aiLogCounts.get(k) || 0) + 1);
  }
  renderAiLogCalendar();
}

function renderAiLogCalendar() {
  const el = document.getElementById('aiLogCalendar');
  if (!el) return;
  const y = aiLogCalMonth.getFullYear();
  const m = aiLogCalMonth.getMonth();
  const startDow = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const loc = currentLang === 'ko' ? 'ko-KR' : undefined;
  const monthLabel = new Date(y, m, 1).toLocaleString(loc, { year: 'numeric', month: 'long' });
  // 2023-01-01은 일요일 — 요일 이름 로컬라이즈용 기준일
  const wd = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + i).toLocaleString(loc, { weekday: 'narrow' }));
  let html = `<div class="cal-head">
    <button type="button" class="cal-nav" data-nav="-1">◀</button>
    <span class="cal-title">${escapeHtml(monthLabel)}</span>
    <button type="button" class="cal-nav" data-nav="1">▶</button>
    <button type="button" class="cal-clear${aiLogDate ? '' : ' active'}">${escapeHtml(t('admin_filter_all'))}</button>
  </div><div class="cal-grid">`;
  html += wd.map(w => `<span class="cal-wd">${escapeHtml(w)}</span>`).join('');
  for (let i = 0; i < startDow; i++) html += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = aiLogCounts.get(key) || 0;
    html += `<button type="button" class="cal-day${n ? ' has' : ''}${aiLogDate === key ? ' active' : ''}" data-date="${key}" ${n ? '' : 'disabled'}>${d}${n ? `<i>${n}</i>` : ''}</button>`;
  }
  el.innerHTML = html + '</div>';
}

document.getElementById('aiLogCalendar')?.addEventListener('click', (e) => {
  const nav = e.target.closest('.cal-nav');
  if (nav) {
    aiLogCalMonth = new Date(aiLogCalMonth.getFullYear(), aiLogCalMonth.getMonth() + Number(nav.dataset.nav), 1);
    renderAiLogCalendar();
    return;
  }
  if (e.target.closest('.cal-clear')) {
    aiLogDate = null;
    delete adminAiLog.dataset.adminPage; // 대상이 바뀌었으니 1페이지부터
    renderAiLogCalendar();
    loadAiLog();
    return;
  }
  const day = e.target.closest('.cal-day');
  if (day && !day.disabled) {
    aiLogDate = aiLogDate === day.dataset.date ? null : day.dataset.date; // 같은 날 재클릭 = 해제
    delete adminAiLog.dataset.adminPage; // 대상이 바뀌었으니 1페이지부터
    renderAiLogCalendar();
    loadAiLog();
  }
});

async function loadAiLog() {
  if (!adminAiLog) return;
  let query = sb.from('ai_review_log')
    .select('*')
    .order('reviewed_at', { ascending: false })
    .limit(500);
  if (aiLogVerdict) query = query.eq('verdict', aiLogVerdict);
  if (aiLogDate) {
    const start = new Date(`${aiLogDate}T00:00:00`); // 로컬 자정 기준
    const end = new Date(start.getTime() + 86400 * 1000);
    query = query.gte('reviewed_at', start.toISOString()).lt('reviewed_at', end.toISOString());
  }
  const { data, error } = await query;
  if (error) { adminAiLog.textContent = error.message; return; }
  if (!data?.length) { adminAiLog.textContent = t('admin_ailog_empty'); return; }

  // AI가 반영한 카테고리/조건(스트림 현재 값)을 함께 보여주고 바로 수정할 수 있게 조인
  const aiIds = [...new Set(data.map(r => r.video_id))];
  const [{ data: aiStreamRows }, aiCatMap, aiTagMap] = await Promise.all([
    sb.from('streams').select('video_id, category, tags, content_type, country').in('video_id', aiIds),
    getCategoryLabelMap(),
    getTagLabelMap(),
  ]);
  const aiStreamMap = new Map((aiStreamRows || []).map(s => [s.video_id, s]));

  const catEditCell = (r) => {
    const s = aiStreamMap.get(r.video_id);
    if (!s) return '<span class="admin-meta">–</span>'; // 삭제된 영상
    const opts = [...aiCatMap.entries()]
      .map(([k, v]) => `<option value="${escapeHtml(k)}" ${s.category === k ? 'selected' : ''}>${escapeHtml(v.icon)} ${escapeHtml(v.label)}</option>`)
      .join('');
    return `<select class="ailog-cat-select" data-video-id="${escapeHtml(r.video_id)}">${opts}</select>`;
  };
  const condCell = (r) => {
    const s = aiStreamMap.get(r.video_id);
    if (!s) return '<span class="admin-meta">–</span>'; // 삭제된 영상
    if (s.content_type !== 'video') return '<span class="admin-meta">–</span>'; // 라이브는 조건 태그 없음
    return `<div class="ailog-tags">${[...aiTagMap.entries()].map(([k, label]) =>
      `<span class="ailog-tag-chip ${(s.tags || []).includes(k) ? 'on' : ''}" data-video-id="${escapeHtml(r.video_id)}" data-tag="${escapeHtml(k)}">${escapeHtml(label)}</span>`).join('')}</div>`;
  };
  // 국가: AI가 판별해 스트림에 반영한 값 (클릭하면 select로 바뀌어 바로 수정 가능)
  const countryName = (code) => {
    try { return new Intl.DisplayNames([currentLang], { type: 'region' }).of(code) || code; } catch { return code; }
  };
  // 카테고리처럼 바로 드롭다운으로 보여준다. 다만 500행 × 200개국 옵션을 미리 만들면 무거우므로
  // 현재 값 하나만 넣어두고, 포커스될 때 전체 목록을 채운다(focusin 핸들러).
  const countryCell = (r) => {
    const s = aiStreamMap.get(r.video_id);
    if (!s) return '<span class="admin-meta">–</span>';
    const c = s.country || '';
    const label = c ? `${countryName(c)} (${c})` : '🌍 ?';
    return `<select class="ailog-cat-select ailog-country-select" data-video-id="${escapeHtml(r.video_id)}" data-country="${escapeHtml(c)}"><option value="${escapeHtml(c)}">${escapeHtml(label)}</option></select>`;
  };

  const bodyRows = data.map(r => {
    const badge = r.verdict === 'approve' ? '✅' : r.verdict === 'reject' ? '🚫' : '❓';
    // 거절 제안 + 아직 미처리인 것만 확정삭제/복구 버튼 노출
    // 스트림이 이미 사라진 행(다른 화면에서 삭제됨)은 처리할 게 없으므로 버튼 대신 상태만 표시
    const gone = !aiStreamMap.has(r.video_id);
    let actions = (r.verdict === 'reject' && r.resolution === 'pending' && !gone)
      ? `<button type="button" class="ailog-del-btn" data-video-id="${escapeHtml(r.video_id)}">${escapeHtml(t('admin_ailog_confirm_delete'))}</button>
         <button type="button" class="ailog-keep-btn" data-video-id="${escapeHtml(r.video_id)}">${escapeHtml(t('admin_ailog_restore'))}</button>`
      : (r.resolution !== 'pending' || gone
          ? `<span class="admin-meta">${escapeHtml(r.resolution === 'restored' ? t('admin_ailog_restored') : t('admin_ailog_deleted'))}</span>`
          : '');
    // 승인/기타 행에도 삭제 버튼 (스트림이 아직 있을 때만) — 삭제 시 차단목록 등록 포함
    if (!(r.verdict === 'reject' && r.resolution === 'pending') && aiStreamMap.has(r.video_id)) {
      actions += ` <button type="button" class="ailog-del2-btn" data-video-id="${escapeHtml(r.video_id)}">🗑 ${escapeHtml(t('admin_delete_button'))}</button>`;
    }
    // 거절제안 + 미처리 + 스트림이 남아 있는 행만 일괄 처리 대상
    const selectable = r.verdict === 'reject' && r.resolution === 'pending' && !gone;
    return `
      <tr class="admin-row">
        <td class="admin-td-check">${selectable ? `<input type="checkbox" class="ailog-check" data-video-id="${escapeHtml(r.video_id)}">` : ''}</td>
        <td>${badge}</td>
        <td class="admin-td-thumb"><img class="admin-thumb-sm" src="https://i.ytimg.com/vi/${encodeURIComponent(r.video_id)}/mqdefault.jpg" alt="" loading="lazy"></td>
        <td class="admin-td-title"><a href="#" class="panel-play-link" data-video-id="${escapeHtml(r.video_id)}" data-title="${escapeHtml((r.title || '').slice(0, 80))}">${escapeHtml((r.title || r.video_id).slice(0, 60))}</a></td>
        <td>${escapeHtml(r.channel_title || '')}</td>
        <td>${(() => { const s = aiStreamMap.get(r.video_id); return s ? (s.content_type === 'live' ? t('content_type_live') : t('content_type_video')) : '<span class="admin-meta">–</span>'; })()}</td>
        <td class="admin-td-cat">${catEditCell(r)}</td>
        <td class="admin-td-cond">${condCell(r)}</td>
        <td class="admin-td-country">${countryCell(r)}</td>
        <td class="admin-td-reason">${r.reason ? escapeHtml(r.reason) : ''}</td>
        <td class="admin-td-actions">${actions}</td>
      </tr>`;
  }).join('');
  // 현재 목록에 일괄 처리 가능한(거절제안·미처리) 행이 있으면 상단에 일괄 바를 붙인다
  const selectableCount = data.filter(r => r.verdict === 'reject' && r.resolution === 'pending' && aiStreamMap.has(r.video_id)).length;
  const bulkBar = selectableCount ? `
    <div class="ailog-bulk-bar">
      <label class="ailog-bulk-all"><input type="checkbox" id="ailogCheckAll"> ${escapeHtml(t('ailog_select_all'))}</label>
      <span id="ailogSelCount" class="admin-meta">${escapeHtml(t('bulk_selected_count', { n: 0 }))}</span>
      <button type="button" id="ailogBulkKeep" class="ailog-bulk-keep" disabled>${escapeHtml(t('ailog_bulk_keep'))}</button>
      <button type="button" id="ailogBulkDelete" class="ailog-bulk-del" disabled>${escapeHtml(t('ailog_bulk_delete'))}</button>
    </div>` : '';
  adminAiLog.innerHTML = bulkBar + `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th class="admin-td-check"></th>
        <th></th>
        <th>${escapeHtml(t('account_export_thumbnail_label'))}</th>
        <th>${escapeHtml(t('admin_col_title'))}</th>
        <th>${escapeHtml(t('admin_col_channel'))}</th>
        <th>${escapeHtml(t('filter_type'))}</th>
        <th>${escapeHtml(t('admin_col_category'))}</th>
        <th>${escapeHtml(t('admin_col_conditions'))}</th>
        <th>${escapeHtml(t('filter_country'))}</th>
        <th>${escapeHtml(t('admin_col_reason'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`;
  enhanceAdminTable(adminAiLog);
  syncAiLogBulkBar();
}

// 선택 개수에 따라 일괄 버튼 활성화 + "모두 선택" 체크 상태를 맞춘다.
// 페이지네이션으로 숨겨진 행도 체크는 유지되므로, 개수는 전체 기준으로 센다.
function syncAiLogBulkBar() {
  const boxes = [...adminAiLog.querySelectorAll('.ailog-check')];
  const checked = boxes.filter(b => b.checked);
  const count = document.getElementById('ailogSelCount');
  const keep = document.getElementById('ailogBulkKeep');
  const del = document.getElementById('ailogBulkDelete');
  const all = document.getElementById('ailogCheckAll');
  if (count) count.textContent = t('bulk_selected_count', { n: checked.length });
  if (keep) keep.disabled = checked.length === 0;
  if (del) del.disabled = checked.length === 0;
  if (all) all.checked = boxes.length > 0 && checked.length === boxes.length;
}

// 선택된 항목들을 순차 처리 (RPC가 건별이라 하나씩 — 진행 상황을 버튼에 표시)
async function aiLogBulkResolve(action) {
  const ids = [...adminAiLog.querySelectorAll('.ailog-check')].filter(b => b.checked).map(b => b.dataset.videoId);
  if (!ids.length) return;
  const isDelete = action === 'delete';
  if (!confirm(isDelete ? t('ailog_bulk_delete_confirm', { n: ids.length }) : t('ailog_bulk_keep_confirm', { n: ids.length }))) return;
  const btn = document.getElementById(isDelete ? 'ailogBulkDelete' : 'ailogBulkKeep');
  const other = document.getElementById(isDelete ? 'ailogBulkKeep' : 'ailogBulkDelete');
  btn.disabled = other.disabled = true;
  let done = 0, failed = 0;
  for (const id of ids) {
    const { error } = await sb.rpc('resolve_ai_rejection', { p_video_id: id, p_action: isDelete ? 'delete' : 'restore' });
    if (error) failed += 1;
    done += 1;
    btn.textContent = `${done}/${ids.length}…`;
  }
  if (failed) alert(t('ailog_bulk_failed', { n: failed }));
  await loadAiLog();
}

document.getElementById('adminAiLog')?.addEventListener('click', (e) => {
  if (e.target.closest('#ailogBulkKeep')) aiLogBulkResolve('keep');
  else if (e.target.closest('#ailogBulkDelete')) aiLogBulkResolve('delete');
});

adminAiLog?.addEventListener('change', (e) => {
  if (e.target.id === 'ailogCheckAll') {
    adminAiLog.querySelectorAll('.ailog-check').forEach(b => { b.checked = e.target.checked; });
    syncAiLogBulkBar();
  } else if (e.target.classList.contains('ailog-check')) {
    syncAiLogBulkBar();
  }
});

document.querySelectorAll('.ailog-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ailog-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    aiLogVerdict = tab.dataset.verdict;
    delete adminAiLog.dataset.adminPage; // 대상이 바뀌었으니 1페이지부터
    loadAiLog();
  });
});

// AI 로그에서 카테고리 즉시 수정 (set_stream_category RPC — 변경 이력에도 남음)
adminAiLog?.addEventListener('change', async (e) => {
  const countrySel = e.target.closest('.ailog-country-select');
  if (countrySel) {
    countrySel.disabled = true;
    const { error } = await sb.rpc('set_stream_country', { p_video_id: countrySel.dataset.videoId, p_country: countrySel.value || null });
    countrySel.disabled = false;
    if (error) { alert(error.message); return; }
    countrySel.classList.add('saved');
    setTimeout(() => countrySel.classList.remove('saved'), 1000);
    return;
  }
  const sel = e.target.closest('.ailog-cat-select');
  if (!sel) return;
  sel.disabled = true;
  const { error } = await sb.rpc('set_stream_category', { p_video_id: sel.dataset.videoId, p_category: sel.value });
  sel.disabled = false;
  if (error) alert(error.message);
  else { sel.classList.add('saved'); setTimeout(() => sel.classList.remove('saved'), 1000); }
});

// 국가 텍스트 클릭 → 그 자리에서 select로 전환 (행이 500개라 전 행에 select를 미리 만들면 무거워서 지연 생성)
const AILOG_CC = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GL GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PF PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TW TZ UA UG US UY UZ VC VE VN VU WS YE ZA ZM ZW'.split(' ');
// 국가 select에 포커스가 오면 그때 전체 국가 목록을 채운다 (행마다 미리 만들면 무거움)
adminAiLog?.addEventListener('focusin', (e) => {
  const sel = e.target.closest('.ailog-country-select');
  if (!sel || sel.dataset.filled) return;
  sel.dataset.filled = '1';
  sel.innerHTML = ailogCountryOptions(sel.dataset.country || '');
});

function ailogCountryOptions(current) {
  const name = (code) => {
    try { return new Intl.DisplayNames([currentLang], { type: 'region' }).of(code) || code; } catch { return code; }
  };
  const rows = AILOG_CC.map(c => [c, name(c)]).sort((a, b) => a[1].localeCompare(b[1], currentLang));
  return `<option value="">🌍 ?</option><option value="XX" ${current === 'XX' ? 'selected' : ''}>International</option>` +
    rows.map(([c, n]) => `<option value="${c}" ${current === c ? 'selected' : ''}>${escapeHtml(n)} (${c})</option>`).join('');
}

adminAiLog?.addEventListener('click', async (e) => {
  // 조건 태그 칩 토글 (일반 영상만) — 낙관적 갱신, 실패 시 되돌림
  const chip = e.target.closest('.ailog-tag-chip');
  if (chip) {
    const row = chip.closest('.ailog-tags');
    chip.classList.toggle('on');
    const next = [...row.querySelectorAll('.ailog-tag-chip.on')].map(c => c.dataset.tag);
    const { error } = await sb.rpc('set_stream_tags', { p_video_id: chip.dataset.videoId, p_tags: next });
    if (error) { chip.classList.toggle('on'); alert(error.message); }
    return;
  }
  const play = e.target.closest('.panel-play-link');
  if (play) {
    e.preventDefault();
    openVideoPanel(play.dataset.videoId, play.dataset.title);
    return;
  }
  // 일반 삭제 버튼 (승인된 행 등) — 차단목록 등록 후 삭제해 재수집 방지
  const del2 = e.target.closest('.ailog-del2-btn');
  if (del2) {
    if (!confirm(t('admin_delete_confirm'))) return;
    del2.disabled = true;
    // 채널·제목까지 기록해 같은 카메라의 재시작(새 videoId) 재수집도 막는다 (sql/058)
    const { data: row3 } = await sb.from('streams').select('channel_id,title').eq('video_id', del2.dataset.videoId).maybeSingle();
    await sb.from('blocklist').insert({
      video_id: del2.dataset.videoId, blocked_by: currentUser.id,
      channel_id: row3?.channel_id || null, title: row3?.title || null,
    });
    const { error } = await sb.from('streams').delete().eq('video_id', del2.dataset.videoId);
    if (error) { alert(error.message); del2.disabled = false; return; }
    await loadAiLog();
    return;
  }
  const del = e.target.closest('.ailog-del-btn');
  const keep = e.target.closest('.ailog-keep-btn');
  if (!del && !keep) return;
  const videoId = (del || keep).dataset.videoId;
  // 삭제는 이제 차단목록 등록까지 겸하는 영구 폐기이므로 실수 방지 확인
  if (del && !confirm(t('admin_ailog_delete_confirm'))) return;
  const { error } = await sb.rpc('resolve_ai_rejection', {
    p_video_id: videoId,
    p_action: del ? 'delete' : 'restore',
  });
  if (error) alert(error.message);
  await loadAiLog();
});

// ===== 내 제보 이력 (submission_log — RLS로 본인 것만 조회됨) =====
async function loadMySubmissions() {
  const el = document.getElementById('mySubmissionsList');
  if (!el) return;
  const { data, error } = await sb
    .from('submission_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    // 053 마이그레이션 실행 전이면 테이블이 없음 → 섹션을 조용히 숨긴다
    el.closest('.account-section').hidden = true;
    return;
  }
  el.closest('.account-section').hidden = false;
  if (!data?.length) {
    el.innerHTML = `<p class="empty-state">${escapeHtml(t('account_submissions_empty'))}</p>`;
    return;
  }
  const badge = (s) =>
    s === 'approved' ? `<span class="sub-status approved">✅ ${escapeHtml(t('sub_status_approved'))}</span>`
    : s === 'rejected' ? `<span class="sub-status rejected">🚫 ${escapeHtml(t('sub_status_rejected'))}</span>`
    : `<span class="sub-status pending">⏳ ${escapeHtml(t('sub_status_pending'))}</span>`;
  const fmtDate = (ts) => new Date(ts).toLocaleDateString();
  el.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th>#</th>
        <th>${escapeHtml(t('account_export_thumbnail_label'))}</th>
        <th>${escapeHtml(t('admin_col_title'))}</th>
        <th>${escapeHtml(t('admin_col_status'))}</th>
        <th>${escapeHtml(t('admin_col_reason'))}</th>
        <th>${escapeHtml(t('admin_col_date'))}</th>
      </tr></thead>
      <tbody>${data.map((r, i) => `
        <tr class="admin-row">
          <td class="admin-td-num">${i + 1}</td>
          <td class="admin-td-thumb"><img class="admin-thumb-sm" src="https://i.ytimg.com/vi/${encodeURIComponent(r.video_id)}/mqdefault.jpg" alt="" loading="lazy"></td>
          <td class="admin-td-title"><a href="#" class="panel-play-link" data-video-id="${escapeHtml(r.video_id)}" data-title="${escapeHtml((r.title || '').slice(0, 80))}">${escapeHtml((r.title || r.video_id).slice(0, 60))}</a></td>
          <td>${badge(r.status)}</td>
          <td class="admin-td-reason">${escapeHtml(r.reason || '')}</td>
          <td class="admin-td-date">${fmtDate(r.created_at)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  enhanceAdminTable(el);
}

document.getElementById('mySubmissionsList')?.addEventListener('click', (e) => {
  const play = e.target.closest('.panel-play-link');
  if (play) {
    e.preventDefault();
    openVideoPanel(play.dataset.videoId, play.dataset.title);
  }
});

async function refresh() {
  applyStaticTranslations();
  if (!currentUser) {
    accountLoggedOut.hidden = false;
    accountContent.hidden = true;
    return;
  }
  accountLoggedOut.hidden = true;
  accountContent.hidden = false;
  accountEmail.textContent = currentUser.email || '';
  const { data } = await sb.from('profiles').select('display_name').eq('id', currentUser.id).maybeSingle();
  accountNickname.textContent = data?.display_name || t('anonymous');
  await refreshFavoritesSection();
  await loadMySubmissions();

  await checkAdmin();
  adminTabBtn.hidden = !isAdmin; // 관리자 탭 버튼은 관리자에게만 노출 (패널은 탭 클릭 시 표시)
  if (isAdmin) setupAdminSections();
}

// ===== 관리자 섹션 접기/펴기 =====
// 섹션이 9개라 한 화면에 다 펼치면 너무 길다. 기본은 모두 접힘이고, 펼친 것만 데이터를 불러온다
// (전체를 한 번에 로드하던 것 대비 초기 로딩도 크게 줄어든다). 펼침 상태는 기기별로 기억.
const ADMIN_SECTION_LOADERS = {
  flagged: loadFlagged,
  blocklist: loadBlocklist,
  users: loadUsers,
  catlog: loadCategoryLog,
  ailog: async () => { await Promise.all([loadAiLogCalendar(), loadAiLog()]); },
  sugg: loadSuggestions,
  tagsugg: loadTagSuggestions,
  tags: loadConditionTagList,
};
const adminSectionLoaded = new Set();

async function openAdminSection(section) {
  const key = section.dataset.adminSection;
  section.classList.remove('collapsed');
  localStorage.setItem('adminSectionOpen_' + key, '1');
  const caret = section.querySelector('.admin-section-caret');
  if (caret) caret.textContent = '▾';
  const loader = ADMIN_SECTION_LOADERS[key];
  if (loader && !adminSectionLoaded.has(key)) {
    adminSectionLoaded.add(key);
    try { await loader(); } catch (err) { adminSectionLoaded.delete(key); console.error(err); }
  }
}

function closeAdminSection(section) {
  section.classList.add('collapsed');
  localStorage.setItem('adminSectionOpen_' + section.dataset.adminSection, '0');
  const caret = section.querySelector('.admin-section-caret');
  if (caret) caret.textContent = '▸';
}

function setupAdminSections() {
  document.querySelectorAll('#adminTab .account-section[data-admin-section]').forEach(section => {
    if (section.dataset.collapsibleReady) return; // 재호출 시 중복 바인딩 방지
    section.dataset.collapsibleReady = '1';
    const h2 = section.querySelector('h2');
    if (!h2) return;
    const caret = document.createElement('span');
    caret.className = 'admin-section-caret';
    caret.textContent = '▸';
    h2.prepend(caret);
    h2.classList.add('admin-section-toggle');
    h2.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // 제목 안의 링크(통계 대시보드)는 그대로 이동
      if (section.classList.contains('collapsed')) openAdminSection(section);
      else closeAdminSection(section);
    });
    // 기본 접힘. 이전에 펼쳐뒀던 섹션만 복원하며 그때 데이터를 불러온다
    if (localStorage.getItem('adminSectionOpen_' + section.dataset.adminSection) === '1') openAdminSection(section);
    else section.classList.add('collapsed');
  });
}

// ===== 카테고리 변경 이력 + 되돌리기 =====
const adminCategoryLog = document.getElementById('adminCategoryLog');

async function loadCategoryLog() {
  const { data, error } = await sb
    .from('category_changes')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(500);
  if (error) {
    adminCategoryLog.textContent = error.message;
    return;
  }
  if (!data?.length) {
    adminCategoryLog.textContent = t('admin_catlog_empty');
    return;
  }
  // 영상 정보(제목/썸네일/카테고리/조건)와 변경자 닉네임을 붙여서 보여준다
  const videoIds = [...new Set(data.map(r => r.video_id))];
  const userIds = [...new Set(data.map(r => r.changed_by).filter(Boolean))];
  const [videosRes, usersRes] = await Promise.all([
    sb.from('streams').select('video_id, title, thumbnail, category, tags, content_type').in('video_id', videoIds),
    userIds.length ? sb.from('profiles').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] }),
  ]);
  const streamMap = new Map((videosRes.data || []).map(v => [v.video_id, v]));
  const nameMap = new Map((usersRes.data || []).map(u => [u.id, u.display_name]));

  adminCategoryLog.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th>#</th>
        <th>${escapeHtml(t('admin_col_date'))}</th>
        <th>${escapeHtml(t('account_export_thumbnail_label'))}</th>
        <th>${escapeHtml(t('admin_col_title'))}</th>
        <th>${escapeHtml(t('admin_col_before'))}</th>
        <th>${escapeHtml(t('admin_col_after'))}</th>
        <th>${escapeHtml(t('admin_col_by'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${data.map((r, idx) => {
        const s = streamMap.get(r.video_id);
        const thumb = s?.thumbnail || `https://i.ytimg.com/vi/${r.video_id}/mqdefault.jpg`;
        return `
        <tr class="admin-row">
          <td class="admin-td-num">${idx + 1}</td>
          <td class="admin-td-date">${new Date(r.changed_at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td class="admin-td-thumb"><img class="admin-thumb-sm" src="${escapeHtml(thumb)}" alt="" loading="lazy"></td>
          <td class="admin-td-title"><a href="#" class="panel-play-link" data-video-id="${escapeHtml(r.video_id)}">${escapeHtml((s?.title || r.video_id).slice(0, 60))}</a></td>
          <td>${escapeHtml(r.old_category || '(none)')}</td>
          <td><b>${escapeHtml(r.new_category)}</b></td>
          <td>${escapeHtml(nameMap.get(r.changed_by) || t('anonymous'))}</td>
          <td>${r.old_category && s ? `<button type="button" class="catlog-revert-btn" data-video-id="${escapeHtml(r.video_id)}" data-old-category="${escapeHtml(r.old_category)}">${escapeHtml(t('admin_catlog_revert'))}</button>` : ''}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table></div>`;
  enhanceAdminTable(adminCategoryLog);
  catlogStreamMap = streamMap; // 패널 열 때 카테고리/조건 표시에 사용
}

// ===== 영상 미리보기 패널 (제목 클릭 → 오른쪽에서 재생 + 카테고리/조건 표시) =====
let catlogStreamMap = new Map();
let categoryLabelMap = null; // key -> {label, icon}
const videoPanel = document.getElementById('videoPanel');
const videoPanelFrame = document.getElementById('videoPanelFrame');
const videoPanelTitle = document.getElementById('videoPanelTitle');
const videoPanelMeta = document.getElementById('videoPanelMeta');

// 패널 왼쪽 가장자리를 드래그해 폭 조절 (AI 검수 로그 등에서 썸네일이 작아 보기 힘들다는 요청).
// globe.html/browse.html의 동일 패턴(panelWidth)과 저장 키를 맞춰, 기기당 한 번만 조절하면
// 다른 프리뷰 패널에서도 같은 폭이 유지된다.
(function initVideoPanelResize() {
  const handle = document.getElementById('videoPanelResize');
  if (!handle) return;
  const saved = localStorage.getItem('panelWidth');
  if (saved && window.innerWidth > 900) {
    document.documentElement.style.setProperty('--video-panel-w', `${saved}px`);
  }
  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(320, Math.min(window.innerWidth - e.clientX, window.innerWidth - 80));
    document.documentElement.style.setProperty('--video-panel-w', `${w}px`);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--video-panel-w'), 10);
    if (w) localStorage.setItem('panelWidth', w);
  });
})();

async function getCategoryLabelMap() {
  if (categoryLabelMap) return categoryLabelMap;
  const { data } = await sb.from('categories').select('key, label_en, label_ko, label_ja, label_zh, label_es, icon').order('sort_order');
  const langCol = { ko: 'label_ko', ja: 'label_ja', zh: 'label_zh', es: 'label_es' }[currentLang];
  categoryLabelMap = new Map((data || []).map(c => [c.key, {
    label: (langCol && c[langCol]) || c.label_en || c.key,
    icon: c.icon || '',
  }]));
  return categoryLabelMap;
}

async function openVideoPanel(videoId, fallbackTitle = '') {
  let s = catlogStreamMap.get(videoId);
  if (!s) {
    // 카테고리 로그 외(예: AI 검수 로그)에서 연 경우: 스트림 정보를 즉석 조회해 캐시
    const { data } = await sb.from('streams').select('video_id, title, category, tags, content_type').eq('video_id', videoId).maybeSingle();
    if (data) { s = data; catlogStreamMap.set(videoId, data); }
  }
  videoPanel.hidden = false;
  document.body.classList.add('video-panel-open'); // 본문을 패널 폭만큼 밀어 delete 버튼 등이 가려지지 않게
  videoPanelTitle.textContent = (s?.title || fallbackTitle || videoId).slice(0, 80);
  videoPanelFrame.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&playsinline=1`;
  const [catMap, tagMap] = await Promise.all([getCategoryLabelMap(), getTagLabelMap()]);
  const cat = s?.category ? catMap.get(s.category) : null;
  const catHtml = cat ? `<span class="panel-badge">${escapeHtml(cat.icon)} ${escapeHtml(cat.label)}</span>` : '';
  const tagHtml = (s?.tags || []).map(tg => `<span class="panel-badge panel-badge-tag">${escapeHtml(tagMap.get(tg) || tg)}</span>`).join('');
  videoPanelMeta.innerHTML = catHtml + tagHtml || `<span class="admin-meta">–</span>`;
}

function closeVideoPanel() {
  videoPanel.hidden = true;
  document.body.classList.remove('video-panel-open');
  videoPanelFrame.src = 'about:blank'; // 재생 중지
}
document.getElementById('videoPanelClose')?.addEventListener('click', closeVideoPanel);

// 프리뷰 패널이 열려 있을 때 바깥을 클릭하거나 Esc를 누르면 닫는다
document.addEventListener('click', (e) => {
  if (videoPanel.hidden) return;
  if (e.target.closest('#videoPanel')) return;      // 패널 내부 클릭은 유지
  if (e.target.closest('.panel-play-link')) return; // 다른 영상 열기 클릭은 openVideoPanel이 처리
  closeVideoPanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !videoPanel.hidden) closeVideoPanel();
});

adminCategoryLog?.addEventListener('click', async (e) => {
  const play = e.target.closest('.panel-play-link');
  if (play) {
    e.preventDefault();
    openVideoPanel(play.dataset.videoId);
    return;
  }
  const btn = e.target.closest('.catlog-revert-btn');
  if (!btn) return;
  btn.disabled = true;
  // 되돌리기 = 이전 카테고리로 재설정 (이 변경도 이력에 남음)
  const { error } = await sb.rpc('set_stream_category', {
    p_video_id: btn.dataset.videoId,
    p_category: btn.dataset.oldCategory,
  });
  if (error) alert(error.message);
  await loadCategoryLog();
});

// ===== 카테고리 제안 승인/거절 =====
const adminSuggestionList = document.getElementById('adminSuggestionList');

async function loadSuggestions() {
  const { data, error } = await sb
    .from('category_suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    adminSuggestionList.textContent = error.message;
    return;
  }
  if (!data?.length) {
    adminSuggestionList.textContent = t('admin_sugg_empty');
    return;
  }
  adminSuggestionList.innerHTML = data.map(r => `
    <div class="admin-row">
      <div class="admin-info">
        <div class="admin-title">${escapeHtml(r.suggestion)}</div>
        <div class="admin-meta">${new Date(r.created_at).toLocaleDateString()}</div>
      </div>
      <div class="admin-actions">
        <button type="button" class="sugg-approve-btn" data-sugg-id="${r.id}" data-suggestion="${escapeHtml(r.suggestion)}">${escapeHtml(t('admin_sugg_approve'))}</button>
        <button type="button" class="sugg-reject-btn" data-sugg-id="${r.id}">${escapeHtml(t('admin_sugg_reject'))}</button>
      </div>
    </div>
  `).join('');
}

adminSuggestionList?.addEventListener('click', async (e) => {
  const approveBtn = e.target.closest('.sugg-approve-btn');
  if (approveBtn) {
    // 카테고리 내부 키(영문 소문자, 예: night_market)를 정해야 딥링크/분류에 쓸 수 있다
    const key = prompt(t('admin_sugg_key_prompt'), '');
    if (key === null) return;
    if (!/^[a-z][a-z0-9_]{1,20}$/.test(key)) {
      alert(t('admin_sugg_key_invalid'));
      return;
    }
    const icon = prompt(t('admin_sugg_icon_prompt'), '📍');
    if (icon === null) return;
    const { error } = await sb.rpc('approve_category_suggestion', {
      p_id: Number(approveBtn.dataset.suggId),
      p_key: key,
      p_label: approveBtn.dataset.suggestion,
      p_sort: 90,
      p_icon: icon.trim() || '📍',
    });
    if (error) alert(error.message);
    await loadSuggestions();
    return;
  }
  const rejectBtn = e.target.closest('.sugg-reject-btn');
  if (rejectBtn) {
    const { error } = await sb.from('category_suggestions')
      .update({ status: 'rejected' })
      .eq('id', Number(rejectBtn.dataset.suggId));
    if (error) alert(error.message);
    await loadSuggestions();
  }
});

// ===== 조건 태그 제안 승인/거절 =====
const adminTagSuggestionList = document.getElementById('adminTagSuggestionList');

async function loadTagSuggestions() {
  const { data, error } = await sb
    .from('tag_suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    adminTagSuggestionList.textContent = error.message;
    return;
  }
  if (!data?.length) {
    adminTagSuggestionList.textContent = t('admin_sugg_empty');
    return;
  }
  adminTagSuggestionList.innerHTML = data.map(r => `
    <div class="admin-row">
      <div class="admin-info">
        <div class="admin-title">${escapeHtml(r.suggestion)}</div>
        <div class="admin-meta">${new Date(r.created_at).toLocaleDateString()}</div>
      </div>
      <div class="admin-actions">
        <button type="button" class="tagsugg-approve-btn" data-sugg-id="${r.id}" data-suggestion="${escapeHtml(r.suggestion)}">${escapeHtml(t('admin_sugg_approve'))}</button>
        <button type="button" class="tagsugg-reject-btn" data-sugg-id="${r.id}">${escapeHtml(t('admin_sugg_reject'))}</button>
      </div>
    </div>
  `).join('');
}

adminTagSuggestionList?.addEventListener('click', async (e) => {
  const approveBtn = e.target.closest('.tagsugg-approve-btn');
  if (approveBtn) {
    // 태그 내부 키(영문 소문자, 예: fog)를 정해야 필터/저장에 쓸 수 있다
    const key = prompt(t('admin_sugg_key_prompt'), '');
    if (key === null) return;
    if (!/^[a-z][a-z0-9_]{1,20}$/.test(key)) {
      alert(t('admin_sugg_key_invalid'));
      return;
    }
    const icon = prompt(t('admin_sugg_icon_prompt'), '');
    if (icon === null) return;
    // 태그는 별도 아이콘 컬럼 없이 라벨 앞에 이모지를 붙이는 구조 (기존 9개와 동일)
    const label = icon.trim() ? `${icon.trim()} ${approveBtn.dataset.suggestion}` : approveBtn.dataset.suggestion;
    const { error } = await sb.rpc('approve_tag_suggestion', {
      p_id: Number(approveBtn.dataset.suggId),
      p_key: key,
      p_label: label,
      p_sort: 90,
    });
    if (error) alert(error.message);
    await loadTagSuggestions();
    return;
  }
  const rejectBtn = e.target.closest('.tagsugg-reject-btn');
  if (rejectBtn) {
    const { error } = await sb.from('tag_suggestions')
      .update({ status: 'rejected' })
      .eq('id', Number(rejectBtn.dataset.suggId));
    if (error) alert(error.message);
    await loadTagSuggestions();
  }
});

// ===== 조건 태그 관리 (라벨 수정/삭제) =====
const adminTagList = document.getElementById('adminTagList');

async function loadConditionTagList() {
  const { data, error } = await sb.from('condition_tags').select('*').order('sort_order');
  if (error) {
    adminTagList.textContent = error.message;
    return;
  }
  adminTagList.innerHTML = (data || []).map(r => `
    <div class="admin-row">
      <div class="admin-info">
        <div class="admin-title">${escapeHtml(r.label)}</div>
        <div class="admin-meta">${escapeHtml(r.key)}</div>
      </div>
      <div class="admin-actions">
        <button type="button" class="tag-label-edit-btn" data-key="${escapeHtml(r.key)}" data-label="${escapeHtml(r.label)}">${escapeHtml(t('admin_tag_edit_button'))}</button>
        <button type="button" class="tag-delete-btn" data-key="${escapeHtml(r.key)}">${escapeHtml(t('admin_tag_delete_button'))}</button>
      </div>
    </div>
  `).join('');
}

adminTagList?.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('.tag-label-edit-btn');
  if (editBtn) {
    const next = prompt(t('admin_tag_edit_prompt'), editBtn.dataset.label);
    if (next === null || !next.trim()) return;
    const { error } = await sb.rpc('update_condition_tag', {
      p_key: editBtn.dataset.key,
      p_label: next.trim().slice(0, 40),
    });
    if (error) alert(error.message);
    await loadConditionTagList();
    return;
  }
  const deleteBtn = e.target.closest('.tag-delete-btn');
  if (deleteBtn) {
    if (!confirm(t('admin_tag_delete_confirm'))) return;
    const { error } = await sb.rpc('delete_condition_tag', { p_key: deleteBtn.dataset.key });
    if (error) alert(error.message);
    await loadConditionTagList();
  }
});

accountEditNicknameBtn.addEventListener('click', async () => {
  const { data } = await sb.from('profiles').select('display_name').eq('id', currentUser.id).maybeSingle();
  const next = prompt(t('nickname_prompt'), data?.display_name || '');
  if (next === null) return;
  const trimmed = next.trim().slice(0, 20);
  if (!trimmed) return;
  const { error } = await sb.from('profiles').update({ display_name: trimmed }).eq('id', currentUser.id);
  if (error) {
    alert(error.code === '23505' ? t('nickname_taken') : t('nickname_failed', { message: error.message }));
    return;
  }
  await refresh();
});

accountDeleteBtn.addEventListener('click', async () => {
  const confirmText = t('account_delete_confirm_prompt');
  const typed = prompt(confirmText);
  if (typed !== 'DELETE') return;
  accountDeleteBtn.disabled = true;
  const { error } = await sb.rpc('delete_my_account');
  if (error) {
    alert(t('account_delete_failed', { message: error.message }));
    accountDeleteBtn.disabled = false;
    return;
  }
  await sb.auth.signOut();
  window.location.href = 'index.html';
});

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user || null;
  await refresh();
});

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  await refresh();
}

init();
