(function () {
  "use strict";

  var STORAGE_KEY = "typefaces-playground-v1";
  var DEFAULT_SAMPLE = "Sphinx of black quartz, judge my vow 0123456789";
  var DEFAULT_SIZE = 40;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    sample: $("sample"), size: $("size"), sizeOut: $("size-out"), search: $("search"),
    list: $("list"), status: $("status"), count: $("count"), skipped: $("skipped"),
    copy: $("copy"), copyLink: $("copy-link"), clear: $("clear"),
    tools: $("tools"), toolsToggle: $("tools-toggle"), toolsBadge: $("tools-badge")
  };

  // ---- state (localStorage for picks, sample and size; the whole view in the URL hash) ----

  var state = { ticked: [], starred: [], sample: DEFAULT_SAMPLE, size: DEFAULT_SIZE };
  var filter = "all";
  var query = "";

  function storageGet() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { return null; }
  }
  function storageSet() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
  }

  // The whole view lives in the URL hash, so a link reproduces it:
  //   t, s  ticked / starred font ids        q  sample text      z  size
  //   n     name filter                      v  view (starred or ticked; absent = all)
  //   x     style and axes: id:face[:tag@value;tag@value],...   (only what differs from the defaults)
  //   o     ids of the open "Style and axes" panels
  // Absent keys mean the default. A link with any of these keys wins over what is saved locally.
  var HASH_KEYS = ["t", "s", "q", "z", "n", "v", "x", "o"];

  function enc(text) {
    return encodeURIComponent(text).replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%3B/g, ";").replace(/%40/g, "@");
  }

  function parseHash() {
    var out = {}, any = false;
    location.hash.slice(1).split("&").forEach(function (pair) {
      var i = pair.indexOf("=");
      if (i < 1) return;
      var key = pair.slice(0, i);
      if (HASH_KEYS.indexOf(key) === -1) return;
      try { out[key] = decodeURIComponent(pair.slice(i + 1)); any = true; } catch (e) { /* ignore a broken value */ }
    });
    return any ? out : null;
  }

  function list(text) { return (text || "").split(",").filter(Boolean); }

  function tweaksToHash() {
    return rows.map(function (row) {
      var face = row.family.faces[row.face];
      var axes = face.axes.filter(function (a) { return row.axisValues[a.tag] != null && row.axisValues[a.tag] !== a.default; })
        .map(function (a) { return a.tag + "@" + row.axisValues[a.tag]; });
      if (row.face === row.defaultFace && !axes.length) return null;
      return row.family.id + ":" + row.face + (axes.length ? ":" + axes.join(";") : "");
    }).filter(Boolean);
  }

  function hashString() {
    var parts = [];
    function add(key, value) { parts.push(key + "=" + enc(value)); }
    if (state.ticked.length) add("t", state.ticked.join(","));
    if (state.starred.length) add("s", state.starred.join(","));
    if (state.sample !== DEFAULT_SAMPLE) add("q", state.sample);
    if (state.size !== DEFAULT_SIZE) add("z", String(state.size));
    if (query) add("n", query);
    if (filter !== "all") add("v", filter);
    var tweaks = tweaksToHash();
    if (tweaks.length) add("x", tweaks.join(","));
    var open = rows.filter(function (r) { return r.details && r.details.open; }).map(function (r) { return r.family.id; });
    if (open.length) add("o", open.join(","));
    return parts.join("&");
  }

  function writeHash() {
    var hash = hashString();
    try { history.replaceState(null, "", location.pathname + location.search + (hash ? "#" + hash : "")); } catch (e) { /* ignore */ }
  }

  function applyTweaks(text) {
    var wanted = {};
    list(text).forEach(function (entry) {
      var bits = entry.split(":");
      var axes = {};
      (bits[2] || "").split(";").forEach(function (pair) {
        var kv = pair.split("@");
        if (kv[0] && isFinite(parseFloat(kv[1]))) axes[kv[0]] = parseFloat(kv[1]);
      });
      wanted[bits[0]] = { face: parseInt(bits[1], 10), axes: axes };
    });
    rows.forEach(function (row) {
      var w = wanted[row.family.id];
      var face = w && w.face >= 0 && w.face < row.family.faces.length ? w.face : row.defaultFace;
      var values = {};
      row.family.faces[face].axes.forEach(function (a) {
        if (w && w.axes[a.tag] != null) values[a.tag] = Math.min(Math.max(w.axes[a.tag], a.min), a.max);
      });
      row.setStyle(face, values);
    });
  }

  function applyHash(h) {
    state.ticked = list(h.t);
    state.starred = list(h.s);
    state.sample = h.q != null ? h.q : DEFAULT_SAMPLE;
    state.size = Math.min(Math.max(parseInt(h.z, 10) || DEFAULT_SIZE, 14), 120);
    query = h.n || "";
    filter = h.v === "starred" || h.v === "ticked" ? h.v : "all";
    if (rows.length) {
      applyTweaks(h.x);
      var open = list(h.o);
      rows.forEach(function (row) { if (row.details) row.details.open = open.indexOf(row.family.id) !== -1; });
    }
  }

  function loadState() {
    var saved = storageGet();
    if (saved) {
      state.sample = typeof saved.sample === "string" ? saved.sample : state.sample;
      state.size = +saved.size || state.size;
      state.ticked = Array.isArray(saved.ticked) ? saved.ticked : [];
      state.starred = Array.isArray(saved.starred) ? saved.starred : [];
    }
  }

  function syncControls() {
    els.sample.value = state.sample;
    els.size.value = state.size;
    els.sizeOut.textContent = state.size;
    els.search.value = query;
    document.querySelectorAll("[data-filter]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.filter === filter)); });
  }

  function has(list, id) { return list.indexOf(id) !== -1; }
  function toggle(list, id) {
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
  }

  // ---- font loading ----

  var rows = [];          // {family, el, loaded: {faceIndex: FontFace}, face, axes}
  var byId = {};

  function faceWeight(f) {
    var w = f.axes.filter(function (a) { return a.tag === "wght"; })[0];
    if (!w) return f.weight;
    return Math.min(Math.max(400, w.min), w.max);
  }

  function defaultFace(family) {
    var best = 0, bestScore = Infinity;
    family.faces.forEach(function (f, i) {
      var score = Math.abs(faceWeight(f) - 400) + (f.italic ? 1000 : 0) + Math.abs(f.width - 5) * 10;
      if (score < bestScore) { best = i; bestScore = score; }
    });
    return best;
  }

  function faceLabel(f) {
    return f.style + (f.axes.length ? " (variable)" : "");
  }

  function fontUrl(family, face) {
    return "../fonts/" + encodeURIComponent(family.dir) + "/" + encodeURIComponent(face.file);
  }

  function loadFace(row, index) {
    var family = row.family, face = family.faces[index];
    row.face = index;
    applyFace(row);
    if (row.loaded[index]) return row.loaded[index].promise;
    var internal = "tf-" + family.id + "-" + index;
    var ff = new FontFace(internal, "url(" + fontUrl(family, face) + ")", { style: face.italic ? "italic" : "normal" });
    var entry = { name: internal, promise: null };
    row.loaded[index] = entry;
    row.el.dataset.state = "loading";
    entry.promise = ff.load().then(function () {
      document.fonts.add(ff);
      if (row.face === index) { row.el.dataset.state = "ready"; applyFace(row); }
    }).catch(function () {
      row.loaded[index] = null;
      row.el.dataset.state = "error";
      row.sampleEl.textContent = "Could not load this font.";
    });
    return entry.promise;
  }

  function applyFace(row) {
    var entry = row.loaded[row.face];
    var face = row.family.faces[row.face];
    row.sampleEl.style.fontFamily = entry ? '"' + entry.name + '", ' + "system-ui" : "";
    row.sampleEl.style.fontStyle = face.italic ? "italic" : "normal";
    row.sampleEl.style.fontVariationSettings = face.axes.length
      ? face.axes.map(function (a) { return '"' + a.tag + '" ' + (row.axisValues[a.tag] != null ? row.axisValues[a.tag] : a.default); }).join(", ")
      : "normal";
  }

  var observer = "IntersectionObserver" in window
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          observer.unobserve(e.target);
          var row = byId[e.target.dataset.id];
          if (row) loadFace(row, row.face);
        });
      }, { rootMargin: "400px 0px" })
    : null;

  // ---- rows ----

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k]; else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function kb(bytes) { return bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB"; }

  function buildRow(family) {
    var row = { family: family, loaded: {}, face: defaultFace(family), axisValues: {} };
    row.defaultFace = row.face;

    var tick = el("input", { type: "checkbox", "aria-label": "Tick " + family.name });
    var star = el("button", { type: "button", class: "star", "aria-label": "Star " + family.name, title: "Star" , text: "★" });
    var licenseFile = family.license.files[0];
    var meta = el("div", { class: "meta" }, [
      el("span", { class: "name", text: family.name }),
      el("span", { class: "badge", text: family.license.id }),
      el("span", { text: family.faces.length + (family.faces.length === 1 ? " style" : " styles") + (family.variable ? ", variable" : "") + " · " + kb(family.bytes) })
    ]);
    var links = el("a", { href: family.source, text: "source" });
    var lic = el("a", { href: "../fonts/" + encodeURIComponent(family.dir) + "/" + encodeURIComponent(licenseFile), text: "licence" });
    meta.appendChild(links);
    meta.appendChild(lic);

    var marks = el("div", { class: "marks" }, [el("label", {}, [tick, el("span", { text: "pick" })]), star]);
    var sampleEl = el("p", { class: "sample", contenteditable: "false" });

    var li = el("li", { class: "row", "data-id": family.id, "data-state": "idle" }, [meta, marks, sampleEl]);

    // style and axis controls
    if (family.faces.length > 1 || family.variable) {
      var controls = el("div", { class: "controls" });
      if (family.faces.length > 1) {
        var select = el("select", { "aria-label": "Style of " + family.name });
        family.faces.forEach(function (f, i) { select.appendChild(el("option", { value: String(i), text: faceLabel(f) })); });
        select.value = String(row.face);
        select.addEventListener("change", function () { row.axisValues = {}; loadFace(row, +select.value); renderAxes(); writeHash(); });
        row.select = select;
        controls.appendChild(el("label", {}, [el("span", { text: "Style" }), select]));
      }
      var axesBox = el("span", { class: "axes" });
      controls.appendChild(axesBox);
      var renderAxes = function () {
        axesBox.textContent = "";
        family.faces[row.face].axes.forEach(function (a) {
          if (a.min === a.max) return;
          var input = el("input", { type: "range", min: a.min, max: a.max, step: (a.max - a.min) > 20 ? 1 : 0.01, value: row.axisValues[a.tag] != null ? row.axisValues[a.tag] : a.default });
          var out = el("output", { text: String(input.value) });
          input.addEventListener("input", function () { row.axisValues[a.tag] = +input.value; out.textContent = input.value; applyFace(row); writeHash(); });
          axesBox.appendChild(el("label", {}, [el("span", { text: a.name }), input, out]));
        });
      };
      renderAxes();
      row.details = el("details", { class: "tweak" }, [el("summary", { text: "Style and axes" }), controls]);
      row.details.addEventListener("toggle", writeHash);
      row.renderAxes = renderAxes;
      li.appendChild(row.details);
    }

    tick.addEventListener("change", function () { toggle(state.ticked, family.id); persist(); });
    star.addEventListener("click", function () { toggle(state.starred, family.id); persist(); });

    // Set the style and axis values (from a link). A row that is not on screen yet keeps loading lazily.
    row.setStyle = function (face, values) {
      row.face = face;
      row.axisValues = values;
      if (row.select) row.select.value = String(face);
      if (row.renderAxes) row.renderAxes();
      if (row.el.dataset.state === "idle") applyFace(row); else loadFace(row, face);
    };

    row.el = li; row.tick = tick; row.star = star; row.sampleEl = sampleEl;
    return row;
  }

  function syncRow(row) {
    var id = row.family.id;
    row.tick.checked = has(state.ticked, id);
    var starred = has(state.starred, id);
    row.star.setAttribute("aria-pressed", String(starred));
    row.star.title = starred ? "Unstar" : "Star";
  }

  function applyFilters() {
    var q = query.trim().toLowerCase();
    var shown = 0;
    rows.forEach(function (row) {
      var id = row.family.id;
      var ok = (filter === "all" || (filter === "starred" && has(state.starred, id)) || (filter === "ticked" && has(state.ticked, id))) &&
        (!q || row.family.name.toLowerCase().indexOf(q) !== -1 || row.family.collection.toLowerCase().indexOf(q) !== -1);
      row.el.hidden = !ok;
      if (ok) shown++;
    });
    els.status.textContent = shown ? "" : "Nothing to show.";
    var picks = state.starred.length + state.ticked.length;
    els.toolsBadge.textContent = String(picks);
    els.toolsBadge.hidden = !picks;
    els.count.textContent = state.starred.length + " starred, " + state.ticked.length + " ticked · " + shown + " of " + rows.length + " shown";
  }

  function persist() {
    storageSet();
    writeHash();
    rows.forEach(syncRow);
    applyFilters();
  }

  function renderSamples() {
    var text = state.sample || DEFAULT_SAMPLE;
    rows.forEach(function (row) {
      if (row.el.dataset.state !== "error") row.sampleEl.textContent = text;
      row.sampleEl.style.fontSize = state.size + "px";
    });
  }

  // ---- picks out ----

  function pickList() {
    var out = [];
    function line(label, ids) {
      if (!ids.length) return;
      out.push(label + ":");
      ids.forEach(function (id) {
        var f = byId[id] && byId[id].family;
        if (f) out.push("- " + f.name + " (" + f.license.id + ") " + f.source);
      });
    }
    line("Starred", state.starred);
    line("Ticked", state.ticked.filter(function (id) { return !has(state.starred, id); }));
    return out.join("\n") || "No picks yet.";
  }

  function copy(text, button) {
    var done = function () { var old = button.textContent; button.textContent = "Copied"; setTimeout(function () { button.textContent = old; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this:", text); });
    } else {
      window.prompt("Copy this:", text);
    }
  }

  // ---- init ----

  function init(manifest) {
    loadState();

    manifest.families.forEach(function (family) {
      var row = buildRow(family);
      rows.push(row);
      byId[family.id] = row;
      els.list.appendChild(row.el);
      syncRow(row);
      if (observer) observer.observe(row.el); else loadFace(row, row.face);
    });
    var fromHash = parseHash();
    if (fromHash) applyHash(fromHash);
    syncControls();
    rows.forEach(syncRow);
    renderSamples();
    applyFilters();

    if (manifest.skipped && manifest.skipped.length) {
      var ul = els.skipped.querySelector("ul");
      manifest.skipped.forEach(function (s) { ul.appendChild(el("li", { text: s.dir + ": " + s.reason })); });
      els.skipped.hidden = false;
    }

    els.sample.addEventListener("input", function () { state.sample = els.sample.value; storageSet(); writeHash(); renderSamples(); });
    els.size.addEventListener("input", function () { state.size = +els.size.value; els.sizeOut.textContent = state.size; storageSet(); writeHash(); renderSamples(); });
    function setTools(open) {
      els.tools.classList.toggle("open", open);
      els.toolsToggle.setAttribute("aria-expanded", String(open));
    }
    els.toolsToggle.addEventListener("click", function () { setTools(!els.tools.classList.contains("open")); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setTools(false); });
    els.search.addEventListener("input", function () { query = els.search.value; writeHash(); applyFilters(); });
    document.querySelectorAll("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        writeHash();
        applyFilters();
      });
    });
    els.copy.addEventListener("click", function () { copy(pickList(), els.copy); });
    els.copyLink.addEventListener("click", function () { writeHash(); copy(location.href, els.copyLink); });
    els.clear.addEventListener("click", function () {
      if (!state.ticked.length && !state.starred.length) return;
      if (window.confirm("Clear all ticks and stars?")) { state.ticked = []; state.starred = []; persist(); }
    });
    window.addEventListener("hashchange", function () {
      var h = parseHash();
      if (h) { applyHash(h); storageSet(); syncControls(); rows.forEach(syncRow); renderSamples(); applyFilters(); }
    });
    writeHash();
  }

  fetch("../fonts/manifest.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function () { els.status.textContent = "Could not load the font list (fonts/manifest.json)."; });
})();
