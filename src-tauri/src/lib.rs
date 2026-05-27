use std::{
    fs::{self, File},
    io::BufReader,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use lofty::{
    file::TaggedFileExt,
    prelude::{AudioFile, ItemKey},
    read_from_path,
};
use rodio::{DeviceSinkBuilder, MixerDeviceSink, Player};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime};
use walkdir::WalkDir;

struct AppState {
    db_path: PathBuf,
    db: Mutex<Connection>,
    audio: Mutex<AudioState>,
}

struct AudioState {
    sink: Option<MixerDeviceSink>,
    player: Option<Player>,
    current_track_id: Option<i64>,
    current_duration_seconds: Option<u64>,
    volume: f32,
    elapsed_before_play_ms: u64,
    started_at: Option<Instant>,
}

impl AudioState {
    fn playback_state(&self) -> PlaybackState {
        let elapsed_ms = self.elapsed_ms();

        PlaybackState {
            current_track_id: self.current_track_id,
            duration_seconds: self.current_duration_seconds,
            is_paused: self.player.as_ref().is_none_or(Player::is_paused),
            volume: self.volume,
            elapsed_ms,
        }
    }

    fn elapsed_ms(&self) -> u64 {
        self.elapsed_before_play_ms
            + self
                .started_at
                .map(|started_at| started_at.elapsed().as_millis() as u64)
                .unwrap_or(0)
    }

    fn pause_clock(&mut self) {
        self.elapsed_before_play_ms = self.elapsed_ms();
        self.started_at = None;
    }

    fn resume_clock(&mut self) {
        if self.current_track_id.is_some() && self.started_at.is_none() {
            self.started_at = Some(Instant::now());
        }
    }

    fn reset_clock(&mut self) {
        self.elapsed_before_play_ms = 0;
        self.started_at = None;
    }

    fn seek_clock(&mut self, elapsed_ms: u64) {
        self.elapsed_before_play_ms = elapsed_ms;
        self.started_at = self.started_at.map(|_| Instant::now());
    }
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("file_not_found:{0}")]
    FileNotFound(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
struct Folder {
    id: i64,
    path: String,
}

#[derive(Serialize)]
struct Track {
    id: i64,
    folder_id: i64,
    path: String,
    file_name: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_seconds: Option<i64>,
    created_at: String,
    last_played_at: Option<String>,
}

#[derive(Serialize)]
struct Playlist {
    id: i64,
    name: String,
    track_ids: Vec<i64>,
}

#[derive(Serialize)]
struct Library {
    db_path: String,
    folders: Vec<Folder>,
    tracks: Vec<Track>,
    playlists: Vec<Playlist>,
}

#[derive(Serialize)]
struct ScanSummary {
    scanned: usize,
    added: usize,
    errors: usize,
}

#[derive(Debug, Serialize)]
struct ImportSummary {
    scanned: usize,
    added: usize,
    existing: usize,
    errors: usize,
    track_ids: Vec<i64>,
    imported_paths: Vec<String>,
    existing_paths: Vec<String>,
}

#[derive(Serialize)]
struct PlaybackState {
    current_track_id: Option<i64>,
    duration_seconds: Option<u64>,
    is_paused: bool,
    volume: f32,
    elapsed_ms: u64,
}

#[tauri::command]
fn get_library(state: tauri::State<'_, AppState>) -> Result<Library, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;

    let folders = {
        let mut stmt = db.prepare("SELECT id, path FROM folders ORDER BY path ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let tracks = {
        let mut stmt = db.prepare(
            "SELECT id, folder_id, path, file_name,
                    COALESCE(NULLIF(title_override, ''), title),
                    COALESCE(NULLIF(artist_override, ''), artist),
                    COALESCE(NULLIF(album_override, ''), album),
                    duration_seconds, created_at, last_played_at
             FROM tracks
             ORDER BY COALESCE(NULLIF(title_override, ''), title, file_name) ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Track {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                path: row.get(2)?,
                file_name: row.get(3)?,
                title: row.get(4)?,
                artist: row.get(5)?,
                album: row.get(6)?,
                duration_seconds: row.get(7)?,
                created_at: row.get(8)?,
                last_played_at: row.get(9)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let playlists = {
        // Load all playlists in one query
        let mut stmt = db.prepare("SELECT id, name FROM playlists ORDER BY name ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                track_ids: Vec::new(),
            })
        })?;
        let mut playlists = rows.collect::<Result<Vec<_>, _>>()?;

        // Single JOIN query instead of N+1 per playlist
        let mut pt_stmt = db.prepare(
            "SELECT playlist_id, track_id FROM playlist_tracks
             ORDER BY playlist_id, position ASC, created_at ASC",
        )?;
        let pt_rows = pt_stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?;
        // Group track_ids by playlist_id in-memory (O(n) total)
        let playlist_idx: std::collections::HashMap<i64, usize> = playlists
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id, i))
            .collect();
        for row in pt_rows {
            let (playlist_id, track_id) = row?;
            if let Some(&idx) = playlist_idx.get(&playlist_id) {
                playlists[idx].track_ids.push(track_id);
            }
        }
        drop(playlist_idx);

        playlists
    };

    Ok(Library {
        db_path: state.db_path.display().to_string(),
        folders,
        tracks,
        playlists,
    })
}

