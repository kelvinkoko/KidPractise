/* ===========================================================================
 * app.js — game logic, rendering, drag & rotate interactions
 *
 * Relies on globals from levels.js: COLORS, LEVELS, generateRandomLevel().
 * ========================================================================= */
(function () {
  "use strict";

  /* ----- tile geometry helpers --------------------------------------------
   * We describe a piece's appearance as a 4-tuple of edge colours:
   *     [top, right, bottom, left]
   * A diagonally-split square always has two adjacent edges of one colour and
   * the other two of the second colour, so this tuple captures it exactly and
   * rotating the piece is just a cyclic shift of the tuple.
   * --------------------------------------------------------------------- */
  function rotCW(t) { return [t[3], t[0], t[1], t[2]]; }      // 90° clockwise

  function appearance(piece) {
    // base: c1 fills the TOP-RIGHT half, c2 the BOTTOM-LEFT half.
    let t = [piece.c1, piece.c1, piece.c2, piece.c2];
    for (let i = 0; i < ((piece.rot % 4) + 4) % 4; i++) t = rotCW(t);
    return t;
  }

  function sameLook(a, b) {
    if (!a || !b) return false;
    const ta = appearance(a), tb = appearance(b);
    return ta[0] === tb[0] && ta[1] === tb[1] && ta[2] === tb[2] && ta[3] === tb[3];
  }

  /* Render a piece as an SVG: four triangles meeting at the centre. Because
   * adjacent edges share a colour, this always reads as one clean diagonal. */
  function tileSVG(piece) {
    const [top, right, bottom, left] = appearance(piece);
    const col = k => COLORS[k] || k;
    const C = "50,50";
    const tri = (pts, c) =>
      `<polygon points="${pts}" fill="${col(c)}" stroke="${col(c)}" stroke-width="0.5"/>`;
    return (
      `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` +
      tri(`${C} 0,0 100,0`, top) +
      tri(`${C} 100,0 100,100`, right) +
      tri(`${C} 100,100 0,100`, bottom) +
      tri(`${C} 0,100 0,0`, left) +
      `</svg>`
    );
  }

  /* ----- state ---------------------------------------------------------- */
  let state = null;   // { size, targets:[], grid:[], tray:[], name }
  let pieceSeq = 0;
  let peek = false;

  function makePiece(c1, c2, rot) {
    return { id: ++pieceSeq, c1, c2, rot: ((rot % 4) + 4) % 4 };
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* Build playable state from a level definition. */
  function loadLevel(level) {
    const size = level.size;
    const targets = level.cells.map(c => (c ? { c1: c.c1, c2: c.c2, rot: c.rot } : null));
    const grid = new Array(size * size).fill(null);

    // One tray piece per non-empty target cell, with a randomised rotation so
    // the kid has to both place AND spin it correctly.
    const tray = [];
    targets.forEach(t => {
      if (t) tray.push(makePiece(t.c1, t.c2, Math.floor(Math.random() * 4)));
    });
    shuffle(tray);

    state = { size, targets, grid, tray, name: level.name };
    render();
  }

  /* ----- rendering ------------------------------------------------------ */
  const el = id => document.getElementById(id);

  function render() {
    renderTarget();
    renderBoard();
    renderTray();
  }

  function gridTemplate(node, size) {
    node.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  }

  function renderTarget() {
    const node = el("targetGrid");
    gridTemplate(node, state.size);
    node.innerHTML = "";
    state.targets.forEach(t => {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (t) cell.innerHTML = `<div class="tile">${tileSVG(t)}</div>`;
      node.appendChild(cell);
    });
  }

  function renderBoard() {
    const node = el("boardGrid");
    gridTemplate(node, state.size);
    node.innerHTML = "";
    state.grid.forEach((piece, i) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = i;

      const target = state.targets[i];
      if (!piece) cell.classList.add("empty");

      if (peek && target) {
        const ghost = document.createElement("div");
        ghost.className = "peek-ghost";
        ghost.innerHTML = tileSVG(target);
        cell.appendChild(ghost);
      }

      if (piece) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.pieceId = piece.id;
        tile.innerHTML = tileSVG(piece);
        cell.appendChild(tile);
        if (sameLook(piece, target)) cell.classList.add("correct");
      }
      node.appendChild(cell);
    });
  }

  function renderTray() {
    const node = el("tray");
    node.innerHTML = "";
    if (state.tray.length === 0) {
      node.innerHTML = '<span class="tray-empty">All pieces are on the board!</span>';
      return;
    }
    state.tray.forEach(piece => {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.pieceId = piece.id;
      tile.innerHTML = tileSVG(piece);
      node.appendChild(tile);
    });
  }

  /* ----- piece lookup --------------------------------------------------- */
  function findPiece(id) {
    id = Number(id);
    const gi = state.grid.findIndex(p => p && p.id === id);
    if (gi !== -1) return { piece: state.grid[gi], src: { type: "grid", index: gi } };
    const ti = state.tray.findIndex(p => p.id === id);
    if (ti !== -1) return { piece: state.tray[ti], src: { type: "tray", index: ti } };
    return null;
  }

  function removeFrom(src) {
    if (src.type === "grid") state.grid[src.index] = null;
    else state.tray.splice(src.index, 1);
  }

  /* Move a piece to a destination, swapping/returning any displaced piece. */
  function movePiece(piece, src, dest) {
    if (dest.type === "grid" && src.type === "grid" && dest.index === src.index) return;

    if (dest.type === "tray") {
      removeFrom(src);
      state.tray.push(piece);
      return;
    }

    // dest is a grid cell
    const occupant = state.grid[dest.index];
    removeFrom(src);
    if (occupant && occupant.id !== piece.id) {
      // Send the displaced piece back where the dragged piece came from.
      state.grid[dest.index] = piece;
      if (src.type === "grid") state.grid[src.index] = occupant;
      else state.tray.push(occupant);
    } else {
      state.grid[dest.index] = piece;
    }
  }

  function rotatePiece(piece) {
    piece.rot = (piece.rot + 1) % 4;
  }

  /* ----- win check ------------------------------------------------------ */
  function checkWin() {
    const ok = state.targets.every((t, i) => {
      const p = state.grid[i];
      return (!t && !p) || (t && p && sameLook(p, t));
    });
    if (ok && state.tray.length === 0) celebrate();
  }

  /* ----- pointer drag + tap-to-rotate ----------------------------------- */
  let drag = null;  // { piece, src, clone, startX, startY, moved, tileEl }
  const MOVE_THRESHOLD = 8;

  function onPointerDown(e) {
    const tileEl = e.target.closest(".tile");
    if (!tileEl || !tileEl.dataset.pieceId) return;
    // Ignore pieces inside the read-only target preview.
    if (tileEl.closest("#targetGrid")) return;

    const found = findPiece(tileEl.dataset.pieceId);
    if (!found) return;

    e.preventDefault();
    drag = {
      piece: found.piece,
      src: found.src,
      tileEl,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      clone: null
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function makeClone(piece) {
    const clone = document.createElement("div");
    clone.className = "drag-clone tile";
    clone.innerHTML = tileSVG(piece);
    el("dragLayer").appendChild(clone);
    return clone;
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      drag.moved = true;
      drag.tileEl.classList.add("dragging-src");
      drag.clone = makeClone(drag.piece);
    }
    if (drag.moved && drag.clone) {
      drag.clone.style.left = e.clientX + "px";
      drag.clone.style.top = e.clientY + "px";
      highlightDropTarget(e.clientX, e.clientY);
    }
  }

  function highlightDropTarget(x, y) {
    document.querySelectorAll(".drop-hover").forEach(n => n.classList.remove("drop-hover"));
    const t = dropTargetAt(x, y);
    if (t === "tray") el("tray").classList.add("drop-hover");
    else if (t && t.type === "grid") {
      const cell = el("boardGrid").children[t.index];
      if (cell) cell.classList.add("drop-hover");
    }
  }

  function dropTargetAt(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (const node of elements) {
      const cell = node.closest && node.closest("#boardGrid .cell");
      if (cell) return { type: "grid", index: Number(cell.dataset.index) };
      if (node.closest && node.closest("#tray")) return "tray";
    }
    return null;
  }

  function onPointerUp(e) {
    if (!drag) return;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.querySelectorAll(".drop-hover").forEach(n => n.classList.remove("drop-hover"));

    if (!drag.moved) {
      // A tap → spin the piece in place.
      rotatePiece(drag.piece);
      render();
      const popped = document.querySelector(`.tile[data-piece-id="${drag.piece.id}"]`);
      if (popped) { popped.classList.add("pop"); }
      checkWin();
    } else {
      if (drag.clone) drag.clone.remove();
      const dest = dropTargetAt(e.clientX, e.clientY);
      if (dest) {
        movePiece(drag.piece, drag.src, dest === "tray" ? { type: "tray" } : dest);
        render();
        checkWin();
      } else {
        render(); // dropped nowhere useful — just redraw
      }
    }
    drag = null;
  }

  /* ----- celebration ---------------------------------------------------- */
  function celebrate() {
    el("winLevelName").textContent = state.name ? `“${state.name}” complete!` : "";
    el("winOverlay").classList.add("show");
    confetti();
  }

  function confetti() {
    const colors = Object.values(COLORS);
    for (let i = 0; i < 60; i++) {
      const bit = document.createElement("div");
      bit.className = "confetti";
      bit.style.left = Math.random() * 100 + "vw";
      bit.style.background = colors[Math.floor(Math.random() * colors.length)];
      bit.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
      bit.style.animationDelay = Math.random() * 0.4 + "s";
      document.body.appendChild(bit);
      setTimeout(() => bit.remove(), 3600);
    }
  }

  /* ----- level navigation & controls ------------------------------------ */
  let currentLevelIndex = -1;   // -1 means a random "surprise" puzzle

  function startLevel(i) {
    currentLevelIndex = i;
    peek = false; el("peekBtn").setAttribute("aria-pressed", "false");
    el("sizeSelect").value = String(LEVELS[i].size);
    loadLevel(LEVELS[i]);
    markActiveLevel();
  }

  function startSurprise() {
    currentLevelIndex = -1;
    peek = false; el("peekBtn").setAttribute("aria-pressed", "false");
    const size = Number(el("sizeSelect").value) || 3;
    loadLevel(generateRandomLevel(size));
    markActiveLevel();
  }

  function markActiveLevel() {
    [...el("levelButtons").children].forEach((b, i) =>
      b.classList.toggle("active", i === currentLevelIndex));
  }

  function buildLevelButtons() {
    const wrap = el("levelButtons");
    wrap.innerHTML = "";
    LEVELS.forEach((lvl, i) => {
      const b = document.createElement("button");
      b.className = "btn btn-level";
      b.textContent = lvl.name;
      b.addEventListener("click", () => startLevel(i));
      wrap.appendChild(b);
    });
  }

  function restartCurrent() {
    if (currentLevelIndex >= 0) startLevel(currentLevelIndex);
    else startSurprise();
  }

  function nextPuzzle() {
    if (currentLevelIndex >= 0 && currentLevelIndex < LEVELS.length - 1) {
      startLevel(currentLevelIndex + 1);
    } else {
      startSurprise();
    }
  }

  /* ----- wire up -------------------------------------------------------- */
  function init() {
    buildLevelButtons();

    el("surpriseBtn").addEventListener("click", startSurprise);
    el("resetBtn").addEventListener("click", restartCurrent);
    el("peekBtn").addEventListener("click", () => {
      peek = !peek;
      el("peekBtn").setAttribute("aria-pressed", String(peek));
      render();
    });
    el("sizeSelect").addEventListener("change", () => {
      // Changing size only makes sense for a fresh surprise puzzle.
      if (currentLevelIndex === -1) startSurprise();
    });

    el("nextBtn").addEventListener("click", () => {
      el("winOverlay").classList.remove("show");
      nextPuzzle();
    });
    el("playAgainBtn").addEventListener("click", () => {
      el("winOverlay").classList.remove("show");
      restartCurrent();
    });

    // One global pointerdown handler (event delegation) for tray + board.
    document.addEventListener("pointerdown", onPointerDown);

    startLevel(0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
