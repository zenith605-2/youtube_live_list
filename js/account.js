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

// ===== 관리자 테이블 공용: 엑셀식 열 필터 =====
// 헤더 아래에 필터 행을 삽입한다. 열의 고유값이 적으면(≤12) 드롭다운, 많으면 검색 입력.
// 빈 헤더(버튼 열)는 필터 없음. 테이블은 리로드 때마다 다시 그려지므로 매번 호출한다.
function enhanceAdminTable(container) {
  const table = container.querySelector('.admin-table');
  if (!table) return;
  const headRow = table.querySelector('thead tr');
  const bodyRows = [...table.querySelectorAll('tbody tr')];
  if (!headRow || bodyRows.length < 2) return; // 1행이면 필터 무의미

  const colCount = headRow.children.length;
  const filterRow = document.createElement('tr');
  filterRow.className = 'admin-filter-row';
  const controls = []; // 열별 필터 컨트롤 (없으면 null)

  const applyFilters = () => {
    for (const row of bodyRows) {
      let show = true;
      for (let i = 0; i < colCount; i++) {
        const ctrl = controls[i];
        if (!ctrl || !ctrl.value) continue;
        const cell = (row.children[i]?.textContent || '').trim();
        if (ctrl.tagName === 'SELECT' ? cell !== ctrl.value : !cell.toLowerCase().includes(ctrl.value.toLowerCase())) {
          show = false;
          break;
        }
      }
      row.hidden = !show;
    }
  };

  for (let i = 0; i < colCount; i++) {
    const th = document.createElement('th');
    const label = headRow.children[i].textContent.trim();
    if (!label) { controls.push(null); filterRow.appendChild(th); continue; }

    const values = [...new Set(bodyRows.map(r => (r.children[i]?.textContent || '').trim()))].filter(Boolean);
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
      <td class="admin-td-title">
        <a href="https://www.youtube.com/watch?v=${encodeURIComponent(r.video_id)}" target="_blank" rel="noopener">${escapeHtml((r.title || r.video_id).slice(0, 60))}</a>
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
    const { error } = await sb.from('streams').delete().eq('video_id', videoId);
    if (error) {
      alert(t('admin_delete_failed', { message: error.message }));
      return;
    }
    await sb.from('blocklist').insert({ video_id: videoId, blocked_by: currentUser.id });
    await loadFlagged();
  }
});

function userRowHtml(u) {
  return `
    <tr class="admin-row" data-user-id="${escapeHtml(u.id)}" data-is-admin="${u.is_admin}">
      <td class="admin-td-title"><img class="admin-avatar-sm" src="${u.avatar_url || ''}" alt=""> ${escapeHtml(u.display_name || t('admin_no_nickname'))}</td>
      <td>${u.submissionCount}</td>
      <td class="admin-td-date">${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${u.is_admin ? t('admin_role_admin') : t('admin_role_user')}</td>
      <td><button type="button" class="toggle-admin-btn">${u.is_admin ? t('admin_revoke_button') : t('admin_promote_button')}</button></td>
    </tr>
  `;
}

async function loadUsers() {
  adminUserList.textContent = t('loading');
  const [{ data: profiles, error: profileErr }, { data: submissions, error: subErr }] = await Promise.all([
    sb.from('profiles').select('id, display_name, avatar_url, is_admin, created_at').order('created_at'),
    sb.from('streams').select('added_by').not('added_by', 'is', null),
  ]);
  if (profileErr) {
    adminUserList.textContent = t('admin_users_load_failed', { message: profileErr.message });
    return;
  }
  const counts = new Map();
  if (!subErr) {
    for (const row of submissions || []) {
      counts.set(row.added_by, (counts.get(row.added_by) || 0) + 1);
    }
  }
  const rows = (profiles || []).map(u => ({ ...u, submissionCount: counts.get(u.id) || 0 }));
  if (!rows.length) {
    adminUserList.textContent = t('admin_users_empty');
    return;
  }
  adminUserList.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th>${escapeHtml(t('admin_col_user'))}</th>
        <th>${escapeHtml(t('admin_col_submissions'))}</th>
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
    <div class="favorite-row" data-video-id="${escapeHtml(item.videoId)}">
      <span class="favorite-row-num">${index + 1}</span>
      <img class="favorite-row-thumb" src="${escapeHtml(item.thumbnail)}" alt="">
      <div class="favorite-row-body">
        <div class="favorite-row-title">${escapeHtml(item.title || item.videoId)}</div>
        <div class="favorite-row-meta">
          ${escapeHtml(item.channel)} · ${item.contentType === 'live' ? t('content_type_live') : t('content_type_video')}
          ${item.note ? ` · 📝 ${escapeHtml(item.note)}` : ''}
        </div>
      </div>
      <button type="button" class="favorite-remove-btn" data-video-id="${escapeHtml(item.videoId)}">${t('account_favorite_remove_button')}</button>
    </div>
  `;
}

async function refreshFavoritesSection() {
  const { count } = await sb.from('favorites').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
  const items = await loadMyFavorites();
  const liveCount = items.filter(i => i.contentType === 'live').length;
  const videoCount = items.filter(i => i.contentType === 'video').length;
  accountFavoritesCount.textContent = t('account_favorites_count_breakdown', { n: count || 0, live: liveCount, video: videoCount });
  favoritesList.innerHTML = items.length
    ? items.map(favoriteRowHtml).join('')
    : `<p class="empty-state">${escapeHtml(t('account_export_empty'))}</p>`;
}

favoritesList.addEventListener('click', async (e) => {
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
let aiLogVerdict = 'reject';

async function loadAiLog() {
  if (!adminAiLog) return;
  let query = sb.from('ai_review_log')
    .select('*')
    .order('reviewed_at', { ascending: false })
    .limit(100);
  if (aiLogVerdict) query = query.eq('verdict', aiLogVerdict);
  const { data, error } = await query;
  if (error) { adminAiLog.textContent = error.message; return; }
  if (!data?.length) { adminAiLog.textContent = t('admin_ailog_empty'); return; }

  const bodyRows = data.map(r => {
    const badge = r.verdict === 'approve' ? '✅' : r.verdict === 'reject' ? '🚫' : '❓';
    // 거절 제안 + 아직 미처리인 것만 확정삭제/복구 버튼 노출
    const actions = (r.verdict === 'reject' && r.resolution === 'pending')
      ? `<button type="button" class="ailog-del-btn" data-video-id="${escapeHtml(r.video_id)}">${escapeHtml(t('admin_ailog_confirm_delete'))}</button>
         <button type="button" class="ailog-keep-btn" data-video-id="${escapeHtml(r.video_id)}">${escapeHtml(t('admin_ailog_restore'))}</button>`
      : (r.resolution !== 'pending' ? `<span class="admin-meta">${escapeHtml(r.resolution === 'deleted' ? t('admin_ailog_deleted') : t('admin_ailog_restored'))}</span>` : '');
    return `
      <tr class="admin-row">
        <td>${badge}</td>
        <td class="admin-td-title"><a href="https://www.youtube.com/watch?v=${encodeURIComponent(r.video_id)}" target="_blank" rel="noopener">${escapeHtml((r.title || r.video_id).slice(0, 60))}</a></td>
        <td>${escapeHtml(r.channel_title || '')}</td>
        <td class="admin-td-reason">${r.reason ? escapeHtml(r.reason) : ''}${r.suggested_country ? ` · 🌍 ${escapeHtml(r.suggested_country)}` : ''}</td>
        <td class="admin-td-actions">${actions}</td>
      </tr>`;
  }).join('');
  adminAiLog.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th></th>
        <th>${escapeHtml(t('admin_col_title'))}</th>
        <th>${escapeHtml(t('admin_col_channel'))}</th>
        <th>${escapeHtml(t('admin_col_reason'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`;
  enhanceAdminTable(adminAiLog);
}

