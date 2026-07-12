const SUPABASE_URL = 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const accountLoggedOut = document.getElementById('accountLoggedOut');
const accountContent = document.getElementById('accountContent');
const accountEmail = document.getElementById('accountEmail');
const accountNickname = document.getElementById('accountNickname');
const accountEditNicknameBtn = document.getElementById('accountEditNicknameBtn');
const accountDeleteBtn = document.getElementById('accountDeleteBtn');

let currentUser = null;

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
