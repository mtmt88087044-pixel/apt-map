/* 집콕맵 서비스 워커: 재방문 속도 + 오프라인 열람
 * - 앱 셸(html/js/css/vendor): 네트워크 우선, 실패 시 캐시
 * - 데이터(data/*.json, geojson, apt/*.html): 캐시 우선 + 백그라운드 갱신 (stale-while-revalidate)
 * - 지도 타일/글꼴(openfreemap, terrarium, jsdelivr): 캐시 우선, 최대 ~400장
 * 배포 때 CACHE 버전이 바뀌면 이전 캐시를 지운다.
 */
const CACHE = "jipkok-v202609160017";
const TILE_CACHE = "jipkok-tiles-v1";
const TILE_HOSTS = ["tiles.openfreemap.org", "s3.amazonaws.com", "cdn.jsdelivr.net"];
const TILE_LIMIT = 400;

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("jipkok-v") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > TILE_LIMIT) await Promise.all(keys.slice(0, keys.length - TILE_LIMIT).map((k) => c.delete(k)));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // API 는 캐시하지 않음
  if (url.hostname.endsWith("workers.dev")) return;

  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); trimTiles(); }
      return res;
    }).catch(() => fetch(req)));
    return;
  }
  if (url.origin !== location.origin) return;

  const isData = /\/data\/|\/apt\/.+\.html$/.test(url.pathname);
  if (isData) {
    // stale-while-revalidate
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // 앱 셸: 캐시 즉시 응답 + 백그라운드 갱신 (index.html 은 네트워크 우선으로 새 버전 감지)
  const isIndex = /\/(index\.html)?$/.test(url.pathname);
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    if (isIndex) return net.then((r) => r || hit);
    return hit || net;
  }));
});