document.querySelectorAll('.ailog-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ailog-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    aiLogVerdict = tab.dataset.verdict;
    loadAiLog();
  });
});

adminAiLog?.addEventListener('click', async (e) => {
  const del = e.target.closest('.ailog-del-btn');
  const keep = e.target.closest('.ailog-keep-btn');
  if (!del && !keep) return;
  const videoId = (del || keep).dataset.videoId;
  const { error } = await sb.rpc('resolve_ai_rejection', {
    p_video_id: videoId,
    p_action: del ? 'delete' : 'restore',
  });
  if (error) alert(error.message);
  await loadAiLog();
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

  await checkAdmin();
  adminTabBtn.hidden = !isAdmin; // 관리자 탭 버튼은 관리자에게만 노출 (패널은 탭 클릭 시 표시)
  if (isAdmin) {
    await Promise.all([loadFlagged(), loadUsers(), loadCategoryLog(), loadSuggestions(), loadTagSuggestions(), loadConditionTagList(), loadAiLog()]);
  }
}

// ===== 카테고리 변경 이력 + 되돌리기 =====
const adminCategoryLog = document.getElementById('adminCategoryLog');

async function loadCategoryLog() {
  const { data, error } = await sb
    .from('category_changes')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(50);
  if (error) {
    adminCategoryLog.textContent = error.message;
    return;
  }
  if (!data?.length) {
    adminCategoryLog.textContent = t('admin_catlog_empty');
    return;
  }
  // 영상 제목과 변경자 닉네임을 붙여서 보여준다
  const videoIds = [...new Set(data.map(r => r.video_id))];
  const userIds = [...new Set(data.map(r => r.changed_by).filter(Boolean))];
  const [videosRes, usersRes] = await Promise.all([
    sb.from('streams').select('video_id, title').in('video_id', videoIds),
    userIds.length ? sb.from('profiles').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] }),
  ]);
  const titleMap = new Map((videosRes.data || []).map(v => [v.video_id, v.title]));
  const nameMap = new Map((usersRes.data || []).map(u => [u.id, u.display_name]));

  adminCategoryLog.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr>
        <th>${escapeHtml(t('admin_col_title'))}</th>
        <th>${escapeHtml(t('admin_col_before'))}</th>
        <th>${escapeHtml(t('admin_col_after'))}</th>
        <th>${escapeHtml(t('admin_col_by'))}</th>
        <th>${escapeHtml(t('admin_col_date'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${data.map(r => `
        <tr class="admin-row">
          <td class="admin-td-title">${escapeHtml((titleMap.get(r.video_id) || r.video_id).slice(0, 60))}</td>
          <td>${escapeHtml(r.old_category || '(none)')}</td>
          <td><b>${escapeHtml(r.new_category)}</b></td>
          <td>${escapeHtml(nameMap.get(r.changed_by) || t('anonymous'))}</td>
          <td class="admin-td-date">${new Date(r.changed_at).toLocaleString()}</td>
          <td>${r.old_category && titleMap.has(r.video_id) ? `<button type="button" class="catlog-revert-btn" data-video-id="${escapeHtml(r.video_id)}" data-old-category="${escapeHtml(r.old_category)}">${escapeHtml(t('admin_catlog_revert'))}</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  enhanceAdminTable(adminCategoryLog);
}

adminCategoryLog?.addEventListener('click', async (e) => {
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
