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
    C.routes.forEach(function (r) { if (list.indexOf("route:" + r.id) !== -1) names.push('the route "' + r.title + '"'); });
    C.places.forEach(function (p) { if (list.indexOf("place:" + p.id) !== -1) names.push('the "' + p.name + '" guide'); });
    C.faqs.forEach(function (f) { if (list.indexOf("faq:" + f.id) !== -1) names.push("our travel FAQ"); });
    return names.length ? names.join(", ") : "our site guides";
  }

  /* ---------------- the engine ---------------- */
  function answer(q) {
    var toks = tokenize(q);
    var ql = q.toLowerCase();

    // 0 · greeting / small talk
    if (/^(hi|hello|hey|good (morning|afternoon|evening))/.test(ql) && ql.length < 30) {
      return {
        text: "Hi! I'm the ZheshGo demo assistant — I answer from this site's Shanghai, Hangzhou and Ningbo guides. Ask me about routes, trains, payment, food or how to plan a few days. (Simulated answers — no live AI connected.)",
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
      var names = cities.map(function (c) { return c.name; }).join(" and ");
      return {
        text: "You're weighing " + names + ". " + cities.map(function (c) { return c.name + ": " + c.tagline; }).join(" ") +
          " Both are covered on this site — " + cities.map(function (c) { return 'the <a href="city.html?id=' + c.id + '">' + c.name + " guide</a>"; }).join(" and ") +
          " has routes and practical basics. Rail between them takes roughly 1–2 hours — verify times for your date. (Demo answer from site content; treat times as unverified.)",
        sources: cities.map(function (c) { return "city:" + c.id; }),
      };
    }

    // 3 · specific route
    var routes = findRoute(q);
    if (routes.length === 1) {
      var r = routes[0];
      return {
        text: "That's our draft route “" + r.title + "” — " + r.days + " day" + (r.days > 1 ? "s" : "") + ", " + r.pace.toLowerCase() + " pace, good for " + r.groups.join(", ") + ". " +
          r.summary + ' See the full day-by-day on the <a href="route.html?id=' + r.id + '">route page</a>, and confirm the "before you go" list before committing anything.',
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
        text: "For about " + dayN + " day" + (dayN > 1 ? "s" : "") + (city ? " in " + city.name : "") + ", these draft routes fit your window:<ul>" +
          pool.map(function (r) {
            return '<li><a href="route.html?id=' + r.id + '">' + r.title + "</a> — " + r.days + " day" + (r.days > 1 ? "s" : "") + ", " + r.pace.toLowerCase() + " pace. " + r.summary.slice(0, 90) + "…</li>";
          }).join("") +
          '</ul>Try the <a href="planner.html">trip planner</a> for matches scored to your pace and travel party. These are draft suggestions, not booked services.',
        sources: pool.map(function (r) { return "route:" + r.id; }),
      };
    }

    // 5 · single city or place
    if (cities.length === 1) {
      var c = cities[0];
      return {
        text: c.name + ": " + c.tagline + " I have a full guide — <a href=\"city.html?id=" + c.id + "\">open the " + c.name + " guide</a> for the basics, draft routes and places. What specifically do you want to know? (Transport, food, a day plan — I can help.)",
        sources: ["city:" + c.id],
      };
    }
    var places = findPlace(q);
    if (places.length === 1) {
      var p = places[0];
      return {
        text: p.name + " — " + p.blurb + ' See the <a href="place.html?id=' + p.id + '">place guide</a> for practical details. Hours and tickets there are marked as unverified, so double-check before you go.',
        sources: ["place:" + p.id],
      };
    }

    // 6 · emergency / visa / legal — no definitive answers
    if (/(visa|emergency|hospital|doctor|police|legal|law|ambulance)/.test(ql)) {
      return {
        text: "I can't give a definite answer on visas, legal or medical matters — please check official sources: your country's Chinese embassy or consulate for entry rules; emergency numbers are police 110, ambulance 120, fire 119. If you're in difficulty right now, contact local help directly.",
        sources: [],
        sensitive: true,
      };
    }

    // 7 · fallback
    var suggestions = C.faqs.slice(0, 3).map(function (f) { return f.q; });
    return {
      text: "I only answer from this site's seed content, and I didn't find a match for that. Try one of these:<ul>" +
        suggestions.map(function (s) { return "<li>" + s + "</li>"; }).join("") +
        '</ul>Or browse the <a href="explore.html">guides</a> / <a href="faq.html">FAQ</a>. For anything personal to your trip, the <a href="consult.html">consult form</a> reaches a real person.',
      sources: [],
      empty: true,
    };
  }

  /* ---------------- UI ---------------- */
  var AI_MODES = { unknown: "unknown", simulated: "simulated", real: "real", notconfigured: "notconfigured", statuserror: "statuserror" };
  function friendlyAiError(e) {
    return e && e.message ? e.message : "The AI service returned an error — please retry.";
  }
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
          if (title) title.textContent = "Checking AI status…";
          if (text) text.textContent = "Contacting the server to check whether the AI model is configured. Please wait a moment.";
          if (statusEl) statusEl.innerHTML = '<span class="status-dot" aria-hidden="true"></span> Checking…';
        } else if (mode === AI_MODES.real) {
          if (title) title.textContent = "AI assistant — live " + providerName() + " model connected (server-side)";
          if (text) text.innerHTML = "Answers come from the server-side " + ZW.esc(modelLabel()) + " model, grounded in this site's published content. AI suggestions are guidance, not booked services — verify anything time-sensitive before you travel.";
          if (statusEl) statusEl.innerHTML = '<span class="status-dot" aria-hidden="true"></span> ' + ZW.esc(modelLabel()) + ' · live';
        } else if (mode === AI_MODES.notconfigured) {
          if (title) title.textContent = "AI assistant — Qwen API key not configured yet";
          if (text) text.innerHTML = "The server's <strong>Qwen API key</strong> has not been configured yet (or the model settings are incomplete), so the assistant cannot answer right now. It will not show simulated answers here. For personal trip questions, use the <a href=\"consult.html\">human consult form</a>.";
          if (statusEl) statusEl.innerHTML = '<span class="status-dot" aria-hidden="true"></span> Qwen API key not configured · answers unavailable';
        } else if (mode === AI_MODES.statuserror) {
          if (title) title.textContent = "AI status temporarily unavailable";
          if (text) text.innerHTML = "The assistant can't confirm whether the server-side AI is working right now, so it will not answer — and it will not switch to simulated answers. Please re-check in a moment, or use the <a href=\"consult.html\">human consult form</a>.";
          if (statusEl) statusEl.innerHTML = '<span class="status-dot" aria-hidden="true"></span> AI status unknown · answers unavailable';
        } else {
          if (title) title.textContent = "Simulated assistant — no live AI connected";
          if (text) text.innerHTML = "This demo answers with local rules over our seed content. It is not a real model, not a live database, and it never books anything. For personal trip questions, use the <a href=\"consult.html\">human consult form</a>.";
          if (statusEl) statusEl.innerHTML = '<span class="status-dot" aria-hidden="true"></span> Answers from site guides · simulated';
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
          "<p>AI 尚未配置千问 API Key，暂时无法回答。The server's <strong>Qwen API key</strong> is not configured yet, so the assistant cannot answer your question right now.</p>" +
          '<p style="margin-top:8px"><button class="btn btn-secondary btn-sm" type="button" data-recheck>Re-check status</button></p>',
          "Not answered · Qwen API key not configured");
        var rb = node.querySelector("[data-recheck]");
        if (rb) rb.addEventListener("click", function () { detect(); });
        ZW.log("assistant_query_blocked", { reason: "not_configured" });
      }

      /* status unavailable: explicit refusal — never a simulated answer */
      function showStatusError() {
        var node = addMsg("assistant",
          "<p>AI 状态暂时无法确认，暂不回答。The assistant cannot confirm the AI service status right now, so it will not answer your question. Please re-check in a moment.</p>" +
          '<p style="margin-top:8px"><button class="btn btn-secondary btn-sm" type="button" data-recheck>Re-check status</button></p>',
          "Not answered · AI status unavailable");
        var rb = node.querySelector("[data-recheck]");
        if (rb) rb.addEventListener("click", function () { detect(); });
        ZW.log("assistant_query_blocked", { reason: "status_unavailable" });
      }

      /* ---- real model path: browser -> THIS site's backend only ----
         The backend holds the provider key server-side. Never any direct
         third-party call from the browser. Errors are explicit and the
         user can retry; we never fall back to simulated answers here. */
      function handleReal(q) {
        chatHistory.push(q);
        if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8);
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 120000);
        addMsg("user", "<p>" + ZW.esc(q) + "</p>");
        var typing = addTyping();
        fetch(apiUrl("/api/v1/assistant/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: chatHistory.map(function (m) { return { role: "user", content: m }; }) }),
          signal: controller.signal,
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (d) {
            if (!res.ok) throw new Error((d.error && d.error.message) || ("HTTP " + res.status));
            return d;
          });
        }).then(function (d) {
          clearTimeout(timer);
          typing.remove();
          if (d.data.model) realModel = d.data.model;
          if (d.data.provider) realProvider = d.data.provider;
          setBanner();
          var answer = addMsg("assistant", "<p>" + ZW.esc(d.data.reply) + "</p>", ZW.esc(modelLabel()) + " · live model · verify anything time-sensitive");
          var sources = d.data && Array.isArray(d.data.sources) ? d.data.sources : [];
          if (sources.length) {
            var lang = document.documentElement.lang || "en";
            var label = lang.indexOf("ko") === 0 ? "검색 출처" : lang.indexOf("ja") === 0 ? "検索元" : "Web sources";
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
          var errName = (e && e.name === "AbortError") ? "The AI service took too long to answer." : friendlyAiError(e);
          var node = addMsg("assistant", "<p>" + ZW.esc(errName) + " It has not been answered.</p>" +
            '<p style="margin-top:8px"><button class="btn btn-secondary btn-sm" type="button" data-retry>Try again</button></p>',
            "Server error · not a simulated answer");
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
          addMsg("assistant", "<p>Status is still being checked — please wait a moment, or use the Re-check button if this persists.</p>", "Not answered · checking");
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
              text: "Something went wrong on my side. You can retry, or skip me entirely and use the human consult form.",
              sources: [],
              error: true,
            };
          }
          typing.remove();
          var meta = "Simulated answer · " + (result.sources && result.sources.length ? "based on " + replySources(result.sources) : "no site source matched");
          var node = addMsg("assistant", "<p>" + result.text + "</p>" + (result.error ? '<p style="margin-top:8px"><button class="btn btn-secondary btn-sm" type="button" data-retry>Try again</button></p>' : ""), meta);
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
          "How do I get from Shanghai to Ningbo?",
          "What should I eat in Ningbo?",
          "Is Ningbo worth two days?",
          "Can I pay with my international card?",
          "Plan 2 days in Hangzhou",
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
            "<p>Hi — I'm the ZheshGo travel assistant. I answer from this site's <strong>demo</strong> guides for Shanghai, Hangzhou and Ningbo: routes, trains, payment, food, and how to plan a few days.</p>" +
            "<p>Two honest notes: my answers are <strong>simulated</strong> (no live AI is connected), and anything time-sensitive should be verified before you travel. For personal trip questions, a human is one form away.</p>",
            "Demo assistant");
        } else if (m === AI_MODES.real) {
          addMsg("assistant",
            "<p>Hi — I'm connected to the live " + providerName() + " model (server-side). I answer from this site's published guides; anything time-sensitive should still be verified before you travel, and AI suggestions are not booked services.</p>",
            ZW.esc(modelLabel()) + " · live model");
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
