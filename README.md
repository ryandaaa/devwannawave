# devwannawave

> a quiet, local-first audio player for developers.

---

devwannawave is a desktop music player that does one thing: plays your local audio files, calmly, without asking anything of you.

no account. no cloud. no telemetry. no onboarding. no AI recommendations.  
your library lives in a single SQLite file on your machine. that's it.

---

## what it does

- scans local folders and builds a library from your audio files
- plays mp3, flac, wav — and best-effort ogg / m4a / opus
- tracks, albums, artists, playlists, folders — all navigable
- queue management with persistent state
- keyboard-first: `space`, `←`, `→`, `+`, `-`, `ctrl+f`, and more
- drag & drop import of files and folders
- per-track metadata override (stored in DB, never writes to file)
- 6 themes: 3 dark variants, 2 light, 1 coal
- custom window chrome — no native title bar

## what it doesn't do

- no streaming, no scrobbling, no sync
- no equalizer, no visualizer, no crossfade
- no tag writing (devwannawave is not a tag editor)
- no native file dialog ("paste the path" is enough)
- no internet connection required or used
- no AI, no recommendations, no "you might also like"

---

## stack

| layer     | technology                                      |
|-----------|-------------------------------------------------|
| shell     | [Tauri 2](https://tauri.app)                    |
| frontend  | React 18 + TypeScript + Vite                    |
| styling   | Tailwind CSS (custom token system) + Geist Mono |
| icons     | Material Symbols Outlined                       |
| backend   | Rust                                            |
| audio     | [`rodio`](https://github.com/RustAudio/rodio)   |
| metadata  | [`lofty`](https://github.com/Serial-ATA/lofty)  |
| storage   | SQLite via `rusqlite` (bundled)                 |

---

## getting started

**prerequisites**

- [Bun](https://bun.sh) (package manager + script runner)
- [Rust](https://rustup.rs) (stable toolchain)
- on Linux: see [system dependencies](#linux-system-dependencies) below

**run in development**

```sh
bun install
bun run tauri dev
```

**build for production**

```sh
bun run tauri build
```

the installer will be in `src-tauri/target/release/bundle/`.

---

## linux system dependencies

on Ubuntu / Debian:

```sh
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libasound2-dev \
  pkg-config
```

---

## keyboard shortcuts

| key              | action                        |
|------------------|-------------------------------|
| `space`          | play / pause                  |
| `←` / `→`        | previous / next track         |
| `+` / `-`        | volume up / down              |
| `ctrl+f` or `/`  | focus search                  |
| `enter`          | play selected track           |
| `q`              | add selected to queue         |
| `delete`         | hide selected from library    |
| `esc`            | close topmost overlay         |

---

## data & privacy

devwannawave stores everything locally:

| OS      | database path                                               |
|---------|-------------------------------------------------------------|
| Windows | `%APPDATA%\dev.wannawave.app\devwannawave.db`              |
| macOS   | `~/Library/Application Support/dev.wannawave.app/devwannawave.db` |
| Linux   | `~/.local/share/dev.wannawave.app/devwannawave.db`         |

the database is a standard SQLite file. you can open it with any SQLite client.  
to move or back up your library: copy the `.db` file.  
to start fresh: delete it.

no data is ever sent anywhere.

---

## project structure

```
devwannawave/
├── src/                  # React frontend
│   ├── App.tsx           # main UI, state, playback controls
│   ├── main.tsx          # entry point
│   └── styles/           # index.css — token system + 6 themes
├── src-tauri/
│   ├── src/
│   │   └── lib.rs        # Rust backend: commands, DB, audio engine
│   ├── migrations/       # SQLite migration files
│   ├── capabilities/     # Tauri permission config
│   └── tauri.conf.json   # app config
├── tailwind.config.ts    # design tokens
└── package.json
```

---

## design philosophy

devwannawave is part of the `devwanna*` family — a set of small, focused tools built on a shared design contract:

- **monospace** everywhere. Geist Mono, no exceptions.
- **flat** UI. no shadows, no gradients, no glassmorphism.
- **quiet** by default. no badges, no modals on launch, no onboarding.
- **one thing** per app. wave plays audio. it doesn't also do podcasts.

the full philosophy lives in [`dev-wanna-philosophy.md`](./dev-wanna-philosophy.md).  
the design rules live in [`dev-wanna-design-rule.md`](./dev-wanna-design-rule.md).

> *build the small calm thing. then stop.*

---

## license

MIT
