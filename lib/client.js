window.__ModuleLoader__.load({
  id: "dsh-skill-pilot",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var jsx = require("react/jsx-runtime");

    var TAG = "[skill-pilot]";
    var STAMP = "2026.11.06";
    var ENDPOINT = { index: "/api/skill-pilot/index", rebuild: "/api/skill-pilot/rebuild" };

    console.log(TAG + " browser half loaded: " + STAMP);

    /** Services the browser half needs before it can mount. */
    var inject = ["sessions", "slots"];

    /** Category shown for an entry the host could not classify. */
    var LOOSE = "\u672A\u5206\u7C7B";

    /**
     * Create an element from a flat spec. The runtime binding takes
     * `(type, props, key)`, so children and the key are folded into that shape
     * here instead of being spelled out at every call site.
     */
    function el(type, props, children, key) {
      var merged = {};
      if (props !== null && props !== undefined) {
        for (var name in props) {
          if (Object.prototype.hasOwnProperty.call(props, name)) merged[name] = props[name];
        }
      }
      if (children !== undefined && children !== null) merged.children = children;
      return key === undefined ? jsx.jsx(type, merged) : jsx.jsx(type, merged, key);
    }

    //#region talking to the host

    var memo = { data: null, pending: null };
    var abortable = new Set();

    /**
     * Turn a URL into parsed JSON. A missing route and a slow route are told
     * apart: the first rejects at once, the second is cut off by the signal the
     * caller owns, so the panel can say which happened.
     */
    function readJson(url, signal) {
      return fetch(url, { headers: { accept: "application/json" }, signal: signal }).then(function (response) {
        if (response.ok === false) {
          var failure = new Error("skill-pilot " + url + " answered " + response.status);
          failure.status = response.status;
          throw failure;
        }
        return response.json();
      });
    }

    /**
     * Load the index once. Concurrent callers share the in-flight promise, a
     * successful result is memoised, and `rebuild` asks the host to rescan
     * rather than trusting the memo.
     */
    function loadIndex(rebuild) {
      if (rebuild !== true && memo.data !== null) return Promise.resolve(memo.data);
      if (rebuild !== true && memo.pending !== null) return memo.pending;

      var controller = new AbortController();
      abortable.add(controller);
      var timer = setTimeout(function () {
        controller.abort();
      }, 8000);

      var settle = function (error) {
        clearTimeout(timer);
        abortable.delete(controller);
        memo.pending = null;
        if (error !== undefined) throw error;
      };

      var pending = readJson(rebuild === true ? ENDPOINT.rebuild : ENDPOINT.index, controller.signal)
        .then(function (payload) {
          var list = payload !== null && Array.isArray(payload.entries) ? payload.entries : null;
          if (list === null) {
            console.warn(TAG + " payload carried no entries array");
            list = [];
          }
          memo.data = list;
          return list;
        })
        .catch(function (error) {
          var aborted = error && error.name === "AbortError";
          console.warn(TAG + (aborted ? " index request timed out" : " index request failed: " + (error && error.message ? error.message : error)));
          throw error;
        })
        .then(
          function (value) {
            settle();
            return value;
          },
          function (error) {
            settle();
            throw error;
          },
        );

      memo.pending = pending;
      return pending;
    }

    //#endregion

    //#region ranking a draft

    /**
     * Split text into comparable fragments. Latin words survive whole; each
     * Chinese character becomes its own fragment, because Chinese has no spaces
     * and a two-character slice would miss most real matches.
     */
    function fragments(text) {
      var source = String(text === null || text === undefined ? "" : text).toLowerCase();
      var out = [];
      var latin = source.match(/[a-z0-9_+#.\u4e00-\u9fff-]{2,}/g) || [];
      for (var i = 0; i < latin.length; i += 1) {
        if (/[\u3400-\u4dbf\u4e00-\u9fff]/.test(latin[i])) continue;
        out.push(latin[i]);
      }
      var han = source.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
      for (var h = 0; h < han.length; h += 1) {
        for (var c = 0; c < han[h].length; c += 1) out.push(han[h].charAt(c));
      }
      return out;
    }

    /** Category nouns are weak signal; skill names and notes are strong. */
    var WEIGHT = { name: 34, note: 12, category: 9, english: 4 };

    /** Score one entry against the draft fragments. Zero means "no relation". */
    function weigh(entry, parts, draft) {
      var name = String(entry.name || "").toLowerCase();
      var note = String(entry.zh || "").toLowerCase();
      var category = String(entry.hint || "").toLowerCase();
      var english = String(entry.description || "").toLowerCase();
      var score = 0;

      // A draft that is already part of the name is the strongest possible hint.
      if (draft.length >= 2 && name.indexOf(draft) >= 0) score += 70;

      for (var i = 0; i < parts.length; i += 1) {
        var part = parts[i];
        if (name.indexOf(part) >= 0) score += WEIGHT.name;
        if (note !== "" && note.indexOf(part) >= 0) score += WEIGHT.note;
        if (category !== "" && category.indexOf(part) >= 0) score += WEIGHT.category;
        if (english !== "" && english.indexOf(part) >= 0) score += WEIGHT.english;
      }

      // A category noun appearing verbatim in the draft is a deliberate ask.
      if (category !== "" && draft !== "" && draft.indexOf(category) >= 0) score += 26;

      return score;
    }

    /** Best `limit` entries for a draft, each carrying the reason it surfaced. */
    function shortlist(entries, draft, limit) {
      if (Array.isArray(entries) === false || entries.length === 0) return [];
      var cleaned = String(draft === null || draft === undefined ? "" : draft)
        .trim()
        .toLowerCase();
      if (cleaned.length < 2) return [];
      var parts = fragments(cleaned);
      if (parts.length === 0) return [];

      var scored = [];
      for (var i = 0; i < entries.length; i += 1) {
        var score = weigh(entries[i], parts, cleaned);
        if (score <= 0) continue;
        scored.push({ entry: entries[i], score: score });
      }
      scored.sort(function (left, right) {
        if (right.score !== left.score) return right.score - left.score;
        return left.entry.name < right.entry.name ? -1 : left.entry.name > right.entry.name ? 1 : 0;
      });
      return scored.slice(0, limit === undefined ? 3 : limit);
    }

    //#endregion

    //#region look and feel

    /**
     * Colours come from the host's own tokens so the panel follows the theme.
     * Spacing and type come from this plugin so it does not read as a copy of
     * any other composer widget.
     */
    var ink = "var(--dsw-alias-label-primary)";
    var dim = "var(--dsw-alias-label-tertiary)";
    var muted = "var(--dsw-alias-label-secondary)";
    var line = "var(--dsw-alias-border-l1)";
    var lineSoft = "var(--dsw-alias-border-l2)";
    var canvas = "var(--dsw-alias-bg-base, #fff)";
    var accent = "var(--dsw-alias-state-business-primary, #4c6ef5)";

    var SKIN = {
      // The anchor itself must not be a positioning context: the suggestion bar
      // has to resolve against the composer card so it can ride the card's top
      // edge. Only `wrap` is positioned, and it holds the button plus the sheet.
      anchor: { position: "static", display: "inline-flex", flexDirection: "column" },
      wrap: { position: "relative", display: "inline-flex" },
      trigger: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 28,
        padding: "0 9px",
        margin: 0,
        border: "none",
        borderRadius: 7,
        background: "transparent",
        color: muted,
        fontSize: 13,
        lineHeight: "20px",
        fontWeight: 450,
        cursor: "pointer",
        outline: "none",
      },
      glyph: { flex: "none", display: "block", color: accent },
      badge: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        borderRadius: 8,
        background: lineSoft,
        color: dim,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: "16px",
      },
      sheet: {
        position: "absolute",
        bottom: "calc(100% + 10px)",
        left: 0,
        zIndex: 1200,
        width: 452,
        maxWidth: "min(94vw, 520px)",
        maxHeight: 424,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid " + line,
        borderRadius: 14,
        background: canvas,
        boxShadow: "0 12px 34px rgba(0,0,0,.16)",
      },
      searchRow: { display: "flex", alignItems: "center", gap: 6, padding: "9px 10px 7px", flex: "none" },
      search: {
        flex: 1,
        minWidth: 0,
        height: 30,
        padding: "0 10px",
        border: "1px solid " + line,
        borderRadius: 9,
        background: "transparent",
        color: ink,
        fontSize: 13,
        outline: "none",
      },
      // Two columns: a fixed category rail on the left, the list on the right.
      // The rail scrolls on its own and `flex: none` keeps the list beside it
      // instead of pushing it below.
      bodyRow: {
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        flex: "1 1 auto",
        minHeight: 0,
      },
      tabRail: {
        flex: "none",
        width: 116,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: "2px 6px 8px 8px",
        boxSizing: "border-box",
        overflowY: "auto",
        overflowX: "hidden",
        borderRight: "1px solid " + lineSoft,
        scrollbarWidth: "none",
      },
      tab: {
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        width: "100%",
        padding: "6px 8px",
        border: "none",
        borderRadius: 8,
        background: "transparent",
        color: muted,
        fontSize: 12,
        lineHeight: "16px",
        textAlign: "left",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        outline: "none",
      },
      tabOn: {
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        width: "100%",
        padding: "6px 8px",
        border: "none",
        borderRadius: 8,
        background: lineSoft,
        color: ink,
        fontSize: 12,
        lineHeight: "16px",
        fontWeight: 600,
        textAlign: "left",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        outline: "none",
      },
      tabCount: { opacity: 0.55, flex: "none", fontSize: 11 },
      tabLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      scroller: { flex: "1 1 auto", minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "4px 0" },
      row: {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        width: "100%",
        padding: "7px 12px",
        border: "none",
        background: "transparent",
        color: ink,
        textAlign: "left",
        cursor: "pointer",
      },
      rowTop: { display: "flex", alignItems: "baseline", gap: 6 },
      rowName: { flex: "none", fontSize: 13, fontWeight: 600, lineHeight: "18px" },
      rowTag: { flex: "none", fontSize: 10, color: dim, lineHeight: "16px" },
      rowNote: {
        display: "block",
        color: dim,
        fontSize: 12,
        lineHeight: "17px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      mark: {
        background: "transparent",
        color: accent,
        fontWeight: 700,
        textDecoration: "underline",
        textUnderlineOffset: 2,
      },
      footRow: {
        display: "flex",
        alignItems: "center",
        flex: "none",
        gap: 8,
        padding: "6px 10px",
        borderTop: "1px solid " + lineSoft,
        color: dim,
        fontSize: 11,
      },
      footBtn: {
        border: "none",
        background: "transparent",
        color: muted,
        fontSize: 11,
        padding: "3px 6px",
        borderRadius: 6,
        cursor: "pointer",
        outline: "none",
      },
      spacer: { flex: 1 },
      // A single row pinned to the composer card's top edge: it rides the
      // border instead of floating over the text the user is writing. The
      // background and the squared-off bottom make it read as part of the
      // card rather than as a floating toast.
      strip: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "100%",
        zIndex: 1200,
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 5,
        boxSizing: "border-box",
        padding: "6px 10px",
        background: canvas,
        border: "1px solid " + line,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(0,0,0,.08)",
        marginBottom: 6,
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
        pointerEvents: "auto",
      },
      chip: {
        display: "inline-flex",
        alignItems: "center",
        flex: "none",
        gap: 4,
        maxWidth: 240,
        whiteSpace: "nowrap",
        padding: "3px 10px",
        border: "none",
        borderRadius: 999,
        background: lineSoft,
        color: ink,
        fontSize: 12,
        lineHeight: "18px",
        cursor: "pointer",
        outline: "none",
        transition: "background .12s ease",
      },
      chipNote: { color: dim, fontSize: 11, lineHeight: "18px" },
      stripLead: {
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        paddingRight: 2,
        color: accent,
        fontSize: 11,
        lineHeight: "18px",
        fontWeight: 600,
        letterSpacing: ".02em",
        whiteSpace: "nowrap",
      },
      hintLine: { padding: "12px", color: dim, fontSize: 12, lineHeight: "18px" },
    };

    /** Tint a row while the pointer is over it. */
    function tint(event) {
      event.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover-solid)";
    }
    /** Drop the tint again, back to the resting fill the chip was given. */
    function untint(event) {
      event.currentTarget.style.background = event.currentTarget.dataset.restFill || "transparent";
    }

    /**
     * Put `/name ` at the caret through the composer's own insertion action, so
     * the draft revision stays consistent with what the editor believes.
     */
    function placeSkill(inputActions, skillName) {
      if (inputActions === undefined || inputActions === null) {
        console.warn(TAG + " composer actions unavailable, cannot insert a skill");
        return false;
      }
      if (typeof inputActions.captureInsertion !== "function") {
        console.warn(TAG + " composer has no captureInsertion, cannot insert a skill");
        return false;
      }
      try {
        var span = inputActions.captureInsertion();
        return inputActions.insertText("/" + skillName + " ", span) !== false;
      } catch (error) {
        console.error(TAG + " insert failed:", error);
        return false;
      }
    }

    //#endregion

    //#region rendering

    /**
     * Render `text`, wrapping every occurrence of `needle` in a highlighted
     * span. Used only for the name row, where a visible match explains why the
     * entry is in the list.
     */
    function marked(text, needle) {
      var source = String(text === null || text === undefined ? "" : text);
      var target = String(needle === null || needle === undefined ? "" : needle).toLowerCase();
      if (target === "" || source === "") return source;
      var lower = source.toLowerCase();
      var parts = [];
      var cursor = 0;
      var hit = lower.indexOf(target, cursor);
      var guard = 0;

      while (hit >= 0 && guard < 12) {
        guard += 1;
        if (hit > cursor) parts.push(source.slice(cursor, hit));
        parts.push(el("span", { style: SKIN.mark, children: source.slice(hit, hit + target.length) }, undefined, "m" + hit));
        cursor = hit + target.length;
        hit = lower.indexOf(target, cursor);
      }
      if (cursor < source.length) parts.push(source.slice(cursor));
      if (parts.length === 0) return source;
      if (parts.length === 1) return parts[0];
      return el("span", { children: parts }, undefined, "mk");
    }

    /** One line in the results list. */
    function Entry(props) {
      var entry = props.entry;
      var needle = props.needle;
      var note = entry.zh !== "" && entry.zh !== undefined ? entry.zh : entry.description;
      var top = [
        el("span", { style: SKIN.rowName, children: marked(entry.name, needle) }, undefined, "n"),
        entry.hint ? el("span", { style: SKIN.rowTag, children: entry.hint }, undefined, "h") : null,
      ];
      return el(
        "button",
        {
          type: "button",
          onClick: function () {
            props.onPick(entry);
          },
          onMouseEnter: tint,
          onMouseLeave: untint,
          style: SKIN.row,
          title: entry.path || entry.name,
        },
        [el("span", { style: SKIN.rowTop, children: top }, undefined, "top"), el("span", { style: SKIN.rowNote, children: note || "\u6682\u65E0\u8BF4\u660E" }, undefined, "note")],
        "entry-" + entry.name,
      );
    }

    /** How many entries sit in one category. */
    function countOf(entries, label) {
      var total = 0;
      for (var i = 0; i < entries.length; i += 1) {
        var at = entries[i].hint !== "" && entries[i].hint !== undefined ? entries[i].hint : LOOSE;
        if (at === label) total += 1;
      }
      return total;
    }

    /**
     * The browsing sheet: a search line, a horizontal category rail, then the
     * rows for whichever category is active. Searching collapses the rail into
     * one flat list — the rail is for browsing, not for filtering a query the
     * user already knows.
     */
    function Sheet(props) {
      var entries = props.entries;
      var status = props.status;
      var onPick = props.onPick;
      var onClose = props.onClose;
      var onRebuild = props.onRebuild;
      var queryState = react.useState("");
      var text = queryState[0];
      var setText = queryState[1];
      var activeState = react.useState(null);
      var category = activeState[0];
      var setCategory = activeState[1];
      var cursorState = react.useState(0);
      var focusIndex = cursorState[0];
      var setFocusIndex = cursorState[1];
      var field = react.useRef(null);

      react.useEffect(function () {
        if (field.current !== null) field.current.focus();
      }, []);

      var trimmed = text.trim();

      var tabs = react.useMemo(
        function () {
          if (Array.isArray(entries) === false) return [];
          var order = [];
          var seen = Object.create(null);
          for (var i = 0; i < entries.length; i += 1) {
            var hint = entries[i].hint;
            var key = hint !== "" && hint !== undefined ? hint : LOOSE;
            if (seen[key] === true) continue;
            seen[key] = true;
            order.push(key);
          }
          order.sort(function (left, right) {
            if (left === LOOSE) return 1;
            if (right === LOOSE) return -1;
            return left < right ? -1 : 1;
          });
          return order;
        },
        [entries],
      );

      var visible = react.useMemo(
        function () {
          if (Array.isArray(entries) === false) return [];
          if (trimmed !== "") {
            var needle = trimmed.toLowerCase();
            var hits = [];
            for (var i = 0; i < entries.length; i += 1) {
              var entry = entries[i];
              var hay = [entry.name, entry.zh, entry.description, entry.hint, entry.whenToUse].join(" ").toLowerCase();
              if (hay.indexOf(needle) >= 0) hits.push(entry);
            }
            return hits.slice(0, 80);
          }
          var bucket = category === null ? (tabs.length > 0 ? tabs[0] : null) : category;
          var out = [];
          for (var k = 0; k < entries.length; k += 1) {
            var hint = entries[k].hint;
            var at = hint !== "" && hint !== undefined ? hint : LOOSE;
            if (bucket === null || at === bucket) out.push(entries[k]);
          }
          return out.slice(0, 200);
        },
        [entries, trimmed, category, tabs],
      );

      react.useEffect(
        function () {
          setFocusIndex(0);
        },
        [trimmed, category],
      );

      var commit = react.useCallback(
        function (index) {
          if (index < 0 || index >= visible.length) return;
          onPick(visible[index]);
        },
        [visible, onPick],
      );

      var body;
      if (Array.isArray(entries) === false) {
        body = el("div", {
          style: SKIN.hintLine,
          children: status === "error" ? "\u8BFB\u53D6\u5931\u8D25\uFF0C\u70B9\u300C\u91CD\u8BFB\u300D\u518D\u8BD5\u4E00\u6B21" : "\u6B63\u5728\u8BFB\u53D6\u6280\u80FD\u2026",
        });
      } else if (visible.length === 0) {
        body = el("div", { style: SKIN.hintLine, children: "\u6CA1\u6709\u5339\u914D\u9879" });
      } else {
        var rows = [];
        for (var r = 0; r < visible.length; r += 1) {
          rows.push(el(Entry, { entry: visible[r], needle: trimmed, onPick: onPick }, undefined, "r-" + visible[r].name));
        }
        body = rows;
      }

      var rail = null;
      if (trimmed === "" && tabs.length > 1) {
        var current = category === null ? tabs[0] : category;
        var buttons = tabs.map(function (label) {
          return el(
            "button",
            {
              type: "button",
              onClick: function () {
                setCategory(label);
              },
              style: current === label ? SKIN.tabOn : SKIN.tab,
            },
            [
              el("span", { style: SKIN.tabLabel, children: label }, undefined, "l"),
              el("span", { style: SKIN.tabCount, children: countOf(entries, label) }, undefined, "c"),
            ],
            "tab-" + label,
          );
        });
        rail = el("div", { style: SKIN.tabRail, children: buttons }, undefined, "rail");
      }

      var input = el("input", {
        ref: field,
        value: text,
        placeholder: "\u641C\u540D\u5B57\u3001\u7528\u9014\u6216\u5206\u7C7B\u2026",
        onChange: function (event) {
          setText(event.target.value);
        },
        onKeyDown: function (event) {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setFocusIndex(Math.min(focusIndex + 1, visible.length - 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setFocusIndex(Math.max(focusIndex - 1, 0));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            commit(focusIndex);
          }
        },
        style: SKIN.search,
      });

      var foot = el(
        "div",
        { style: SKIN.footRow },
        [
          el(
            "button",
            {
              type: "button",
              onClick: onRebuild,
              onMouseEnter: tint,
              onMouseLeave: untint,
              style: SKIN.footBtn,
              title: "\u91CD\u65B0\u8BFB\u53D6\u6280\u80FD\u76EE\u5F55",
            },
            "\u91CD\u8BFB",
            "rebuild",
          ),
          el("span", { style: SKIN.spacer }, undefined, "sp"),
          el("span", {
            children: (Array.isArray(entries) ? entries.length : 0) + " \u4E2A\u6280\u80FD \u00B7 \u21C5 \u9009\u62E9 \u00B7 Enter \u63D2\u5165",
          }),
        ],
        "foot",
      );

      return el(
        "div",
        { style: SKIN.sheet, role: "dialog", "aria-label": "\u6280\u80FD" },
        [
          el("div", { style: SKIN.searchRow, children: input }, undefined, "search"),
          el(
            "div",
            { style: SKIN.bodyRow },
            [rail, el("div", { style: SKIN.scroller, children: body }, undefined, "list")],
            "body",
          ),
          foot,
        ],
        "sheet",
      );
    }

    /**
     * The composer widget. Closed, it is a small 「技能」 button carrying a count;
     * open, it is the browsing sheet. Either way, a draft being typed also
     * raises a dashed strip of suggested skills above it.
     */
    function ComposerEntry(props) {
      var inputActions = props.inputActions;
      var useInput = props.useInput;

      var sheetState = react.useState(false);
      var open = sheetState[0];
      var setOpen = sheetState[1];
      var dataState = react.useState(null);
      var entries = dataState[0];
      var setEntries = dataState[1];
      var statusState = react.useState("loading");
      var status = statusState[0];
      var setStatus = statusState[1];
      var anchor = react.useRef(null);

      // The draft drives the strip. `useInput` is the composer's own selector
      // hook, so this re-renders on draft edits and nothing else.
      var draft = "";
      if (typeof useInput === "function") {
        draft = useInput(function (state) {
          return state && typeof state.draft === "string" ? state.draft : "";
        });
      }

      // Typing should not re-rank on every keystroke, and an IME composition
      // must not make the strip flicker.
      var settleState = react.useState("");
      var settled = settleState[0];
      var setSettled = settleState[1];
      react.useEffect(
        function () {
          var timer = setTimeout(function () {
            setSettled(draft);
          }, 260);
          return function () {
            clearTimeout(timer);
          };
        },
        [draft],
      );

      // Pull the index once when the composer mounts; the sheet and the strip
      // share the same array.
      react.useEffect(
        function () {
          var alive = true;
          loadIndex(false)
            .then(function (list) {
              if (alive === false) return;
              setEntries(list);
              setStatus("ready");
            })
            .catch(function () {
              if (alive === false) return;
              setEntries([]);
              setStatus("error");
            });
          return function () {
            alive = false;
          };
        },
        [],
      );

      var rebuild = react.useCallback(function () {
        setStatus("loading");
        loadIndex(true)
          .then(function (list) {
            setEntries(list);
            setStatus("ready");
          })
          .catch(function () {
            setStatus("error");
          });
      }, []);

      // Close on Escape or on a pointer that lands outside the widget.
      react.useEffect(
        function () {
          if (open === false) return undefined;
          var onKey = function (event) {
            if (event.key === "Escape") setOpen(false);
          };
          var onDown = function (event) {
            if (anchor.current !== null && anchor.current.contains(event.target) === false) setOpen(false);
          };
          document.addEventListener("keydown", onKey);
          document.addEventListener("pointerdown", onDown, true);
          return function () {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onDown, true);
          };
        },
        [open],
      );

      var pick = react.useCallback(
        function (entry) {
          placeSkill(inputActions, entry.name);
          setOpen(false);
        },
        [inputActions],
      );

      // A draft that already starts with `/` is the user typing a slash command;
      // do not second-guess that with suggestions.
      var picked = react.useMemo(
        function () {
          if (settled.length < 3) return [];
          if (settled.replace(/^\s+/, "").charAt(0) === "/") return [];
          return shortlist(entries === null ? [] : entries, settled, 3);
        },
        [entries, settled],
      );

      // The strip and the sheet want the same lane above the button, so the
      // strip stands down while the sheet is open.
      var strip = null;
      if (open === false && picked.length > 0) {
        var chips = picked.map(function (match) {
          var entry = match.entry;
          var parts = [el("span", { children: entry.name }, undefined, "n")];
          if (entry.hint) {
            parts.push(el("span", { style: SKIN.chipNote, children: entry.hint }, undefined, "h"));
          }
          return el(
            "button",
            {
              type: "button",
              onClick: function () {
                pick(entry);
              },
              onMouseEnter: tint,
              onMouseLeave: untint,
              style: SKIN.chip,
              "data-rest-fill": "var(--dsw-alias-border-l2)",
              title: entry.zh || entry.description || entry.name,
            },
            parts,
            "chip-" + entry.name,
          );
        });
        chips.unshift(
          el("span", { style: SKIN.stripLead, children: "\u2726 \u63A8\u8350" }, undefined, "lead"),
        );
        strip = el("div", { style: SKIN.strip, children: chips }, undefined, "strip");
      }

      var sheet =
        open === true
          ? el(Sheet, {
              entries: entries,
              status: status,
              onPick: pick,
              onClose: function () {
                setOpen(false);
              },
              onRebuild: rebuild,
            })
          : null;

      var badge =
        Array.isArray(entries) && entries.length > 0
          ? el("span", { style: SKIN.badge, children: entries.length }, undefined, "badge")
          : null;

      // A four-point sparkle: the panel is a suggestion surface, so the glyph
      // reads as "pick something good" rather than "open a menu".
      var glyph = el(
        "svg",
        {
          width: 14,
          height: 14,
          viewBox: "0 0 16 16",
          fill: "none",
          "aria-hidden": "true",
          style: SKIN.glyph,
        },
        [
          el("path", {
            d: "M8 1.6l1.42 3.77L13.2 6.8l-3.78 1.43L8 12l-1.42-3.77L2.8 6.8l3.78-1.43z",
            fill: "currentColor",
            opacity: open === true ? 1 : 0.85,
          }, undefined, "spark"),
          el("path", {
            d: "M12.8 10.6l.62 1.63 1.63.62-1.63.62-.62 1.63-.62-1.63-1.63-.62 1.63-.62z",
            fill: "currentColor",
            opacity: 0.6,
          }, undefined, "spark-small"),
        ],
        "glyph",
      );

      var trigger = el(
        "button",
        {
          type: "button",
          className: "skill-pilot-trigger",
          "aria-label": "\u6280\u80FD",
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          title: "\u6280\u80FD\uFF1A\u6D4F\u89C8\u3001\u641C\u7D22\u3001\u6309\u6b63\u5728\u5199\u7684\u5185\u5BB9\u63A8\u8350",
          onMouseDown: function (event) {
            event.preventDefault();
          },
          onClick: function () {
            setOpen(open !== true);
          },
          style: SKIN.trigger,
        },
        [glyph, el("span", { children: "\u6280\u80FD" }, undefined, "label"), badge],
        "btn",
      );

      return el("div", { ref: anchor, style: SKIN.anchor }, [strip, el("div", { style: SKIN.wrap, children: [trigger, sheet] }, undefined, "wrap")], "root");
    }

    //#endregion

    /**
     * Register the composer entry.
     *
     * @param ctx - client context carrying `slots`.
     */
    function apply(ctx) {
      ctx.effect(function () {
        return function () {
          abortable.forEach(function (controller) {
            controller.abort();
          });
          abortable.clear();
          memo.pending = null;
        };
      }, "skill-pilot: in-flight requests");

      ctx.slots.inject("conversation.input.left", function () {
        return ctx.slots.register({ name: "conversation.input.left", id: "skill-pilot-entry", order: 20 }, ComposerEntry);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
