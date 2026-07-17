// 국가별/카테고리별 정적 SEO 페이지 생성기
// 매일 갱신 워크플로 마지막에 실행되어 /country/*.html, /c/*.html, browse.html, sitemap.xml을
// 다시 만들고 커밋한다. 검색 수요의 대부분이 "live cam 도시/나라" 형태라서,
// 실제 콘텐츠가 HTML에 박힌 페이지가 있어야 구글이 색인/랭킹할 수 있다.
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = 'https://camlisted.com';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://chgodrjjalsrgyxuwjyq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_publishable_IPRYfUNkhfTLWohT6gjXYw_APGRcPuP';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MIN_COUNTRY_ENTRIES = 3;   // 이보다 적은 나라는 페이지를 만들지 않음 (얇은 페이지는 SEO에 역효과)
const MAX_ENTRIES_PER_PAGE = 150;

async function fetchAllRows(table, columns = '*') {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryNameOf(code) {
  try { return regionNames.of(code) || code; } catch { return code; }
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// 사이트 본체와 톤을 맞춘 자체 스타일 (style.css의 클래스는 JS 렌더링 전제라 재사용하지 않음)
const PAGE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #0d1117; color: #e6e6e6; font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
  header { padding: 16px 24px; border-bottom: 1px solid #2a2f3a; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  header a.logo { color: #ff3b3b; font-weight: 700; font-size: 1.1rem; text-decoration: none; }
  header nav a { color: #9aa4b2; text-decoration: none; margin-right: 14px; font-size: 0.9rem; }
  header nav a:hover { color: #e6e6e6; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; }
  p.intro { color: #9aa4b2; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .entry { display: block; background: #161b22; border: 1px solid #2a2f3a; border-radius: 10px; overflow: hidden; text-decoration: none; color: inherit; }
  .entry:hover { border-color: #ff3b3b; }
  .thumb { position: relative; aspect-ratio: 16/9; background: #000; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .badge { position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,.75); color: #fff; font-size: 0.7rem; padding: 2px 7px; border-radius: 4px; }
  .badge.live { background: #d21f3c; }
  .entry-body { padding: 10px 12px; }
  .entry-body strong { display: block; font-size: 0.88rem; font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .entry-body span { color: #9aa4b2; font-size: 0.78rem; }
  .browse-list { columns: 3; column-gap: 32px; }
  .browse-list li { list-style: none; margin-bottom: 6px; break-inside: avoid; }
  .browse-list a { color: #e6e6e6; text-decoration: none; }
  .browse-list a:hover { color: #ff3b3b; }
  .browse-list .count { color: #9aa4b2; font-size: 0.85rem; }
  .map-wrap { position: relative; margin: 8px 0 4px; }
  .map-wrap svg { width: 100%; height: auto; display: block; }
  .map-wrap path { stroke: #0d1117; stroke-width: 0.5; }
  .map-wrap path[data-href] { cursor: pointer; }
  .map-wrap path:hover { filter: brightness(1.6); stroke: #ffffff; }
  .map-tip { position: fixed; z-index: 10; background: rgba(0,0,0,.85); border: 1px solid #2a2f3a; color: #fff; padding: 5px 10px; border-radius: 6px; font-size: 0.85rem; pointer-events: none; white-space: nowrap; }
  .map-note { color: #9aa4b2; font-size: 0.8rem; margin-bottom: 16px; }
  h2 { font-size: 1.15rem; margin: 28px 0 12px; }
  .cta { display: inline-block; margin: 20px 0; background: #ff3b3b; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  footer { border-top: 1px solid #2a2f3a; margin-top: 40px; padding: 20px 24px; color: #9aa4b2; font-size: 0.85rem; }
  footer a { color: #9aa4b2; margin-right: 14px; }
  @media (max-width: 700px) { .browse-list { columns: 2; } }
`;

function pageHtml({ title, description, canonicalPath, h1, intro, bodyHtml, ctaHref }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${SITE}${canonicalPath}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE}${canonicalPath}">
<style>${PAGE_CSS}</style>
</head>
<body>
<header>
  <a class="logo" href="/">📹 Camlisted</a>
  <nav><a href="/">Home</a><a href="/browse.html">Browse</a><a href="/about.html">About</a></nav>
</header>
<main>
  <h1>${escapeHtml(h1)}</h1>
  <p class="intro">${escapeHtml(intro)}</p>
  ${ctaHref ? `<a class="cta" href="${escapeHtml(ctaHref)}">Open in interactive viewer →</a>` : ''}
  ${bodyHtml}
</main>
<footer>
  <a href="/">Home</a><a href="/browse.html">Browse all</a><a href="/about.html">About</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a>
  <p>Camlisted is a curated directory of publicly available YouTube live cams and footage, re-verified daily. All videos play on YouTube.</p>
</footer>
</body>
</html>
`;
}

function entryCard(s) {
  const isLive = s.content_type === 'live';
  const thumb = s.thumbnail || `https://i.ytimg.com/vi/${s.video_id}/hqdefault.jpg`;
  const badge = isLive
    ? '<span class="badge live">LIVE</span>'
    : (s.duration_seconds ? `<span class="badge">${formatDuration(s.duration_seconds)}</span>` : '');
  return `
    <a class="entry" href="https://www.youtube.com/watch?v=${encodeURIComponent(s.video_id)}" target="_blank" rel="noopener">
      <div class="thumb"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(s.title)}" loading="lazy" width="320" height="180">${badge}</div>
      <div class="entry-body"><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.channel_title || '')}</span></div>
    </a>`;
}

function sortForPage(list) {
  // 라이브 먼저, 그 안에서는 추천 많은 순 → 최신 순
  return [...list].sort((a, b) =>
    (a.content_type === 'live' ? 0 : 1) - (b.content_type === 'live' ? 0 : 1)
    || (b.upvote_count || 0) - (a.upvote_count || 0)
    || String(b.added_at || '').localeCompare(String(a.added_at || ''))
  );
}

async function main() {
  const [streams, categoriesRes] = await Promise.all([
    fetchAllRows('streams', 'video_id,title,channel_title,thumbnail,content_type,category,country,approval_status,duration_seconds,upvote_count,added_at'),
    supabase.from('categories').select('key,label_en,icon,sort_order').order('sort_order'),
  ]);
  if (categoriesRes.error) throw categoriesRes.error;
  const categories = categoriesRes.data || [];
  const visible = streams.filter(s => s.approval_status !== 'pending' && s.title);
  const today = new Date().toISOString().slice(0, 10);
  console.log(`전체 ${streams.length}건 중 공개 ${visible.length}건으로 페이지 생성`);

  await mkdir(path.join(ROOT, 'country'), { recursive: true });
  await mkdir(path.join(ROOT, 'c'), { recursive: true });

  const sitemapUrls = [
    { loc: `${SITE}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${SITE}/browse.html`, priority: '0.8', changefreq: 'daily' },
    { loc: `${SITE}/about.html`, priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE}/feedback.html`, priority: '0.5', changefreq: 'weekly' },
    { loc: `${SITE}/privacy.html`, priority: '0.3', changefreq: 'yearly' },
    { loc: `${SITE}/terms.html`, priority: '0.3', changefreq: 'yearly' },
  ];

  // ===== 국가별 페이지 =====
  const byCountry = new Map();
  for (const s of visible) {
    if (!s.country) continue;
    if (!byCountry.has(s.country)) byCountry.set(s.country, []);
    byCountry.get(s.country).push(s);
  }
  const countryPages = [];
  for (const [code, list] of byCountry) {
    if (list.length < MIN_COUNTRY_ENTRIES) continue;
    const name = countryNameOf(code);
    const slug = slugify(name);
    const liveCount = list.filter(s => s.content_type === 'live').length;
    const videoCount = list.length - liveCount;
    const entries = sortForPage(list).slice(0, MAX_ENTRIES_PER_PAGE);
    const html = pageHtml({
      title: `Live Cams & Webcams in ${name} – Camlisted`,
      description: `Watch ${liveCount} live cams and ${videoCount} real-world videos from ${name}: traffic cameras, city streets, harbors, beaches and more. Verified daily.`,
      canonicalPath: `/country/${slug}.html`,
      h1: `Live Cams & Footage in ${name}`,
      intro: `${liveCount} live cams and ${videoCount} videos from ${name}, re-verified daily. Click any card to watch on YouTube. Updated ${today}.`,
      ctaHref: `/?country=${encodeURIComponent(code)}`,
      bodyHtml: `<div class="grid">${entries.map(entryCard).join('')}</div>`,
    });
    await writeFile(path.join(ROOT, 'country', `${slug}.html`), html);
    countryPages.push({ code, name, slug, count: list.length });
    sitemapUrls.push({ loc: `${SITE}/country/${slug}.html`, priority: '0.8', changefreq: 'daily' });
  }
  countryPages.sort((a, b) => b.count - a.count);
  console.log(`국가 페이지 ${countryPages.length}개 생성`);

  // ===== 카테고리별 페이지 =====
  const categoryPages = [];
  for (const cat of categories) {
    if (cat.key === 'other') continue;
    const list = visible.filter(s => s.category === cat.key);
    if (!list.length) continue;
    const liveCount = list.filter(s => s.content_type === 'live').length;
    const videoCount = list.length - liveCount;
    const entries = sortForPage(list).slice(0, MAX_ENTRIES_PER_PAGE);
    const label = cat.label_en || cat.key;
    const html = pageHtml({
      title: `${label} Live Cams & Videos – Camlisted`,
      description: `${liveCount} live ${label.toLowerCase()} cams and ${videoCount} videos, curated from YouTube and verified daily. Free to watch, no sign-up.`,
      canonicalPath: `/c/${cat.key}.html`,
      h1: `${cat.icon ? cat.icon + ' ' : ''}${label} Live Cams & Videos`,
      intro: `${liveCount} live cams and ${videoCount} videos in the ${label} category, re-verified daily. Click any card to watch on YouTube. Updated ${today}.`,
      ctaHref: `/?category=${encodeURIComponent(cat.key)}`,
      bodyHtml: `<div class="grid">${entries.map(entryCard).join('')}</div>`,
    });
    await writeFile(path.join(ROOT, 'c', `${cat.key}.html`), html);
    categoryPages.push({ key: cat.key, label, icon: cat.icon, count: list.length });
    sitemapUrls.push({ loc: `${SITE}/c/${cat.key}.html`, priority: '0.8', changefreq: 'daily' });
  }
  console.log(`카테고리 페이지 ${categoryPages.length}개 생성`);

  // ===== 세계지도 (choropleth) — 영상 수에 따라 색이 진해지고, 호버 툴팁 + 클릭 이동 =====
  // 지도 경로 데이터: jsvectormap(MIT, Natural Earth 기반)에서 추출한 config/world_map_paths.json
  const countByCode = new Map();
  for (const s of visible) {
    if (s.country) countByCode.set(s.country, (countByCode.get(s.country) || 0) + 1);
  }
  const maxCount = Math.max(1, ...countByCode.values());
  const heatColor = (count) => {
    if (!count) return '#1e242e';
    const t = 0.25 + 0.75 * (Math.log(count + 1) / Math.log(maxCount + 1));
    const mix = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
    return `#${mix(0x4a, 0xff)}${mix(0x22, 0x3b)}${mix(0x28, 0x3b)}`;
  };
  const slugByCode = new Map(countryPages.map(c => [c.code, c.slug]));
  const mapPaths = JSON.parse(await readFile(path.join(ROOT, 'config', 'world_map_paths.json'), 'utf-8'));
  const mapSvgPaths = Object.entries(mapPaths).map(([code, v]) => {
    const count = countByCode.get(code) || 0;
    const href = slugByCode.has(code) ? `/country/${slugByCode.get(code)}.html` : (count ? `/?country=${code}` : '');
    return `<path d="${v.path}" fill="${heatColor(count)}" data-name="${escapeHtml(countryNameOf(code) || v.name)}" data-count="${count}"${href ? ` data-href="${href}"` : ''}></path>`;
  }).join('');
  const mapSection = `
      <div class="map-wrap">
        <svg viewBox="0 0 900 441" role="img" aria-label="World map of available cams by country">${mapSvgPaths}</svg>
        <div id="mapTip" class="map-tip" hidden></div>
      </div>
      <p class="map-note">Hover a country to see how many cams it has — click to browse them.</p>
      <script>
        (function () {
          var tip = document.getElementById('mapTip');
          document.querySelectorAll('.map-wrap path').forEach(function (p) {
            p.addEventListener('mousemove', function (e) {
              var n = Number(p.dataset.count);
              tip.textContent = p.dataset.name + ' — ' + (n ? n + (n === 1 ? ' cam' : ' cams') : 'no cams yet');
              tip.hidden = false;
              tip.style.left = (e.clientX + 14) + 'px';
              tip.style.top = (e.clientY + 14) + 'px';
            });
            p.addEventListener('mouseleave', function () { tip.hidden = true; });
            if (p.dataset.href) p.addEventListener('click', function () { location.href = p.dataset.href; });
          });
        })();
      </script>`;

  // ===== browse.html (전체 색인 — 크롤러와 사용자 모두의 진입점) =====
  const browseHtml = pageHtml({
    title: 'Browse Live Cams by Country & Category – Camlisted',
    description: `Browse ${visible.length}+ YouTube live cams and real-world videos by country or category: traffic, beaches, harbors, dashcam footage and more.`,
    canonicalPath: '/browse.html',
    h1: 'Browse by Country & Category',
    intro: `${visible.length} live cams and videos, organized by where and what they show. Updated ${today}.`,
    ctaHref: '/',
    bodyHtml: `
      ${mapSection}
      <h2>By Category</h2>
      <ul class="browse-list">
        ${categoryPages.map(c => `<li><a href="/c/${c.key}.html">${c.icon ? c.icon + ' ' : ''}${escapeHtml(c.label)}</a> <span class="count">(${c.count})</span></li>`).join('')}
      </ul>
      <h2>By Country</h2>
      <ul class="browse-list">
        ${countryPages.map(c => `<li><a href="/country/${c.slug}.html">${escapeHtml(c.name)}</a> <span class="count">(${c.count})</span></li>`).join('')}
      </ul>`,
  });
  await writeFile(path.join(ROOT, 'browse.html'), browseHtml);

  // ===== sitemap.xml =====
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
  await writeFile(path.join(ROOT, 'sitemap.xml'), sitemap);
  console.log(`sitemap.xml 갱신 (URL ${sitemapUrls.length}개)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
