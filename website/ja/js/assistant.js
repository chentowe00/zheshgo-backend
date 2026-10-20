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
    C.routes.forEach(function (r) { if (list.indexOf("route:" + r.id) !== -1) names.push("コース「" + r.title + '"'); });
    C.places.forEach(function (p) { if (list.indexOf("place:" + p.id) !== -1) names.push("ガイド「" + p.name + "」"); });
    C.faqs.forEach(function (f) { if (list.indexOf("faq:" + f.id) !== -1) names.push("よくある質問"); });
    return names.length ? names.join(", ") : "our site guides";
  }

  /* ---------------- the engine ---------------- */
  function answer(q) {
    var toks = tokenize(q);
    var ql = q.toLowerCase();

    // 0 · greeting / small talk
    if (/^(hi|hello|hey|good (morning|afternoon|evening))/.test(ql) && ql.length < 30) {
      return {
        text: "これは模擬回答のデモです。上海・杭州・寧波の掲載ガイドから回答します。実際のAIには接続されていません。",
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
      var names = cities.map(function (c) { return c.name; }).join("・");
      return {
        text: "比較中の都市：" + names + ". " + cities.map(function (c) { return c.name + ": " + c.tagline; }).join(" ") +
          " 掲載ガイドをご覧ください：" + cities.map(function (c) { return "<a href=\"city.html?id=" + c.id + '">' + c.name + "ガイド</a>"; }).join("・") +
          "でコースと基本情報を確認できます。列車の所要時間は利用日ごとに確認してください。模擬回答です。",
        sources: cities.map(function (c) { return "city:" + c.id; }),
      };
    }

    // 3 · specific route
    var routes = findRoute(q);
    if (routes.length === 1) {
      var r = routes[0];
      return {
        text: "モデルコース「" + r.title + "” — " + r.days + "日" + "" + ", " + ZW.label(r.pace) + "、想定する同行者：" + r.groups.map(ZW.label).join(", ") + ". " +
          r.summary + " 日程の詳細は<a href=\"route.html?id=" + r.id + "\">コースのページ</a>でご覧ください。「出発前に確認したいこと」も確認してから手配しましょう。",
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
        text: "滞在日数の目安：" + dayN + "日" + (dayN > 1 ? "s" : "") + (city ? "、行き先：" + city.name : "") + "。候補のモデルコースは以下です。<ul>" +
          pool.map(function (r) {
            return '<li><a href="route.html?id=' + r.id + '">' + r.title + "</a> — " + r.days + "日" + "" + ", " + ZW.label(r.pace) + "のペース。" + r.summary.slice(0, 90) + "…</li>";
          }).join("") +
          "</ul>希望条件で探すなら、<a href=\"planner.html\">旅のプランナー</a>をご利用ください。表示されるコースで予約は完了しません。",
        sources: pool.map(function (r) { return "route:" + r.id; }),
      };
    }

    // 5 · single city or place
    if (cities.length === 1) {
      var c = cities[0];
      return {
        text: c.name + ": " + c.tagline + " 詳しくは、<a href=\"city.html?id=" + c.id + "\">ガイドを見る：" + c.name + "ガイド</a>で基本情報とモデルコースをご覧ください。移動、食事、日程など、知りたいことを教えてください。",
        sources: ["city:" + c.id],
      };
    }
    var places = findPlace(q);
    if (places.length === 1) {
      var p = places[0];
      return {
        text: p.name + " — " + p.blurb + " 詳しくは、<a href=\"place.html?id=" + p.id + "\">スポットガイド</a>をご覧ください。営業時間や料金は未確認なので、訪問前に確認してください。",
        sources: ["place:" + p.id],
      };
    }

    // 6 · emergency / visa / legal — no definitive answers
    if (/(visa|emergency|hospital|doctor|police|legal|law|ambulance)/.test(ql)) {
      return {
        text: "入国、法律、医療について個別の判断はできません。関係する公式機関や専門家に確認してください。緊急通報は警察110、救急120、消防119です。緊急の場合は現地の窓口へ直接連絡してください。",
        sources: [],
        sensitive: true,
      };
    }

    // 7 · fallback
    var suggestions = C.faqs.slice(0, 3).map(function (f) { return f.q; });
    return {
      text: "模擬回答用の掲載内容では、該当する情報が見つかりませんでした。以下の質問も参考にしてください。<ul>" +
        suggestions.map(function (s) { return "<li>" + s + "</li>"; }).join("") +
        "</ul>または、<a href=\"explore.html\">ガイド</a> / <a href=\"faq.html\">よくある質問</a>をご覧ください。個別の相談は、<a href=\"consult.html\">相談フォーム</a>の受付状況をご確認ください。",
      sources: [],
      empty: true,
    };
  }

  /* ---------------- UI ---------------- */
  var AI_MODES = { unknown: "unknown", simulated: "simulated", real: "real", notconfigured: "notconfigured", statuserror: "statuserror" };
  function friendlyAiError(e) {
    return "AIでエラーが発生しました。もう一度お試しください。";
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
          if (title) title.textContent = "AIの接続状況を確認しています…";
          if (text) text.textContent = "サーバーに接続しています。少しお待ちください。";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> 接続確認中…";
        } else if (mode === AI_MODES.real) {
          if (title) title.textContent = "AI旅行助手 — " + providerName() + "にサーバー経由で接続しています";
          if (text) text.innerHTML = "サーバーで動作する" + ZW.esc(modelLabel()) + "が掲載ガイドなどを参考に回答します。AIの提案で予約は完了しません。変わりやすい情報は出発前に公式案内でご確認ください。";
          if (statusEl) statusEl.innerHTML = '<span class="status-dot" aria-hidden="true"></span> ' + ZW.esc(modelLabel()) + " · 接続中";
        } else if (mode === AI_MODES.notconfigured) {
          if (title) title.textContent = "現在、AIを利用できません";
          if (text) text.innerHTML = "サーバーの<strong>AI接続設定</strong>が完了していないため、現在は回答できません。模擬回答への切り替えは行いません。個別の相談は、<a href=\"consult.html\">相談フォーム</a>.";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> 現在、AIを利用できません";
        } else if (mode === AI_MODES.statuserror) {
          if (title) title.textContent = "AIの接続状況を確認できません";
          if (text) text.innerHTML = "現在、接続状況を確認できないため回答できません。少し時間をおいて、もう一度確認してください。個別の相談は、<a href=\"consult.html\">相談フォーム</a>.";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> 接続状況不明 · 回答できません";
        } else {
          if (title) title.textContent = "模擬回答のデモ — 実際のAIには未接続";
          if (text) text.innerHTML = "掲載サンプルに基づくルールで回答します。実際のAIや最新データベースには接続していません。予約は行いません。個別の相談は、<a href=\"consult.html\">相談フォーム</a>.";
          if (statusEl) statusEl.innerHTML = "<span class=\"status-dot\" aria-hidden=\"true\"></span> 掲載内容に基づく模擬回答";
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
          "<p>AIの<strong>AI接続設定</strong>が未完了のため、現在は回答できません。</p>" +
          "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-recheck>接続状況を確認</button></p>",
          "未回答 · AIを利用できません");
        var rb = node.querySelector("[data-recheck]");
        if (rb) rb.addEventListener("click", function () { detect(); });
        ZW.log("assistant_query_blocked", { reason: "not_configured" });
      }

      /* status unavailable: explicit refusal — never a simulated answer */
      function showStatusError() {
        var node = addMsg("assistant",
          "<p>現在、AIの接続状況を確認できず回答できません。少し時間をおいて、もう一度確認してください。</p>" +
          "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-recheck>接続状況を確認</button></p>",
          "未回答 · 接続状況不明");
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
          body: JSON.stringify({ locale: "ja", messages: chatHistory }),
          signal: controller.signal,
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (d) {
            if (!res.ok) throw new Error((d.error && d.error.message) || ("HTTP " + res.status));
            return d;
          });
        }).then(function (d) {
          clearTimeout(timer);
          typing.remove();
          chatHistory.push({role:"assistant",content:d.data.reply});
          if (d.data.model) realModel = d.data.model;
          if (d.data.provider) realProvider = d.data.provider;
          setBanner();
          var answer = addMsg("assistant", "<p>" + ZW.esc(d.data.reply) + "</p>", ZW.esc(modelLabel()) + " · 実際のAI回答 · 最新情報は要確認");
          var sources = d.data && Array.isArray(d.data.sources) ? d.data.sources : [];
          var evidence = document.createElement("p");
          evidence.style.marginTop = "12px";
          evidence.textContent = sources.length ? "根拠：ウェブ検索結果。ページ本文や個別の事実は独立に確認していません。" : "この回答には確認できるウェブ出典がありません。具体的な情報は別途確認してください。";
          answer.querySelector(".bubble").appendChild(evidence);
          if (sources.length) {
            var lang = document.documentElement.lang || "en";
            var label = "回答で引用したウェブ出典";
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
          var errName = (e && e.name === "AbortError") ? "AIの応答が時間内に届きませんでした。" : friendlyAiError(e);
          var node = addMsg("assistant", "<p>" + ZW.esc(errName) + " まだ回答できていません。</p>" +
            "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-retry>もう一度試す</button></p>",
            "サーバーエラー · 模擬回答ではありません");
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
          addMsg("assistant", "<p>接続状況を確認しています。少しお待ちください。長く続く場合は、接続状況をもう一度確認してください。</p>", "未回答 · 接続確認中");
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
              text: "エラーが発生しました。もう一度お試しいただくか、相談フォームの受付状況をご確認ください。",
              sources: [],
              error: true,
            };
          }
          typing.remove();
          var meta = "模擬回答 · " + (result.sources && result.sources.length ? "参照：" + replySources(result.sources) : "no site source matched");
          var node = addMsg("assistant", "<p>" + result.text + "</p>" + (result.error ? "<p style=\"margin-top:8px\"><button class=\"btn btn-secondary btn-sm\" type=\"button\" data-retry>もう一度試す</button></p>" : ""), meta);
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
          "上海から寧波へはどう行けばいいですか？",
          "寧波ではどんな地元料理を楽しめますか？",
          "寧波で2日間過ごすなら、どんな旅ができますか？",
          "海外発行のクレジットカードは使えますか？",
          "杭州で過ごす2日間のプランを考えたいです。",
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
            "<p>こんにちは。ZheshGo旅行助手です。このサイトの<strong>サンプル</strong>ガイドから、上海・杭州・寧波のコースや移動、食事などを案内します。</p>" +
            "<p>これは<strong>模擬回答</strong>で、実際のAIには接続していません。変わりやすい情報は出発前に確認してください。</p>",
            "デモ旅行助手");
        } else if (m === AI_MODES.real) {
          addMsg("assistant",
            "<p>こんにちは。サーバー経由で" + providerName() + "に接続しています。掲載ガイドを参考に旅の相談にお答えします。料金や営業時間などは出発前に確認してください。AIの提案で予約・手配は完了しません。</p>",
            ZW.esc(modelLabel()) + " · 実際のAI");
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
