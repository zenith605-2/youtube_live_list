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
const adminSections = document.getElementById('adminSections');
const adminFlaggedList = document.getElementById('adminFlaggedList');
const adminUserList = document.getElementById('adminUserList');

let currentUser = null;
let isAdmin = false;

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
    <div class="admin-row" data-video-id="${escapeHtml(r.video_id)}" data-visibility="${r.visibility}">
      <img class="admin-thumb" src="${r.thumbnail || ''}" alt="">
      <div class="admin-info">
        <div class="admin-title">${escapeHtml(r.title || r.video_id)}</div>
        <div class="admin-meta">
          ${t('admin_channel_label')}: ${escapeHtml(r.channel_title || t('admin_no_info'))} ·
          👎 ${r.downvote_count || 0} · 🚩 ${r.report_count || 0} ·
          ${r.visibility === 'hidden' ? t('admin_status_hidden') : t('admin_status_listed')}
        </div>
        <a href="https://www.youtube.com/watch?v=${encodeURIComponent(r.video_id)}" target="_blank" rel="noopener">${t('watch_on_youtube')}</a>
      </div>
      <div class="admin-actions">
        <button type="button" class="toggle-visibility-btn">${r.visibility === 'hidden' ? t('admin_show_button') : t('admin_hide_button')}</button>
        <button type="button" class="delete-btn">${t('admin_delete_button')}</button>
      </div>
    </div>
  `;
}

async function loadFlagged() {
  adminFlaggedList.textContent = t('loading');
  const { data, error } = await sb
    .from('streams')
    .select('*')
    .or('visibility.eq.hidden,downvote_count.gt.0,report_count.gt.0')
    .order('downvote_count', { ascending: false });

  if (error) {
    adminFlaggedList.textContent = t('admin_flagged_load_failed', { message: error.message });
    return;
  }
  if (!data || data.length === 0) {
    adminFlaggedList.textContent = t('admin_flagged_empty');
    return;
  }
  adminFlaggedList.innerHTML = data.map(flaggedRowHtml).join('');
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
    <div class="admin-row" data-user-id="${escapeHtml(u.id)}" data-is-admin="${u.is_admin}">
      <img class="admin-thumb user-avatar" src="${u.avatar_url || ''}" alt="">
      <div class="admin-info">
        <div class="admin-title">${escapeHtml(u.display_name || t('admin_no_nickname'))}</div>
        <div class="admin-meta">
          ${t('admin_submissions_label')} ${u.submissionCount} · ${t('admin_joined_label')} ${new Date(u.created_at).toLocaleDateString()} ·
          ${u.is_admin ? t('admin_role_admin') : t('admin_role_user')}
        </div>
      </div>
      <div class="admin-actions">
        <button type="button" class="toggle-admin-btn">${u.is_admin ? t('admin_revoke_button') : t('admin_promote_button')}</button>
      </div>
    </div>
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
  adminUserList.innerHTML = rows.map(userRowHtml).join('');
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

async function loadMyFavorites() {
  const { data: favRows, error: favErr } = await sb
    .from('favorites')
    .select('video_id, note')
    .eq('user_id', currentUser.id);
  if (favErr || !favRows.length) return [];

  const videoIds = favRows.map(f => f.video_id);
  const { data: streamRows } = await sb
    .from('streams')
    .select('video_id, title, channel_title, thumbnail, content_type')
    .in('video_id', videoIds);
  const streamMap = new Map((streamRows || []).map(s => [s.video_id, s]));

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
    .map((i, idx) => `${idx + 1}. ${i.title}\n${t('account_export_channel_label')}: ${i.channel}\n${t('account_export_url_label')}: ${i.url}\n${t('account_export_thumbnail_label')}: ${i.thumbnail}${i.note ? `\n${t('account_export_note_label')}: ${i.note}` : ''}`)
    .join('\n\n---\n\n');
}

function buildAndDownloadXlsx(items) {
  const header = ['No.', 'Title', 'Channel', 'YouTube URL', 'Thumbnail URL', 'Note'];
  const rows = items.map((i, idx) => [idx + 1, i.title, i.channel, i.url, i.thumbnail, i.note]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  // 유튜브/썸네일 URL 칸을 실제 클릭 가능한 링크로 만든다 (이미지 자체는 CORS 때문에 못 넣음)
  rows.forEach((_row, i) => {
    const rowNum = i + 2;
    const urlCell = `D${rowNum}`;
    const thumbCell = `E${rowNum}`;
    if (ws[urlCell]) ws[urlCell].l = { Target: items[i].url };
    if (ws[thumbCell]) ws[thumbCell].l = { Target: items[i].thumbnail };
  });
  ws['!cols'] = [{ wch: 5 }, { wch: 50 }, { wch: 25 }, { wch: 45 }, { wch: 45 }, { wch: 30 }];
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
  adminSections.hidden = !isAdmin;
  if (isAdmin) {
    await Promise.all([loadFlagged(), loadUsers(), loadCategoryLog(), loadSuggestions()]);
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

  adminCategoryLog.innerHTML = data.map(r => `
    <div class="admin-row">
      <div class="admin-info">
        <div class="admin-title">${escapeHtml((titleMap.get(r.video_id) || r.video_id).slice(0, 70))}</div>
        <div class="admin-meta">
          ${escapeHtml(r.old_category || '(none)')} → <b>${escapeHtml(r.new_category)}</b>
          · ${escapeHtml(nameMap.get(r.changed_by) || t('anonymous'))}
          · ${new Date(r.changed_at).toLocaleString()}
        </div>
      </div>
      <div class="admin-actions">
        ${r.old_category && titleMap.has(r.video_id) ? `<button type="button" class="catlog-revert-btn" data-video-id="${escapeHtml(r.video_id)}" data-old-category="${escapeHtml(r.old_category)}">${escapeHtml(t('admin_catlog_revert'))}</button>` : ''}
      </div>
    </div>
  `).join('');
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
    const { error } = await sb.rpc('approve_category_suggestion', {
      p_id: Number(approveBtn.dataset.suggId),
      p_key: key,
      p_label: approveBtn.dataset.suggestion,
      p_sort: 90,
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
