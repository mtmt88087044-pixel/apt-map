/* 집콕맵 MVP - 실거래·호가·학군·도로·경매 */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const PY = 3.3058;
  const dark = false;   // 항상 밝은 화면 (사용자 요청: 너무 어둡다)

  const state = {
    complexes: [], auctions: [], schools: null, meta: null,
    area: "all", sort: null, q: "",
    selected: null, markers: {}, aucMarkers: [], schoolMarkers: [], crownMarkers: [],
    layers: { school: true, subway: true, road: false, auction: false, terrain: false, nuisance: false, amenity: false },
    compare: JSON.parse(localStorage.getItem("compare") || "[]"), budget: null,
  };

  // ---------- API / 찜 ----------
  const API = (window.APT_CONFIG && window.APT_CONFIG.API_BASE) || "";
  const api = (path, opt) => API ? fetch(API + path, opt).then((r) => r.json()) : Promise.reject(new Error("no api"));
  const favs = { ids: new Set(JSON.parse(localStorage.getItem("favs") || "[]")), code: localStorage.getItem("favCode") || "" };
  function saveFavs() {
    localStorage.setItem("favs", JSON.stringify([...favs.ids]));
    if (favs.code) api("/favs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: favs.code, ids: [...favs.ids] }) }).catch(() => {});
  }
  function toggleFav(id) { if (favs.ids.has(id)) favs.ids.delete(id); else favs.ids.add(id); saveFavs(); renderList(); $$(".fav").forEach((b) => { if (b.dataset.id === id) b.classList.toggle("on", favs.ids.has(id)); }); }
  const gBadge = (coedu) => coedu === "남" ? `<span class="gb boy">남</span>` : coedu === "여" ? `<span class="gb girl">여</span>` : `<span class="gb co">공학</span>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".cb-copy");
    if (!b) return;
    const t = b.dataset.addr || "";
    const done = () => { const o = b.textContent; b.textContent = "복사됨"; setTimeout(() => (b.textContent = o), 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => {});
    else { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (err) {} document.body.removeChild(ta); }
  });
  const favBtn = (id) => `<button class="fav ${favs.ids.has(id) ? "on" : ""}" data-id="${esc(id)}" title="찜" aria-label="찜">♥</button>`;

  // ---------- utils ----------
  const fmtPrice = (v) => v == null ? "-" : v >= 10000 ? (v / 10000).toFixed(v >= 1000000 ? 0 : 1).replace(/\.0$/, "") + "억" : v.toLocaleString() + "만";
  const fmtChg = (v) => v == null ? "" : `<span class="chg ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v}%</span>`;
  const bucket = (area) => area < 70 ? "59" : area < 100 ? "84" : "114";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  const areaShort = () => (state.meta && state.meta.area.startsWith("서울 전체") ? "서울" : (state.meta ? state.meta.area.split(" ").pop() : ""));
  function repArea(c, area) {
    const list = c.by_area || [];
    if (area !== "all") return list.find((a) => bucket(a.area) === area) || null;
    return list.find((a) => bucket(a.area) === "84") || list.slice().sort((a, b) => b.count - a.count)[0] || null;
  }
  function areaMatch(c) { return state.area === "all" || (c.by_area || []).some((a) => bucket(a.area) === state.area); }

  // ---------- map ----------
  // 베이스맵: OpenFreeMap (키 불필요, 벡터). 실패 시 OSM 래스터로 폴백
  // glyphs 가 없으면 text-field 를 쓰는 심볼 레이어(구 이름·편의시설·지하철역 라벨)가 전부 죽는다
  const OSM_RASTER = { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: { osm: { type: "raster", tileSize: 256, attribution: "© OpenStreetMap contributors",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"] } }, layers: [{ id: "osm", type: "raster", source: "osm" }] };
  const map = new maplibregl.Map({
    container: "map",
    style: dark ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/positron",
    center: [126.9515, 37.5505], zoom: 14.6, attributionControl: false, maxZoom: 19,
  });
  window.__app = { map, state };
  let mapReady = false;
  map.once("load", () => { mapReady = true; });
  map.once("error", (e) => { if (!map.isStyleLoaded()) { console.warn("basemap fallback", e && e.error); map.setStyle(OSM_RASTER); } });
  setTimeout(() => { if (!map.isStyleLoaded()) { console.warn("basemap timeout -> OSM raster"); map.setStyle(OSM_RASTER); } }, 10000);
  // 스타일이 (다시) 로드될 때마다 오버레이 레이어를 붙인다 (폴백 setStyle 포함)
  map.on("style.load", () => { if (state.schools && !map.getSource("schools")) addLayers(); });
  // 탭 전환/창 크기 변경 후 캔버스 크기 재계산
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(() => map.resize(), 50); });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-left");

  const PALETTE = ["#7c3aed", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#f97316", "#14b8a6", "#6366f1"];

  function addLayers() {
    // 학군
    const names = [...new Set(state.schools.features.filter((f) => f.properties.kind === "zone").map((f) => f.properties.name))];
    const matchExpr = ["match", ["get", "name"]];
    names.forEach((n, i) => matchExpr.push(n, PALETTE[i % PALETTE.length]));
    matchExpr.push("#94a3b8");
    map.addSource("schools", { type: "geojson", data: state.schools });
    map.addLayer({ id: "school-fill", type: "fill", source: "schools", filter: ["==", ["get", "kind"], "zone"],
      paint: { "fill-color": matchExpr, "fill-opacity": 0.13 } });
    map.addLayer({ id: "school-line", type: "line", source: "schools", filter: ["==", ["get", "kind"], "zone"],
      paint: { "line-color": matchExpr, "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
    state.schools.features.filter((f) => f.properties.kind === "school").forEach((f, i) => {
      const el = document.createElement("div"); el.className = "mk school";
      el.style.color = PALETTE[names.indexOf(f.properties.name) % PALETTE.length];
      el.innerHTML = `🏫 ${esc(f.properties.name.replace("등학교", ""))}`;
      state.schoolMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(f.geometry.coordinates).addTo(map));
    });

    // 지하철: 노선 경로(공식 색) + 역. 항상 강조해서 보여준다 (요청)
    map.addSource("subway-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "sub-line-case", type: "line", source: "subway-lines", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff", "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 13, 5, 17, 10] } });
    map.addLayer({ id: "sub-line", type: "line", source: "subway-lines", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 13, 3, 17, 6] } });
    // 공사 중 노선: 점선 + 예정역 (OSM 기준, 개통 시기·역 위치 변동 가능)
    map.addSource("future-rail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "fut-line", type: "line", source: "future-rail", filter: ["==", ["geometry-type"], "MultiLineString"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-opacity": 0.85, "line-dasharray": [2, 1.6],
               "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 13, 3, 17, 5] } });
    map.addLayer({ id: "fut-line-label", type: "symbol", source: "future-rail", filter: ["==", ["geometry-type"], "MultiLineString"], minzoom: 11.5,
      layout: { "symbol-placement": "line", "text-field": ["concat", ["get", "name"], " (공사 중)"], "text-font": ["Noto Sans Bold"], "text-size": 12, "symbol-spacing": 400 },
      paint: { "text-color": ["get", "color"], "text-halo-color": "#fff", "text-halo-width": 2 } });
    map.addLayer({ id: "fut-dot", type: "circle", source: "future-rail", filter: ["==", ["get", "kind"], "station"], minzoom: 11,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 14, 7, 17, 10], "circle-color": "#fff",
               "circle-stroke-color": "#f59e0b", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 17, 3.5] } });
    map.addLayer({ id: "fut-label", type: "symbol", source: "future-rail", filter: ["==", ["get", "kind"], "station"], minzoom: 12.5,
      layout: { "text-field": ["concat", ["get", "name"], " 예정"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 11, 17, 16],
                "text-offset": [0, 1.0], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#b45309", "text-halo-color": "#fff", "text-halo-width": 2 } });
    map.addSource("stations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "sub-dot", type: "circle", source: "stations", minzoom: 11,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["case", ["get", "transfer"], 5, 4], 14, ["case", ["get", "transfer"], 9, 7], 17, ["case", ["get", "transfer"], 13, 10]],
               "circle-color": ["case", ["get", "transfer"], "#fff", ["get", "color"]],
               "circle-stroke-color": ["case", ["get", "transfer"], "#1f2937", "#fff"],
               "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 17, 3] } });
    map.addLayer({ id: "sub-label", type: "symbol", source: "stations", minzoom: 12,
      layout: { "text-field": ["format", ["get", "name"], { "font-scale": 1 }, "\n", {}, ["get", "line"], { "font-scale": 0.72 }], "text-font": ["Noto Sans Bold"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 12, 12, 14, 15, 17, 19],
                "text-offset": [0, 1.0], "text-anchor": "top", "text-allow-overlap": false, "text-optional": true },
      paint: { "text-color": ["case", ["get", "transfer"], "#111827", ["get", "color"]], "text-halo-color": "#fff", "text-halo-width": 2.2 } });

    // 도로: 큰길은 서울 전체 파일, 골목/동네길은 화면에 걸친 격자 타일만 로드
    map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("roads-major", { type: "geojson", data: { type: "FeatureCollection", features: [] } });   // 실제 데이터는 도로 레이어 켤 때
    const z = (a, b) => ["interpolate", ["linear"], ["zoom"], 13, a, 18, b];
    map.addLayer({ id: "road-walk", type: "line", source: "roads",
      filter: ["all", ["!=", ["get", "class"], "alley"], ["in", ["get", "sidewalk"], ["literal", ["yes", "likely"]]]],
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: { "line-color": "#22c55e", "line-width": ["interpolate", ["linear"], ["zoom"], 13, ["case", ["==", ["get", "class"], "major"], 6, 4], 18, ["case", ["==", ["get", "class"], "major"], 15, 9]], "line-opacity": 0.85 } });
    map.addLayer({ id: "road-alley", type: "line", source: "roads", filter: ["==", ["get", "class"], "alley"], minzoom: 14,
      layout: { visibility: "none" }, paint: { "line-color": dark ? "#475569" : "#cbd5e1", "line-width": z(1, 3), "line-dasharray": [2, 2] } });
    map.addLayer({ id: "road-minor", type: "line", source: "roads", filter: ["==", ["get", "class"], "minor"], minzoom: 13.5,
      layout: { "line-cap": "round", visibility: "none" }, paint: { "line-color": "#94a3b8", "line-width": z(1.5, 5) } });
    map.addLayer({ id: "road-major-far", type: "line", source: "roads-major", maxzoom: 13.5,
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: { "line-color": "#f97316", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 13.5, 3], "line-opacity": 0.9 } });
    map.addLayer({ id: "road-major", type: "line", source: "roads", filter: ["==", ["get", "class"], "major"], minzoom: 13.5,
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: { "line-color": "#f97316", "line-width": z(3, 10), "line-opacity": 0.95 } });
    map.on("moveend", loadRoadTiles);

    // 구 경계 / 구 이름 / 대장 아파트 (줌 아웃)
    map.addSource("districts", { type: "geojson", data: "data/districts.geojson" });
    map.addLayer({ id: "gu-fill", type: "fill", source: "districts", maxzoom: 14, paint: { "fill-color": "#2563eb", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.06, 13, 0.02] } });
    map.addLayer({ id: "gu-line", type: "line", source: "districts", maxzoom: 15, paint: { "line-color": dark ? "#93c5fd" : "#1d4ed8", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.2], "line-opacity": 0.7 } });
    if (map.getStyle().glyphs) {
      map.addLayer({ id: "gu-label", type: "symbol", source: "districts", maxzoom: 13.5,
        layout: { "text-field": ["format", ["get", "name"], { "font-scale": 1.15 }, "\n", {}, ["case", ["has", "ppy_med"], ["concat", "평당 ", ["to-string", ["round", ["/", ["get", "ppy_med"], 100]]], "백만"], ""], { "font-scale": 0.8 }],
          "text-font": ["Noto Sans Bold"], "text-size": 13, "text-anchor": "center", "text-allow-overlap": false },
        paint: { "text-color": dark ? "#e2e8f0" : "#1e3a8a", "text-halo-color": dark ? "#0f172a" : "#ffffff", "text-halo-width": 1.6 } });
    }
    fetch("data/districts.geojson").then((r) => r.json()).then((gj) => {
      gj.features.forEach((f) => {
        const t = (f.properties.top || [])[0]; if (!t) return;
        const el = document.createElement("div"); el.className = "mk crown";
        el.innerHTML = `<small>${esc(f.properties.name)} 대장</small><b>👑 ${esc(t.name.length > 10 ? t.name.slice(0, 10) + "…" : t.name)}</b><small>${t.latest ? fmtPrice(t.latest) + " · " + t.area + "㎡" : "평당 " + t.ppy.toLocaleString() + "만"}</small>`;
        el.addEventListener("click", (ev) => { ev.stopPropagation(); openDetail(t.id, "half"); });
        const m = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -4] }).setLngLat([t.lng, t.lat]).addTo(map);
        state.crownMarkers.push(m);
      });
      applyCrowns();
    }).catch(() => {});

    // 주요시설 (병원·마트·어린이집·도서관·공원·놀이터) + 선택 단지 반경 원
    map.addSource("amenity", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("range", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const AM_COLOR = ["match", ["get", "kind"], "hospital", "#dc2626", "emergency", "#b91c1c", "clinic_ped", "#f97316", "mart", "#2563eb", "kindergarten", "#f59e0b", "playground", "#eab308", "library", "#7c3aed", "park", "#16a34a", "university", "#0ea5e9", "police", "#334155", "#64748b"];
    map.addLayer({ id: "am-park", type: "fill", source: "amenity", filter: ["==", ["get", "kind"], "park_area"], layout: { visibility: "none" }, paint: { "fill-color": "#22c55e", "fill-opacity": 0.22 } });
    map.addLayer({ id: "range-fill", type: "fill", source: "range", layout: { visibility: "none" }, paint: { "fill-color": "#2563eb", "fill-opacity": ["case", ["==", ["get", "r"], 500], 0.10, 0.05] } });
    map.addLayer({ id: "range-line", type: "line", source: "range", layout: { visibility: "none" }, paint: { "line-color": "#2563eb", "line-width": 1.5, "line-dasharray": [3, 2] } });
    map.addLayer({ id: "am-point", type: "circle", source: "amenity", filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "park_area"]], layout: { visibility: "none" }, minzoom: 12,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 16, 8], "circle-color": AM_COLOR, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.95 } });
    if (map.getStyle().glyphs) {
      map.addLayer({ id: "am-label", type: "symbol", source: "amenity", filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "park_area"]], minzoom: 14.5, layout: { visibility: "none",
        "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 12, 17, 15], "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true, "text-max-width": 8 },
        paint: { "text-color": AM_COLOR, "text-halo-color": dark ? "#0f172a" : "#ffffff", "text-halo-width": 1.8 } });
    }
    map.on("click", "am-point", (e) => { const p = e.features[0].properties; toast(`${p.label}${p.name ? " · " + p.name : ""}${p.area ? " · " + Math.round(p.area / 10000 * 10) / 10 + "ha" : ""}`); });
    map.on("mouseenter", "am-point", () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", "am-point", () => map.getCanvas().style.cursor = "");

    // 기피시설 (OSM + 인허가)
    map.addSource("nuisance", { type: "geojson", data: { type: "FeatureCollection", features: [] } });      // 기피 레이어 켤 때 로드
    map.addLayer({ id: "nz-line", type: "line", source: "nuisance", filter: ["==", ["geometry-type"], "LineString"], layout: { visibility: "none" },
      paint: { "line-color": ["match", ["get", "kind"], "powerline", "#dc2626", "rail", "#6b7280", "#b45309"], "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity": 0.85 } });
    map.addLayer({ id: "nz-point", type: "circle", source: "nuisance", filter: ["==", ["geometry-type"], "Point"], layout: { visibility: "none" }, minzoom: 12,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7], "circle-color": ["match", ["get", "kind"], "nightlife", "#db2777", "adult_biz", "#db2777", "motel", "#c026d3", "lodging", "#c026d3", "fuel", "#f59e0b", "substation", "#dc2626", "#7c2d12"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.2, "circle-opacity": 0.9 } });
    map.on("click", "nz-point", (e) => { const p = e.features[0].properties; toast(`${p.label}${p.name ? " · " + p.name : ""}`); });
    map.on("click", "nz-line", (e) => { const p = e.features[0].properties; toast(`${p.label}${p.name ? " · " + p.name : ""}`); });

    // 지형 음영 (AWS Terrarium DEM, 키 불필요)
    map.addSource("dem", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terrain: Mapzen/AWS" });
    map.addLayer({ id: "hillshade", type: "hillshade", source: "dem", layout: { visibility: "none" },
      paint: { "hillshade-exaggeration": 0.6, "hillshade-shadow-color": dark ? "#000" : "#4b3d2a", "hillshade-highlight-color": dark ? "#334155" : "#ffffff", "hillshade-accent-color": "#7c5a3a" } }, "school-fill");
    map.on("click", "road-major", (e) => { const p = e.features[0].properties; toast(`${p.name || "이름 없는 큰길"} · ${p.lanes ? p.lanes + "차로 · " : ""}인도 ${p.sidewalk === "yes" ? "있음" : "추정"}`); });
    map.on("click", "school-fill", (e) => { if (!e.originalEvent._mk) toast(`${e.features[0].properties.name} 통학구역 · ${e.features[0].properties.note || ""}`); });
    ["road-major", "school-fill"].forEach((id) => { map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", id, () => map.getCanvas().style.cursor = ""); });

    // 경매
    state.auctions.forEach((a) => {
      const el = document.createElement("div"); el.className = "mk auction";
      el.innerHTML = `⚖️ ${fmtPrice(a.min_price)} <small style="color:#fde68a">${a.fail_count}회 유찰</small>`;
      el.addEventListener("click", (ev) => { ev.stopPropagation(); openDetail(a.complex_id, "half"); });
      const m = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -58] }).setLngLat([a.lng, a.lat]);
      state.aucMarkers.push(m);
    });
    applyLayers();
  }

  const roadTiles = { loaded: new Set(), feats: [], seen: new Set(), index: null, T: 0.02 };
  function loadRoadTiles() {
    if (!state.layers.road || !map.getSource("roads") || map.getZoom() < 13.5) return;
    const idx = roadTiles.index ? Promise.resolve(roadTiles.index) : fetch("data/roads/index.json").then((r) => r.json()).then((j) => { roadTiles.T = j.tile || 0.02; return (roadTiles.index = new Set(j.tiles)); }).catch(() => (roadTiles.index = new Set()));
    idx.then((index) => {
      const b = map.getBounds(), T = roadTiles.T, keys = [];
      for (let r = Math.floor(b.getSouth() / T); r <= Math.floor(b.getNorth() / T); r++)
        for (let c = Math.floor(b.getWest() / T); c <= Math.floor(b.getEast() / T); c++) keys.push(`${r}_${c}`);
      const need = keys.filter((k) => !roadTiles.loaded.has(k) && index.has(k));
      if (!need.length) return;
      Promise.all(need.map((k) => fetch(`data/roads/${k}.geojson`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((gj) => {
        roadTiles.loaded.add(k);
        (gj ? gj.features : []).forEach((f) => {
          const c = f.geometry.coordinates, id = `${c[0]}|${c[c.length - 1]}|${c.length}`;
          if (!roadTiles.seen.has(id)) { roadTiles.seen.add(id); roadTiles.feats.push(f); }
        });
      }))).then(() => map.getSource("roads").setData({ type: "FeatureCollection", features: roadTiles.feats }));
    });
  }
  function circlePoly(lng, lat, r) {
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, pts = [];
    for (let i = 0; i <= 64; i++) { const t = (i / 64) * 2 * Math.PI; pts.push([lng + (r * Math.cos(t)) / kx, lat + (r * Math.sin(t)) / ky]); }
    return pts;
  }
  function drawRange() {
    const src = map.getSource("range"); if (!src) return;
    const c = state.selected && state.complexes.find((x) => x.id === state.selected);
    src.setData({ type: "FeatureCollection", features: c ? [500, 1000].map((r) => ({ type: "Feature", properties: { r }, geometry: { type: "Polygon", coordinates: [circlePoly(c.lng, c.lat, r)] } })) : [] });
  }
  const lazyLoaded = {};
  function lazySource(id, url) {
    if (lazyLoaded[id] || !map.getSource(id)) return;
    lazyLoaded[id] = true;
    fetch(url).then((r) => r.json()).then((gj) => map.getSource(id).setData(gj)).catch(() => { lazyLoaded[id] = false; });
  }
  const LINE_COLORS = { "1호선": "#004A85", "2호선": "#00A23F", "3호선": "#ED6C00", "4호선": "#009BCE", "5호선": "#794698", "6호선": "#7C4932",
    "7호선": "#6E7E31", "8호선": "#D11D70", "9호선": "#A49D87", "신분당선": "#B81B30", "경의중앙선": "#6AC2B3", "경춘선": "#007A62",
    "공항철도": "#0079AC", "서해선": "#5EAC41", "수인분당선": "#ECA300", "GTX-A": "#AB087D", "신림선": "#6789CA", "우이신설선": "#BACC50" };
  const lineBadges = (ls) => (ls || []).map((l) => `<span class="lnb" style="background:${LINE_COLORS[l] || "#64748b"}">${esc(l.replace("호선", "").replace("선", ""))}</span>`).join("");
  function applyCrowns() { const show = map.getZoom() < 13.3; state.crownMarkers.forEach((m) => m.getElement().style.display = show ? "" : "none"); }
  function applyLayers() {
    const v = (ids, on) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
    v(["school-fill", "school-line"], state.layers.school);
    state.schoolMarkers.forEach((m) => m.getElement().style.display = state.layers.school && map.getZoom() >= 13.8 ? "" : "none");
    v(["sub-line-case", "sub-line", "sub-dot", "sub-label", "fut-line", "fut-line-label", "fut-dot", "fut-label"], state.layers.subway);
    if (state.layers.subway) { lazySource("subway-lines", "data/subway_lines.geojson"); lazySource("stations", "data/stations.geojson"); lazySource("future-rail", "data/future_rail.geojson"); }
    v(["road-walk", "road-alley", "road-minor", "road-major", "road-major-far"], state.layers.road);
    v(["hillshade"], state.layers.terrain);
    v(["nz-line", "nz-point"], state.layers.nuisance);
    if (map.getSource("dem")) { map.setTerrain(state.layers.terrain ? { source: "dem", exaggeration: 1.5 } : null); if (!state.layers.terrain && map.getPitch()) map.easeTo({ pitch: 0, bearing: 0 }); }
    $("#terrainLegend").hidden = !state.layers.terrain;
    if (state.layers.road) { lazySource("roads-major", "data/roads_major.geojson"); loadRoadTiles(); }
    if (state.layers.nuisance) lazySource("nuisance", "data/nuisance.geojson");
    v(["am-park", "am-point", "am-label", "range-fill", "range-line"], state.layers.amenity);
    if (state.layers.amenity) { lazySource("amenity", "data/amenities.geojson"); drawRange(); }
    $("#amLegend").hidden = !state.layers.amenity;
    $("#legend").hidden = !state.layers.road;
    state.aucMarkers.forEach((m) => state.layers.auction ? m.addTo(map) : m.remove());
    $$(".lyr[data-layer]").forEach((b) => b.classList.toggle("on", !!state.layers[b.dataset.layer]));
  }

  // ---------- markers ----------
  function renderMarkers() {
    const z = map.getZoom();
    const compact = z < 14.8;
    const W = compact ? 76 : 122, H = compact ? 40 : 54;   // 핀 대략 크기(px), 겹침 판정용
    const byZoom = (c) => !(z < 11.8 || (z < 12.6 && c.trade_count_1y < 40) || (z < 13.2 && c.trade_count_1y < 20) || (z < 14 && c.trade_count_1y < 10) || (z < 14.8 && c.trade_count_1y < 4));
    const vw = map.getContainer().clientWidth, vh = map.getContainer().clientHeight;
    const bb = map.getBounds(), pad = 0.15 * (bb.getNorth() - bb.getSouth());
    const inView = (c) => c.lat > bb.getSouth() - pad && c.lat < bb.getNorth() + pad && c.lng > bb.getWest() - pad && c.lng < bb.getEast() + pad;
    // 우선순위: 선택된 단지 > 검색/필터 일치 > 거래 많은 순. 화면 안에서 서로 겹치면 뒤 순위를 숨김
    const order = state.complexes.filter((c) => inView(c) || c.id === state.selected).sort((a, b) =>
      ((b.id === state.selected) - (a.id === state.selected)) ||
      ((areaMatch(b) && matchQ(b)) - (areaMatch(a) && matchQ(a))) ||
      (b.trade_count_1y - a.trade_count_1y));
    const boxes = [];
    order.forEach((c) => {
      const rep = repArea(c, state.area);
      let m = state.markers[c.id];
      const wanted = (byZoom(c) && inView(c)) || c.id === state.selected;
      if (!wanted) { if (m) { m.remove(); delete state.markers[c.id]; } return; }   // 서울 전체 6천 개 DOM 방지
      if (!m) {
        const el = document.createElement("div"); el.className = "mk";
        el.addEventListener("click", (ev) => { ev.stopPropagation(); openDetail(c.id, "half"); });
        m = state.markers[c.id] = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -4] }).setLngLat([c.lng, c.lat]).addTo(map);
      }
      const el = m.getElement();
      let show = byZoom(c) || c.id === state.selected;
      if (show) {
        const p = map.project([c.lng, c.lat]);
        if (p.x > -W && p.x < vw + W && p.y > -H && p.y < vh + H) {
          const box = { x: p.x - W / 2, y: p.y - H, x2: p.x + W / 2, y2: p.y };
          const hit = boxes.some((b) => !(box.x2 < b.x || box.x > b.x2 || box.y2 < b.y || box.y > b.y2));
          if (hit && c.id !== state.selected) show = false; else boxes.push(box);
        }
      }
      el.style.display = show ? "" : "none";
      el.classList.toggle("compact", compact);
      const dim = !areaMatch(c) || (state.q && !matchQ(c));
      el.classList.toggle("dim", dim);
      el.classList.toggle("sel", state.selected === c.id);
      el.innerHTML = !rep ? `<small>${esc(c.name)}</small><b>-</b>`
        : compact ? `<b>${fmtPrice(rep.latest)}</b><small>${rep.area}㎡</small>`
        : `<small>${esc(c.name.length > 9 ? c.name.slice(0, 9) + "…" : c.name)}</small><b>${fmtPrice(rep.latest)}</b><small>${rep.area}㎡ ${fmtChg(c.chg_1y)}</small>`;
    });
  }
  // ---------- 익명 집계 (세션당 방문 1회, 기능별 1회) ----------
  function hit(t) {
    try {
      if (/^(localhost|127\.|192\.168\.)/.test(location.hostname)) return;   // 로컬 테스트는 집계 안 함
      const k = "jk_" + (t === "visit" ? "v" : t);
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
      if (API && navigator.sendBeacon) navigator.sendBeacon(API + "/hit", JSON.stringify({ t, p: "app", r: document.referrer }));
    } catch (e) { /* 집계 실패는 무시 */ }
  }
  hit("visit");

  // ---------- 출퇴근 시간 ----------
  // 역 그래프(subway_graph.json)에서 회사 역 기준 최단시간(환승 4분 가산)을 구하고,
  // 단지마다 1.5km 안의 역 최대 3곳 중 (도보 + 대기 3분 + 탑승) 최소값을 쓴다.
  let graph = null, cmNear = null;
  async function loadGraph() {
    if (graph) return graph;
    graph = await fetch("data/subway_graph.json").then((r) => r.json());
    const dl = $("#stationList"); if (dl) dl.innerHTML = graph.nodes.map((n) => `<option value="${esc(n[0])}">`).join("");
    return graph;
  }
  const normSt = (s) => (s || "").trim().replace(/\(.*?\)/g, "").replace(/역$/, "");
  function findNode(name) {
    const q = normSt(name); if (!q) return -1;
    let i = graph.nodes.findIndex((n) => n[0] === q);
    if (i < 0) i = graph.nodes.findIndex((n) => n[0].startsWith(q));
    if (i < 0) i = graph.nodes.findIndex((n) => n[0].includes(q));
    return i;
  }
  function commuteTimes(src) {
    const N = graph.nodes.length, L = graph.lines.length, INF = 1e9;
    const adj = new Map();   // key = node*L+line -> [[node, line, min]]
    const linesAt = Array.from({ length: N }, () => new Set());
    for (const [i, j, m, li] of graph.edges) {
      const t = m / 10;
      (adj.get(i * L + li) || adj.set(i * L + li, []).get(i * L + li)).push([j, li, t]);
      (adj.get(j * L + li) || adj.set(j * L + li, []).get(j * L + li)).push([i, li, t]);
      linesAt[i].add(li); linesAt[j].add(li);
    }
    const dist = new Float64Array(N * L).fill(INF), done = new Uint8Array(N * L), best = new Float64Array(N).fill(INF);
    const pq = [];   // 작은 그래프라 정렬 배열 기반 우선순위 큐로 충분
    const push = (d, k) => { let lo = 0, hi = pq.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (pq[mid][0] > d) lo = mid + 1; else hi = mid; } pq.splice(lo, 0, [d, k]); };
    linesAt[src].forEach((li) => { dist[src * L + li] = 0; push(0, src * L + li); });
    while (pq.length) {
      const [d, k] = pq.pop();
      if (done[k]) continue; done[k] = 1;
      const i = Math.floor(k / L), li = k % L;
      if (d < best[i]) best[i] = d;
      for (const [j, l2, t] of adj.get(k) || []) { const nk = j * L + l2; if (!done[nk] && d + t < dist[nk]) { dist[nk] = d + t; push(d + t, nk); } }
      linesAt[i].forEach((l2) => { const nk = i * L + l2; if (l2 !== li && !done[nk] && d + 4 < dist[nk]) { dist[nk] = d + 4; push(d + 4, nk); } });
    }
    return best;
  }
  function nearStations() {
    if (cmNear) return cmNear;
    cmNear = new Map();
    const R = 1500, rad = Math.PI / 180;
    for (const c of state.complexes) {
      const cos = Math.cos(c.lat * rad), cand = [];
      graph.nodes.forEach((n, i) => {
        const dy = (n[1] - c.lat) * 111320, dx = (n[2] - c.lng) * 111320 * cos;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= R) cand.push([i, Math.max(1, Math.round(d / 70))]);
      });
      cand.sort((x, y) => x[1] - y[1]);
      cmNear.set(c.id, cand.slice(0, 3));
    }
    return cmNear;
  }
  function applyCommute() {
    const C = state.commute; if (!C) return;
    const near = nearStations();
    const ta = commuteTimes(C.a.idx), tb = C.b ? commuteTimes(C.b.idx) : null;
    for (const c of state.complexes) {
      const cand = near.get(c.id) || [];
      const pick = (t) => cand.reduce((m, [i, w]) => Math.min(m, w + 3 + t[i]), 1e9);
      c._cmA = cand.length ? Math.round(pick(ta)) : null;
      c._cmB = tb && cand.length ? Math.round(pick(tb)) : null;
      c._cm = c._cmA == null ? null : Math.max(c._cmA, c._cmB == null ? 0 : c._cmB);
    }
  }
  const commuteOk = (c) => !state.commute || (c._cm != null && c._cm <= state.commute.max);
  const commuteTag = (c) => !state.commute || c._cmA == null ? "" :
    `<span class="tag cm">🚉 ${esc(state.commute.a.name)} ${c._cmA}분${state.commute.b && c._cmB != null ? ` · ${esc(state.commute.b.name)} ${c._cmB}분` : ""}</span>`;
  function syncCommuteUrl() {
    const u = new URL(location.href), C = state.commute;
    if (C) u.searchParams.set("cm", [C.a.name, C.b ? C.b.name : "", C.max].join(",")); else u.searchParams.delete("cm");
    history.replaceState(null, "", u);
  }
  async function shareCommute() {
    const C = state.commute; if (!C) return;
    hit("share");
    const url = location.href, text = `${C.a.name}${C.b ? "·" + C.b.name : ""} 출퇴근 ${C.max}분 이내 서울 아파트 | 집콕맵`;
    try { if (navigator.share) return await navigator.share({ title: text, url }); } catch (e) { return; }
    try { await navigator.clipboard.writeText(url); toast("링크를 복사했어요. 배우자에게 보내보세요."); } catch (e) { prompt("이 링크를 복사하세요", url); }
  }
  function updateCommuteChip() {
    const ch = $("#commuteChip"), C = state.commute;
    ch.classList.toggle("on", !!C);
    ch.textContent = C ? `🚉 ${C.a.name}${C.b ? "·" + C.b.name : ""} ${C.max}분 ✕` : "🚉 출퇴근 시간";
    $("#commuteShare").hidden = !C;
  }

  const matchQ = (c) => !state.q || (c.name + c.umd + (c.addr || "") + (c.sgg || "")).toLowerCase().includes(state.q.toLowerCase());

  // ---------- list ----------
  function visibleComplexes() {
    let list = state.complexes.filter((c) => areaMatch(c) && matchQ(c));
    if (!state.q && map.getZoom() >= 12 && state.sort !== "fav" && state.sort !== "budget" && !state.commute) {   // 검색어 없으면 지도 화면 안 단지만
      const bb = map.getBounds();
      list = list.filter((c) => c.lat > bb.getSouth() && c.lat < bb.getNorth() && c.lng > bb.getWest() && c.lng < bb.getEast());
    }
    if (state.sort === "ppy") list.sort((a, b) => (b.ppy || 0) - (a.ppy || 0));
    else if (state.sort === "chg") list.sort((a, b) => (b.chg_1y || 0) - (a.chg_1y || 0));
    else if (state.sort === "school") list = list.filter((c) => c.school.chopuma).sort((a, b) => a.school.elem_dist - b.school.elem_dist);
    else if (state.sort === "gap") list = list.filter((c) => c.jeonse_ratio).sort((a, b) => b.jeonse_ratio - a.jeonse_ratio);
    else if (state.sort === "edu") list = list.filter((c) => c.edu_score != null).sort((a, b) => b.edu_score - a.edu_score);
    else if (state.sort === "eduvalue") list = list.filter((c) => c.edu_band_pct != null).sort((a, b) => a.edu_band_pct - b.edu_band_pct || (b.edu_score || 0) - (a.edu_score || 0));
    else if (state.sort === "fav") { list = state.complexes.filter((c) => favs.ids.has(c.id) && areaMatch(c)); }
    else if (state.sort === "up") list = list.filter((c) => c.up_n).sort((a, b) => (b.up_n - b.risk_n) - (a.up_n - a.risk_n) || b.trade_count_1y - a.trade_count_1y);
    else if (state.sort === "kid") list = list.filter((c) => c.kid != null).sort((a, b) => b.kid - a.kid || b.trade_count_1y - a.trade_count_1y);
    else if (state.sort === "budget" && state.budget) {
      const B = state.budget;
      list = state.complexes.filter((c) => areaMatch(c) && (!B.gu || c.sgg === B.gu) && (!B.gender || !c.mg || c.mg[B.gender === "girl" ? 1 : 0] >= 2))
        .map((c) => {
          // 가족형: 50㎡ 이상 평형 중 예산 안에 드는 것, 100세대 이상 단지만
          const r = B.fam ? (c.households || 0) >= 100 && (c.by_area || []).filter((x) => x.area >= 50 && x.latest && x.latest <= B.max && x.latest >= B.min).sort((x, y) => y.count - x.count)[0]
                          : repArea(c, state.area);
          c._bRep = B.fam ? r || null : null;
          return r && r.latest <= B.max && r.latest >= B.min ? c : null;
        }).filter(Boolean)
        .sort((a, b) => (B.pri === "eduvalue" ? (a.edu_band_pct || 999) - (b.edu_band_pct || 999)
                       : B.pri === "edu" ? (b.edu_score || 0) - (a.edu_score || 0)
                       : (b.kid || 0) - (a.kid || 0)) || b.trade_count_1y - a.trade_count_1y);
    }
    else if (state.commute) list.sort((a, b) => (a._cm ?? 999) - (b._cm ?? 999) || b.trade_count_1y - a.trade_count_1y);
    else list.sort((a, b) => b.trade_count_1y - a.trade_count_1y);
    if (state.commute) list = list.filter(commuteOk);
    return list.slice(0, 150);
  }
  function renderList() {
    const list = visibleComplexes();
    $("#compareBar").hidden = !state.compare.length;
    $("#compareBar").querySelector("span").textContent = `비교 ${state.compare.length}/3`;
    $("#listCount").textContent = state.commute && state.sort !== "fav" ? `출퇴근 ${state.commute.max}분 이내${state.sort === "budget" ? " + 예산" : ""} ${list.length >= 150 ? "150개+" : list.length + "개"}` : state.sort === "budget" ? `예산 조건 ${list.length}개` : state.sort === "fav" ? `찜한 단지 ${list.length}개` : (map.getZoom() >= 12 && !state.q ? `화면 안 단지 ${list.length}개` : `단지 ${list.length}개`);
    $("#alertBar").hidden = !(state.sort === "fav" && list.length && API);
    $("#list").innerHTML = list.map((c) => {
      const rep = (state.sort === "budget" && c._bRep) || repArea(c, state.area);
      const tags = [
        ...(commuteTag(c) ? [commuteTag(c)] : []),
        ...(c.fut && c.fut.dist <= 800 ? [`<span class="tag fut">🚧 ${esc(c.fut.line)} ${esc(c.fut.name)} 예정 ${c.fut.walk_min}분</span>`] : []),
        ...(c.school.chopuma ? [`<span class="tag school">초품아 ${esc(c.school.elem.replace("등학교", ""))}</span>`] : [`<span class="tag">${esc(c.school.elem.replace("등학교", ""))} ${c.school.elem_walk_min}분</span>`]),
        ...c.pros.slice(0, 2).filter((p) => !p.startsWith("초품아")).map((p) => `<span class="tag good">${esc(p)}</span>`),
        ...c.cons.slice(0, 1).map((p) => `<span class="tag bad">${esc(p)}</span>`),
        ...(c.jeonse_ratio ? [`<span class="tag ${c.jeonse_ratio >= 90 ? "bad" : ""}">전세가율 ${c.jeonse_ratio}%</span>`] : []),
        ...(c.sale_type === "혼합" ? [`<span class="tag">분양·임대 혼합</span>`] : []),
        ...(c.sale_type === "임대" ? [`<span class="tag">임대 단지</span>`] : []),
        ...(c.edu_band_pct != null && c.edu_band_pct <= 20 ? [`<span class="tag school">${esc(c.budget_band)}대 학군 상위 ${c.edu_band_pct}%</span>`] : []),
        ...(c.edu_score != null && c.edu_top_pct <= 30 ? [`<span class="tag school">학군 ${c.edu_score}점 · 상위 ${c.edu_top_pct}%</span>`] : []),
        ...(c.terrain && c.terrain.station_dh != null && c.terrain.station_dh >= 30 ? [`<span class="tag bad">언덕 +${c.terrain.station_dh}m</span>`] : []),
        ...(c.nz ? [`<span class="tag bad">기피시설 ${c.nz}</span>`] : []),
        ...(c.kid != null && c.kid_pct <= 25 ? [`<span class="tag school">👶 아이 키우기 ${c.kid}점</span>`] : []),
        ...(c.mg && (c.mg[0] <= 1 || c.mg[1] <= 1) ? [`<span class="tag bad">${c.mg[0] <= 1 ? "아들" : "딸"} 배정 가능 중학교 ${Math.min(...c.mg)}곳</span>`] : []),
        ...(c.risk_n ? [`<span class="tag bad">위험 신호 ${c.risk_n}</span>`] : []),
        ...(c.up_n ? [`<span class="tag good">상승 신호 ${c.up_n}</span>`] : []),
      ].join("");
      return `<div class="card ${state.selected === c.id ? "sel" : ""}" data-id="${c.id}">
        <div><h3>${esc(c.name)}</h3><div class="sub">${esc(c.umd)} · ${c.households ? c.households.toLocaleString() + "세대 · " : ""}${c.built}년 · ${lineBadges(c.station.lines)}${esc(c.station.name)} ${c.station.walk_min}분</div></div>
        <div class="price">${rep ? fmtPrice(rep.latest) : "-"}<small>${rep ? "전용 " + rep.area + "㎡ 실거래" : ""} ${fmtChg(c.chg_1y)}</small></div>
        <div class="tags">${tags}</div>${favBtn(c.id)}</div>`;
    }).join("") || `<div class="muted" style="padding:20px 4px">${state.sort === "fav" ? "찜한 단지가 없어요. 카드의 ♥ 를 눌러보세요." : "조건에 맞는 단지가 없어요."}</div>`;
    $$(".card", $("#list")).forEach((el) => el.addEventListener("click", (e) => { if (e.target.closest(".fav")) { e.stopPropagation(); toggleFav(el.dataset.id); return; } openDetail(el.dataset.id, "full"); }));
  }

  // ---------- detail ----------
  function radarSVG(axes) {
    const keys = Object.keys(axes), n = keys.length, R = 58, cx = 92, cy = 88;
    const pt = (i, v) => { const ang = -Math.PI / 2 + (2 * Math.PI * i) / n; const r = R * v / 100; return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]; };
    const grid = [25, 50, 75, 100].map((v) => `<polygon points="${keys.map((k, i) => pt(i, v).join(",")).join(" ")}" fill="none" stroke="var(--line)" stroke-width="1"/>`).join("");
    const poly = keys.map((k, i) => pt(i, axes[k]).join(",")).join(" ");
    const labels = keys.map((k, i) => { const [x, y] = pt(i, 128); return `<text x="${x}" y="${y}" font-size="10" fill="var(--muted)" text-anchor="middle" dominant-baseline="middle">${esc(k)}</text>`; }).join("");
    return `<svg viewBox="0 0 184 176" style="width:184px;height:176px;flex:0 0 auto">${grid}<polygon points="${poly}" fill="rgba(124,58,237,.25)" stroke="#7c3aed" stroke-width="2"/>${labels}</svg>`;
  }
  function chartSVG(trades, areaSel) {
    const pts = trades.filter((t) => !areaSel || bucket(t.area) === areaSel).map((t) => ({ d: new Date(t.date), v: t.price / (t.area / PY), p: t.price }));
    if (pts.length < 2) return `<div class="muted" style="font-size:13px">거래가 적어 추세를 그릴 수 없어요.</div>`;
    const W = 340, H = 150, L = 8, R = 8, T = 12, B = 22;
    const xs = pts.map((p) => p.d.getTime()), vs = pts.map((p) => p.v);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), v0 = Math.min(...vs) * 0.97, v1 = Math.max(...vs) * 1.03;
    const X = (x) => L + (x - x0) / (x1 - x0 || 1) * (W - L - R), Y = (v) => T + (1 - (v - v0) / (v1 - v0 || 1)) * (H - T - B);
    // 월별 중앙값 선
    const byM = {};
    pts.forEach((p) => { const k = p.d.getFullYear() * 12 + p.d.getMonth(); (byM[k] = byM[k] || []).push(p.v); });
    const line = Object.keys(byM).map(Number).sort((a, b) => a - b).map((k) => {
      const arr = byM[k].sort((a, b) => a - b); const med = arr[Math.floor(arr.length / 2)];
      return [X(new Date(Math.floor(k / 12), k % 12, 15).getTime()), Y(med)];
    });
    const path = line.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const dots = pts.map((p) => `<circle cx="${X(p.d.getTime()).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3" fill="#2563eb" opacity=".45"><title>${p.d.toISOString().slice(0, 10)} ${fmtPrice(p.p)} (평당 ${Math.round(p.v).toLocaleString()}만)</title></circle>`).join("");
    const first = pts[0].d, last = pts[pts.length - 1].d;
    const lab = (d) => `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${path}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linejoin="round"/>${dots}
      <text x="${L}" y="${H - 6}" font-size="11" fill="#94a3b8">${lab(first)}</text>
      <text x="${W - R}" y="${H - 6}" font-size="11" fill="#94a3b8" text-anchor="end">${lab(last)}</text>
      <text x="${W - R}" y="${T}" font-size="11" fill="#94a3b8" text-anchor="end">평당 ${Math.round(v1 / 1.03).toLocaleString()}만</text></svg>`;
  }

  function openDetail(id, sheetState) {
    const c0 = state.complexes.find((x) => x.id === id); if (!c0) return;
    if (!c0.trades) {                       // 요약만 있으면 상세 파일을 받아 합친 뒤 렌더
      state.selected = id; renderMarkers();
      fetch(`data/c/${encodeURIComponent(id)}.json`).then((r) => r.json()).then((full) => { Object.assign(c0, full); openDetail(id, sheetState); })
        .catch(() => toast("상세 정보를 불러오지 못했어요."));
      return;
    }
    const c = c0;
    state.selected = id;
    renderMarkers(); drawRange();
    map.flyTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), 15.2), offset: [0, innerWidth < 900 ? -innerHeight * 0.18 : 0], duration: 700 });
    const areas = c.by_area || [];
    let areaSel = state.area !== "all" && areas.some((a) => bucket(a.area) === state.area) ? state.area : (areas.some((a) => bucket(a.area) === "84") ? "84" : bucket(areas[0].area));
    const aucs = state.auctions.filter((a) => a.complex_id === id);
    const reports = JSON.parse(localStorage.getItem("askReports") || "{}")[id] || [];

    function render() {
      const rep = areas.find((a) => bucket(a.area) === areaSel) || areas[0];
      const ask = c.ask;
      const askLow = ask ? ask.low_ppy * (rep.area / PY) : null, askHigh = ask ? ask.high_ppy * (rep.area / PY) : null;
      const lo = Math.min(rep.latest, askLow || rep.latest) * 0.96, hi = Math.max(rep.latest, askHigh || rep.latest) * 1.04;
      const pos = (v) => ((v - lo) / (hi - lo) * 100).toFixed(1) + "%";
      const age = new Date().getFullYear() - c.built;
      $("#detailView").innerHTML = `
        <div class="d-head"><button class="back" id="backBtn">‹</button>
          <div style="flex:1"><h2>${esc(c.name)} ${favBtn(c.id)}</h2><div class="sub">${esc(c.addr)}${c.households ? ` · <b>${c.households.toLocaleString()}세대</b>` : ""} · ${c.built}년 (${age}년차)${c.max_floor ? ` · 최고 ${c.max_floor}층` : ""}${c.dongs ? ` · ${c.dongs}개동` : ""}${c.far ? ` · 용적률 ${c.far}%` : ""}</div></div></div>

        <div class="section">
          <div class="atabs">${areas.map((a) => `<button class="atab ${bucket(a.area) === areaSel ? "on" : ""}" data-a="${bucket(a.area)}">${a.area}㎡ <span class="muted">${a.pyeong}평형</span></button>`).join("")}</div>
          <div class="hero"><div class="big">${fmtPrice(rep.latest)}<small>최근 실거래 · ${rep.latest_date.slice(2).replace(/-/g, ".")}</small></div>
            <div class="meta">평당 <b>${Math.round(rep.latest / (rep.area / PY)).toLocaleString()}만</b>1년 ${fmtChg(c.chg_1y)} · 거래 ${rep.count}건</div></div>
          ${rep.jeonse ? `<div class="jrow"><span>전세 <b>${fmtPrice(rep.jeonse)}</b></span><span>전세가율 <b class="${rep.jeonse_ratio >= 90 ? "up" : ""}">${rep.jeonse_ratio == null ? "-" : rep.jeonse_ratio + "%"}</b></span><span>갭 <b>${fmtPrice(rep.latest - rep.jeonse)}</b></span><span class="muted">최근 6개월 전세 ${rep.jeonse_n}건</span></div>` : ""}
          ${ask ? `<div class="gapbar"><div class="lbl"><span>실거래 <b>${fmtPrice(rep.latest)}</b></span><span>호가 <b>${fmtPrice(Math.round(askLow))} ~ ${fmtPrice(Math.round(askHigh))}</b></span></div>
            <div class="bar"><span class="pin t" style="left:${pos(rep.latest)}"></span><span class="pin a" style="left:${pos(askLow)}"></span><span class="pin a" style="left:${pos(askHigh)}"></span></div>
            <div class="lbl"><span>호가가 실거래보다 <b class="${ask.gap_pct >= 0 ? "up" : "down"}">${ask.gap_pct >= 0 ? "+" : ""}${ask.gap_pct}%</b> 높음</span><span class="muted">${esc(ask.source)}</span></div></div>` : ""}
          <div id="communityReports"><div class="note">${API ? "제보 불러오는 중…" : "제보 서버 연결 전 (내 기기 저장)"}${reports.length ? " · 내 제보: " + reports.map((r) => fmtPrice(r.price) + " (" + r.date + ")").join(", ") : ""}</div></div>
          <div style="margin-top:12px">${chartSVG(c.trades, areaSel)}</div>
          ${c.phase ? `<div class="note" style="margin-top:8px">📈 지금 국면: <b>${esc(c.phase)}</b></div>` : ""}
        </div>

        ${c.kid ? `<div class="section"><h4>👶 아이 키우기 점수 <span class="r muted">서울 상위 ${c.kid.top_pct}%</span></h4>
          <div style="display:flex;gap:10px;align-items:center">${radarSVG(c.kid.axes)}<div style="flex:1"><div class="big" style="font-size:34px">${c.kid.score}<small>/100</small></div>
            ${Object.entries(c.kid.axes).map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0"><span class="muted">${esc(k)}</span><b>${v}</b></div>`).join("")}</div></div>
          <div class="note">초등 접근·학군·보육/의료·지형/보행·환경/안전·생활 편의 6축 가중 평균. 세 아이 키우는 부모 관점의 참고 지표예요.</div>
          <button class="btn ghost" style="margin-top:10px" id="cmpBtn">${state.compare.includes(c.id) ? "✓ 비교 목록에 있음" : "⚖ 비교 목록에 담기"} (${state.compare.length}/3)</button></div>` : ""}

        ${(() => { const truths = [...c.cons, ...(c.notes || []), ...c.signals.risk].filter((x, i, arr) => arr.indexOf(x) === i); return truths.length ? `<div class="section"><h4>🕵️ 동네 진실 <span class="r muted">광고엔 안 나오는 것</span></h4><div class="plist">${truths.map((p) => `<div class="row info"><i>!</i><span>${esc(p)}</span></div>`).join("")}</div>
          <button class="btn ghost" style="margin-top:10px" id="shareTruthBtn">📋 이 내용 복사해서 공유</button></div>` : ""; })()}

        ${c.signals && (c.signals.risk.length || c.signals.up.length) ? `<div class="section"><h4>위험 · 상승 신호 <span class="r muted">최근 24개월 실거래 기준</span></h4><div class="plist">
          ${c.signals.up.map((p) => `<div class="row good"><i>↑</i><span>${esc(p)}</span></div>`).join("")}
          ${c.signals.risk.map((p) => `<div class="row bad"><i>!</i><span>${esc(p)}</span></div>`).join("")}</div>
          <div class="note">자동 계산 참고용이며 투자 판단의 근거가 아닙니다.</div></div>` : ""}
        <div class="section"><h4>장단점 요약</h4><div class="plist">
          ${c.pros.map((p) => `<div class="row good"><i>+</i><span>${esc(p)}</span></div>`).join("")}
          ${c.cons.map((p) => `<div class="row bad"><i>−</i><span>${esc(p)}</span></div>`).join("")}
          ${(c.notes || []).map((p) => `<div class="row info"><i>i</i><span>${esc(p)}</span></div>`).join("")}
          ${!c.pros.length && !c.cons.length ? `<div class="muted">특이사항 없음</div>` : ""}</div></div>

        <div class="section"><h4>배정 학군 <span class="r muted">${esc(state.meta.zone_note || "초등 통학구역 기준")}</span></h4>
          ${c.edu_score != null ? `<div class="jrow" style="margin:0 0 12px"><span>학군 지수 <b>${c.edu_score}</b>/100</span><span>${esc(areaShort())} <b>${c.edu_rank}위</b> · 상위 ${c.edu_top_pct}%</span><span class="muted">학원 밀집 40 · 초등 전입 25 · 초등 증감 15 · 중학교 20</span></div>` : ""}
          ${c.edu_band_pct != null ? `<div class="jrow" style="margin:0 0 12px"><span>같은 가격대 <b>${esc(c.budget_band)}</b></span><span>이 구간 ${c.edu_band_n}개 단지 중 학군 <b>상위 ${c.edu_band_pct}%</b></span><span class="muted">대표 실거래가로 가격대를 나눠, 비슷한 예산에서 학군이 어느 정도인지 비교합니다</span></div>` : ""}
          <div class="school-hero"><div class="ic">🏫</div><div><b>${esc(c.school.elem)}</b>${c.school.elem_official ? ` <span class="tag school" style="vertical-align:middle">공식 학구</span>` : ""}<div class="n">도보 ${c.school.elem_walk_min}분 (${c.school.elem_dist}m) ${c.school.chopuma ? "· <b style='color:#7c3aed'>초품아</b>" : ""}</div>
            ${c.school.elem_shared && c.school.elem_shared.length ? `<div class="n">공동통학구역: ${c.school.elem_shared.map(esc).join(" / ")} 중 선택 배정</div>` : ""}
            ${c.school.elem_stats ? `<div class="n">학생 ${c.school.elem_stats.students.toLocaleString()}명${c.school.elem_stats.chg_pct != null ? ` (전년 ${fmtChg(c.school.elem_stats.chg_pct)})` : ""} · 학급당 ${c.school.elem_stats.class_size}명${c.school.elem_stats.net_move != null ? ` · 순전입 <b class="${c.school.elem_stats.net_move > 0 ? "up" : c.school.elem_stats.net_move < 0 ? "down" : ""}">${c.school.elem_stats.net_move > 0 ? "+" : ""}${c.school.elem_stats.net_move}명</b>` : ""}${c.school.elem_rank ? ` · 전입 선호 ${c.school.elem_rank[0]}위/${c.school.elem_rank[1]}` : ""}</div>` : ""}</div></div>
          ${c.edu ? `<div class="kv" style="margin-top:12px">
            <div><div class="k">1km 내 교과학원</div><div class="v">${c.edu.exam_1km}개<small>${areaShort()} 상위 ${c.edu.exam_top_pct}%</small></div></div>
            <div><div class="k">1km 내 학원 전체</div><div class="v">${c.edu.aca_1km}개<small>예체능 ${c.edu.art_1km}</small></div></div></div>` : ""}
          ${c.school.middle_zone ? `<div class="n" style="margin-top:10px;font-weight:700">중학교 ${esc(c.school.middle_zone)}</div>` : ""}
          ${c.school.middle_gender ? `<div class="n">학교군 내 공학 ${c.school.middle_gender["공학"]} · 남중 ${c.school.middle_gender["남"]} · 여중 ${c.school.middle_gender["여"]} → <b>아들 ${c.school.middle_gender["공학"] + c.school.middle_gender["남"]}곳 · 딸 ${c.school.middle_gender["공학"] + c.school.middle_gender["여"]}곳</b> 배정 가능</div>` : ""}
          <div class="mids">${(c.school.middle_detail && c.school.middle_detail.length ? c.school.middle_detail.map((m) => `<span class="tag">${esc(m.name)} <span class="muted">${m.dist}m${m.public === "사립" ? " · 사립" : ""}${m.stats ? ` · ${m.stats.students}명 · 학급당 ${m.stats.class_size}` : ""}</span> ${gBadge(m.coedu)}</span>`) : c.school.middle.map((m) => `<span class="tag">${esc(m)}</span>`)).join("")}</div>
          <div class="note">${esc(c.school.middle_note)}${c.school.elem_stats ? " · 학생 수·전출입은 학교알리미 " + c.school.elem_stats.year + "년 공시" : ""}</div>
          ${c.school.high ? `<div class="n" style="margin-top:12px;font-weight:700">고등학교 ${esc(c.school.high.zone || "인근")}${c.school.high.zone_total ? ` <span class="muted">· 일반고 ${c.school.high.zone_total}곳 중 가까운 순</span>` : ""}</div>
          <div class="mids">${c.school.high.general.map((h) => `<span class="tag">${esc(h.name)} <span class="muted">${h.dist}m${h.public === "사립" ? " · 사립" : ""}</span> ${gBadge(h.coedu)}</span>`).join("")}</div>
          ${c.school.high.gender ? `<div class="n" style="margin-top:4px">학교군 일반고: 공학 ${c.school.high.gender["공학"]} · 남고 ${c.school.high.gender["남"]} · 여고 ${c.school.high.gender["여"]} → 아들 ${c.school.high.gender["공학"] + c.school.high.gender["남"]}곳 · 딸 ${c.school.high.gender["공학"] + c.school.high.gender["여"]}곳 지원 가능</div>` : ""}
          ${c.school.high.special.length ? `<div class="mids" style="margin-top:6px">${c.school.high.special.map((h) => `<span class="tag school">${esc(h.type)} ${esc(h.name)} <span class="muted">${(h.dist / 1000).toFixed(1)}km${h.special ? " · " + esc(h.special) : ""}</span></span>`).join("")}</div>` : ""}
          <div class="note">고교는 학교군 내 선지원·추첨 배정(평준화). 자율고·특목고는 전형별 별도 지원. 학교 상세는 <a href="https://www.schoolinfo.go.kr/ei/ss/Pneiss_f01_l0.do?SEARCH_KEYWORD=${encodeURIComponent(c.school.elem)}&SEARCH_TYPE=1" target="_blank" rel="noopener" style="color:var(--brand)">학교알리미</a>에서 학폭 심의 결과·학업성취 등을 직접 확인할 수 있어요.</div>` : ""}</div>

        <div class="section"><h4>교통 · 도로 환경</h4><div class="kv">
          ${c.terrain ? `<div><div class="k">지형</div><div class="v">해발 ${c.terrain.elev}m<small>${c.terrain.station_dh != null ? (c.terrain.station_dh >= 0 ? "역보다 +" : "역보다 ") + c.terrain.station_dh + "m" : ""}${c.terrain.slope_pct != null ? " · 경사 " + c.terrain.slope_pct + "%" : ""}</small></div></div>` : ""}
          ${c.parking ? `<div><div class="k">주차</div><div class="v">${c.parking.toLocaleString()}대<small>세대당 ${c.parking_per_hh || "-"}</small></div></div>` : ""}
          ${state.commute && c._cmA != null ? `<div style="grid-column:1/-1"><div class="k">출퇴근 (추정)</div><div class="v">${esc(state.commute.a.name)}까지 ${c._cmA}분${state.commute.b && c._cmB != null ? ` · ${esc(state.commute.b.name)}까지 ${c._cmB}분` : ""}<small>도보+대기 3분+지하철, 환승 1회당 4분</small></div></div>` : ""}
          ${c.fut ? `<div style="grid-column:1/-1"><div class="k">공사 중 노선 예정역</div><div class="v">🚧 ${esc(c.fut.line)} ${esc(c.fut.name)}역 도보 ${c.fut.walk_min}분 (${c.fut.dist}m)<small>OpenStreetMap 기준 · 개통 시기와 역 위치는 바뀔 수 있어요</small></div></div>` : ""}
          <div><div class="k">가까운 역</div><div class="v">${lineBadges(c.station.lines)}${esc(c.station.name)}<small>${esc(c.station.line)} · ${c.station.walk_min}분</small></div></div>
          <div><div class="k">큰길과 거리</div><div class="v">${c.road.major_dist == null ? "-" : c.road.major_dist + "m"}<small>${c.road.roadside ? "대로변" : c.road.major_dist > 150 ? "이면 · 조용" : "인접"}</small></div></div>
          ${c.station.within_600.length > 1 ? `<div style="grid-column:1/-1"><div class="k">600m 내 역</div><div class="v" style="font-size:13.5px">${c.station.within_600.map((s) => esc(s.name) + " " + s.dist + "m").join(" · ")}</div></div>` : ""}
          </div>
          <button class="btn ghost" style="margin-top:10px" id="roadBtn">🛣️ 지도에서 큰길·골목·인도 보기</button></div>

        ${c.nuisance && Object.keys(c.nuisance).length ? `<div class="section"><h4>기피·주의 시설 <span class="r muted">가까운 순</span></h4>
          ${Object.values(c.nuisance).sort((x, y) => x.dist - y.dist).slice(0, 8).map((v) => `<div class="rep"><span>${v.within ? "⚠️ " : ""}${esc(v.label)}${v.name ? ` <span class="muted">· ${esc(v.name)}</span>` : ""}</span><span class="${v.within ? "up" : "muted"}"><b>${v.dist >= 1000 ? (v.dist / 1000).toFixed(1) + "km" : v.dist + "m"}</b>${v.count > 1 ? ` · ${v.count}곳` : ""}</span></div>`).join("")}
          <div class="note">⚠️ 는 종류별 기준 거리 안(변전소 300m, 유흥·모텔 200m, 송전선·철도 100m 등). 오픈스트리트맵·지방행정 인허가 자료 기준이라 누락이 있을 수 있어요.</div>
          <button class="btn ghost" style="margin-top:10px" id="nzBtn">🚧 지도에서 기피시설 보기</button></div>` : ""}
        ${c.amen && Object.keys(c.amen).length ? `<div class="section"><h4>가까운 주요시설 <span class="r muted">직선거리</span></h4>
          ${["kindergarten", "playground", "clinic_ped", "hospital", "emergency", "mart", "park", "library", "police", "university"].filter((k) => c.amen[k]).map((k) => { const v = c.amen[k]; return `<div class="rep"><span>${esc(v.label)}${v.name ? ` <span class="muted">· ${esc(v.name)}</span>` : ""}${v.area_m2 ? ` <span class="muted">${(v.area_m2 / 10000).toFixed(1)}ha</span>` : ""}</span><span class="${v.dist <= 500 ? "good" : "muted"}" style="${v.dist <= 500 ? "color:var(--good)" : ""}"><b>${v.dist >= 1000 ? (v.dist / 1000).toFixed(1) + "km" : v.dist + "m"}</b></span></div>`; }).join("")}
          ${c.school.cross_major != null ? `<div class="note">🚸 초등 통학로: ${c.school.cross_major ? "<b style='color:var(--bad)'>큰길을 건너야 할 가능성</b> (직선 기준, 지하보도·육교는 반영 안 됨)" : "큰길 횡단 없음 (직선 기준)"}</div>` : ""}
          <button class="btn ghost" style="margin-top:10px" id="amBtn">🏥 지도에서 주요시설 · 반경 500m/1km 보기</button></div>` : ""}
        ${c.life ? `<div class="section"><h4>육아 · 생활 편의 <span class="r muted">단지 반경 기준</span></h4><div class="kv">
          <div><div class="k">어린이집·유치원 (700m)</div><div class="v">${c.life.daycare}곳</div></div>
          <div><div class="k">소아과 (1km)</div><div class="v">${c.life.pediatric}곳</div></div>
          <div><div class="k">병원 (700m) · 약국 (500m)</div><div class="v">${c.life.hospital}<small>· ${c.life.pharmacy}</small></div></div>
          <div><div class="k">대형마트 (1km) · 편의점 (300m)</div><div class="v">${c.life.mart}<small>· ${c.life.convenience}</small></div></div>
          <div><div class="k">공원 (700m)</div><div class="v">${c.life.park}곳</div></div>
          <div><div class="k">도서관 (1km)</div><div class="v">${c.life.library}곳</div></div></div>
          <div class="note">카카오 지도 등록 기준 개수. 소아과는 키워드 검색이라 오차가 있어요.</div></div>` : ""}
        ${aucs.length ? `<div class="section"><h4>경매 물건 <span class="r muted">${esc(aucs[0].court)}</span></h4>
          ${aucs.map((a) => `<div class="auc"><div><b>${esc(a.unit)} · ${a.area}㎡</b><div class="s">${esc(a.case)} · 매각 ${a.sale_date} · ${a.fail_count}회 유찰</div>
            <div class="s">감정가 ${fmtPrice(a.appraisal)} → 최저가 <b>${fmtPrice(a.min_price)}</b>${a.recent_trade ? " · 같은 평형 실거래 " + fmtPrice(a.recent_trade) : ""}</div></div>
            <div class="pct">-${a.discount_pct}%</div></div>`).join("")}
          <div class="note">경매는 권리분석(임차인·선순위 등)이 필수예요. 최저가만 보고 판단하지 마세요.</div></div>` : ""}
        ${(window.APT_CONFIG && window.APT_CONFIG.COURT_LINK) ? `<div class="section"><h4>경매로 나온 물건 확인</h4>
          <div class="courtbox">
            <div class="cb-addr"><span>${esc(c.addr)}</span><button class="cb-copy" data-addr="${esc(c.addr)}">주소 복사</button></div>
            <div class="s">대한민국 법원 <b>법원경매정보</b>에서 이 주소로 직접 조회할 수 있어요. 첫 화면에서 <b>시/도 → 시·군·구 → 동</b>을 고르고 검색하세요.</div>
            <a class="cb-go" href="https://www.courtauction.go.kr" target="_blank" rel="noopener noreferrer">법원경매정보 열기</a>
            <div class="note">대한민국 법원이 운영하는 법원경매정보 사이트로 연결됩니다. 집콕맵과 제휴하거나 추천하는 관계가 아니며, 물건 정보와 권리관계는 해당 사이트와 법원 공고가 기준입니다.</div>
          </div></div>` : ""}

        <div class="section"><h4>실거래 내역 <span class="r muted">최근 ${Math.min(12, c.trades.length)}건</span></h4>
          <table class="tbl"><tr><th>계약일</th><th>평형</th><th>층</th><th class="r">가격</th></tr>
          ${c.trades.slice().reverse().slice(0, 12).map((t) => `<tr><td>${t.date.slice(2).replace(/-/g, ".")}</td><td>${Math.floor(t.area)}㎡</td><td>${t.floor}층</td><td class="r"><b>${fmtPrice(t.price)}</b></td></tr>`).join("")}</table></div>

        <div style="margin-top:14px"><button class="btn" id="reportBtn">이 단지 호가 제보하기</button>
          <a class="btn ghost" style="margin-top:8px" href="apt/${encodeURIComponent(c.id)}.html">📄 단지 상세 페이지 (공유용)</a></div>
        <div class="disclaim">${state.meta.mode === "demo" ? "⚠️ 지금은 데모 데이터입니다. 단지 위치·세대수는 대략값, 가격은 시세 흐름을 흉내낸 생성값이며 학군 경계도 예시입니다. 국토교통부 실거래가 API 키를 연결하면 실데이터로 바뀝니다." : "실거래가: 국토교통부 실거래가 공개시스템 (신고 지연 최대 30일). 학군: 학구도안내서비스 기준, 실제 배정은 교육청 공지를 확인하세요."}</div>`;

      $("#backBtn").onclick = closeDetail;
      $$(".atab").forEach((b) => b.onclick = () => { areaSel = b.dataset.a; render(); });
      if ($("#cmpBtn")) $("#cmpBtn").onclick = () => { toggleCompare(id); render(); };
      if ($("#amBtn")) $("#amBtn").onclick = () => { state.layers.amenity = true; applyLayers(); setSheet("peek"); map.flyTo({ center: [c.lng, c.lat], zoom: 15.3 }); };
      if ($("#shareTruthBtn")) $("#shareTruthBtn").onclick = () => {
        const txt = `[집콕맵] ${c.name} 동네 진실\n` + [...c.cons, ...(c.notes || []), ...c.signals.risk].map((x) => "- " + x).join("\n") + `\nhttps://jipkokmap.kr/?id=${encodeURIComponent(c.id)}`;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("복사했어요. 카톡에 붙여넣기!")).catch(() => prompt("복사해서 공유하세요", txt));
      };
      if ($("#nzBtn")) $("#nzBtn").onclick = () => { state.layers.nuisance = true; applyLayers(); setSheet("peek"); map.flyTo({ center: [c.lng, c.lat], zoom: 15.5 }); };
      $("#roadBtn").onclick = () => { state.layers.road = true; applyLayers(); setSheet("peek"); map.flyTo({ center: [c.lng, c.lat], zoom: 16.5 }); };
      $$(".d-head .fav").forEach((b) => b.onclick = (e) => { e.stopPropagation(); toggleFav(id); });
      $("#reportBtn").onclick = () => openReportModal(c, rep, () => render());
      if (API) api(`/reports?id=${encodeURIComponent(id)}`).then((j) => {
        const box = $("#communityReports"); if (!box) return;
        const rs = j.reports || [];
        box.innerHTML = rs.length ? `<div class="note" style="margin-top:10px">커뮤니티 제보 ${rs.length}건 · <a href="feed.html" style="color:var(--brand)">전체 피드</a></div>` + rs.slice(0, 6).map((r) => `<div class="rep"><span><span class="k ${r.kind}">${r.kind === "deal" ? "실거래" : "호가"}</span>${r.area}㎡ <b>${fmtPrice(r.price)}</b>${r.note ? ` <span class="muted">· ${esc(r.note)}</span>` : ""}</span><span class="muted">${r.date} <button class="flagBtn" data-ts="${r.ts}" title="잘못된 제보 신고">신고</button></span></div>`).join("")
          : `<div class="note">아직 제보가 없어요. 첫 제보를 남겨주세요.</div>`;
        $$(".flagBtn", box).forEach((b) => b.onclick = () => {
          if (!confirm("이 제보를 잘못된 정보로 신고할까요?")) return;
          api("/flag", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ts: Number(b.dataset.ts) }) }).then(() => { b.textContent = "신고됨"; b.disabled = true; }).catch(() => toast("신고에 실패했어요."));
        });
      }).catch(() => { const box = $("#communityReports"); if (box) box.innerHTML = `<div class="note">제보 서버에 연결하지 못했어요.</div>`; });
    }
    render();
    $("#listView").hidden = true; $("#detailView").hidden = false; $("#sheetBody").scrollTop = 0;
    setSheet(sheetState || "half");
  }
  function closeDetail() {
    state.selected = null; drawRange(); $("#detailView").hidden = true; $("#listView").hidden = false;
    renderMarkers(); renderList(); setSheet("half");
  }

  // ---------- 실거래 알림 (이메일) ----------
  $("#alertBtn").addEventListener("click", () => {
    const ids = [...favs.ids]; if (!ids.length) return toast("먼저 단지를 찜해 주세요.");
    const email = prompt("새 실거래가 등록되면 알려드릴 이메일 주소", localStorage.getItem("alertEmail") || "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return email ? toast("이메일 형식을 확인해 주세요.") : null;
    api("/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), ids }) })
      .then((j) => { if (j.error) throw new Error(j.error); localStorage.setItem("alertEmail", email.trim()); toast(`찜한 ${j.n}개 단지의 실거래 알림을 등록했어요.`); })
      .catch(() => toast("알림 등록에 실패했어요."));
  });

  // ---------- 단지 비교 ----------
  function toggleCompare(id) {
    const i = state.compare.indexOf(id);
    if (i >= 0) state.compare.splice(i, 1); else { if (state.compare.length >= 3) return toast("비교는 3개까지예요. 하나를 빼주세요."); state.compare.push(id); }
    localStorage.setItem("compare", JSON.stringify(state.compare)); renderList();
  }
  async function openCompare() {
    const ids = state.compare.slice(0, 3); if (ids.length < 2) return toast("비교할 단지를 2개 이상 담아주세요.");
    const cs = await Promise.all(ids.map(async (id) => { const c = state.complexes.find((x) => x.id === id); if (c && !c.trades) Object.assign(c, await fetch(`data/c/${encodeURIComponent(id)}.json`).then((r) => r.json())); return c; }));
    const rep = (c) => repArea(c, state.area) || (c.by_area || [])[0] || {};
    const rows = [
      ["대표 실거래", (c) => `${fmtPrice(rep(c).latest)} <small class="muted">${rep(c).area}㎡</small>`],
      ["평당가", (c) => c.ppy ? c.ppy.toLocaleString() + "만" : "-"],
      ["1년 변동", (c) => fmtChg(c.chg_1y) || "-"],
      ["전세가율", (c) => c.jeonse_ratio ? c.jeonse_ratio + "%" : "-"],
      ["세대수 / 준공", (c) => `${c.households ? c.households.toLocaleString() + "세대" : "-"} / ${c.built}년`],
      ["👶 아이 키우기", (c) => c.kid ? `<b>${c.kid.score}</b> (상위 ${c.kid.top_pct}%)` : "-"],
      ["학군 지수", (c) => c.edu_score != null ? `${c.edu_score} (상위 ${c.edu_top_pct}%)` : "-"],
      ["같은 가격대 학군", (c) => c.edu_band_pct != null ? `${c.budget_band} 중 상위 ${c.edu_band_pct}%` : "-"],
      ["분양/임대", (c) => c.sale_type || "-"],
      ["배정 초등", (c) => `${esc(c.school.elem)} ${c.school.elem_walk_min}분${c.school.chopuma ? " · 초품아" : ""}`],
      ["가까운 역", (c) => `${esc(c.station.name)} ${c.station.walk_min}분`],
      ["지형", (c) => c.terrain ? `해발 ${c.terrain.elev}m · 경사 ${c.terrain.slope_pct}%` : "-"],
      ["기피시설(기준내)", (c) => { const v = Object.values(c.nuisance || {}).filter((x) => x.within); return v.length ? v.map((x) => esc(x.label) + " " + x.dist + "m").join("<br>") : "없음"; }],
      ["어린이집·소아과", (c) => c.life ? `${c.life.daycare}곳 · ${c.life.pediatric}곳` : "-"],
      ["주차(세대당)", (c) => c.parking_per_hh ? c.parking_per_hh + "대" : "-"],
      ["위험/상승 신호", (c) => `${c.signals.risk.length} / ${c.signals.up.length}`],
      ["국면", (c) => c.phase ? esc(c.phase) : "-"],
    ];
    $("#compareBox").innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">단지 비교</h3><button class="btn ghost" id="cmpClose" style="width:auto;padding:6px 10px">닫기</button></div>
      <div style="overflow-x:auto;margin-top:10px"><table class="tbl cmp"><tr><th></th>${cs.map((c) => `<th><a href="#" data-id="${esc(c.id)}" class="cmpName">${esc(c.name)}</a><br><small class="muted">${esc(c.umd)}</small></th>`).join("")}</tr>
      ${rows.map(([k, f]) => `<tr><th>${k}</th>${cs.map((c) => `<td>${f(c)}</td>`).join("")}</tr>`).join("")}</table></div>
      <div class="note">비교 목록 비우기: <button class="fav" id="cmpClear" style="font-size:13px">🗑 전체 삭제</button></div>`;
    $("#compareModal").hidden = false;
    $("#cmpClose").onclick = () => { $("#compareModal").hidden = true; };
    $("#cmpClear").onclick = () => { state.compare = []; localStorage.setItem("compare", "[]"); $("#compareModal").hidden = true; renderList(); };
    $$(".cmpName").forEach((el) => el.onclick = (e) => { e.preventDefault(); $("#compareModal").hidden = true; openDetail(el.dataset.id, "full"); });
  }
  $("#compareOpen").addEventListener("click", openCompare);
  $("#compareModal").addEventListener("click", (e) => { if (e.target === $("#compareModal")) $("#compareModal").hidden = true; });

  // ---------- 예산으로 찾기 ----------
  $("#commuteChip").addEventListener("click", async () => {
    if (state.commute) { state.commute = null; syncCommuteUrl(); updateCommuteChip(); renderMarkers(); renderList(); return; }
    $("#commuteModal").hidden = false;
    try { await loadGraph(); } catch (e) { toast("노선 정보를 불러오지 못했어요."); }
  });
  $("#commuteModal").addEventListener("click", (e) => { if (e.target === $("#commuteModal")) $("#commuteModal").hidden = true; });
  $("#commuteShare").addEventListener("click", shareCommute);
  $("#commuteClear").addEventListener("click", () => { state.commute = null; syncCommuteUrl(); $("#commuteModal").hidden = true; updateCommuteChip(); renderMarkers(); renderList(); });
  $("#commuteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await loadGraph();
    const f = e.target, ia = findNode(f.a.value), ib = f.b.value.trim() ? findNode(f.b.value) : null;
    if (ia < 0) return toast(`'${f.a.value}' 역을 찾지 못했어요.`);
    if (ib != null && ib < 0) return toast(`'${f.b.value}' 역을 찾지 못했어요.`);
    state.commute = { a: { idx: ia, name: graph.nodes[ia][0] }, b: ib != null ? { idx: ib, name: graph.nodes[ib][0] } : null, max: +f.max.value };
    applyCommute(); syncCommuteUrl(); hit("commute");
    $("#commuteModal").hidden = true; updateCommuteChip(); renderMarkers(); renderList(); setSheet("full");
    const first = visibleComplexes()[0];
    if (first) map.flyTo({ center: [first.lng, first.lat], zoom: 12.5 }); else toast("조건에 맞는 단지가 없어요. 시간을 늘려보세요.");
  });
  $("#budgetChip").addEventListener("click", () => { $("#budgetModal").hidden = false; });
  $("#budgetCancel").addEventListener("click", () => { $("#budgetModal").hidden = true; });
  $("#budgetModal").addEventListener("click", (e) => { if (e.target === $("#budgetModal")) $("#budgetModal").hidden = true; });
  $("#budgetForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const max = Math.round(parseFloat(f.max.value || "0") * 10000), min = Math.round(parseFloat(f.min.value || "0") * 10000);
    if (!max) return toast("최대 예산을 억 단위로 넣어주세요.");
    state.budget = { max, min, gu: f.gu.value, kid: f.kid.checked, gender: f.gender.value, fam: f.area.value === "fam", pri: f.pri ? f.pri.value : "kid" };
    if (f.area.value && f.area.value !== "fam") { state.area = f.area.value; $$("[data-area]").forEach((x) => x.classList.toggle("on", x.dataset.area === state.area)); }
    hit("budget");
    state.sort = "budget"; $$("[data-sort]").forEach((x) => x.classList.toggle("on", x.dataset.sort === "budget"));
    $("#budgetModal").hidden = true; renderMarkers(); renderList(); setSheet("full");
    const first = visibleComplexes()[0]; if (first) map.flyTo({ center: [first.lng, first.lat], zoom: 13 });
  });

  // ---------- 3D 기울이기 ----------
  $("#tiltBtn").addEventListener("click", () => {
    const on = map.getPitch() < 20;
    map.easeTo({ pitch: on ? 58 : 0, bearing: on ? -15 : 0, duration: 800 });
    $("#tiltBtn").textContent = on ? "↩ 평면으로" : "↗ 3D 기울이기";
  });

  // ---------- 제보 모달 ----------
  function openReportModal(c, rep, done) {
    const m = $("#reportModal"), f = $("#reportForm");
    $("#reportTarget").textContent = `${c.name} · ${c.addr || c.umd}`;
    $("#reportArea").innerHTML = (c.by_area || []).map((a) => `<option value="${a.area}" ${a.area === rep.area ? "selected" : ""}>${a.area}㎡</option>`).join("");
    f.reset(); m.hidden = false; f.price.focus();
    $("#reportCancel").onclick = () => { m.hidden = true; };
    m.onclick = (e) => { if (e.target === m) m.hidden = true; };
    f.onsubmit = (e) => {
      e.preventDefault();
      const price = Math.round(parseFloat(f.price.value) * 10000), area = parseFloat(f.area.value);
      if (!price || price < 1000) return toast("가격을 억 단위로 입력해 주세요 (예: 16.5)");
      const body = { id: c.id, name: c.name, area, price, kind: f.kind.value, note: f.note.value.trim(), hp: f.hp.value };
      const local = () => { const all = JSON.parse(localStorage.getItem("askReports") || "{}"); (all[c.id] = all[c.id] || []).push({ price, area, date: new Date().toISOString().slice(0, 10) }); localStorage.setItem("askReports", JSON.stringify(all)); };
      m.hidden = true;
      if (!API) { local(); toast("제보를 이 기기에 저장했어요."); done(); return; }
      api("/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then((j) => { if (j.error) throw new Error(j.error); toast("제보 감사합니다! 바로 반영됐어요."); done(); })
        .catch((err) => { local(); toast(String(err.message).includes("too many") ? "제보가 너무 많아요. 잠시 후 다시." : "서버 오류로 이 기기에만 저장했어요."); done(); });
    };
  }
  // 찜 동기화 코드: ?fav=CODE 로 열면 그 코드의 찜을 불러오고 이후 자동 동기화. 칩을 더블클릭하면 공유 링크 생성
  (function favSync() {
    const q = new URLSearchParams(location.search).get("fav");
    if (q) { favs.code = q.toUpperCase(); localStorage.setItem("favCode", favs.code); }
    if (favs.code && API) api(`/favs?code=${favs.code}`).then((j) => { (j.ids || []).forEach((i) => favs.ids.add(i)); saveFavs(); renderList(); }).catch(() => {});
  })();
  $("#favChip").addEventListener("dblclick", () => {
    if (!API) return toast("제보 서버 연결 후 사용할 수 있어요.");
    if (!favs.code) { favs.code = Math.random().toString(36).slice(2, 8).toUpperCase(); localStorage.setItem("favCode", favs.code); saveFavs(); }
    const link = `${location.origin}${location.pathname}?fav=${favs.code}`;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast("다른 기기용 링크를 복사했어요: " + favs.code)).catch(() => prompt("이 링크를 다른 기기에서 열면 찜이 동기화돼요", link));
  });

  // ---------- sheet ----------
  const sheet = $("#sheet");
  function setSheet(s) { sheet.dataset.state = s; }
  (function dragInit() {
    const grip = $("#grip"); let y0 = 0, h0 = 0, moved = false;
    grip.addEventListener("pointerdown", (e) => { y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; moved = false; sheet.classList.add("dragging"); grip.setPointerCapture(e.pointerId); });
    grip.addEventListener("pointermove", (e) => { if (!sheet.classList.contains("dragging")) return; const dy = y0 - e.clientY; if (Math.abs(dy) > 4) moved = true; sheet.style.height = Math.max(90, Math.min(innerHeight - 20, h0 + dy)) + "px"; });
    const end = () => {
      if (!sheet.classList.contains("dragging")) return;
      sheet.classList.remove("dragging"); const h = sheet.getBoundingClientRect().height; sheet.style.height = "";
      if (!moved) { setSheet(sheet.dataset.state === "peek" ? "half" : sheet.dataset.state === "half" ? "full" : "peek"); return; }
      const cands = { peek: 156, half: innerHeight * 0.52, full: innerHeight - 20 };
      setSheet(Object.keys(cands).sort((a, b) => Math.abs(cands[a] - h) - Math.abs(cands[b] - h))[0]);
    };
    grip.addEventListener("pointerup", end); grip.addEventListener("pointercancel", end);
  })();

  // ---------- controls ----------
  $$("#areaChips .chip").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.area) { state.area = b.dataset.area; $$("[data-area]").forEach((x) => x.classList.toggle("on", x === b)); }
    else { state.sort = state.sort === b.dataset.sort ? null : b.dataset.sort; $$("[data-sort]").forEach((x) => x.classList.toggle("on", x.dataset.sort === state.sort)); }
    renderMarkers(); renderList();
  }));
  $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim(); renderMarkers(); renderList(); if (state.q) setSheet("half"); });
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") { const f = visibleComplexes()[0]; if (f) openDetail(f.id, "half"); e.target.blur(); } });
  $$(".lyr[data-layer]").forEach((b) => b.addEventListener("click", () => { state.layers[b.dataset.layer] = !state.layers[b.dataset.layer]; applyLayers(); }));
  $("#locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return toast("위치 정보를 지원하지 않는 브라우저예요.");
    navigator.geolocation.getCurrentPosition((p) => {
      const ll = [p.coords.longitude, p.coords.latitude];
      new maplibregl.Marker({ color: "#2563eb" }).setLngLat(ll).addTo(map); map.flyTo({ center: ll, zoom: 15 });
    }, () => toast("위치를 가져오지 못했어요."));
  });
  map.on("click", () => { if (state.selected && innerWidth < 900) setSheet("peek"); });
  let zt = null;
  map.on("zoomend", () => { clearTimeout(zt); zt = setTimeout(() => { renderMarkers(); applyLayers(); applyCrowns(); }, 60); });
  map.on("moveend", () => { clearTimeout(zt); zt = setTimeout(() => { renderMarkers(); if (!state.selected) renderList(); }, 60); });

  // ---------- boot ----------
  Promise.all(["complexes", "auctions", "meta"].map((n) => fetch(`data/${n}.json`).then((r) => r.json())))
    .then(([complexes, auctions, meta]) => {
      Object.assign(state, { complexes, auctions, meta });
      // 학군 폴리곤(180KB)은 첫 화면이 뜬 뒤에 받는다
      fetch("data/schools.geojson").then((r) => r.json()).then((schools) => { state.schools = schools; tryAdd(); }).catch(() => {});
      if (meta.mode === "demo") { $("#modeBadge").hidden = false; $("#modeBadge").textContent = "데모 데이터"; }
      $("#areaLabel").textContent = meta.area;
      $("#gapChip").hidden = !complexes.some((c) => c.jeonse_ratio);
      const gus = [...new Set(complexes.map((c) => c.sgg).filter(Boolean))].sort();
      $("#budgetGu").innerHTML = `<option value="">서울 전체</option>` + gus.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
      if (meta.center) map.jumpTo({ center: meta.center, zoom: meta.mode === "real" ? 13.6 : 14.6 });
      const deep = new URLSearchParams(location.search).get("id");   // 정적 페이지 -> 앱 딥링크
      if (deep && complexes.some((c) => c.id === deep)) setTimeout(() => openDetail(deep, "half"), 400);
      const cmq = new URLSearchParams(location.search).get("cm");   // 공유 링크: ?cm=강남,여의도,40
      if (cmq) loadGraph().then(() => {
        const [pa, pb, pm] = cmq.split(","), ia = findNode(pa), ib = pb ? findNode(pb) : null;
        if (ia < 0) return;
        state.commute = { a: { idx: ia, name: graph.nodes[ia][0] }, b: ib != null && ib >= 0 ? { idx: ib, name: graph.nodes[ib][0] } : null, max: +pm || 40 };
        applyCommute(); updateCommuteChip(); renderMarkers(); renderList(); setSheet("full");
      }).catch(() => {});
      // 리스트/마커는 지도 로드와 무관하게 바로, 레이어는 스타일 준비 후
      renderMarkers(); renderList(); setSheet(innerWidth < 900 ? "half" : "full");
      var tryAdd = () => { if (!state.schools || map.getSource("schools")) return; if (map.isStyleLoaded()) addLayers(); else setTimeout(tryAdd, 300); };
    })
    .catch((e) => { console.error(e); toast("데이터를 불러오지 못했어요. pipeline/build.py 를 먼저 실행하세요."); });
})();
