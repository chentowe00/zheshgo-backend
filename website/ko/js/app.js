/* ============================================================
   ZheshGo — shared core (ZHEWAY namespace)
   Data access · save/trip store · demo event log · search
   overlay · shared renderers · header/footer injection · PWA
   ============================================================ */
(function () {
  "use strict";

  var ZW = (window.ZW = window.ZW || {});
  window.ZHEWAY = ZW; // canonical team namespace alias

  /* ---------------- utilities ---------------- */
  ZW.esc = function (s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  ZW.param = function (key) {
    return new URLSearchParams(window.location.search).get(key);
  };
  ZW.toast = function (msg) {
    var t = document.getElementById("zw-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "zw-toast";
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(ZW._toastTimer);
    ZW._toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  };

  /* ---------------- icons (inline SVG) ---------------- */
  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/><path d="M8 11h6M11 8v6"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    assistant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a7 7 0 0 0-4 12.6V19l2.5-1.2c.5.1 1 .2 1.5.2a7 7 0 1 0 0-14Z"/><path d="M9.5 10.5h.01M14.5 10.5h.01M9.5 13.5h5"/></svg>',
    trip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21c-1.8-1.5-3.9-2-6-2s-4.2.5-6 2V5c1.8-1.5 3.9-2 6-2s4.2.5 6 2v16Z"/><path d="M13 5v16"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5C6 16 3 12.5 3 9a4.6 4.6 0 0 1 8.1-3.1L12 7l.9-1.1A4.6 4.6 0 0 1 21 9c0 3.5-3 7-9 11.5Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="5" r="2"/><path d="M12 7.5v5l-2.5 2.5v6M15.5 12.5l2-3 3 .5M12 10l-3-1.5-1 2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.8 14.6c2.4.2 4.1 1.5 4.7 3.9"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.9 7.5 9.5 4.3-1.6 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4.5"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    cameraOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><path d="m3 3 18 18"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>',
  };
  ZW.icon = function (name) { return ICONS[name] || ""; };

  /* ---------------- content access ---------------- */
  ZW.getCity = function (id) {
    var list = ZW.CONTENT.cities.filter(function (c) { return c.id === id && !c.archived; });
    return list[0] || null;
  };
  ZW.getRoute = function (id) {
    var list = ZW.CONTENT.routes.filter(function (r) { return r.id === id && r.status !== "archived"; });
    return list[0] || null;
  };
  ZW.getPlace = function (id) {
    var list = ZW.CONTENT.places.filter(function (p) { return p.id === id && p.status !== "archived"; });
    return list[0] || null;
  };
  ZW.getRoutes = function (filter) {
    filter = filter || {};
    return ZW.CONTENT.routes.filter(function (r) {
      if (r.status === "archived") return false;
      if (filter.city && r.cities.indexOf(filter.city) === -1) return false;
      if (filter.theme && r.themes.indexOf(filter.theme) === -1) return false;
      if (filter.days && r.days > filter.days) return false;
      if (filter.pace && filter.pace !== "any" && r.pace !== filter.pace) return false;
      if (filter.group && filter.group !== "any" && r.groups.indexOf(filter.group) === -1) return false;
      return true;
    });
  };
  ZW.themeName = function (id) { return ZW.THEMES[id] || id; };
  ZW.cityName = function (id) {
    var c = ZW.getCity(id);
    return c ? c.name : id;
  };

  /* ---------------- store (localStorage) ---------------- */
  var LS_KEY_TRIP = "zheway:trip";
  var LS_KEY_EVENTS = "zheway:events";

  ZW.readTrip = function () {
    try {
      var raw = localStorage.getItem(LS_KEY_TRIP);
      if (!raw) return { routes: [], places: [] };
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.routes)) return { routes: [], places: [] };
      if (!Array.isArray(d.places)) d.places = [];
      return d;
    } catch (e) { return { routes: [], places: [] }; }
  };
  ZW.writeTrip = function (trip) {
    try { localStorage.setItem(LS_KEY_TRIP, JSON.stringify(trip)); return true; }
    catch (e) { ZW.toast("저장 공간이 부족하거나 사용할 수 없어 저장 내용이 유지되지 않을 수 있어요."); return false; }
  };
  ZW.isSaved = function (type, id) {
    var t = ZW.readTrip();
    return t[type].indexOf(id) !== -1;
  };
  ZW.toggleSave = function (type, id, label) {
    var t = ZW.readTrip();
    var idx = t[type].indexOf(id);
    if (idx === -1) {
      t[type].push(id);
      if (!ZW.writeTrip(t)) {
        // storage failed: roll back in-memory state, report honestly
        t[type].pop();
        ZW.toast("저장할 수 없어요. ‘저장한 여행’에서 기존 목록을 내보내 주세요.");
        return false;
      }
      ZW.log(type === "routes" ? "save_route" : "save_place", { id: id });
      ZW.toast("저장했어요");
      return true;
    }
    t[type].splice(idx, 1);
    if (!ZW.writeTrip(t)) {
      ZW.toast("저장 공간을 사용할 수 없어 목록을 수정하지 못했어요.");
      return false;
    }
    ZW.log(type === "routes" ? "unsave_route" : "unsave_place", { id: id });
    ZW.toast("여행 목록에서 삭제했어요");
    return false;
  };
  ZW.clearTrip = function () {
    try { localStorage.removeItem(LS_KEY_TRIP); } catch (e) { /* storage blocked */ }
    ZW.toast("저장한 여행을 지웠어요");
  };
  ZW.tripCount = function () {
    var t = ZW.readTrip();
    return t.routes.length + t.places.length;
  };

  /* ---------------- demo event log ---------------- */
  ZW.log = function (task, payload) {
    try {
      var raw = localStorage.getItem(LS_KEY_EVENTS);
      var events = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(events)) events = [];
      events.push({ ts: Date.now(), task: task, payload: payload || {} });
      if (events.length > 500) events = events.slice(events.length - 500);
      localStorage.setItem(LS_KEY_EVENTS, JSON.stringify(events));
    } catch (e) { /* logging must never break the page */ }
    if (window.console && console.debug) console.debug("[zheshgo event]", task, payload || {});
    ZW.sendAnonEvent(task);
  };
  /* Anonymized aggregate reporting: only the task NAME is sent (no
     payload, no session id, no personal data). Used for the admin
     overview trend only. Throttled + batched; failures are silent. */
  ZW._anonQueue = [];
  ZW._anonTimer = null;
  ZW.sendAnonEvent = function (task) {
    try {
      if (String(task).length > 40) return;
      ZW._anonQueue.push(task);
      if (ZW._anonQueue.length > 60) ZW._anonQueue = ZW._anonQueue.slice(-60);
      if (!ZW._anonTimer) {
        ZW._anonTimer = setTimeout(function () {
          ZW._anonTimer = null;
          var batch = ZW._anonQueue.slice();
          ZW._anonQueue = [];
          if (!batch.length) return;
          fetch("/api/v1/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: batch }),
          }).catch(function () { /* offline or no backend — silent */ });
        }, 20000);
      }
    } catch (e) { /* never break the page */ }
  };
  ZW.getEvents = function () {
    try {
      var raw = localStorage.getItem(LS_KEY_EVENTS);
      var events = raw ? JSON.parse(raw) : [];
      return Array.isArray(events) ? events : [];
    } catch (e) { return []; }
  };
  ZW.clearEvents = function () {
    try { localStorage.removeItem(LS_KEY_EVENTS); } catch (e) { /* storage blocked */ }
    ZW.toast("활동 기록을 지웠어요");
  };
  ZW.eventCounts = function () {
    var counts = {};
    ZW.getEvents().forEach(function (ev) { counts[ev.task] = (counts[ev.task] || 0) + 1; });
    return counts;
  };
  ZW.sessionId = (function () {
    try {
      var id = sessionStorage.getItem("zheway:session");
      if (!id) { id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); sessionStorage.setItem("zheway:session", id); }
      return id;
    } catch (e) {
      // storage blocked — in-memory fallback so the shell still boots
      return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
  })();

  /* ---------------- status / trust badges ---------------- */
  ZW.verifyBadge = function (entity) {
    var verified = entity && entity.status === "verified" && entity.verified === true;
    if (verified) {
      var d = entity.lastVerifiedDate || ZW.CONTENT.meta.lastUpdated;
      return '<span class="pill-verify" style="background:var(--bamboo-soft);color:var(--bamboo);border-color:#C9D8C4">' + ZW.icon("check") +
        " 확인됨 " + ZW.esc(d) +
        (entity.source ? " · " + ZW.esc(ZW.label(entity.source)) : "") + "</span>";
    }
    return '<span class="pill-verify" title="' + ZW.esc(entity && entity.source ? entity.source : "데모 자료(미확인)") + '">' +
      ZW.icon("warn") + " 출발 전 확인해 주세요</span>";
  };
  ZW.provenance = function(entity){
    var l=ZW.CONTENT.meta.provenanceLabels;
    if(!entity||!l)return '';
    return '<details class="trust-details"><summary>'+ZW.esc(l.heading)+'</summary><p>'+ZW.esc(l.source)+ZW.esc(ZW.label(entity.source||l.noSource))+'</p><p>'+ZW.esc(l.checked)+ZW.esc(entity.lastVerifiedDate||l.unverified)+'</p><p>'+ZW.esc(l.translation)+ZW.esc(entity.translationUpdatedAt||l.noDate)+'</p></details>';
  };
  ZW.demoPill = function (text) {
    return '<span class="pill-demo">' + ZW.icon("info") + " " + ZW.esc(text || "데모 예시") + "</span>";
  };

  /* ---------------- save heart ---------------- */
  ZW.saveHeart = function (type, id) {
    var saved = ZW.isSaved(type, id);
    return (
      '<button class="save-btn' + (saved ? " saved" : "") + "\" type=\"button\" data-save-type=\"" + type +
      '" data-save-id="' + ZW.esc(id) + '" aria-pressed="' + saved + '" aria-label="' +
      (saved ? "여행 목록에서 삭제" : "여행 목록에 저장") + '">' + ZW.icon("heart") + "</button>"
    );
  };
  ZW.bindSaveButtons = function (scope) {
    scope = scope || document;
    scope.querySelectorAll(".save-btn").forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var type = btn.getAttribute("data-save-type");
        var id = btn.getAttribute("data-save-id");
        var saved = ZW.toggleSave(type, id);
        btn.classList.toggle("saved", saved);
        btn.setAttribute("aria-pressed", saved ? "true" : "false");
        btn.setAttribute("aria-label", saved ? "여행 목록에서 삭제" : "여행 목록에 저장");
        ZW.refreshTripBadge();
      });
    });
  };
  ZW.refreshTripBadge = function () {
    var n = ZW.tripCount();
    document.querySelectorAll(".trip-count").forEach(function (el) {
      el.textContent = n;
      el.style.display = n > 0 ? "inline-flex" : "none";
    });
  };

  /* ---------------- header / footer / bottom nav ---------------- */
  var IS_APP = document.body && document.body.getAttribute("data-app") === "app";
  var NAV = IS_APP
    ? [
        { href: "index.html", label: "홈", key: "home", icon: "home" },
        { href: "explore.html", label: "여행지·코스", key: "explore", icon: "explore" },
        { href: "planner.html", label: "여행 계획", key: "plan", icon: "plan" },
        { href: "assistant.html", label: "AI 상담", key: "assistant", icon: "assistant" },
        { href: "photo-guide.html", label: "사진 가이드", key: "photoguide", icon: "camera" },
      ]
    : [
        { href: "index.html", label: "홈", key: "home", icon: "home" },
        { href: "explore.html", label: "여행지·코스", key: "explore", icon: "explore" },
        { href: "planner.html", label: "여행 계획하기", key: "plan", icon: "plan" },
        { href: "assistant.html", label: "AI 여행 도우미", key: "assistant", icon: "assistant" },
        { href: "my-trip.html", label: "저장한 여행", key: "trip", icon: "trip" },
      ];
  ZW.renderShell = function () {
    var page = document.body.getAttribute("data-page") || "";
    var header = document.getElementById("site-header");
    if (header) {
      var navLinks = NAV.map(function (n) {
        var cur = page === n.key ? " aria-current=\"page\"" : "";
        return '<a href="' + n.href + '"' + cur + ">" + ZW.esc(ZW.label(n.label)) + "</a>";
      }).join("");
      var tripCount = ZW.tripCount();
      header.innerHTML =
        '<div class="wrap header-inner">' +
        '<a class="brand" href="index.html" aria-label="ZheshGo 홈">' +
        '<img class="brand-mark" src="' + (IS_APP ? "../" : "") + 'assets/img/brand-mark.svg" alt="" width="34" height="34"/>' +
        "<span><span class=\"brand-name\">ZheshGo</span><br/><span class=\"brand-sub\">浙沪 · 行</span></span>" +
        "</a>" +
        '<nav class="main-nav" aria-label="주 메뉴">' + navLinks + "</nav>" +
        '<div class="header-actions">' +
        '<button class="icon-btn nav-only" type="button" data-open-search aria-label="가이드와 코스 검색">' + ZW.icon("search") + "</button>" +
        '<a class="icon-btn nav-only" href="my-trip.html" aria-label="저장한 여행">' + ZW.icon("heart") +
        '<span class="trip-count" style="display:' + (tripCount > 0 ? "inline-flex" : "none") +
        ";position:absolute;margin:22px 0 0 22px;background:var(--sandal);color:#fff;border-radius:999px;font-size:.62rem;min-width:16px;height:16px;align-items:center;justify-content:center;padding:0 4px;font-weight:700;\">" +
        tripCount + "</span></a>" +
        "</div></div>";
      var sbtn = header.querySelector("[data-open-search]");
      if (sbtn) sbtn.addEventListener("click", function () { ZW.openSearch(); });
    }
    var footer = document.getElementById("site-footer");
    if (footer) {
      var M = ZW.CONTENT.meta;
      footer.innerHTML =
        '<div class="wrap">' +
        '<div class="footer-grid">' +
        '<div class="footer-brand">' +
        '<a class="brand" href="index.html"><img class="brand-mark" src="' + (IS_APP ? "../" : "") + 'assets/img/brand-mark.svg" alt="" width="30" height="30"/>' +
        "<span><span class=\"brand-name\" style=\"color:var(--on-night)\">ZheshGo</span></span></a>" +
        "<p>상하이·저장성 여행자를 위한 실용 가이드. 아직 확인하지 않은 정보는 표시해요.</p>" +
        "</div>" +
        "<div class=\"footer-col\"><h4>여행지</h4><ul>" +
        ZW.CONTENT.cities.map(function (c) {
          return '<li><a href="city.html?id=' + c.id + '">' + ZW.esc(c.name) + "</a></li>";
        }).join("") +
        "</ul></div>" +
        "<div class=\"footer-col\"><h4>여행 계획</h4><ul>" +
        "<li><a href=\"explore.html\">코스 찾기</a></li>" +
        "<li><a href=\"planner.html\">여행 계획하기</a></li>" +
        "<li><a href=\"assistant.html\">AI에게 물어보기</a></li>" +
        "<li><a href=\"consult.html\">여행 상담 요청</a></li>" +
        "</ul></div>" +
        "<div class=\"footer-col\"><h4>서비스와 정보 기준</h4><ul>" +
        "<li><a href=\"about.html\">콘텐츠 운영 기준 보기</a></li>" +
        "<li><a href=\"faq.html\">여행 FAQ</a></li>" +
        "<li><a href=\"community.html\">여행 이야기(데모)</a></li>" +
        "<li><a href=\"privacy.html\">개인정보와 데이터</a></li>" +
        (IS_APP
          ? "<li><a href=\"photo-guide.html\">사진 가이드(App 기능)</a></li>"
          : "<li><a href=\"app/index.html\">ZheshGo App 이용하기</a></li>") +
        "</ul></div></div>" +
        '<div class="footer-note">' +
        "<span>" + ZW.esc(M.contentStatus) + " · 기본 자료 업데이트 " + ZW.esc(M.lastUpdated) + "</span>" +
        "<a href=\"events.html\">데모 활동 기록</a>" +
        "<span>예약 플랫폼이 아니에요. AI 제안은 예약 완료를 뜻하지 않아요.</span>" +
        "</div></div>";
    }
    var bottom = document.getElementById("bottom-nav");
    if (bottom) {
      bottom.innerHTML = NAV.map(function (n) {
        var cur = page === n.key ? " aria-current=\"page\"" : "";
        return '<a href="' + n.href + '"' + cur + ">" + ZW.icon(n.icon) + '<span class="bn-label">' + ZW.esc(ZW.label(n.label)) + "</span></a>";
      }).join("");
    }
    ZW.refreshTripBadge();
  };

  /* ---------------- global search overlay ---------------- */
  ZW.openSearch = function () {
    var trigger = document.activeElement;
    var ov = document.getElementById("search-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "search-overlay";
      ov.className = "search-overlay";
      ov.setAttribute("role", "dialog");
      ov.setAttribute("aria-modal", "true");
      ov.setAttribute("aria-label", "ZheshGo 검색");
      ov.innerHTML =
        '<div class="search-panel">' +
        '<div class="search-row">' + ZW.icon("search") +
        '<input type="search" id="zw-search-input" placeholder="도시·코스·장소·질문 검색" aria-label="검색"/>' +
        '<button class="icon-btn" type="button" data-close-search aria-label="검색 닫기">' + ZW.icon("x") + "</button>" +
        "</div>" +
        '<div class="search-results" id="zw-search-results" role="listbox"></div>' +
        "</div>";
      document.body.appendChild(ov);
      var input = ov.querySelector("#zw-search-input");
      input.addEventListener("input", function () { ZW.runSearch(input.value); });
      ov.querySelector("[data-close-search]").addEventListener("click", ZW.closeSearch);
      ov.addEventListener("click", function (e) { if (e.target === ov) ZW.closeSearch(); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && ov.classList.contains("open")) ZW.closeSearch();
      });
    }
    ov._returnFocus = trigger instanceof HTMLElement ? trigger : null;
    ov.classList.add("open");
    var inp = ov.querySelector("#zw-search-input");
    inp.value = "";
    ZW.runSearch("");
    setTimeout(function () { inp.focus(); }, 30);
    ZW.log("search_open", {});
  };
  ZW.closeSearch = function () {
    var ov = document.getElementById("search-overlay");
    if (!ov) return;
    ov.classList.remove("open");
    if (ov._returnFocus && typeof ov._returnFocus.focus === "function") {
      try { ov._returnFocus.focus(); } catch (e) { /* element may be gone */ }
    }
  };
  ZW.runSearch = function (q) {
    var box = document.getElementById("zw-search-results");
    if (!box) return;
    q = (q || "").trim().toLowerCase();
    var hits = [];
    var C = ZW.CONTENT;
    C.cities.forEach(function (c) {
      var hay = (c.name + " " + (c.originalName||"") + " " + (c.latinName||"") + " " + (c.searchAliases||[]).join(" ") + " " + c.tagline + " " + c.role).toLowerCase();
      if (hay.indexOf(q) !== -1) hits.push({ type: "city", title: c.name, sub: "여행지 — " + c.role, href: "city.html?id=" + c.id });
    });
    C.routes.forEach(function (r) {
      var hay = (r.title + " " + r.themes.join(" ") + " " + r.summary).toLowerCase();
      if (hay.indexOf(q) !== -1) hits.push({ type: "route", title: r.title, sub: "코스 — " + r.days + "일" + "" + " · " + r.pace, href: "route.html?id=" + r.id });
    });
    C.places.forEach(function (p) {
      var hay = (p.name + " " + (p.originalName||"") + " " + (p.latinName||"") + " " + p.type + " " + p.blurb).toLowerCase();
      if (hay.indexOf(q) !== -1) hits.push({ type: "place", title: p.name, sub: "장소 — " + p.type, href: "place.html?id=" + p.id });
    });
    C.faqs.forEach(function (f) {
      var hay = (f.q + " " + f.a + " " + f.tags.join(" ")).toLowerCase();
      if (hay.indexOf(q) !== -1) hits.push({ type: "faq", title: f.q, sub: "여행 질문", href: "faq.html#q-" + f.id });
    });
    if (!q) hits = [];
    ZW.log("search", { q: q, hits: hits.length });
    if (hits.length === 0) {
      box.innerHTML = "<div class=\"search-empty\">검색 결과가 없어요: “" + ZW.esc(q || "") + "”.<br/>‘닝보’, ‘해산물’, ‘기차’, ‘결제’ 등으로 찾아보세요.</div>";
      return;
    }
    box.innerHTML = hits.slice(0, 30).map(function (h) {
      var icon = h.type === "city" ? "explore" : h.type === "route" ? "plan" : h.type === "place" ? "walk" : "message";
      return (
        '<a class="search-result" href="' + ZW.esc(h.href) + '">' +
        '<span class="ico">' + ZW.icon(icon) + "</span>" +
        "<span><b>" + ZW.esc(h.title) + "</b><span>" + ZW.esc(h.sub) + "</span></span></a>"
      );
    }).join("");
  };

  /* ---------------- shared card renderers ---------------- */
  ZW.cityCard = function (c) {
    return (
      '<a class="dest-card" href="city.html?id=' + c.id + '">' +
      '<span class="dest-art"><img src="' + ZW.esc(c.art) + '" alt="" loading="lazy"/></span>' +
      '<span class="dest-scrim"></span>' +
      (c.gateway ? "<span class=\"dest-badge\">대표 출발 도시</span>" : c.preview ? "<span class=\"dest-badge\">미리보기</span>" : "") +
      '<span class="dest-body"><span class="dest-zh">' + ZW.esc(c.zh) + "</span>" +
      '<span class="dest-name" style="display:block">' + ZW.esc(c.name) + "</span>" +
      '<span class="dest-tag">' + ZW.esc(c.role) + "</span></span></a>"
    );
  };
  ZW.routeCard = function (r) {
    var city = ZW.getCity(r.city);
    var art = city ? city.art : "assets/img/hero-art.svg";
    var saved = ZW.isSaved("routes", r.id);
    return (
      '<article class="card route-card">' +
      '<div class="card-media" style="position:relative">' +
      '<a href="route.html?id=' + r.id + '" aria-label="코스 보기: ' + ZW.esc(r.title) + '"><img src="' + ZW.esc(art) + '" alt="" loading="lazy"/></a>' +
      ZW.saveHeart("routes", r.id) +
      "</div>" +
      '<div class="card-body">' +
      '<span class="theme-tag">' + ZW.esc(ZW.label(r.theme)) + "</span>" +
      '<h3 class="card-title"><a href="route.html?id=' + r.id + '">' + ZW.esc(r.title) + "</a></h3>" +
      '<div class="route-facts">' +
      "<span>" + ZW.icon("clock") + " " + r.days + "일" + "" + "</span>" +
      "<span>" + ZW.icon("walk") + " " + ZW.esc(ZW.label(r.pace)) + " 여행 속도</span>" +
      "<span>" + ZW.icon("users") + " " + ZW.esc(r.groups.map(ZW.label).join(" · ")) + "</span>" +
      "</div>" +
      '<p class="card-desc" style="margin-top:8px">' + ZW.esc(r.summary) + "</p>" +
      '<div style="margin-top:10px">' + ZW.verifyBadge(r) + "</div>" +
      "</div></article>"
    );
  };
  ZW.placeCard = function (p) {
    var city = ZW.getCity(p.city);
    return (
      '<article class="card">' +
      '<div class="card-body" style="position:relative">' +
      ZW.saveHeart("places", p.id) +
      '<span class="theme-tag">' + ZW.esc(p.type) + "</span>" +
      '<h3 class="card-title"><a href="place.html?id=' + p.id + '">' + ZW.esc(p.name) + "</a></h3>" +
      '<p class="card-meta">' + (city ? city.name : "") + "</p>" +
      '<p class="card-desc">' + ZW.esc(p.blurb) + "</p>" +
      "</div></article>"
    );
  };

  /* ---------------- page helpers ---------------- */
  ZW.notFound = function (title) {
    document.title = "찾을 수 없어요 · ZheshGo";
    var el = document.getElementById("detail");
    if (el) {
      el.innerHTML =
        '<div class="empty"><div class="empty-art">' + ZW.icon("search") + "</div>" +
        "<h3>" + ZW.esc(title || "콘텐츠를 찾을 수 없어요") + "</h3>" +
        "<p>주소가 바뀌었거나 아직 준비 중인 가이드예요.</p>" +
        "<a class=\"btn btn-primary\" href=\"explore.html\">모든 가이드 보기</a></div>";
    }
    ZW.log("error", { task: "not_found", url: location.href });
  };

  /* ---------------- PWA ---------------- */
  ZW.registerSW = function () {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && !/localhost|127\.0\.0\.1/.test(location.hostname)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (err) {
        if (console && console.warn) console.warn("SW registration skipped:", err);
      });
    });
  };

  /* ---------------- boot ---------------- */
  ZW.boot = function () {
    ZW.renderShell();
    ZW.bindSaveButtons();
    ZW.registerSW();
    if (document.body.getAttribute("data-page")) {
      ZW.log("view_" + document.body.getAttribute("data-page"), { url: location.pathname });
    }
  };

  document.addEventListener("DOMContentLoaded", ZW.boot);
})();
