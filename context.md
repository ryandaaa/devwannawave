# devwannawave Project Context

## Ringkasan
`devwannawave` adalah desktop music player lokal berbasis Tauri 2 + React/Vite + Rust backend. Fokusnya:
- library musik lokal dari folder/file
- playback audio lewat `rodio`
- scan/import metadata lewat `lofty`
- penyimpanan library/playlists di SQLite
- UI custom bergaya terminal/dark minimal

Repo ini sedang aktif dikembangkan, dan banyak fitur sudah bukan MVP lagi. Status sekarang lebih dekat ke “musik player lokal yang cukup matang”, dengan queue, drag/drop import, playlist management, context menus, theme system, dan settings dasar.

## Stack
- Frontend: React + TypeScript + Vite
- Styling: Tailwind config custom dengan token warna/spacing ukuran tinggi row, bar, dll
- Backend: Rust + Tauri 2
- Audio: `rodio`
- Tag parsing: `lofty`
- DB: SQLite via `rusqlite`

## File Penting
- `src/App.tsx` - seluruh UI utama, state orchestration, playback controls, views, dialogs, context menus
- `src-tauri/src/lib.rs` - backend commands, DB access, scan/import/playback logic
- `src-tauri/migrations/0001_initial.sql` - schema awal SQLite
- `src-tauri/capabilities/default.json` - permission window controls
- `src/styles/index.css` - style/theme classes dan animasi
- `tailwind.config.ts` - token ukuran, warna, dan utilities custom

## Status Fitur Saat Ini

### Playback
- Playback lokal sudah jalan.
- Supported:
  - play / pause / stop
  - previous / next
  - seek
  - volume control
  - shuffle
  - repeat
  - repeat one
- Progress bar di bottom bar tampil sebagai strip top-like ala YouTube Music.
- Progress, duration, dan seek sudah tidak stuck lagi.
- Track auto-next sudah beres.

### Library
- Library dari folder lokal sudah jalan.
- `all tracks` punya:
  - search
  - sort ascending/descending untuk title/artist/album/time
  - browse mode `all / recently added / recently played`
  - row height lebih lega
  - action menu per track
- Import support:
  - folder path import/rescan
  - drag & drop file/folder ke All Tracks, sidebar, dan playlist
  - drop ke playlist akan import ke library lalu add ke playlist
- Duplicate handling:
  - import summary membedakan `added` vs `existing`
  - hint/toast sudah dibikin lebih jelas

### Playlists
- Playlist page sudah ada.
- Bisa:
  - create playlist
  - add current track
  - add track satu-satu dari list search
  - delete playlist
  - remove track dari playlist
- Queue tidak lagi di sidebar kiri; queue panel ada di kanan/overlay style.

### Albums / Artists / Folder Views
- Albums, artists, playlists, folders sudah ada sebagai halaman/detail tersendiri.
- Placeholder visual:
  - album pakai ikon/cassette-like placeholder
  - artist pakai placeholder profile-style
- Detail halaman menampilkan daftar track terkait.

### Queue
- Queue manual sudah ada.
- Queue disimpan persisten ke `localStorage`.
- Queue diprun kalau track sudah tidak ada di library.
- Queue dapat dibuka dari bottom bar.
- Drop/import ke All Tracks dan playlist sudah punya behavior berbeda.

### Theme / Settings
- Ada 6 tema:
  - 3 light
  - 2 dark
  - 1 coal
- Dark default sudah lebih soft, bukan hitam pekat.
- Settings dialog sekarang bukan sekadar tombol, tapi punya kontrol nyata:
  - theme selector compact
  - sidebar width slider
  - playback mode display/control
  - clear queue
  - clear hidden tracks
- Theme dan playback mode persisten via `localStorage`.
- Sidebar width juga persisten via `localStorage`.

### Window Controls
- Top bar settings/minimize/maximize/close sudah wired ke Tauri window API.
- Permission/capability window sudah ditambah di `src-tauri/capabilities/default.json`.

### Context Menu / Track Actions
- Custom context menu sudah dipakai di track rows.
- Aksi tersedia:
  - play
  - add to queue
  - add to playlist
  - create playlist from menu
  - edit metadata
  - hide from library
- Menu ini sudah dipakai di beberapa list utama, bukan cuma All Tracks.
- Menu punya backdrop dim + blur dan animasi popover.

### Metadata Edit
- Ada dialog edit metadata ringan.
- Backend menyimpan override di DB:
  - `title_override`
  - `artist_override`
  - `album_override`
- Query library menampilkan override kalau ada, fallback ke metadata asli.
- `last_played_at` juga dicatat saat track dimainkan.

### Shortcuts
- Keyboard shortcuts global sudah ada:
  - `Ctrl+F` / `/` fokus search All Tracks
  - `Space` play/pause
  - `ArrowLeft` / `ArrowRight` prev/next
  - `Enter` play selected
  - `Q` add selected to queue
  - `Delete` hide selected
  - `+` / `-` volume

## Backend / Schema Notes
- `tracks` table sekarang punya:
  - `title_override`, `artist_override`, `album_override`
  - `last_played_at`
  - `created_at`
  - `updated_at`
- `get_library` memakai `COALESCE(NULLIF(override, ''), original)` untuk title/artist/album.
- `play_track` mengupdate `last_played_at`.
- `update_track_metadata` command backend sudah ada.
- Ada upgrader schema `ensure_track_schema(...)` untuk existing DB lama.

## Catatan Bug / Handoff Penting
- Pernah terjadi startup crash karena migration awal membuat index `idx_tracks_last_played_at` sebelum kolom `last_played_at` ada di database lama.
- Fix yang sudah dilakukan:
  - index `last_played_at` dipindah keluar dari migration awal
  - dibuat lewat upgrader schema setelah kolom ditambah
- Ada juga error startup `attempt to write a readonly database` yang pernah muncul saat runtime. Ini perlu dicek ulang kalau masih muncul di environment lain. Kemungkinan terkait file/handle DB existing atau state app data lama, bukan compile issue.

## Status Verifikasi
Perubahan terakhir sudah lolos:
- `bun run typecheck`
- `bun run build`
- `cargo check`

## Hal Yang Masih Layak Dilanjutkan
1. Rapikan settings jadi lebih “real” lagi:
   - persist/cerminkan lebih banyak preference
   - tambah tombol maintenance yang lebih eksplisit
2. Refactor context menu supaya reusable benar-benar konsisten untuk semua halaman/list.
3. Tambahkan “recently played/added” navigation yang lebih jelas di UI, bukan cuma filter kecil.
4. Kalau mau metadata lebih serius, tambahkan edit artist/album/title di banyak konteks lain dan kemungkinan per-track action di detail pages.
5. Pertimbangkan penyimpanan queue/history ke SQLite jika mulai butuh lintas session yang lebih kuat daripada `localStorage`.

## File yang Sering Dimodifikasi
- `src/App.tsx`
- `src-tauri/src/lib.rs`
- `src-tauri/migrations/0001_initial.sql`
- `src/styles/index.css`
- `tailwind.config.ts`

## Cara Membaca Project Ini Cepat
1. Mulai dari `src/App.tsx` untuk lihat aliran state UI.
2. Lihat `src-tauri/src/lib.rs` untuk command backend dan DB schema behavior.
3. Lihat `src-tauri/migrations/0001_initial.sql` kalau ada masalah startup DB.
4. Kalau konteks tema/spacing/layout, cek `tailwind.config.ts` dan `src/styles/index.css`.