#[tauri::command]
fn create_playlist(name: String, state: tauri::State<'_, AppState>) -> Result<Playlist, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("playlist name is required".into()));
    }

    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    db.execute("INSERT INTO playlists (name) VALUES (?1)", params![trimmed])?;
    let id = db.last_insert_rowid();

    Ok(Playlist {
        id,
        name: trimmed.to_string(),
        track_ids: Vec::new(),
    })
}

#[tauri::command]
fn delete_playlist(playlist_id: i64, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    db.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])?;
    Ok(())
}

#[tauri::command]
fn add_track_to_playlist(
    playlist_id: i64,
    track_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    let next_position = db.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
        params![playlist_id],
        |row| row.get::<_, i64>(0),
    )?;
    db.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
         VALUES (?1, ?2, ?3)",
        params![playlist_id, track_id, next_position],
    )?;
    db.execute(
        "UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![playlist_id],
    )?;
    Ok(())
}

#[tauri::command]
fn remove_track_from_playlist(
    playlist_id: i64,
    track_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    db.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
        params![playlist_id, track_id],
    )?;
    db.execute(
        "UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![playlist_id],
    )?;
    Ok(())
}

#[tauri::command]
fn update_track_metadata(
    track_id: i64,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    db.execute(
        "UPDATE tracks
         SET title_override = ?2,
             artist_override = ?3,
             album_override = ?4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1",
        params![
            track_id,
            normalize_override(title),
            normalize_override(artist),
            normalize_override(album),
        ],
    )?;
    Ok(())
}

#[tauri::command]
fn add_music_folder(path: String, state: tauri::State<'_, AppState>) -> Result<Folder, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("folder path is required".into()));
    }

    let folder_path = PathBuf::from(trimmed);
    if !folder_path.is_dir() {
        return Err(AppError::Message("folder path does not exist".into()));
    }

    let canonical = fs::canonicalize(folder_path)?;
    let path_string = canonical.display().to_string();
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;

    db.execute(
        "INSERT OR IGNORE INTO folders (path) VALUES (?1)",
        params![path_string],
    )?;

    let id = db.query_row(
        "SELECT id FROM folders WHERE path = ?1",
        params![path_string],
        |row| row.get(0),
    )?;

    Ok(Folder {
        id,
        path: path_string,
    })
}

