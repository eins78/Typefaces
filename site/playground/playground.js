(function () {
  "use strict";

  var STORAGE_KEY = "typefaces-playground-v1";
  var DEFAULT_SAMPLE = "Sphinx of black quartz, judge my vow 0123456789";

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    sample: $("sample"), size: $("size"), sizeOut: $("size-out"), search: $("search"),
    list: $("list"), status: $("status"), count: $("count"), skipped: $("skipped"),
    copy: $("copy"), copyLink: $("copy-link"), clear: $("clear"),
    tools: $("tools"), toolsToggle: $("tools-toggle"), toolsBadge: $("tools-badge")
  };

  // ---- state (localStorage, mirrored to the URL hash) ----

  var state = { ticked: [], starred: [], sample: DEFAULT_SAMPLE, size: 40 };
  var filter = "all";
  var query = "";

  function storageGet() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { return null; }
  }
  function storageSet() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
  }

  function parseHash() {
    var out = null;
    try {
      var p = new URLSearchParams(location.hash.slice(1));
      if (p.has("t") || p.has("s")) {
        out = {
          ticked: (p.get("t") || "").split(",").filter(Boolean),
          starred: (p.get("s") || "").split(",").filter(Boolean)
        };
      }
    } catch (e) { /* ignore a broken hash */ }
    return out;
  }

  function writeHash() {
    var p = new URLSearchParams();
    if (state.ticked.length) p.set("t", state.ticked.join(","));
    if (state.starred.length) p.set("s", state.starred.join(","));
    var hash = p.toString().replace(/%2C/g, ",");
    try { history.replaceState(null, "", location.pathname + location.search + (hash ? "#" + hash : "")); } catch (e) { /* ignore */ }
  }

  function loadState() {
    var saved = storageGet();
    if (saved) {
      state.sample = typeof saved.sample === "string" ? saved.sample : state.sample;
      state.size = +saved.size || state.size;
      state.ticked = Array.isArray(saved.ticked) ? saved.ticked : [];
      state.starred = Array.isArray(saved.starred) ? saved.starred : [];
    }
    var fromHash = parseHash(); // a shared link wins over the saved picks
    if (fromHash) { state.ticked = fromHash.ticked; state.starred = fromHash.starred; }
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
        select.addEventListener("change", function () { row.axisValues = {}; loadFace(row, +select.value); renderAxes(); });
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
          input.addEventListener("input", function () { row.axisValues[a.tag] = +input.value; out.textContent = input.value; applyFace(row); });
          axesBox.appendChild(el("label", {}, [el("span", { text: a.name }), input, out]));
        });
      };
      renderAxes();
      li.appendChild(el("details", { class: "tweak" }, [el("summary", { text: "Style and axes" }), controls]));
    }

    tick.addEventListener("change", function () { toggle(state.ticked, family.id); persist(); });
    star.addEventListener("click", function () { toggle(state.starred, family.id); persist(); });

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
    els.sample.value = state.sample;
    els.size.value = state.size;
    els.sizeOut.textContent = state.size;

    manifest.families.forEach(function (family) {
      var row = buildRow(family);
      rows.push(row);
      byId[family.id] = row;
      els.list.appendChild(row.el);
      syncRow(row);
      if (observer) observer.observe(row.el); else loadFace(row, row.face);
    });
    renderSamples();
    applyFilters();

    if (manifest.skipped && manifest.skipped.length) {
      var ul = els.skipped.querySelector("ul");
      manifest.skipped.forEach(function (s) { ul.appendChild(el("li", { text: s.dir + ": " + s.reason })); });
      els.skipped.hidden = false;
    }

    els.sample.addEventListener("input", function () { state.sample = els.sample.value; storageSet(); renderSamples(); });
    els.size.addEventListener("input", function () { state.size = +els.size.value; els.sizeOut.textContent = state.size; storageSet(); renderSamples(); });
    function setTools(open) {
      els.tools.classList.toggle("open", open);
      els.toolsToggle.setAttribute("aria-expanded", String(open));
    }
    els.toolsToggle.addEventListener("click", function () { setTools(!els.tools.classList.contains("open")); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setTools(false); });
    els.search.addEventListener("input", function () { query = els.search.value; applyFilters(); });
    document.querySelectorAll("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
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
      if (h) { state.ticked = h.ticked; state.starred = h.starred; storageSet(); rows.forEach(syncRow); applyFilters(); }
    });
    writeHash();
  }

  fetch("../fonts/manifest.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function () { els.status.textContent = "Could not load the font list (fonts/manifest.json)."; });
})();
