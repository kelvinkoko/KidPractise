/* ===========================================================================
 * levels.js  —  Puzzle definitions + random generator
 *
 * A PIECE is a square split along a diagonal into TWO triangles, each with a
 * colour.  We describe every piece (in a target or on the board) with:
 *
 *     { c1, c2, rot }
 *
 *   - c1 / c2 are colour KEYS (see COLORS below).
 *   - rot is the rotation in quarter-turns clockwise: 0, 1, 2 or 3.
 *   - If c1 === c2 the square is a single solid colour (rotation doesn't matter).
 *
 * A target CELL is either such an object, or `null` for "empty background".
 * The board is a `size x size` grid stored row-major: index = row*size + col.
 * ========================================================================= */

const COLORS = {
  red:    "#ff5a5f",
  blue:   "#4d96ff",
  yellow: "#ffd23f",
  green:  "#6bcb77",
  purple: "#9b5de5",
  orange: "#ff924c",
  pink:   "#ff7eb6",
  sky:    "#d7f0ff", // soft background-ish colour
  cream:  "#fff7e6"
};

/* The four bright colours kids will mostly build pictures with. */
const SHAPE_COLORS = ["red", "blue", "yellow", "green", "purple", "orange", "pink"];

/* -------------------------------------------------------------------------
 * Hand-crafted levels.  Each has a name, a grid size, and a flat list of
 * cells (length size*size, row-major).  Use `null` for empty cells.
 *
 * Quick reference for which corner a colour lands on at rot 0
 * (base tile = c1 on the TOP-RIGHT half, c2 on the BOTTOM-LEFT half):
 *
 *      rot 0 -> c1 top-right     rot 1 -> c1 bottom-right
 *      rot 2 -> c1 bottom-left   rot 3 -> c1 top-left
 * ---------------------------------------------------------------------- */
const LEVELS = [
  {
    name: "Tiny Diamond",
    size: 2,
    cells: [
      { c1: "red", c2: "sky", rot: 0 }, { c1: "red", c2: "sky", rot: 3 },
      { c1: "red", c2: "sky", rot: 1 }, { c1: "red", c2: "sky", rot: 2 }
    ]
  },
  {
    name: "Big Diamond",
    size: 3,
    cells: [
      { c1: "red", c2: "sky", rot: 1 }, null,                          { c1: "red", c2: "sky", rot: 2 },
      null,                             { c1: "red", c2: "red", rot: 0 }, null,
      { c1: "red", c2: "sky", rot: 0 }, null,                          { c1: "red", c2: "sky", rot: 3 }
    ]
  },
  {
    name: "Pinwheel",
    size: 2,
    cells: [
      { c1: "blue",  c2: "yellow", rot: 0 }, { c1: "red",   c2: "yellow", rot: 1 },
      { c1: "green", c2: "yellow", rot: 3 }, { c1: "purple", c2: "yellow", rot: 2 }
    ]
  },
  {
    name: "Arrow Up",
    size: 3,
    cells: [
      null,                                { c1: "green", c2: "sky", rot: 0 }, null,
      { c1: "green", c2: "sky", rot: 0 },  { c1: "green", c2: "green", rot: 0 }, { c1: "green", c2: "sky", rot: 3 },
      { c1: "green", c2: "green", rot: 0 }, { c1: "green", c2: "green", rot: 0 }, { c1: "green", c2: "green", rot: 0 }
    ]
  },
  {
    name: "Bow Tie",
    size: 3,
    cells: [
      { c1: "purple", c2: "sky", rot: 1 }, null, { c1: "purple", c2: "sky", rot: 2 },
      { c1: "purple", c2: "purple", rot: 0 }, { c1: "purple", c2: "purple", rot: 0 }, { c1: "purple", c2: "purple", rot: 0 },
      { c1: "purple", c2: "sky", rot: 0 }, null, { c1: "purple", c2: "sky", rot: 3 }
    ]
  },
  {
    name: "Flower",
    size: 4,
    cells: [
      null, { c1: "pink", c2: "sky", rot: 1 }, { c1: "pink", c2: "sky", rot: 2 }, null,
      { c1: "pink", c2: "sky", rot: 1 }, { c1: "pink", c2: "pink", rot: 0 }, { c1: "pink", c2: "pink", rot: 0 }, { c1: "pink", c2: "sky", rot: 2 },
      { c1: "pink", c2: "sky", rot: 0 }, { c1: "yellow", c2: "yellow", rot: 0 }, { c1: "yellow", c2: "yellow", rot: 0 }, { c1: "pink", c2: "sky", rot: 3 },
      null, { c1: "pink", c2: "sky", rot: 0 }, { c1: "pink", c2: "sky", rot: 3 }, null
    ]
  }
];

/* -------------------------------------------------------------------------
 * Random puzzle generator — gives endless "different variations".
 * Builds a target that is guaranteed solvable (the tray is derived from it),
 * biased toward a single shape colour on a soft background, mirrored left↔right
 * so the result looks tidy.
 * ---------------------------------------------------------------------- */
function generateRandomLevel(size) {
  size = size || 3;
  const shape = SHAPE_COLORS[Math.floor(Math.random() * SHAPE_COLORS.length)];
  const bg = "sky";
  const cells = new Array(size * size).fill(null);
  const half = Math.ceil(size / 2);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < half; c++) {
      const roll = Math.random();
      let cell = null;
      if (roll < 0.45) {
        cell = { c1: shape, c2: shape, rot: 0 };            // solid
      } else if (roll < 0.8) {
        cell = { c1: shape, c2: bg, rot: Math.floor(Math.random() * 4) }; // diagonal
      } // else stays empty
      cells[r * size + c] = cell;

      // Mirror to the right side for a tidy symmetric picture.
      const mc = size - 1 - c;
      if (mc !== c) cells[r * size + mc] = mirrorCell(cell);
    }
  }

  // Make sure we never hand back a totally empty board.
  if (cells.every(x => x === null)) {
    cells[Math.floor(cells.length / 2)] = { c1: shape, c2: shape, rot: 0 };
  }
  return { name: "Surprise!", size, cells };
}

/* Horizontal mirror of a single piece (for symmetric generation). */
function mirrorCell(cell) {
  if (!cell) return null;
  // Mirroring left↔right maps the rotation: rot' so that the diagonal flips.
  // top-right<->top-left, bottom-right<->bottom-left  => rot 0<->3, 1<->2.
  const map = { 0: 3, 1: 2, 2: 1, 3: 0 };
  return { c1: cell.c1, c2: cell.c2, rot: map[cell.rot] };
}