#[tauri::command]
fn import_music_paths(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<ImportSummary, AppError> {
    let mut summary = ImportSummary {
        scanned: 0,
        added: 0,
        existing: 0,
        errors: 0,
        track_ids: Vec::new(),
        imported_paths: Vec::new(),
        existing_paths: Vec::new(),
    };

    for path in paths {
        let path = PathBuf::from(path.trim());
        if path.is_dir() {
            match import_music_folder_path(&path, state.clone()) {
                Ok((folder, folder_summary)) => {
                    summary.scanned += folder_summary.scanned;
                    summary.added += folder_summary.added;
                    summary.errors += folder_summary.errors;
                    summary.track_ids.extend(track_ids_for_folder(&state, folder.id)?);
                }
                Err(_) => summary.errors += 1,
            }
            continue;
        }

        if !path.is_file() || !is_audio_file(&path) {
            summary.errors += 1;
            continue;
        }

        summary.scanned += 1;
        match import_music_file_path(&path, &state) {
            Ok((track_id, added, canonical_path)) => {
                if added {
                    summary.added += 1;
                    summary.imported_paths.push(canonical_path);
                } else {
                    summary.existing += 1;
                    summary.existing_paths.push(canonical_path);
                }
                summary.track_ids.push(track_id);
            }
            Err(_) => summary.errors += 1,
        }
    }

    summary.track_ids.sort_unstable();
    summary.track_ids.dedup();
    Ok(summary)
}

#[tauri::command]
fn scan_music_folder(
    folder_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<ScanSummary, AppError> {
    let folder_path = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        db.query_row(
            "SELECT path FROM folders WHERE id = ?1",
            params![folder_id],
            |row| row.get::<_, String>(0),
        )?
    };

    let mut scanned = 0;
    let mut added = 0;
    let mut errors = 0;

    for entry in WalkDir::new(&folder_path).follow_links(false) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                errors += 1;
                continue;
            }
        };

        if !entry.file_type().is_file() || !is_audio_file(entry.path()) {
            continue;
        }

        scanned += 1;
        match insert_track(&state, folder_id, entry.path()) {
            Ok(true) => added += 1,
            Ok(false) => {}
            Err(_) => errors += 1,
        }
    }

    Ok(ScanSummary {
        scanned,
        added,
        errors,
    })
}

#[tauri::command]
fn rescan_library(state: tauri::State<'_, AppState>) -> Result<ScanSummary, AppError> {
    let folder_ids = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        let mut stmt = db.prepare("SELECT id FROM folders ORDER BY path ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let mut summary = ScanSummary {
        scanned: 0,
        added: 0,
        errors: 0,
    };

    for folder_id in folder_ids {
        let folder_summary = scan_music_folder(folder_id, state.clone())?;
        summary.scanned += folder_summary.scanned;
        summary.added += folder_summary.added;
        summary.errors += folder_summary.errors;
    }

    Ok(summary)
}

#[tauri::command]
fn play_track(
    track_id: i64,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlaybackState, AppError> {
    let (track_path, duration_seconds) = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        db.query_row(
            "SELECT path, duration_seconds FROM tracks WHERE id = ?1",
            params![track_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<u64>>(1)?)),
        )?
    };
    let duration_seconds =
        duration_seconds.or_else(|| read_audio_metadata(Path::new(&track_path)).duration_seconds);

    // Detect missing file before trying to open
    let file = File::open(&track_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::FileNotFound(track_path.clone())
        } else {
            AppError::Io(e)
        }
    })?;
    let reader = BufReader::new(file);
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;

    if let Some(player) = audio.player.take() {
        player.stop();
    }

    let sink = audio
        .sink
        .as_ref()
        .ok_or_else(|| AppError::Message("no audio output device available".into()))?;
    let player = rodio::play(sink.mixer(), reader)
        .map_err(|error| AppError::Message(format!("failed to play track: {error}")))?;
    player.set_volume(audio.volume);

    audio.current_track_id = Some(track_id);
    audio.current_duration_seconds = duration_seconds;
    audio.elapsed_before_play_ms = 0;
    audio.started_at = Some(Instant::now());
    audio.player = Some(player);
    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        db.execute(
            "UPDATE tracks SET last_played_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![track_id],
        )?;
    }
    set_setting(&state, "last_track_id", &track_id.to_string())?;

    let pb = audio.playback_state();
    let _ = app.emit("playback_state_changed", &pb);
    Ok(pb)
}

