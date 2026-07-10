const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const lastUpdatedEl = document.getElementById('lastUpdated');
const modal = document.getElementById('modal');
const modalPlayer = modal.querySelector('.modal-player');
const modalClose = document.getElementById('modalClose');
const modalOpenNewTab = document.getElementById('modalOpenNewTab');
const modalTitle = document.getElementById('modalTitle');

let streams = [];
const pageLoadTime = Date.now();

function render(list) {
  grid.innerHTML = '';
  emptyState.hidden = list.length > 0;

  for (const s of list) {
    const card = document.createElement('div');
    card.className = 'card';
    const liveSnapshot = `https://i.ytimg.com/vi/${encodeURIComponent(s.videoId)}/hqdefault_live.jpg?cb=${pageLoadTime}`;
    card.innerHTML = `
      <div class="thumb-wrap">
        <span class="live-badge">LIVE</span>
        <div class="thumb-half">
          <img src="${s.thumbnail}" alt="${escapeHtml(s.title)} - 대표 썸네일" loading="lazy">
          <span class="thumb-label">대표 썸네일</span>
        </div>
        <div class="thumb-half">
          <img src="${liveSnapshot}" alt="${escapeHtml(s.title)} - 실시간 화면" loading="lazy" onerror="this.closest('.thumb-half').style.display='none'">
          <span class="thumb-label">실시간 화면</span>
        </div>
      </div>
      <div class="card-body">
        <p class="card-title">${escapeHtml(s.title)}</p>
        <p class="card-channel">${escapeHtml(s.channelTitle)}</p>
        <span class="card-keyword">${escapeHtml(s.matchedKeyword || '')}</span>
      </div>
    `;
    card.addEventListener('click', () => openModal(s.videoId, s.title));
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
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

const PLAYER_ERROR_MESSAGES = {
  2: '잘못된 영상 정보입니다.',
  5: '이 브라우저에서 재생할 수 없습니다.',
  100: '삭제되었거나 비공개로 전환된 영상입니다.',
  101: '이 채널이 임베드 재생을 허용하지 않습니다.',
  150: '이 채널이 임베드 재생을 허용하지 않습니다.',
};

function showPlayerError(code) {
  const message = PLAYER_ERROR_MESSAGES[code] || '영상을 재생할 수 없습니다.';
  modalPlayer.innerHTML = `<div class="player-error">${escapeHtml(message)}<br>아래 버튼으로 유튜브에서 시청해주세요.</div>`;
}

function openModal(videoId, title) {
  modalPlayer.innerHTML = '<div class="player-loading">불러오는 중...</div>';
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

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = !q
    ? streams
    : streams.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.channelTitle.toLowerCase().includes(q)
      );
  render(filtered);
});

async function init() {
  try {
    const res = await fetch('data/streams.json', { cache: 'no-store' });
    const data = await res.json();
    streams = data.streams || [];
    if (data.lastUpdated) {
      lastUpdatedEl.textContent = `마지막 갱신: ${new Date(data.lastUpdated).toLocaleString('ko-KR')}`;
    }
    render(streams);
  } catch (err) {
    emptyState.textContent = '목록을 불러오지 못했습니다.';
    emptyState.hidden = false;
    console.error(err);
  }
}

init();
