# DESIGN_devwannawave

app-specific design notes for **devwannawave** — a quiet, local-first audio player.

this document **adds and specializes**. it never overrides. for the family contract see:

- [`dev-wanna-philosophy.md`](./dev-wanna-philosophy.md) — why we build this way
- [`dev-wanna-design-rule.md`](./dev-wanna-design-rule.md) — design system v1 (strict)

> if anything below conflicts with the family docs, the family docs win.

design system target: **v1**.

---

## 0. one-line scope

> open the app, see the library, pick a track, listen. nothing more.

devwannawave is **not** a tag editor, podcast app, streaming client, equalizer, visualizer showcase, social music app, or AI recommender. when in doubt, see §16 (anti-patterns) of the design rule.

---

## 1. identity

| key | value |
|---|---|
| display name | `devwannawave` |
| tauri identifier | `dev.wannawave.app` |
| data folder name | `dev.wannawave.app` |
| db file | `devwannawave.db` |
| default theme | `theme-dark` |
| tagline | a quiet, local-first audio player for developers |

db path per OS (per family rule §9):

| os | path |
|---|---|
| Windows | `%APPDATA%\dev.wannawave.app\devwannawave.db` |
| macOS | `~/Library/Application Support/dev.wannawave.app/devwannawave.db` |
| Linux | `~/.local/share/dev.wannawave.app/devwannawave.db` |

---

## 2. primary layout

three regions, top to bottom:

```
┌──────────────────────────────────────────────────────────┐
│  TopAppBar                                          48px │
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  SideNav   │   main body                                 │
│   220px    │   (header + track list)                     │
│            │                                             │
│            │                                             │
├────────────┴─────────────────────────────────────────────┤
│  NowPlayingBar                                      72px │
└──────────────────────────────────────────────────────────┘
```

- TopAppBar: 48px, fixed (family rule §5).
- SideNav: 220px default, collapsible to 48px (family rule §7).
- NowPlayingBar: **72px** fixed at bottom. flat 1px `surface-container-high` top border. **no shadow.**
- main body fills the remaining space between TopAppBar/SideNav/NowPlayingBar.

the NowPlayingBar height (72px) is the only deliberate exception to the 24/32/40/48 grid in §5 of the design rule. it is a fixed app-shell region, not an interactive component, and 72 = 48 + 24 (still on-grid arithmetically). do not use 72 for anything else.

---

## 3. side nav items

fixed order. labels are lowercase, monospace.

| label | state | notes |
|---|---|---|
| all tracks | active | the default landing view |
| folders | active | shows scanned folders + manage |
| albums | disabled | post-mvp |
| artists | disabled | post-mvp |
| playlists | disabled | post-mvp |
| queue | disabled | post-mvp |

disabled items render in `on-surface-variant` with `opacity-50`, are **not** focusable, have **no tooltip**, **no "coming soon" modal**, **no badge**. their presence is honest signal that the app's roadmap exists, nothing more.

---

## 4. main body — all tracks

header row (top of main body, flat):

```
all tracks      42 tracks                              [+ add folder]
```

- title: `headline` (14px / 600).
- count: `body-sm` muted (`on-surface-variant`).
- right-aligned action: 32px button labeled `+ add folder`. opens AddFolderPanel inline (not modal).

track list:

- one row per track. row height **32px** (family rule §5).
- four columns, left to right:

| column | width | content | typography |
|---|---|---|---|
| title | flex grow | `title` else `file_name` | `body-md` `on-surface` |
| artist | 25% min 120px | `artist` else `—` | `body-md` `on-surface-variant` |
| album | 25% min 120px | `album` else `—` | `body-md` `on-surface-variant` |
| duration | 64px right-aligned | `mm:ss` | `body-sm` `on-surface-variant` tabular-nums |

row states (per family rule §2):

- default: transparent bg, `on-surface-variant` text.
- hover: bg `surface-container-high`, text `on-surface`.
- selected (clicked once): bg `surface-variant`, left border 2px `primary`.
- playing: same as selected **plus** a `play_arrow` icon (12px, `primary`) prefixed to title. color alone is not a state signal (family rule §14).

interactions:

- single click → select row.
- double click → play.
- enter on focused row → play.
- right click → custom ContextMenu (mvp: stub; real menu post-mvp).

---

## 5. empty state — all tracks

when `tracks` table is empty:

```
no tracks yet.
add a folder to scan local audio files.

[ folder path…                                            ] [ add ]
```

- two muted lines (`body-md`, `on-surface-variant`).
- AddFolderPanel inline directly underneath.
- **no illustration, no icon, no spinner, no "get started" badge.** (family rule §15.)

---

## 6. add folder panel

mvp: manual path input only (no native picker per family rule §1).

- single text input, height 32px, fills available width.
- placeholder: `paste a folder path…`.
- one 32px button right of input: `add`.
- on submit:
  - frontend → `add_music_folder(path)` (rust validates).
  - on ok: kick off `scan_music_folder(folder_id)` immediately.
  - on err: inline error text below input, `error` color, no toast.
- while scanning: replace the right-side button with the static text **`scanning…`** (`on-surface-variant`, `body-sm`). no spinner.
- when done: emit a single toast event with the scan summary (e.g. `scanned 142 · added 142 · errors 0`). toast auto-dismiss 3s.

drag-drop folder support: **post-mvp**. native file dialog: **never** (family rule §1).

---

## 7. now playing bar

72px high. left → middle → right:

```
[ title           ]   [ ⏮  ⏯  ⏹  ⏭ ]   [ progress       ]  [ vol ]
[ artist · file   ]   [             ]   [ 01:14 / 03:42  ]  [  ▮  ]
```