#[tauri::command]
fn get_playback_state(state: tauri::State<'_, AppState>) -> Result<PlaybackState, AppError> {
    let audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;

    Ok(audio.playback_state())
}

#[tauri::command]
fn pause_playback(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlaybackState, AppError> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
    if let Some(player) = &audio.player {
        player.pause();
    }
    audio.pause_clock();

    let pb = audio.playback_state();
    let _ = app.emit("playback_state_changed", &pb);
    Ok(pb)
}

#[tauri::command]
fn resume_playback(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlaybackState, AppError> {
    let has_player = {
        let audio = state
            .audio
            .lock()
            .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
        audio.player.is_some()
    };

    if !has_player {
        let track_id_opt = {
            let audio = state
                .audio
                .lock()
                .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
            audio.current_track_id
        };
        if let Some(track_id) = track_id_opt {
            return play_track(track_id, state.clone(), app);
        }
    }

    let mut audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
    if let Some(player) = &audio.player {
        player.play();
    }
    audio.resume_clock();

    let pb = audio.playback_state();
    let _ = app.emit("playback_state_changed", &pb);
    Ok(pb)
}

#[tauri::command]
fn seek_playback(
    elapsed_ms: u64,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlaybackState, AppError> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
    let duration_ms = audio
        .current_duration_seconds
        .map(|duration| duration.saturating_mul(1000));
    let target_ms = duration_ms
        .map(|duration| elapsed_ms.min(duration))
        .unwrap_or(elapsed_ms);

    if let Some(player) = &audio.player {
        if player.try_seek(Duration::from_millis(target_ms)).is_err() {
            restart_current_track_at(&state, &mut audio, target_ms)?;
        }
    }
    audio.seek_clock(target_ms);

    let pb = audio.playback_state();
    let _ = app.emit("playback_state_changed", &pb);
    Ok(pb)
}

fn restart_current_track_at(
    state: &tauri::State<'_, AppState>,
    audio: &mut AudioState,
    target_ms: u64,
) -> Result<(), AppError> {
    let track_id = audio
        .current_track_id
        .ok_or_else(|| AppError::Message("no track is playing".into()))?;
    let track_path = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        db.query_row(
            "SELECT path FROM tracks WHERE id = ?1",
            params![track_id],
            |row| row.get::<_, String>(0),
        )?
    };
    let sink = audio
        .sink
        .as_ref()
        .ok_or_else(|| AppError::Message("no audio output device available".into()))?;

    if let Some(player) = audio.player.take() {
        player.stop();
    }

    let reader = BufReader::new(File::open(&track_path)?);
    let player = rodio::play(sink.mixer(), reader)
        .map_err(|error| AppError::Message(format!("failed to restart track: {error}")))?;
    player.set_volume(audio.volume);
    player
        .try_seek(Duration::from_millis(target_ms))
        .map_err(|error| AppError::Message(format!("failed to seek after restart: {error}")))?;
    if audio.started_at.is_none() {
        player.pause();
    }
    audio.player = Some(player);

    Ok(())
}

#[tauri::command]
fn stop_playback(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlaybackState, AppError> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
    if let Some(player) = audio.player.take() {
        player.stop();
    }
    audio.current_track_id = None;
    audio.current_duration_seconds = None;
    audio.reset_clock();

    let pb = audio.playback_state();
    let _ = app.emit("playback_state_changed", &pb);
    Ok(pb)
}

#[tauri::command]
fn set_volume(
    volume: f32,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlaybackState, AppError> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
    audio.volume = volume.clamp(0.0, 1.0);
    if let Some(player) = &audio.player {
        player.set_volume(audio.volume);
    }
    set_setting(&state, "volume", &audio.volume.to_string())?;

    let pb = audio.playback_state();
    let _ = app.emit("playback_state_changed", &pb);
    Ok(pb)
}

#[tauri::command]
fn remove_track(track_id: i64, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    db.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
    Ok(())
}

