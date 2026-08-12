# 🔺🟦 Triangle Squares — Shape Builder

A tiny web app for kids to practise **spatial reasoning** by building a target
picture out of square pieces. Each piece is a square split along a diagonal into
**two coloured triangles**. Kids **drag** pieces onto the board and **tap** to
**spin** (rotate) them until their board matches the target.

## How to play

1. Look at the **“Make this!”** picture on the left.
2. **Drag** a piece from the tray at the bottom onto a square on your board.
3. **Tap** a piece to spin it a quarter-turn until the colours line up.
4. Match the whole picture to win! 🎉

### Helpers & buttons

- **Puzzle buttons** — pick a hand-made puzzle (Tiny Diamond, Big Diamond,
  Pinwheel, Arrow Up, Bow Tie, Flower).
- **Size** — choose the board size for surprise puzzles (2×2, 3×3, 4×4).
- **🎲 Surprise** — generate an endless supply of fresh, solvable puzzles.
- **👀 Peek** — faintly shows the answer on your board for younger kids.
- **↺ Reset** — start the current puzzle over.

## Running it

No build step, no dependencies. Either:

- **Just open `index.html`** in any modern browser, or
- Serve the folder, e.g. `python3 -m http.server` then visit
  `http://localhost:8000`.

Works with **mouse and touch** (phones/tablets), with big tap targets.

## How it works

- A piece's look is captured as a 4-tuple of edge colours `[top, right, bottom,
  left]`. Rotating a piece is just a cyclic shift of that tuple, so matching is
  a simple equality check (`app.js → appearance / sameLook`).
- Each piece is drawn as an SVG of four triangles meeting at the centre; because
  adjacent edges share a colour it always reads as one clean diagonal split.
- Puzzles live in `levels.js`. The tray for a puzzle is derived from its target
  (one piece per filled cell, randomly rotated), so every puzzle is guaranteed
  solvable — including the randomly generated **Surprise** ones.

## 🏎️ RC Track Lane Editor

A separate little tool for **drawing RC track lanes** by dropping control
points — the tool joins them into a smooth **multi-segment Bézier curve** made
of straights and curves. Open `track-editor.html` in any browser (no build, no
dependencies).

### How to draw

1. In **Add points** mode, click on the canvas to lay the racing line. Each
   click drops a control point and the tool auto-fits smooth Bézier handles
   through all the points.
2. Switch to **Edit** to drag the anchor points (●) and their Bézier handles
   (○) to shape each curve exactly.
3. **Smooth / Corner** — a smooth node keeps its two handles mirror-symmetric
   (rounded bends); a corner node lets them move independently (sharp turns).
4. **Straight to next** — flattens the segment after the selected point into a
   straight.
5. **Closed loop** joins the last point back to the first (for oval/circuit
   tracks); **Width** sets the lane thickness; **Snap to grid** aligns points.
6. **Export** the track as **JSON** (control points), an **SVG path** `d`
   string, a list of **sampled points** (evenly-spaced coordinates for driving
   a marker along the lane), or a standalone **SVG file**.

### How it works

- The lane is a chain of nodes; between two nodes A → B the tool draws a cubic
  Bézier using A's *out* handle and B's *in* handle. A fresh point's handles
  are auto-derived from its neighbours (Catmull-Rom → Bézier), so a few clicks
  already give a flowing line (`track-editor.js → recomputeAuto`).
- The asphalt ribbon is drawn by sampling every segment, offsetting each sample
  along its normal by ±½ width, and filling between the two edges.

## Files

| File                | Purpose                                            |
|---------------------|----------------------------------------------------|
| `index.html`        | Shape-builder game page structure                  |
| `styles.css`        | Kid-friendly styling, responsive layout, animations|
| `levels.js`         | Colours, hand-made levels, random generator        |
| `app.js`            | Game state, rendering, drag & tap-to-rotate logic  |
| `track-editor.html` | RC track lane editor page                          |
| `track-editor.css`  | Editor styling                                     |
| `track-editor.js`   | Bézier track model, canvas rendering, export       |