three groups, each gets a third of the bar approximately. group widths flex; the bar never wraps.

**left — track info** (no fixed width, truncates):

- line 1: `title` (`body-md`, `on-surface`). if missing → `file_name`.
- line 2: `artist · album` (`body-sm`, `on-surface-variant`). if both missing → directory name.
- if nothing playing: line 1 = `—`, line 2 hidden.
- no album art (post-mvp).

**middle — transport** (centered, ~196px):

- previous (32×32 icon button, `skip_previous`).
- play/pause (40×40 primary action button, `play_arrow` / `pause`). this is the *one* primary action of the app.
- stop (32×32 icon button, `stop`).
- next (32×32 icon button, `skip_next`).
- gap between buttons: `sm` (8px).
- when nothing playing: all disabled (`opacity-50`).

**right — progress + volume** (flexes):

- elapsed / total: `body-sm` tabular-nums, fixed 96px column, e.g. `01:14 / 03:42`. if duration unknown: `01:14 / —`.
- progress bar: 4px tall, full available width. fill = `primary`, track = `surface-container-high`. **no border-radius.**
- volume slider: 96px wide, 4px tall, same style as progress.
- right edge gets `md` (12px) padding.

if precise progress is hard for the chosen audio crate, leave the progress bar non-interactive and add a TODO. **do not animate fake progress.** (family rule §15: no fake feedback.)

---

## 8. window chrome

per family rule §13. devwannawave-specific:

- TopAppBar contents:
  - left (16px gap): `menu` icon (toggles sidebar) · `devwannawave` text label (`body-md`, `on-surface`).
  - middle: empty drag region.
  - right (8px gap): `settings` icon · WindowControls (min · max-restore · close).
- drag region: `data-tauri-drag-region` on bar background + label span. **never** on interactive children.
- window outline: 10px outer radius, 1px `surface-container-high` outline (`.dwt-window`).

---

## 9. settings modal

per family rule §10. mvp tabs in this order:

| tab | content |
|---|---|
| appearance | 6 theme swatches |
| storage | db path · `open data folder` · `export all data` (post-mvp stub disabled) |
| about | name · version · license · github link |

no audio-output device picker in mvp (uses system default).

---

## 10. keyboard shortcuts

mvp: only **`Esc` → close topmost overlay**. that's it.

universal family shortcuts (`Ctrl+B`, `Ctrl+K`, `Ctrl+,`, `F11`, `?`) are scaffolded with `// TODO: post-mvp` placeholders. cheatsheet (`?`) is post-mvp.

per-app shortcuts (planned, not yet implemented):

| shortcut | action |
|---|---|
| `space` | play/pause (only when no input focused) |
| `→` | next track |
| `←` | previous track |
| `+` / `-` | volume up / down |

document each here the moment it lands.

---

## 11. audio

playback engine lives in rust (family rule §0: local-first).

| format | mvp |
|---|---|
| mp3 | yes |
| flac | yes |
| wav | yes |
| ogg | best-effort |
| m4a / aac | best-effort |
| opus | best-effort |

primary crate: `rodio` (simple, covers mp3/flac/wav/ogg vorbis out of the box).
fallback for wider format support: `symphonia` (already used by rodio internally; may be plugged in directly if needed).
metadata: `lofty` (read-only in mvp; **never write tags** — devwannawave is not a tag editor).

audio engine state lives globally in tauri `State`:

- output stream (kept alive for the app lifetime).
- current sink/handle.
- current `track_id` + path.
- volume (0.0 – 1.0).

seeking: if the chosen crate makes it cheap → wire it up. if not → progress bar non-interactive, TODO comment, **no fake seek**.

---

## 12. persistence (`app_settings`)

keys reserved by devwannawave (all stored as TEXT):

| key | meaning |
|---|---|
| `theme` | one of the 6 theme class names |
| `sidebar_collapsed` | `"true"` / `"false"` |
| `volume` | string-encoded float 0.0–1.0 |
| `last_track_id` | numeric id last selected/playing |
| `window_size` | `"WxH"` |
| `window_position` | `"X,Y"` |

writes are debounced 200–400ms per family rule §9.

---

## 13. mvp checklist

```
[ ] Tauri 2 shell (decorations: false, identifier dev.wannawave.app)
[ ] React + TS + Vite + Tailwind, geist mono + material symbols loaded
[ ] index.css copies token system + all 6 themes
[ ] custom TopAppBar + WindowControls (drag region correct)
[ ] SideNav (active items + disabled stubs)
[ ] main body: all tracks header + track list (32px rows)
[ ] AddFolderPanel (manual path input)
[ ] NowPlayingBar (72px, transport, progress, volume)
[ ] SQLite at correct OS path, app_settings + folders + tracks tables
[ ] add_music_folder + scan_music_folder commands (lofty metadata)
[ ] rodio playback: play / pause / resume / stop / next / prev / volume
[ ] basic elapsed/duration display (real, not fake)
[ ] last_track_id persistence
[ ] Esc closes overlays
[ ] no shadows, no gradients, no border-radius on components
[ ] no native context menu, no native file dialog
[ ] no toasts for routine success (only scan-done event)
[ ] no spinners, no skeletons, no onboarding
[ ] zero ts errors, zero rust warnings (or justified)
```

post-mvp items are explicitly out of scope. see the family philosophy doc before adding any of them.

---

## 14. evolution

this doc targets design system **v1**. when the family system bumps to v2, audit this file against the diff and update.

if devwannawave needs to break a family rule, **don't**. open an issue and discuss. if there's a real reason, document the exception inline here with a `> exception:` block and a justification.

---

*build the small calm thing. then stop.*