fn insert_track(state: &AppState, folder_id: i64, path: &Path) -> Result<bool, AppError> {
    let path_string = path.display().to_string();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&file_name);
    let fallback = fallback_metadata_from_stem(stem);
    let metadata = read_audio_metadata(path);
    let title = metadata.title.or(fallback.title);
    let artist = metadata.artist.or(fallback.artist);
    let album = metadata.album.or(fallback.album);

    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    let changed = db.execute(
        "INSERT INTO tracks
           (folder_id, path, file_name, title, artist, album, duration_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(path) DO UPDATE SET
           folder_id = excluded.folder_id,
           file_name = excluded.file_name,
           title = excluded.title,
           artist = excluded.artist,
           album = excluded.album,
           duration_seconds = excluded.duration_seconds,
           updated_at = CURRENT_TIMESTAMP",
        params![
            folder_id,
            path_string,
            file_name,
            title,
            artist,
            album,
            metadata.duration_seconds
        ],
    )?;

    Ok(changed > 0)
}

fn import_music_folder_path(
    folder_path: &Path,
    state: tauri::State<'_, AppState>,
) -> Result<(Folder, ScanSummary), AppError> {
    let folder = add_music_folder(folder_path.display().to_string(), state.clone())?;
    let summary = scan_music_folder(folder.id, state)?;
    Ok((folder, summary))
}

fn import_music_file_path(
    path: &Path,
    state: &tauri::State<'_, AppState>,
) -> Result<(i64, bool, String), AppError> {
    let canonical = fs::canonicalize(path)?;
    let parent = canonical
        .parent()
        .ok_or_else(|| AppError::Message("audio file has no parent folder".into()))?;
    let folder = ensure_music_folder(parent, state)?;
    let added = insert_track(state, folder.id, &canonical)?;
    let track_id = track_id_for_path(state, &canonical)?;

    Ok((track_id, added, canonical.display().to_string()))
}

fn ensure_music_folder(
    folder_path: &Path,
    state: &tauri::State<'_, AppState>,
) -> Result<Folder, AppError> {
    let canonical = fs::canonicalize(folder_path)?;
    let path_string = canonical.display().to_string();
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;

    db.execute(
        "INSERT OR IGNORE INTO folders (path) VALUES (?1)",
        params![path_string],
    )?;

    let id = db.query_row(
        "SELECT id FROM folders WHERE path = ?1",
        params![path_string],
        |row| row.get(0),
    )?;

    Ok(Folder {
        id,
        path: path_string,
    })
}

fn track_id_for_path(state: &AppState, path: &Path) -> Result<i64, AppError> {
    let path_string = path.display().to_string();
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;

    Ok(db.query_row(
        "SELECT id FROM tracks WHERE path = ?1",
        params![path_string],
        |row| row.get(0),
    )?)
}

fn track_ids_for_folder(
    state: &tauri::State<'_, AppState>,
    folder_id: i64,
) -> Result<Vec<i64>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    let mut stmt = db.prepare("SELECT id FROM tracks WHERE folder_id = ?1 ORDER BY title ASC")?;
    let rows = stmt.query_map(params![folder_id], |row| row.get::<_, i64>(0))?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

struct AudioMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_seconds: Option<u64>,
}

fn fallback_metadata_from_stem(stem: &str) -> AudioMetadata {
    let clean_stem = clean_tag_value(stem);
    let mut title = Some(clean_stem.clone());
    let mut artist = None;

    for separator in [" - ", " – ", " — "] {
        if let Some((left, right)) = clean_stem.split_once(separator) {
            artist = non_empty_string(left);
            title = non_empty_string(right).or(title);
            break;
        }
    }

    AudioMetadata {
        title,
        artist,
        album: None,
        duration_seconds: None,
    }
}

