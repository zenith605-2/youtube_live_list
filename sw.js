// PWA 설치 요건용 최소 서비스워커.
// 캐싱은 하지 않는다 — 카탈로그가 매일 바뀌는 사이트라 낡은 캐시가 더 해롭다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* 네트워크 기본 동작 그대로 */ });
