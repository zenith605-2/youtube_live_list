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
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportTxtBtn = document.getElementById('exportTxtBtn');

let currentUser = null;

async function loadMyFavorites() {
  const { data: favRows, error: favErr } = await sb
    .from('favorites')
    .select('video_id, note')
    .eq('user_id', currentUser.id);
  if (favErr || !favRows.length) return [];

  const videoIds = favRows.map(f => f.video_id);
  const { data: streamRows } = await sb
    .from('streams')
    .select('video_id, title, channel_title, thumbnail')
    .in('video_id', videoIds);
  const streamMap = new Map((streamRows || []).map(s => [s.video_id, s]));

  return favRows.map(f => {
    const s = streamMap.get(f.video_id) || {};
    return {
      title: s.title || '',
      channel: s.channel_title || '',
      url: `https://www.youtube.com/watch?v=${f.video_id}`,
      thumbnail: s.thumbnail || `https://i.ytimg.com/vi/${f.video_id}/hqdefault.jpg`,
      note: f.note || '',
    };
  });
}

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

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCsv(items) {
  const BOM = '﻿'; // Excel이 UTF-8로 정확히 인식하도록 BOM을 앞에 붙인다
  const header = ['Title', 'Channel', 'YouTube URL', 'Thumbnail URL', 'Note'];
  const rows = items.map(i => [i.title, i.channel, i.url, i.thumbnail, i.note].map(csvEscape).join(','));
  return BOM + [header.join(','), ...rows].join('\r\n');
}

function buildTxt(items) {
  return items
    .map(i => `${i.title}\n${t('account_export_channel_label')}: ${i.channel}\n${t('account_export_url_label')}: ${i.url}\n${t('account_export_thumbnail_label')}: ${i.thumbnail}${i.note ? `\n${t('account_export_note_label')}: ${i.note}` : ''}`)
    .join('\n\n---\n\n');
}

exportCsvBtn.addEventListener('click', async () => {
  const items = await loadMyFavorites();
  if (!items.length) {
    alert(t('account_export_empty'));
    return;
  }
  downloadFile('favorites.csv', buildCsv(items), 'text/csv;charset=utf-8');
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
  const { count } = await sb.from('favorites').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
  accountFavoritesCount.textContent = t('account_favorites_count', { n: count || 0 });
}

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
