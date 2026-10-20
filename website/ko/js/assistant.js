/* ============================================================
   ZheshGo — assistant (SIMULATED demo engine)
   ------------------------------------------------------------------
   REAL INTEGRATION (not used in this demo):
   1) Deploy a small server-side proxy:  POST /api/v1/assistant/chat
      Keep the LLM key in the server environment variable
      (e.g. ZHESHGO_LLM_KEY). Never ship a key to the browser.
   2) The proxy stitches site content (js/data/content.js JSON)
      into the prompt context, then calls the model (e.g. DeepSeek).
   3) Response contract: { code, message, data: { reply, sources } }
      Frontend renders data.reply and lists data.sources.
   This file implements the same UI contract with a local
   rule-based engine, clearly labeled as simulated.
   ============================================================ */
(function () {
  "use strict";

  var ZW = window.ZW;
  var C = ZW.CONTENT;

  // Live AI backend base URL (configurable; empty = same-origin).
  // Set via window.ZW_CONFIG.assistantApiBase (see js/config.js) after the
  // backend is deployed. This holds only a URL — never the API key.
  var API_BASE = "";
  if (window.ZW_CONFIG && typeof window.ZW_CONFIG.assistantApiBase === "string") {
    API_BASE = window.ZW_CONFIG.assistantApiBase.replace(/\/+$/, "");
  }
  function apiUrl(p) { return API_BASE + p; }

  var tokenize = function (s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function (w) { return w.length > 1; });
  };

  var stopWords = { the: 1, and: 1, for: 1, with: 1, from: 1, what: 1, about: 1, your: 1, you: 1, i: 1, a: 1, an: 1, is: 1, are: 1, to: 1, of: 1, in: 1, do: 1, can: 1, how: 1, my: 1, me: 1, it: 1, there: 1, some: 1, any: 1, we: 1, should: 1, need: 1 };

  /* ---------------- answer sources ---------------- */
  function faqScore(f, toks, q) {
    var score = 0;
    var ql = q.toLowerCase();
    toks.forEach(function (t) {
      if (stopWords[t]) return;
      f.tags.forEach(function (tag) {
        if (tag === t) score += 3;
        else if (tag.indexOf(t) !== -1 || t.indexOf(tag) !== -1) score += 1;
      });
    });
    var words = tokenize(f.q);
    words.forEach(function (w) {
      if (stopWords[w]) return;
      if (toks.indexOf(w) !== -1) score += 2;
      else if (ql.indexOf(w) !== -1) score += 1;
    });
    return score;
  }

  function findCity(q) {
    return C.cities.filter(function (c) {
      return new RegExp("\\b" + c.name.toLowerCase() + "\\b", "i").test(q);
    });
  }
  function findRoute(q) {
    return C.routes.filter(function (r) {
      var t = r.title.toLowerCase();
      return q.toLowerCase().indexOf(t.slice(0, 24)) !== -1 || t.split(" ").slice(0, 3).every(function (w) { return q.toLowerCase().indexOf(w.toLowerCase()) !== -1; });
    });
  }
  function findPlace(q) {
    return C.places.filter(function (p) {
      var words = p.name.toLowerCase().split(" ").filter(function (w) { return w.length > 3; });
      return words.some(function (w) { return q.toLowerCase().indexOf(w) !== -1; });
    });
  }

  function replySources(list) {
    var names = [];
    C.routes.forEach(function (r) { if (list.indexOf("route:" + r.id) !== -1) names.push("코스 \"" + r.title + '"'); });
    C.places.forEach(function (p) { if (list.indexOf("place:" + p.id) !== -1) names.push("\"" + p.name + "\" 가이드"); });
    C.faqs.forEach(function (f) { if (list.indexOf("faq:" + f.id) !== -1) names.push("여행 FAQ"); });
    return names.length ? names.join(", ") : "our site guides";
  }

  /* ---------------- the engine ---------------- */
  function answer(q) {
    var toks = tokenize(q);
    var ql = q.toLowerCase();

    // 0 · greeting / small talk
    if (/^(hi|hello|hey|good (morning|afternoon|evening))/.test(ql) && ql.length < 30) {
      return {
        text: "안녕하세요. ZheshGo 모의 도우미예요. 사이트의 상하이·항저우·닝보 자료에서 코스와 기차, 결제, 먹거리를 안내해요. 이 모드에는 실제 AI가 연결되지 않았어요.",
        sources: [],
      };
    }

    // 1 · FAQ match
    var scored = C.faqs.map(function (f) { return { f: f, s: faqScore(f, toks, q) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; });
    if (scored.length && scored[0].s >= 4) {
      var f = scored[0].f;
      return { text: f.a, sources: ["faq:" + f.id], faqId: f.id };
    }

    // 2 · multi-entity comparison (2+ cities)
    var cities = findCity(q);
    if (cities.length >= 2) {
      var names = cities.map(function (c) { return c.name; }).join(" 및 ");
      return {
        text: "비교 중인 여행지: " + names + ". " + cities.map(function (c) { return c.name + ": " + c.tagline; }).join(" ") +
          ". 두 도시 모두 가이드가 있어요. " + cities.map(function (c) { return "다음 <a href=\"city.html?id=" + c.id + '">' + c.name + " 가이드</a>"; }).join(" 및 ") +
          "에서 코스와 기본 정보를 볼 수 있어요. 도시 간 철도 이동 시간은 날짜별로 확인해 주세요. 현재는 확인 전 데모 답변이에요.",
        sources: cities.map(function (c) { return "city:" + c.id; }),
      };
    }

    // 3 · specific route
    var routes = findRoute(q);
    if (routes.length === 1) {
      var r = routes[0];
      return {
        text: "코스 초안: “" + r.title + "” — " + r.days + "일" + "" + ", " + ZW.label(r.pace) + " 속도 · 추천 동행인: " + r.groups.map(ZW.label).join(", ") + ". " +
          r.summary + " 일차별 내용은 <a href=\"route.html?id=" + r.id + "\">코스 페이지</a>에서 확인하고 출발 전 확인 목록도 살펴보세요.",
        sources: ["route:" + r.id],
      };
    }

    // 4 · planning intent
    if (/(plan|itinerar|trip|days|schedule|week)/.test(ql) && (/\d/.test(q) || toks.indexOf("days") !== -1 || toks.indexOf("trip") !== -1 || toks.indexOf("plan") !== -1)) {
      var dayN = parseInt((q.match(/\d+/) || [])[0], 10) || 2;
      var city = cities[0];
      var pool = ZW.getRoutes({ city: city ? city.id : null, days: dayN });
      pool = pool.slice(0, 3);
      if (pool.length === 0) pool = ZW.getRoutes({}).slice(0, 3);
      return {
        text: "여행 기간 약 " + dayN + "일" + (dayN > 1 ? "s" : "") + (city ? " · 도시 " + city.name : "") + "에 맞춰 이런 코스를 살펴볼 수 있어요.<ul>" +
          pool.map(function (r) {
            return '<li><a href="route.html?id=' + r.id + '">' + r.title + "</a> — " + r.days + "일" + "" + ", " + ZW.label(r.pace) + " 속도. " + r.summary.slice(0, 90) + "…</li>";
          }).join("") +
          "</ul>다음 도구를 이용해 보세요: <a href=\"planner.html\">여행 계획 도구</a>. 여행 속도와 동행인에 따라 비교할 수 있어요. 추천 결과는 예약된 상품이 아니에요.",
        sources: pool.map(function (r) { return "route:" + r.id; }),
      };
    }

    // 5 · single city or place
    if (cities.length === 1) {
      var c = cities[0];
      return {
        text: c.name + ": " + c.tagline + " 상세 가이드도 있어요. <a href=\"city.html?id=" + c.id + "\">가이드 보기: " + c.name + " 가이드</a>에서 기본 정보와 코스, 장소를 확인해 보세요. 교통·먹거리·하루 일정 중 무엇이 궁금한가요?",
        sources: ["city:" + c.id],
      };
    }
    var places = findPlace(q);
    if (places.length === 1) {
      var p = places[0];
      return {
        text: p.name + " — " + p.blurb + " 다음 <a href=\"place.html?id=" + p.id + "\">장소 가이드</a>에서 이용 정보를 확인해 보세요. 운영 시간과 입장권은 방문 전 공식 안내를 확인해 주세요.",
        sources: ["place:" + p.id],
      };
    }

    // 6 · emergency / visa / legal — no definitive answers
    if (/(visa|emergency|hospital|doctor|police|legal|law|ambulance)/.test(ql)) {
      return {
        text: "비자·법률·의료에 관한 개인별 판단은 하지 않아요. 입국 규정은 해당 중국 대사관·영사관에 확인해 주세요. 중국 긴급 신고는 경찰 110, 구급 120, 소방 119예요. 긴급한 상황이면 현지 기관에 바로 도움을 요청하세요.",
        sources: [],
        sensitive: true,
      };
    }

    // 7 · fallback
    var suggestions = C.faqs.slice(0, 3).map(function (f) { return f.q; });
    return {
      text: "사이트의 데모 자료에서 맞는 내용을 찾지 못했어요. 다음 주제로 물어보세요.<ul>" +
        suggestions.map(function (s) { return "<li>" + s + "</li>"; }).join("") +
        "</ul>또는 <a href=\"explore.html\">가이드</a> / <a href=\"faq.html\">자주 묻는 질문</a>를 둘러보세요. 개별 여행 상담은 <a href=\"consult.html\">상담 양식</a>을 이용해 주세요.",
      sources: [],
      empty: true,
    };
  }

  /* ---------------- UI ---------------- */
  var AI_MODES = { unknown: "unknown", simulated: "simulated", real: "real", notconfigured: "notconfigured", statuserror: "statuserror" };
  function friendlyAiError(e) { var messages={"AI_TIMEOUT":"AI 응답 시간이 초과됐어요. 잠시 뒤 다시 시도해 주세요.","AI_RATE_LIMITED":"질문이 많아 잠시 쉬고 있어요. 잠시 뒤 다시 시도해 주세요.","AI_NOT_CONFIGURED":"AI 서비스가 아직 준비되지 않았어요. 담당자에게 문의해 주세요.","AI_AUTH_ERROR":"AI 연결 설정에 문제가 있어요. 담당자에게 문의해 주세요.","AI_MODEL_ERROR":"AI 서비스가 답변을 보내지 못했어요. 다시 시도해 주세요.","UNSUPPORTED_LOCALE":"이 언어의 AI 기능을 아직 준비 중이에요.","NETWORK_ERROR":"서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."};return messages[e&&e.code]||"AI 응답 중 문제가 생겼어요. 다시 시도해 주세요."; }
  ZW.assistant = {
    answer: answer,
    /* Pure classifier for the backend status probe result.
       - {kind:"ok", d:{configured:true}}  -> real (use server model)
       - {kind:"ok", d:{configured:false}} -> notconfigured (NO simulated answers)
       - {kind:"nostatus"} (HTTP 404 ONLY) -> simulated (static site, clearly labeled)
       - anything else (HTTP 500/503/other non-404, network error, timeout)
         -> statuserror ("AI status temporarily unavailable" — NO answers,
            never simulated, user gets a re-check button) */
    decideMode: function (info) {
      if (!info || typeof info !== "object") return AI_MODES.unknown;
      if (info.kind === "ok") return info.d && info.d.configured ? AI_MODES.real : AI_MODES.notconfigured;
      if (info.kind === "nostatus") return AI_MODES.simulated;
      return AI_MODES.statuserror;
    },
    mount: function () {
      var body = document.getElementById("chat-body");
      var input = document.getElementById("chat-input");
      var form = document.getElementById("chat-form");
      var sendBtn = document.getElementById("chat-send");
      var suggest = document.getElementById("chat-suggest");
      var recheckBtn = document.getElementById("ai-recheck");
      if (!body || !input || !form) return;

      /* mode detection: real model via local backend, or clearly-labeled
         simulated engine ONLY when the site has no backend at all.
         configured:false on a live backend => NO answers of any kind,
         just a clear "AI not configured" message + re-check. */
      var mode = AI_MODES.unknown; // while the status probe is running
      var realModel = "";
      var realProvider = "";
      var chatHistory = []; // user turns only, kept in memory (not persisted)
      if (sendBtn) sendBtn.disabled = true; // no answers before status is known

      function providerName() {
        return realProvider === "qwen" ? "Qwen" : (realProvider || "AI");
      }
      function modelLabel() {
        return realModel ? (providerName() + " · " + realModel) : providerName();
      }

      function setBanner() {
        var title = document.getElementById("ai-banner-title");
        var text = document.getElementById("ai-banner-text");
        var statusEl = document.querySelector(".chat-head .status");
        if (mode === AI_MODES.unknown) {
          if (title) title.textContent = "AI 연결 확인 중…";
          if (text) text.textContent = "서버에 연결해 AI 설정 상태를 확인하고 있어요. 잠시만 기다려 주세요.";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> 확인 중…";
        } else if (mode === AI_MODES.real) {
          if (title) title.textContent = "AI 여행 도우미 — " + providerName() + " 모델 연결(서버 경유)";
          if (text) text.innerHTML = "답변은 서버를 통해 호출하는 " + ZW.esc(modelLabel()) + " 모델이 사이트의 공개 가이드를 바탕으로 생성해요. AI 제안은 예약 완료가 아니며, 달라질 수 있는 정보는 출발 전에 확인해 주세요.";
          if (statusEl) statusEl.innerHTML = '<span class="status-dot" aria-hidden="true"></span> ' + ZW.esc(modelLabel()) + " · 연결됨";
        } else if (mode === AI_MODES.notconfigured) {
          if (title) title.textContent = "AI 서비스를 아직 설정 중이에요";
          if (text) text.innerHTML = "서버의 <strong>AI 연결 설정</strong>이 완료되지 않아 지금은 답변할 수 없어요. 모의 답변으로 바꾸지 않으며, 여행 상담은 다음 양식을 이용해 주세요: <a href=\"consult.html\">담당자 상담</a>.";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> AI 설정 미완료 · 답변 불가";
        } else if (mode === AI_MODES.statuserror) {
          if (title) title.textContent = "지금은 AI 연결 상태를 확인할 수 없어요";
          if (text) text.innerHTML = "서버의 AI 연결 상태를 확인할 수 없어 답변을 잠시 중단했어요. 조금 뒤 다시 확인하거나 다음 양식을 이용해 주세요: <a href=\"consult.html\">담당자 상담</a>.";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> AI 연결 확인 불가 · 답변 불가";
        } else {
          if (title) title.textContent = "모의 도우미 · 실제 AI 미연결";
          if (text) text.innerHTML = "현재는 사이트 자료에 따른 규칙형 데모 답변이에요. 실제 모델이나 실시간 데이터베이스를 호출하지 않으며 예약도 진행하지 않아요. 여행 상담은 다음 양식을 이용해 주세요: <a href=\"consult.html\">담당자 상담</a>.";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> 사이트 자료에 따른 모의 답변";
        }
        if (recheckBtn) recheckBtn.hidden = (mode !== AI_MODES.notconfigured && mode !== AI_MODES.statuserror && mode !== AI_MODES.unknown);
      }

      function detect() {
        mode = AI_MODES.unknown;
        if (sendBtn) sendBtn.disabled = true;
        setBanner();
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 6000);
        return fetch(apiUrl("/api/v1/assistant/status"), { headers: { Accept: "application/json" }, signal: controller.signal })
          .then(function (r) {
            if (r.ok) {
              return r.json().then(function (d) { return { kind: "ok", d: d }; })
                .catch(function () { return { kind: "statuserror", status: r.status }; }); // 200 but unreadable body
            }
            if (r.status === 404 && !API_BASE) return { kind: "nostatus" }; // HTTP 404 ONLY => no backend on this site
            return { kind: "statuserror", status: r.status }; // 500/503/other non-404 => backend exists, status unknown
          })
          .catch(function () { return { kind: "statuserror" }; }) // network error / timeout
          .then(function (info) {
            clearTimeout(timer);
            mode = ZW.assistant.decideMode(info);
            if (info.kind === "ok" && info.d && info.d.configured) {
              realModel = info.d.model || "";
              realProvider = info.d.provider || "";
            }
            setBanner();
            if (sendBtn) sendBtn.disabled = (mode === AI_MODES.unknown || mode === AI_MODES.statuserror);
            return mode;
          });
      }
      if (recheckBtn) recheckBtn.addEventListener("click", function () { detect(); });

      function addMsg(role, html, meta) {
        var div = document.createElement("div");
        div.className = "msg " + role;
        div.innerHTML =
          '<div class="bubble">' + html + '</div>' +
          (meta ? '<div class="meta">' + meta + "</div>" : "");
        body.appendChild(div);
        body.scrollTop = body.scrollHeight;
        return div;
      }
      function addTyping() {
        var div = document.createElement("div");
        div.className = "msg assistant";
        div.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>';
        body.appendChild(div);
        body.scrollTop = body.scrollHeight;
        return div;
      }

      var thinking = false;
      var lastQuery = "";

      /* not configured: explicit refusal — never a simulated answer */
      function showNotConfigured() {
        var node = addMsg("assistant",
          "<p>지금은 AI 설정이 완료되지 않았어요. 서버의 <strong>AI 연결 설정</strong>이 준비되지 않아 질문에 답변할 수 없어요.</p>" +
          "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-recheck>연결 다시 확인</button></p>",
          "답변하지 못했어요 · AI 설정 필요");
        var rb = node.querySelector("[data-recheck]");
        if (rb) rb.addEventListener("click", function () { detect(); });
        ZW.log("assistant_query_blocked", { reason: "not_configured" });
      }

      /* status unavailable: explicit refusal — never a simulated answer */
      function showStatusError() {
        var node = addMsg("assistant",
          "<p>AI 연결 상태를 확인할 수 없어 지금은 답변할 수 없어요. 잠시 뒤 다시 확인해 주세요.</p>" +
          "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-recheck>연결 다시 확인</button></p>",
          "답변하지 못했어요 · AI 연결 확인 불가");
        var rb = node.querySelector("[data-recheck]");
        if (rb) rb.addEventListener("click", function () { detect(); });
        ZW.log("assistant_query_blocked", { reason: "status_unavailable" });
      }

      /* ---- real model path: browser -> THIS site's backend only ----
         The backend holds the provider key server-side. Never any direct
         third-party call from the browser. Errors are explicit and the
         user can retry; we never fall back to simulated answers here. */
      function handleReal(q) {
        chatHistory.push({ role: "user", content: q });
        if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8);
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 120000);
        addMsg("user", "<p>" + ZW.esc(q) + "</p>");
        var typing = addTyping();
        fetch(apiUrl("/api/v1/assistant/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: "ko", messages: chatHistory }),
          signal: controller.signal,
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (d) {
            if (!res.ok) { var err=new Error("AI request failed");err.code=(d.error&&d.error.code)||"NETWORK_ERROR";throw err; }
            return d;
          });
        }).then(function (d) {
          clearTimeout(timer);
          typing.remove();
          chatHistory.push({role:"assistant",content:d.data.reply});
          if (d.data.model) realModel = d.data.model;
          if (d.data.provider) realProvider = d.data.provider;
          setBanner();
          var answer = addMsg("assistant", "<p>" + ZW.esc(d.data.reply) + "</p>", ZW.esc(modelLabel()) + " · 실제 AI 응답 · 최신 정보는 출발 전 확인");
          var sources = d.data && Array.isArray(d.data.sources) ? d.data.sources : [];
          var evidence = document.createElement("p");
          evidence.style.marginTop = "12px";
          evidence.textContent = sources.length ? "근거: 웹 검색 결과입니다. 원문 내용과 개별 사실은 별도로 확인되지 않았습니다." : "이 답변에는 확인 가능한 웹 출처가 없습니다. 구체적인 정보는 별도로 확인하세요.";
          answer.querySelector(".bubble").appendChild(evidence);
          if (sources.length) {
            var lang = document.documentElement.lang || "en";
            var label = "답변에서 인용한 웹 출처";
            var box = document.createElement("p");
            box.style.marginTop = "12px";
            box.appendChild(document.createTextNode(label + (d.data.checkedAt ? " · " + new Date(d.data.checkedAt).toLocaleString(lang) : "") + ": "));
            sources.forEach(function (source, i) {
              try {
                var url = new URL(source.url);
                if (url.protocol !== "https:") return;
                if (i) box.appendChild(document.createTextNode(" · "));
                var link = document.createElement("a");
                link.href = url.href;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = source.title || url.hostname;
                box.appendChild(link);
              } catch (_) { /* Ignore malformed source links. */ }
            });
            answer.querySelector(".bubble").appendChild(box);
          }
          ZW.log("assistant_query_real", { ok: true, provider: realProvider });
        }).catch(function (e) {
          clearTimeout(timer);
          typing.remove();
          if(chatHistory.length && chatHistory[chatHistory.length-1].role === "user") chatHistory.pop();
          var errName = (e && e.name === "AbortError") ? "AI 응답 시간이 초과됐어요." : friendlyAiError(e);
          var node = addMsg("assistant", "<p>" + ZW.esc(errName) + " 아직 답변을 받지 못했어요.</p>" +
            "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-retry>다시 시도</button></p>",
            "서버 오류 · 모의 답변이 아니에요");
          var rb = node.querySelector("[data-retry]");
          if (rb) rb.addEventListener("click", function () {
            thinking = false;
            sendBtn.disabled = false;
            handle(lastQuery);
          });
          ZW.log("error", { task: "assistant_real", message: String(e && e.message ? e.message : e).slice(0, 80) });
        }).finally(function () {
          thinking = false;
          sendBtn.disabled = false;
        });
      }

      /* ---- simulated path (ONLY when the site has no backend at all) ---- */
      function handle(q) {
        q = q.trim();
        if (!q || thinking) return;
        if (mode === AI_MODES.unknown) {
          addMsg("assistant", "<p>연결을 확인하고 있어요. 잠시 기다려 주시고 계속 지연되면 ‘연결 다시 확인’을 눌러 주세요.</p>", "답변 대기 · 연결 확인 중");
          return;
        }
        if (mode === AI_MODES.notconfigured) {
          showNotConfigured();
          return;
        }
        if (mode === AI_MODES.statuserror) {
          showStatusError();
          return;
        }
        if (mode === AI_MODES.real) {
          thinking = true;
          lastQuery = q;
          sendBtn.disabled = true;
          input.value = "";
          input.style.height = "auto";
          handleReal(q);
          return;
        }
        // simulated (no backend)
        thinking = true;
        lastQuery = q;
        sendBtn.disabled = true;
        addMsg("user", "<p>" + ZW.esc(q) + "</p>");
        input.value = "";
        input.style.height = "auto";
        var typing = addTyping();
        var timer = setTimeout(function () {
          var result;
          try {
            result = answer(q);
            ZW.log("assistant_query", { q: q.slice(0, 80), empty: !!result.empty, sensitive: !!result.sensitive });
          } catch (err) {
            ZW.log("error", { task: "assistant", message: String(err) });
            result = {
              text: "오류가 발생했어요. 다시 시도하거나 담당자 상담을 이용해 주세요.",
              sources: [],
              error: true,
            };
          }
          typing.remove();
          var meta = "모의 답변 · " + (result.sources && result.sources.length ? "참고 자료: " + replySources(result.sources) : "일치하는 사이트 자료 없음");
          var node = addMsg("assistant", "<p>" + result.text + "</p>" + (result.error ? "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-retry>다시 시도</button></p>" : ""), meta);
          if (result.error) {
            var rb = node.querySelector("[data-retry]");
            if (rb) rb.addEventListener("click", function () {
              thinking = false;
              sendBtn.disabled = false;
              handle(lastQuery);
            });
          }
          thinking = false;
          sendBtn.disabled = false;
        }, 500 + Math.random() * 600);
        typing._timer = timer;
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (thinking) return;
        handle(input.value);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (thinking) return; handle(input.value); }
      });

      if (suggest) {
        var chips = [
          "상하이에서 닝보로 어떻게 가나요?",
          "닝보에서 어떤 음식을 먹으면 좋을까요?",
          "닝보에서 이틀 동안 무엇을 하면 좋을까요?",
          "해외에서 발급한 카드로 결제할 수 있나요?",
          "항저우 2일 여행 코스를 짜고 싶어요",
        ];
        suggest.innerHTML = chips.map(function (c) {
          return '<button class="chip" type="button">' + ZW.esc(c) + "</button>";
        }).join("");
        suggest.querySelectorAll(".chip").forEach(function (b) {
          b.addEventListener("click", function () { handle(b.textContent); });
        });
      }

      ZW.log("open_assistant", {});

      // mode-aware greeting + deep-link question, only after status is known
      detect().then(function (m) {
        if (m === AI_MODES.simulated) {
          addMsg("assistant",
            "<p>안녕하세요. ZheshGo 여행 도우미예요. 사이트의 <strong>데모</strong> 가이드를 바탕으로 상하이·항저우·닝보의 코스, 기차, 결제, 먹거리와 일정을 안내해요.</p>" +
            "<p>현재 답변은 <strong>모의 답변</strong>이며 실제 AI가 연결된 상태가 아니에요. 달라질 수 있는 정보는 출발 전에 확인하고, 개별 여행 상담은 양식을 이용해 주세요.</p>",
            "데모 도우미");
        } else if (m === AI_MODES.real) {
          addMsg("assistant",
            "<p>안녕하세요. 현재 서버를 통해 실제 " + providerName() + " 모델에 연결돼 있어요. 사이트의 공개 가이드를 참고해 답변하며, 운영 시간·요금 등은 출발 전에 확인해 주세요. AI의 제안이 예약이나 수배 완료를 뜻하지는 않아요.</p>",
            ZW.esc(modelLabel()) + " · 실제 AI 응답");
        }
        var q = ZW.param("q");
        if (q) {
          setTimeout(function () {
            if (mode === AI_MODES.real || mode === AI_MODES.simulated) handle(q);
            else if (mode === AI_MODES.notconfigured) showNotConfigured();
            else if (mode === AI_MODES.statuserror) showStatusError();
          }, 400);
        }
      });
    },
  };
})();
