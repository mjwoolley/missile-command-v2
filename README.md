# Missile Command v2

A browser-based remake of the classic Missile Command arcade game.  
Built with vanilla JavaScript and HTML5 Canvas — no build step required.

---

## Quick Start

### Run locally

Any static file server works:

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Or just open index.html directly in your browser
# (some browsers allow ES modules from file:// — Chrome/Firefox do)
```

Then open `http://localhost:8080` in your browser.

---

## Controls

| Input | Action |
|-------|--------|
| **Enter / Space** | Start game / Restart |
| **Click** | Start game / Restart (or fire missile — coming soon) |

---

## Project Structure

```
missile-command-v2/
├── index.html   # Canvas element, minimal CSS
├── main.js      # Game loop, state machine, starfield, terrain
└── README.md    # This file
```

---

## Architecture

### Game Loop

Uses `requestAnimationFrame` with delta-time based updates so gameplay speed is
consistent across all frame rates.  The loop is capped at 100 ms max delta to
avoid the "spiral of death" on tab switch / sleep.

### State Machine

```
TITLE ──(start)──▶ PLAYING ──(cities gone)──▶ GAME_OVER ──(restart)──▶ TITLE
                      │                             ▲
                 (wave clear)                       │
                      ▼                             │
                 LEVEL_END ──(3 s)──▶ PLAYING ──────┘
```

### Starfield

150 procedurally placed stars with individual twinkle animations driven by
delta-time so they animate at the same apparent speed at any frame rate.

### Terrain

Jagged ground strip generated at startup via random ±8 px offsets on a 20 px
grid.  Rendered as a filled polygon so it works at any canvas size.

---

## GitHub Pages Deployment

This project is static-file only — no build step, no bundler.

1. Push to `main` branch.
2. In the repo **Settings → Pages**, set source to **Deploy from a branch**,
   branch `main`, folder `/` (root).
3. GitHub will serve `index.html` at  
   `https://mjwoolley.github.io/missile-command-v2/`

---

## Upcoming Stories

- MIS-4: Cities and missile batteries (player assets)
- MIS-5: Enemy missiles
- MIS-6: Player firing + explosion mechanics
- MIS-7: Scoring and difficulty scaling
