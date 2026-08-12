/* ===========================================================================
 * track-editor.js — draw an RC track lane as a multi-segment Bézier curve
 *
 * Model
 * -----
 * A track is an ordered list of *nodes* (anchor / control points). Between two
 * consecutive nodes A and B we draw a cubic Bézier:
 *
 *     P0 = A            (anchor)
 *     P1 = A.out        (A's outgoing handle)
 *     P2 = B.in         (B's incoming handle)
 *     P3 = B            (anchor)
 *
 * Each node keeps its two handles as *absolute* points. A freshly-added node
 * gets its handles auto-computed from its neighbours (Catmull-Rom → Bézier) so
 * simply clicking a few points already yields a smooth flowing line. The moment
 * you drag a handle the node becomes "manual" and keeps whatever you set.
 *
 *   node.smooth === true   → the two handles stay mirror-symmetric (rounded)
 *   node.smooth === false  → handles move independently (a sharp corner)
 *
 * The lane itself is rendered by sampling every Bézier segment, offsetting each
 * sample along its normal by ±width/2, and filling the ribbon between the two
 * offset edges.
 * ========================================================================= */
(function () {
  "use strict";

  /* ----- track state ---------------------------------------------------- */
  const track = {
    nodes: [],       // [{ x, y, in:{x,y}, out:{x,y}, smooth, auto }]
    closed: false,
    width: 64,
  };

  let mode = "add";          // "add" | "edit"
  let selected = -1;         // index of selected node, or -1
  let snap = false;
  const GRID = 32;

  const undoStack = [];      // history of serialized snapshots
  const MAX_UNDO = 60;

  /* drag session */
  let drag = null;           // { kind:"node"|"in"|"out", index, dx, dy }

  /* ----- DOM ------------------------------------------------------------ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  /* ----- geometry helpers ---------------------------------------------- */
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

  function cubicAt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
  }

  function cubicTangent(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
    return {
      x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
      y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
    };
  }

  /* segments of the path as [P0,P1,P2,P3] control quads */
  function segments() {
    const n = track.nodes.length;
    const segs = [];
    if (n < 2) return segs;
    const last = track.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = track.nodes[i];
      const b = track.nodes[(i + 1) % n];
      segs.push([{ x: a.x, y: a.y }, a.out, b.in, { x: b.x, y: b.y }]);
    }
    return segs;
  }

  /* ----- auto (Catmull-Rom) handles ------------------------------------ */
  // Recompute handles for every node still flagged auto, using its neighbours.
  function recomputeAuto() {
    const n = track.nodes.length;
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      const node = track.nodes[i];
      if (!node.auto) continue;

      let prev, next;
      if (track.closed) {
        prev = track.nodes[(i - 1 + n) % n];
        next = track.nodes[(i + 1) % n];
      } else {
        prev = track.nodes[i - 1] || node;
        next = track.nodes[i + 1] || node;
      }
      // Tangent ∝ (next - prev); 1/6 keeps a Catmull-Rom-like curve.
      const tx = (next.x - prev.x) / 6;
      const ty = (next.y - prev.y) / 6;
      node.out = { x: node.x + tx, y: node.y + ty };
      node.in  = { x: node.x - tx, y: node.y - ty };
    }
  }

  /* ----- node creation / editing --------------------------------------- */
  function makeNode(x, y) {
    return { x, y, in: { x, y }, out: { x, y }, smooth: true, auto: true };
  }

  function addNode(x, y) {
    pushUndo();
    const node = makeNode(x, y);
    track.nodes.push(node);
    recomputeAuto();
    selected = track.nodes.length - 1;
  }

  function deleteSelected() {
    if (selected < 0) return;
    pushUndo();
    track.nodes.splice(selected, 1);
    selected = -1;
    recomputeAuto();
  }

  // Move an anchor and carry its handles with it (keeps the local shape).
  function moveNode(i, x, y) {
    const node = track.nodes[i];
    const dx = x - node.x, dy = y - node.y;
    node.x = x; node.y = y;
    node.in.x += dx; node.in.y += dy;
    node.out.x += dx; node.out.y += dy;
    // Auto neighbours re-derive from their (now moved) neighbour.
    recomputeAuto();
  }

  // Drag one handle; a smooth node mirrors the opposite one.
  function moveHandle(i, which, x, y) {
    const node = track.nodes[i];
    node.auto = false;               // manual edit wins over auto-smoothing
    const h = which === "out" ? node.out : node.in;
    h.x = x; h.y = y;
    if (node.smooth) {
      const other = which === "out" ? node.in : node.out;
      // Mirror across the anchor, preserving the *other* handle's length.
      const dx = x - node.x, dy = y - node.y;
      const len = Math.hypot(dx, dy) || 1;
      const olen = Math.hypot(other.x - node.x, other.y - node.y) || len;
      other.x = node.x - (dx / len) * olen;
      other.y = node.y - (dy / len) * olen;
    }
  }

  // Make the segment from node i to node i+1 a straight line.
  function straightenFrom(i) {
    const n = track.nodes.length;
    const j = track.closed ? (i + 1) % n : i + 1;
    if (j >= n && !track.closed) return;
    const a = track.nodes[i], b = track.nodes[j];
    if (!b) return;
    pushUndo();
    const dx = (b.x - a.x) / 3, dy = (b.y - a.y) / 3;
    a.out = { x: a.x + dx, y: a.y + dy };
    b.in  = { x: b.x - dx, y: b.y - dy };
    a.auto = false; b.auto = false;
  }

  /* ----- undo / snapshots ---------------------------------------------- */
  function snapshot() {
    return JSON.stringify({ nodes: track.nodes, closed: track.closed, width: track.width });
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    refreshControls();
  }
  function undo() {
    if (!undoStack.length) return;
    const prev = JSON.parse(undoStack.pop());
    track.nodes = prev.nodes;
    track.closed = prev.closed;
    track.width = prev.width;
    selected = Math.min(selected, track.nodes.length - 1);
    syncWidthUI();
    render();
    refreshControls();
  }

  /* ----- hit testing (in canvas coords) -------------------------------- */
  const HIT = 12;   // px radius for grabbing points

  function hitTest(x, y) {
    // Prefer the selected node's handles, then all handles, then anchors.
    const order = [];
    if (selected >= 0) order.push(selected);
    for (let i = 0; i < track.nodes.length; i++) if (i !== selected) order.push(i);

    // handles first (they sit on top and are smaller targets)
    for (const i of order) {
      const nd = track.nodes[i];
      if (showHandles(i)) {
        if (dist2(x, y, nd.out.x, nd.out.y) <= HIT * HIT) return { kind: "out", index: i };
        if (dist2(x, y, nd.in.x, nd.in.y) <= HIT * HIT)  return { kind: "in", index: i };
      }
    }
    for (const i of order) {
      const nd = track.nodes[i];
      if (dist2(x, y, nd.x, nd.y) <= HIT * HIT) return { kind: "node", index: i };
    }
    return null;
  }

  // Handles are drawn for the selected node and its immediate neighbours.
  function showHandles(i) {
    if (selected < 0) return false;
    if (i === selected) return true;
    const n = track.nodes.length;
    if (track.closed) return i === (selected + 1) % n || i === (selected - 1 + n) % n;
    return i === selected + 1 || i === selected - 1;
  }

  /* ----- rendering ------------------------------------------------------ */
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.round(r.width);
    H = Math.round(r.height);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    render();
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = "#eef2f9";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke();
    }
    ctx.restore();
  }

  // Sample the whole centreline into a flat list of {x,y,nx,ny} (nx,ny = normal).
  function sampleCenterline(perSeg = 24) {
    const segs = segments();
    const pts = [];
    for (let s = 0; s < segs.length; s++) {
      const [p0, p1, p2, p3] = segs[s];
      // Skip the shared endpoint except on the very first segment.
      for (let k = (s === 0 ? 0 : 1); k <= perSeg; k++) {
        const t = k / perSeg;
        const p = cubicAt(p0, p1, p2, p3, t);
        const tan = cubicTangent(p0, p1, p2, p3, t);
        const len = Math.hypot(tan.x, tan.y) || 1;
        pts.push({ x: p.x, y: p.y, nx: -tan.y / len, ny: tan.x / len });
      }
    }
    return pts;
  }

  function drawTrack() {
    const pts = sampleCenterline();
    if (pts.length < 2) return;
    const hw = track.width / 2;

    const left = pts.map((p) => ({ x: p.x + p.nx * hw, y: p.y + p.ny * hw }));
    const right = pts.map((p) => ({ x: p.x - p.nx * hw, y: p.y - p.ny * hw }));

    // Asphalt ribbon: left edge forward, right edge back.
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    if (track.closed) ctx.closePath();
    ctx.fillStyle = "#3a3f4b";
    ctx.fill();

    // Coloured edge kerbs.
    const edge = (arr) => {
      ctx.beginPath();
      ctx.moveTo(arr[0].x, arr[0].y);
      for (let i = 1; i < arr.length; i++) ctx.lineTo(arr[i].x, arr[i].y);
      if (track.closed) ctx.closePath();
      ctx.stroke();
    };
    ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "#ff5a5f"; edge(left);
    ctx.strokeStyle = "#ffffff"; edge(right);

    // Dashed centre / racing line.
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (track.closed) ctx.closePath();
    ctx.setLineDash([14, 12]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffd54a";
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSkeleton() {
    // Thin centreline (so you can see the path even with width 0-ish).
    const segs = segments();
    if (segs.length) {
      ctx.beginPath();
      ctx.moveTo(segs[0][0].x, segs[0][0].y);
      for (const [p0, p1, p2, p3] of segs) ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      ctx.strokeStyle = "rgba(77,150,255,.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Handles + anchors.
    for (let i = 0; i < track.nodes.length; i++) {
      const nd = track.nodes[i];
      if (showHandles(i)) {
        ctx.strokeStyle = "#9aa7bd";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(nd.in.x, nd.in.y); ctx.lineTo(nd.x, nd.y);
        ctx.lineTo(nd.out.x, nd.out.y); ctx.stroke();
        handleDot(nd.in.x, nd.in.y);
        handleDot(nd.out.x, nd.out.y);
      }
    }
    for (let i = 0; i < track.nodes.length; i++) {
      const nd = track.nodes[i];
      const isSel = i === selected;
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, isSel ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? "#4d96ff" : (nd.smooth ? "#2b7a3a" : "#c76a00");
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      // Number the nodes so export order is obvious.
      ctx.fillStyle = "#1c2636";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(String(i + 1), nd.x, nd.y - 9);
    }
  }

  function handleDot(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#6b7a93"; ctx.stroke();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawTrack();
    drawSkeleton();
  }

  /* ----- pointer interaction ------------------------------------------- */
  function toCanvas(evt) {
    const r = canvas.getBoundingClientRect();
    let x = evt.clientX - r.left;
    let y = evt.clientY - r.top;
    if (snap) { x = Math.round(x / GRID) * GRID; y = Math.round(y / GRID) * GRID; }
    return { x, y };
  }

  function onPointerDown(evt) {
    evt.preventDefault();
    canvas.setPointerCapture(evt.pointerId);
    const { x, y } = toCanvas(evt);
    const hit = hitTest(x, y);

    if (hit) {
      selected = hit.index;
      // Undo is captured lazily on the first move, so a pure click that only
      // selects a point doesn't pile up no-op history entries.
      drag = { kind: hit.kind, index: hit.index, saved: false };
      refreshControls();
      render();
      return;
    }

    if (mode === "add") {
      addNode(x, y);
      drag = { kind: "node", index: selected, fresh: true };
      refreshControls();
      render();
    } else {
      selected = -1;
      refreshControls();
      render();
    }
  }

  function onPointerMove(evt) {
    if (!drag) return;
    evt.preventDefault();
    if (!drag.saved && !drag.fresh) { pushUndo(); drag.saved = true; }
    const { x, y } = toCanvas(evt);
    if (drag.kind === "node") moveNode(drag.index, x, y);
    else moveHandle(drag.index, drag.kind, x, y);
    render();
  }

  function onPointerUp(evt) {
    if (!drag) return;
    evt.preventDefault();
    try { canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
    drag = null;
    refreshControls();
  }

  /* ----- toolbar wiring ------------------------------------------------- */
  function setMode(m) {
    mode = m;
    $("modeAdd").classList.toggle("is-on", m === "add");
    $("modeEdit").classList.toggle("is-on", m === "edit");
    canvas.style.cursor = m === "add" ? "crosshair" : "default";
  }

  function refreshControls() {
    const has = selected >= 0;
    const nd = has ? track.nodes[selected] : null;
    $("smoothBtn").disabled = !has;
    $("cornerBtn").disabled = !has;
    $("deleteBtn").disabled = !has;
    const n = track.nodes.length;
    const canStraight = has && (track.closed ? n >= 2 : selected < n - 1);
    $("straightBtn").disabled = !canStraight;
    if (nd) {
      $("smoothBtn").classList.toggle("is-on", nd.smooth);
      $("cornerBtn").classList.toggle("is-on", !nd.smooth);
    } else {
      $("smoothBtn").classList.remove("is-on");
      $("cornerBtn").classList.remove("is-on");
    }
    $("undoBtn").disabled = undoStack.length === 0;
    $("closeBtn").classList.toggle("is-on", track.closed);
  }

  function syncWidthUI() {
    $("widthRange").value = track.width;
    $("widthVal").textContent = track.width;
  }

  /* ----- export --------------------------------------------------------- */
  function svgPathData() {
    const segs = segments();
    if (!segs.length) return "";
    let d = `M ${round(segs[0][0].x)} ${round(segs[0][0].y)}`;
    for (const [, p1, p2, p3] of segs) {
      d += ` C ${round(p1.x)} ${round(p1.y)}, ${round(p2.x)} ${round(p2.y)}, ${round(p3.x)} ${round(p3.y)}`;
    }
    if (track.closed) d += " Z";
    return d;
  }

  const round = (v) => Math.round(v * 100) / 100;

  function exportJSON() {
    const data = {
      closed: track.closed,
      width: track.width,
      nodes: track.nodes.map((nd) => ({
        x: round(nd.x), y: round(nd.y),
        in: { x: round(nd.in.x), y: round(nd.in.y) },
        out: { x: round(nd.out.x), y: round(nd.out.y) },
        smooth: nd.smooth,
      })),
    };
    return JSON.stringify(data, null, 2);
  }

  function exportPoints() {
    // Evenly-ish sampled centreline — handy for driving a marker along the track.
    const pts = sampleCenterline(20).map((p) => ({ x: round(p.x), y: round(p.y) }));
    return JSON.stringify(pts, null, 2);
  }

  function exportSVGFile() {
    const d = svgPathData();
    const w = Math.max(1, W), h = Math.max(1, H);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <path d="${d}" fill="none" stroke="#3a3f4b" stroke-width="${track.width}" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${d}" fill="none" stroke="#ffd54a" stroke-width="2" stroke-dasharray="14 12"/>
</svg>`;
  }

  let currentTab = "json";
  function exportContent(tab) {
    switch (tab) {
      case "svgpath": return svgPathData();
      case "points":  return exportPoints();
      case "svgfile": return exportSVGFile();
      default:        return exportJSON();
    }
  }
  function fileName(tab) {
    return tab === "svgfile" ? "rc-track.svg"
      : tab === "svgpath" ? "rc-track-path.txt"
      : tab === "points" ? "rc-track-points.json"
      : "rc-track.json";
  }

  function openExport() {
    if (track.nodes.length < 2) {
      alert("Add at least two points to export a track.");
      return;
    }
    showTab(currentTab);
    $("exportOverlay").hidden = false;
  }
  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".te-tab").forEach((b) =>
      b.classList.toggle("is-on", b.dataset.tab === tab));
    $("exportText").value = exportContent(tab);
    $("copyMsg").textContent = "";
  }

  /* ----- sample track --------------------------------------------------- */
  function loadSample() {
    pushUndo();
    const cx = W / 2, cy = H / 2;
    const rx = Math.min(W, H) * 0.32, ry = Math.min(W, H) * 0.24;
    const pts = [
      [cx - rx, cy], [cx - rx * 0.5, cy - ry], [cx + rx * 0.4, cy - ry * 1.1],
      [cx + rx, cy - ry * 0.2], [cx + rx * 0.7, cy + ry], [cx - rx * 0.3, cy + ry * 1.05],
    ];
    track.nodes = pts.map(([x, y]) => makeNode(x, y));
    track.closed = true;
    selected = -1;
    recomputeAuto();
    syncWidthUI();
    refreshControls();
    render();
  }

  /* ----- events --------------------------------------------------------- */
  function bind() {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    $("modeAdd").onclick = () => setMode("add");
    $("modeEdit").onclick = () => setMode("edit");

    $("smoothBtn").onclick = () => {
      if (selected < 0) return;
      pushUndo();
      track.nodes[selected].smooth = true;
      // Re-derive a nice rounded shape from neighbours.
      track.nodes[selected].auto = true;
      recomputeAuto();
      refreshControls(); render();
    };
    $("cornerBtn").onclick = () => {
      if (selected < 0) return;
      pushUndo();
      track.nodes[selected].smooth = false;
      refreshControls(); render();
    };
    $("straightBtn").onclick = () => { if (selected >= 0) { straightenFrom(selected); render(); } };
    $("deleteBtn").onclick = () => { deleteSelected(); refreshControls(); render(); };

    $("closeBtn").onclick = () => {
      pushUndo();
      track.closed = !track.closed;
      recomputeAuto();
      refreshControls(); render();
    };

    $("widthRange").oninput = (e) => {
      track.width = +e.target.value;
      $("widthVal").textContent = track.width;
      render();
    };

    $("snapChk").onchange = (e) => { snap = e.target.checked; };

    $("undoBtn").onclick = undo;
    $("clearBtn").onclick = () => {
      if (!track.nodes.length) return;
      pushUndo();
      track.nodes = []; track.closed = false; selected = -1;
      refreshControls(); render();
    };
    $("sampleBtn").onclick = loadSample;

    $("exportBtn").onclick = openExport;
    $("exportClose").onclick = () => { $("exportOverlay").hidden = true; };
    $("exportOverlay").onclick = (e) => { if (e.target === $("exportOverlay")) $("exportOverlay").hidden = true; };
    document.querySelectorAll(".te-tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

    $("copyBtn").onclick = async () => {
      const text = $("exportText").value;
      try {
        await navigator.clipboard.writeText(text);
        $("copyMsg").textContent = "Copied!";
      } catch (e) {
        $("exportText").select();
        document.execCommand && document.execCommand("copy");
        $("copyMsg").textContent = "Copied!";
      }
      setTimeout(() => ($("copyMsg").textContent = ""), 1600);
    };
    $("downloadBtn").onclick = () => {
      const text = $("exportText").value;
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName(currentTab);
      a.click();
      URL.revokeObjectURL(a.href);
    };

    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected >= 0) {
        e.preventDefault(); deleteSelected(); refreshControls(); render();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault(); undo();
      } else if (e.key === "Escape") {
        if (!$("exportOverlay").hidden) $("exportOverlay").hidden = true;
        else { selected = -1; refreshControls(); render(); }
      } else if (e.key.toLowerCase() === "a") {
        setMode("add");
      } else if (e.key.toLowerCase() === "e") {
        setMode("edit");
      }
    });

    window.addEventListener("resize", resize);
  }

  /* ----- boot ----------------------------------------------------------- */
  function init() {
    bind();
    setMode("add");
    syncWidthUI();
    resize();
    refreshControls();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