fn read_audio_metadata(path: &Path) -> AudioMetadata {
    let tagged_file = match read_from_path(path) {
        Ok(file) => file,
        Err(_) => return empty_metadata(),
    };

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    AudioMetadata {
        title: tag.and_then(|tag| tag.get_string(ItemKey::TrackTitle).map(clean_tag_value)),
        artist: tag.and_then(|tag| tag.get_string(ItemKey::TrackArtist).map(clean_tag_value)),
        album: tag.and_then(|tag| tag.get_string(ItemKey::AlbumTitle).map(clean_tag_value)),
        duration_seconds: Some(tagged_file.properties().duration().as_secs()),
    }
}

fn clean_tag_value(value: &str) -> String {
    value.trim().to_string()
}

fn non_empty_string(value: &str) -> Option<String> {
    let cleaned = clean_tag_value(value);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn normalize_override(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn empty_metadata() -> AudioMetadata {
    AudioMetadata {
        title: None,
        artist: None,
        album: None,
        duration_seconds: None,
    }
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "mp3" | "flac" | "wav" | "ogg" | "m4a" | "aac" | "opus"
            )
        })
        .unwrap_or(false)
}

fn init_state<R: Runtime>(app: &tauri::App<R>) -> Result<AppState, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&app_data_dir)?;

    let db_path = app_data_dir.join("devwannawave.db");
    let db = Connection::open(&db_path)?;
    // Enable WAL mode for concurrent reads without blocking writes
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    run_migrations(&db)?;
    let volume = get_setting_from_db(&db, "volume")?
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    let last_track_id =
        get_setting_from_db(&db, "last_track_id")?.and_then(|value| value.parse::<i64>().ok());
    let sink = match DeviceSinkBuilder::open_default_sink() {
        Ok(mut sink) => {
            sink.log_on_drop(false);
            Some(sink)
        }
        Err(_) => None,
    };

    Ok(AppState {
        db_path,
        db: Mutex::new(db),
        audio: Mutex::new(AudioState {
            sink,
            player: None,
            current_track_id: last_track_id,
            current_duration_seconds: None,
            volume,
            elapsed_before_play_ms: 0,
            started_at: None,
        }),
    })
}

fn run_migrations(db: &Connection) -> Result<(), AppError> {
    db.execute_batch(include_str!("../migrations/0001_initial.sql"))?;
    ensure_track_schema(db)?;
    Ok(())
}

fn ensure_track_schema(db: &Connection) -> Result<(), AppError> {
    ensure_column(db, "tracks", "title_override", "TEXT")?;
    ensure_column(db, "tracks", "artist_override", "TEXT")?;
    ensure_column(db, "tracks", "album_override", "TEXT")?;
    ensure_column(db, "tracks", "last_played_at", "TEXT")?;
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks(created_at)",
        [],
    )?;
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_tracks_last_played_at ON tracks(last_played_at)",
        [],
    )?;
    // Fast path dedup lookup during scan
    db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path)",
        [],
    )?;
    Ok(())
}

fn ensure_column(db: &Connection, table: &str, column: &str, definition: &str) -> Result<(), AppError> {
    let mut stmt = db.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let columns = rows.collect::<Result<Vec<_>, _>>()?;
    if columns.iter().any(|existing| existing == column) {
        return Ok(());
    }

    db.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}

fn get_setting_from_db(db: &Connection, key: &str) -> Result<Option<String>, AppError> {
    let mut stmt = db.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
    match stmt.query_row(params![key], |row| row.get::<_, String>(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(AppError::Sql(error)),
    }
}

fn set_setting(state: &AppState, key: &str, value: &str) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    db.execute(
        "INSERT INTO app_settings (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = init_state(app)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            create_playlist,
            delete_playlist,
            add_track_to_playlist,
            remove_track_from_playlist,
            update_track_metadata,
            add_music_folder,
            import_music_paths,
            scan_music_folder,
            rescan_library,
            play_track,
            get_playback_state,
            pause_playback,
            resume_playback,
            seek_playback,
            stop_playback,
            set_volume,
            remove_track
        ])
        .run(tauri::generate_context!())
        .expect("error while running devwannawave");
}
