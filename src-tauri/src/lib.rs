use std::{
    fs::{self, File},
    io::{BufReader, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use lofty::{
    file::TaggedFileExt,
    prelude::{AudioFile, ItemKey},
    read_from_path,
};
use rodio::{DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime};
use walkdir::WalkDir;

struct AppState {
    db_path: PathBuf,
    db: Mutex<Connection>,
    audio: Mutex<AudioState>,
    pending_open_paths: Mutex<Vec<String>>,
    active_scans: Mutex<std::collections::HashSet<i64>>,
}

struct AudioState {
    sink: Option<MixerDeviceSink>,
    player: Option<Player>,
    current_track_id: Option<i64>,
    current_duration_seconds: Option<u64>,
    volume: f32,
    gain: f32,
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
            gain: self.gain,
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
    pinned: bool,
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
    liked: bool,
    play_count: i64,
    genre: Option<String>,
    year: Option<i64>,
    genre_override: Option<String>,
    year_override: Option<i64>,
    last_position_ms: u64,
}

#[derive(Serialize)]
struct Playlist {
    id: i64,
    name: String,
    track_ids: Vec<i64>,
    pinned: bool,
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

#[derive(Clone, Serialize)]
struct ScanProgress {
    folder_id: i64,
    scanned: usize,
    added: usize,
    current_file: String,
    is_done: bool,
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
    gain: f32,
}

#[derive(Serialize)]
struct CliCommandStatus {
    installed: bool,
    location: Option<String>,
    reachable_hint: Option<String>,
}

#[tauri::command]
fn get_library(state: tauri::State<'_, AppState>) -> Result<Library, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;

    let folders = {
        let mut stmt = db.prepare("SELECT id, path, pinned FROM folders ORDER BY path ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                path: row.get(1)?,
                pinned: row.get::<_, i64>(2)? != 0,
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
                    duration_seconds, created_at, last_played_at,
                    liked, play_count, genre, year,
                    genre_override, year_override, last_position_ms
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
                liked: row.get::<_, i64>(10)? != 0,
                play_count: row.get(11)?,
                genre: row.get(12)?,
                year: row.get(13)?,
                genre_override: row.get(14)?,
                year_override: row.get(15)?,
                last_position_ms: row.get::<_, i64>(16)? as u64,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let playlists = {
        // Load all playlists in one query
        let mut stmt = db.prepare("SELECT id, name, pinned FROM playlists ORDER BY name ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                track_ids: Vec::new(),
                pinned: row.get::<_, i64>(2)? != 0,
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
        pinned: false,
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
    genre: Option<String>,
    year: Option<i64>,
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
             genre_override = ?5,
             year_override = ?6,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1",
        params![
            track_id,
            normalize_override(title),
            normalize_override(artist),
            normalize_override(album),
            normalize_override(genre),
            year,
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
    if is_disallowed_music_root(&canonical) {
        return Err(AppError::Message(
            "choose a music folder, not a whole drive root like C:\\ or D:\\".into(),
        ));
    }
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
        pinned: false,
    })
}

fn save_current_position_locked(state: &AppState, audio: &AudioState) -> Result<(), AppError> {
    if let Some(track_id) = audio.current_track_id {
        let elapsed = audio.elapsed_ms();
        let duration_ms = audio.current_duration_seconds.map(|d| d * 1000).unwrap_or(0);
        let save_val = if duration_ms > 0 && elapsed >= duration_ms.saturating_sub(5000) {
            0
        } else {
            elapsed
        };
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        db.execute(
            "UPDATE tracks SET last_position_ms = ?2 WHERE id = ?1",
            params![track_id, save_val],
        )?;
    }
    Ok(())
}

fn to_base64(data: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        match chunk.len() {
            3 => {
                let b = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
                result.push(CHARSET[((b >> 18) & 63) as usize] as char);
                result.push(CHARSET[((b >> 12) & 63) as usize] as char);
                result.push(CHARSET[((b >> 6) & 63) as usize] as char);
                result.push(CHARSET[(b & 63) as usize] as char);
            }
            2 => {
                let b = ((chunk[0] as u32) << 8) | (chunk[1] as u32);
                result.push(CHARSET[((b >> 12) & 63) as usize] as char);
                result.push(CHARSET[((b >> 6) & 63) as usize] as char);
                result.push(CHARSET[(b & 63) as usize] as char);
                result.push('=');
            }
            1 => {
                let b = chunk[0] as u32;
                result.push(CHARSET[((b >> 6) & 63) as usize] as char);
                result.push(CHARSET[(b & 63) as usize] as char);
                result.push('=');
                result.push('=');
            }
            _ => unreachable!(),
        }
    }
    result
}

#[tauri::command]
fn toggle_track_liked(track_id: i64, state: tauri::State<'_, AppState>) -> Result<bool, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    let current_liked: i64 = db.query_row(
        "SELECT liked FROM tracks WHERE id = ?1",
        params![track_id],
        |row| row.get(0),
    ).unwrap_or(0);
    let next_liked = if current_liked == 0 { 1 } else { 0 };
    db.execute(
        "UPDATE tracks SET liked = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![track_id, next_liked],
    )?;
    Ok(next_liked != 0)
}

#[tauri::command]
fn toggle_playlist_pinned(playlist_id: i64, state: tauri::State<'_, AppState>) -> Result<bool, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    let current_pinned: i64 = db.query_row(
        "SELECT pinned FROM playlists WHERE id = ?1",
        params![playlist_id],
        |row| row.get(0),
    ).unwrap_or(0);
    let next_pinned = if current_pinned == 0 { 1 } else { 0 };
    db.execute(
        "UPDATE playlists SET pinned = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![playlist_id, next_pinned],
    )?;
    Ok(next_pinned != 0)
}

#[tauri::command]
fn toggle_folder_pinned(folder_id: i64, state: tauri::State<'_, AppState>) -> Result<bool, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    let current_pinned: i64 = db.query_row(
        "SELECT pinned FROM folders WHERE id = ?1",
        params![folder_id],
        |row| row.get(0),
    ).unwrap_or(0);
    let next_pinned = if current_pinned == 0 { 1 } else { 0 };
    db.execute(
        "UPDATE folders SET pinned = ?2 WHERE id = ?1",
        params![folder_id, next_pinned],
    )?;
    Ok(next_pinned != 0)
}

#[tauri::command]
fn check_library_health(state: tauri::State<'_, AppState>) -> Result<Vec<Track>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    let mut stmt = db.prepare(
        "SELECT id, folder_id, path, file_name,
                COALESCE(NULLIF(title_override, ''), title),
                COALESCE(NULLIF(artist_override, ''), artist),
                COALESCE(NULLIF(album_override, ''), album),
                duration_seconds, created_at, last_played_at,
                liked, play_count, genre, year,
                genre_override, year_override, last_position_ms
         FROM tracks",
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
            liked: row.get::<_, i64>(10)? != 0,
            play_count: row.get(11)?,
            genre: row.get(12)?,
            year: row.get(13)?,
            genre_override: row.get(14)?,
            year_override: row.get(15)?,
            last_position_ms: row.get::<_, i64>(16)? as u64,
        })
    })?;

    let mut missing_tracks = Vec::new();
    for track_res in rows {
        if let Ok(track) = track_res {
            if !Path::new(&track.path).exists() {
                missing_tracks.push(track);
            }
        }
    }
    Ok(missing_tracks)
}

#[tauri::command]
fn prune_missing_tracks(state: tauri::State<'_, AppState>) -> Result<usize, AppError> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    
    let tx = db.transaction()?;
    let mut stmt = tx.prepare("SELECT id, path FROM tracks")?;
    let mut rows = stmt.query([])?;
    let mut ids_to_delete = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let path: String = row.get(1)?;
        if !Path::new(&path).exists() {
            ids_to_delete.push(id);
        }
    }
    drop(rows);
    drop(stmt);

    let count = ids_to_delete.len();
    for id in ids_to_delete {
        tx.execute("DELETE FROM tracks WHERE id = ?1", params![id])?;
    }
    tx.commit()?;
    Ok(count)
}

#[tauri::command]
fn relink_folder_path(folder_id: i64, new_path: String, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let folder_path = Path::new(&new_path);
    if !folder_path.is_dir() {
        return Err(AppError::Message("relinked folder path does not exist on disk".into()));
    }
    let canonical = fs::canonicalize(folder_path)?.display().to_string();

    let mut db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;

    let old_path: String = db.query_row(
        "SELECT path FROM folders WHERE id = ?1",
        params![folder_id],
        |row| row.get(0),
    )?;

    let tx = db.transaction()?;
    tx.execute(
        "UPDATE folders SET path = ?2 WHERE id = ?1",
        params![folder_id, canonical],
    )?;

    // Fetch all tracks in this folder
    let mut stmt = tx.prepare("SELECT id, path FROM tracks WHERE folder_id = ?1")?;
    let mut rows = stmt.query(params![folder_id])?;
    let mut tracks_to_update = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let path: String = row.get(1)?;
        tracks_to_update.push((id, path));
    }
    drop(rows);
    drop(stmt);

    for (id, old_track_path) in tracks_to_update {
        if old_track_path.starts_with(&old_path) {
            let relative_part = &old_track_path[old_path.len()..];
            let new_track_path = format!("{}{}", canonical, relative_part);
            tx.execute(
                "UPDATE tracks SET path = ?2 WHERE id = ?1",
                params![id, new_track_path],
            )?;
        }
    }

    tx.commit()?;
    Ok(())
}

#[tauri::command]
fn relink_track_path(track_id: i64, new_path: String, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let file_path = Path::new(&new_path);
    if !file_path.is_file() {
        return Err(AppError::Message("relinked track file does not exist on disk".into()));
    }
    let canonical = fs::canonicalize(file_path)?.display().to_string();

    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;

    db.execute(
        "UPDATE tracks SET path = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![track_id, canonical],
    )?;
    Ok(())
}

#[tauri::command]
fn get_track_cover_art(track_id: i64, state: tauri::State<'_, AppState>) -> Result<Option<String>, AppError> {
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

    let path = Path::new(&track_path);
    if !path.exists() {
        return Ok(None);
    }

    if let Ok(tagged_file) = read_from_path(path) {
        let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
        if let Some(tag) = tag {
            let pictures = tag.pictures();
            if !pictures.is_empty() {
                let pic = &pictures[0];
                let mime = pic.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
                let base64_str = to_base64(pic.data());
                return Ok(Some(format!("data:{};base64,{}", mime, base64_str)));
            }
        }
    }

    if let Some(parent) = path.parent() {
        let cover_filenames = ["cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png"];
        for entry in WalkDir::new(parent).max_depth(1).follow_links(false) {
            if let Ok(entry) = entry {
                if let Some(name) = entry.file_name().to_str() {
                    let name_lower = name.to_lowercase();
                    if cover_filenames.iter().any(|&f| f == name_lower) {
                        if let Ok(data) = fs::read(entry.path()) {
                            let ext = entry.path().extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("jpeg")
                                .to_lowercase();
                            let mime = if ext == "png" { "image/png" } else { "image/jpeg" };
                            let base64_str = to_base64(&data);
                            return Ok(Some(format!("data:{};base64,{}", mime, base64_str)));
                        }
                    }
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
fn cancel_scan_music_folder(folder_id: i64, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let mut active = state
        .active_scans
        .lock()
        .map_err(|_| AppError::Message("active scans lock poisoned".into()))?;
    active.remove(&folder_id);
    Ok(())
}

#[tauri::command]
fn get_system_music_folders() -> Result<Vec<String>, AppError> {
    let mut suggestions = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let path = PathBuf::from(profile).join("Music");
            if path.exists() {
                suggestions.push(path.display().to_string());
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let path = PathBuf::from(home).join("Music");
            if path.exists() {
                suggestions.push(path.display().to_string());
            }
        }
    }
    Ok(suggestions)
}

#[tauri::command]
fn play_test_sound(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let app_data_dir = state.db_path.parent().ok_or_else(|| AppError::Message("no app data dir".into()))?;
    let demo_path = app_data_dir.join("starter").join("devwannawave - first light.wav");
    let file = File::open(&demo_path).map_err(AppError::Io)?;
    let reader = BufReader::new(file);

    let audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
    let sink = audio
        .sink
        .as_ref()
        .ok_or_else(|| AppError::Message("no audio output device available".into()))?;
    
    let _player = rodio::play(sink.mixer(), reader)
        .map_err(|e| AppError::Message(format!("failed to play test sound: {e}")))?;
    Ok(())
}

#[tauri::command]
fn set_volume_gain(
    gain: f32,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<PlaybackState, AppError> {
    let mut audio = state
        .audio
        .lock()
        .map_err(|_| AppError::Message("audio lock poisoned".into()))?;
    audio.gain = gain.clamp(0.5, 2.0);
    if let Some(player) = &audio.player {
        player.set_volume(audio.volume * audio.gain);
    }
    set_setting(&state, "volume_gain", &audio.gain.to_string())?;

    let pb = audio.playback_state();
    let _ = app.emit("playback_state_changed", &pb);
    Ok(pb)
}

#[tauri::command]
fn import_music_paths(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
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
            if let Ok(canonical) = fs::canonicalize(&path) {
                if is_disallowed_music_root(&canonical) {
                    summary.errors += 1;
                    continue;
                }
            }
            match import_music_folder_path(&path, state.clone(), app.clone()) {
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
    app: tauri::AppHandle,
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

    // Register active scan
    {
        let mut active = state
            .active_scans
            .lock()
            .map_err(|_| AppError::Message("active scans lock poisoned".into()))?;
        active.insert(folder_id);
    }

    let mut scanned = 0;
    let mut added = 0;
    let mut errors = 0;

    for entry in WalkDir::new(&folder_path).follow_links(false) {
        // Check cancelation
        {
            let active = state
                .active_scans
                .lock()
                .map_err(|_| AppError::Message("active scans lock poisoned".into()))?;
            if !active.contains(&folder_id) {
                break;
            }
        }

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

        let current_file = entry.file_name().to_string_lossy().to_string();
        let _ = app.emit("scan_progress", ScanProgress {
            folder_id,
            scanned,
            added,
            current_file,
            is_done: false,
        });
    }

    // Clean up active scan
    {
        let mut active = state
            .active_scans
            .lock()
            .map_err(|_| AppError::Message("active scans lock poisoned".into()))?;
        active.remove(&folder_id);
    }

    let _ = app.emit("scan_progress", ScanProgress {
        folder_id,
        scanned,
        added,
        current_file: String::new(),
        is_done: true,
    });

    Ok(ScanSummary {
        scanned,
        added,
        errors,
    })
}

#[tauri::command]
fn get_cli_command_status() -> Result<CliCommandStatus, AppError> {
    #[cfg(target_os = "windows")]
    {
        return Ok(CliCommandStatus {
            installed: true,
            location: Some("installed by the Windows installer as dww.exe".into()),
            reachable_hint: Some("reopen terminal after install so PATH refreshes.".into()),
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let launcher_path = default_cli_launcher_path()?;
        let installed = launcher_path.is_file();
        let reachable_hint = if installed {
            Some(format!(
                "restart terminal first. if `dww` is still not found, add {} to PATH.",
                launcher_path
                    .parent()
                    .map(Path::display)
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "~".into())
            ))
        } else {
            None
        };

        return Ok(CliCommandStatus {
            installed,
            location: installed.then(|| launcher_path.display().to_string()),
            reachable_hint,
        });
    }
}

#[tauri::command]
fn install_cli_command() -> Result<CliCommandStatus, AppError> {
    #[cfg(target_os = "windows")]
    {
        return Ok(CliCommandStatus {
            installed: true,
            location: Some("installed by the Windows installer as dww.exe".into()),
            reachable_hint: Some("reopen terminal after install so PATH refreshes.".into()),
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let launcher_path = default_cli_launcher_path()?;
        let parent = launcher_path
            .parent()
            .ok_or_else(|| AppError::Message("invalid CLI launcher path".into()))?;
        fs::create_dir_all(parent)?;

        let current_exe =
            std::env::current_exe().map_err(|error| AppError::Message(error.to_string()))?;
        let launcher_script = build_cli_launcher_script(&current_exe);
        fs::write(&launcher_path, launcher_script)?;
        #[cfg(unix)]
        fs::set_permissions(&launcher_path, fs::Permissions::from_mode(0o755))?;

        return Ok(CliCommandStatus {
            installed: true,
            location: Some(launcher_path.display().to_string()),
            reachable_hint: Some(format!(
                "restart terminal first. if `dww` is still not found, add {} to PATH.",
                parent.display()
            )),
        });
    }
}

#[tauri::command]
fn rescan_library(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ScanSummary, AppError> {
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
        let folder_summary = scan_music_folder(folder_id, state.clone(), app.clone())?;
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
    let (track_path, duration_seconds, last_position_ms) = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        db.query_row(
            "SELECT path, duration_seconds, last_position_ms FROM tracks WHERE id = ?1",
            params![track_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<u64>>(1)?, row.get::<_, i64>(2)? as u64)),
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

    // Save previous track's position before switching!
    let _ = save_current_position_locked(&state, &audio);

    if let Some(player) = audio.player.take() {
        player.stop();
    }

    let sink = audio
        .sink
        .as_ref()
        .ok_or_else(|| AppError::Message("no audio output device available".into()))?;
    let player = rodio::play(sink.mixer(), reader)
        .map_err(|error| AppError::Message(format!("failed to play track: {error}")))?;
    
    let resume_ms = if let Some(d_sec) = duration_seconds {
        if d_sec > 300 && last_position_ms > 0 && last_position_ms < (d_sec * 1000).saturating_sub(5000) {
            last_position_ms
        } else {
            0
        }
    } else {
        0
    };

    player.set_volume(audio.volume * audio.gain);
    if resume_ms > 0 {
        let _ = player.try_seek(Duration::from_millis(resume_ms));
    }

    audio.current_track_id = Some(track_id);
    audio.current_duration_seconds = duration_seconds;
    audio.elapsed_before_play_ms = resume_ms;
    audio.started_at = Some(Instant::now());
    audio.player = Some(player);
    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Message("database lock poisoned".into()))?;
        db.execute(
            "UPDATE tracks SET last_played_at = CURRENT_TIMESTAMP, play_count = play_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
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
    let _ = save_current_position_locked(&state, &audio);

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
    let _ = save_current_position_locked(&state, &audio);

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
        player.set_volume(audio.volume * audio.gain);
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

#[tauri::command]
fn take_pending_open_paths(state: tauri::State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let mut pending = state
        .pending_open_paths
        .lock()
        .map_err(|_| AppError::Message("pending-open lock poisoned".into()))?;
    Ok(std::mem::take(&mut *pending))
}

fn insert_track(state: &AppState, folder_id: i64, path: &Path) -> Result<bool, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    insert_track_row(&db, folder_id, path)
}

fn insert_track_row(db: &Connection, folder_id: i64, path: &Path) -> Result<bool, AppError> {
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

    let changed = db.execute(
        "INSERT INTO tracks
           (folder_id, path, file_name, title, artist, album, duration_seconds, genre, year)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(path) DO UPDATE SET
           folder_id = excluded.folder_id,
           file_name = excluded.file_name,
           title = excluded.title,
           artist = excluded.artist,
           album = excluded.album,
           duration_seconds = excluded.duration_seconds,
           genre = COALESCE(excluded.genre, tracks.genre),
           year = COALESCE(excluded.year, tracks.year),
           updated_at = CURRENT_TIMESTAMP",
        params![
            folder_id,
            path_string,
            file_name,
            title,
            artist,
            album,
            metadata.duration_seconds,
            metadata.genre,
            metadata.year,
        ],
    )?;

    Ok(changed > 0)
}

fn import_music_folder_path(
    folder_path: &Path,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(Folder, ScanSummary), AppError> {
    let folder = add_music_folder(folder_path.display().to_string(), state.clone())?;
    let summary = scan_music_folder(folder.id, state, app)?;
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
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Message("database lock poisoned".into()))?;
    ensure_music_folder_row(&db, folder_path)
}

fn ensure_music_folder_row(db: &Connection, folder_path: &Path) -> Result<Folder, AppError> {
    let canonical = fs::canonicalize(folder_path)?;
    let path_string = canonical.display().to_string();

    db.execute(
        "INSERT OR IGNORE INTO folders (path) VALUES (?1)",
        params![path_string],
    )?;

    let (id, pinned) = db.query_row(
        "SELECT id, pinned FROM folders WHERE path = ?1",
        params![path_string],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)? != 0)),
    )?;

    Ok(Folder {
        id,
        path: path_string,
        pinned,
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
    genre: Option<String>,
    year: Option<i64>,
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
        genre: None,
        year: None,
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

    let genre = tag.and_then(|t| t.get_string(ItemKey::Genre).map(clean_tag_value));
    let year = tag.and_then(|t| {
        t.get_string(ItemKey::Year)
            .or_else(|| t.get_string(ItemKey::RecordingDate))
            .and_then(|s| {
                let trimmed = s.trim();
                if trimmed.len() >= 4 {
                    trimmed[0..4].parse::<i64>().ok()
                } else {
                    trimmed.parse::<i64>().ok()
                }
            })
    });

    AudioMetadata {
        title: tag.and_then(|t| t.get_string(ItemKey::TrackTitle).map(clean_tag_value)),
        artist: tag.and_then(|t| t.get_string(ItemKey::TrackArtist).map(clean_tag_value)),
        album: tag.and_then(|t| t.get_string(ItemKey::AlbumTitle).map(clean_tag_value)),
        duration_seconds: Some(tagged_file.properties().duration().as_secs()),
        genre,
        year,
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
        genre: None,
        year: None,
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

fn collect_audio_paths<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    args.into_iter()
        .filter_map(|arg| {
            let path = PathBuf::from(arg.as_ref());
            if !path.exists() {
                return None;
            }

            if path.is_dir() || (path.is_file() && is_audio_file(&path)) {
                fs::canonicalize(path)
                    .ok()
                    .map(|canonical| canonical.display().to_string())
            } else {
                None
            }
        })
        .collect()
}

fn collect_audio_paths_from_window_args(args: Vec<String>) -> Vec<String> {
    let all_args = collect_audio_paths(args.iter());
    if !all_args.is_empty() {
        return all_args;
    }

    collect_audio_paths(args.iter().skip(1))
}

fn collect_launch_audio_paths() -> Vec<String> {
    collect_audio_paths(std::env::args_os().skip(1))
}

fn is_disallowed_music_root(path: &Path) -> bool {
    path.parent().is_none()
}

#[cfg(not(target_os = "windows"))]
fn default_cli_launcher_path() -> Result<PathBuf, AppError> {
    let home_dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Message("could not resolve home directory".into()))?;
    #[cfg(target_os = "macos")]
    {
        return Ok(home_dir.join("bin").join("dww"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Ok(home_dir.join(".local").join("bin").join("dww"));
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_escape_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "'\"'\"'")
}

#[cfg(not(target_os = "windows"))]
fn build_cli_launcher_script(current_exe: &Path) -> String {
    let escaped_current_exe = shell_escape_path(current_exe);

    #[cfg(target_os = "macos")]
    {
        return format!(
            "#!/bin/sh\nif command -v open >/dev/null 2>&1; then\n  exec open -a \"devwannawave\" --args \"$@\"\nfi\nexec \"{}\" \"$@\"\n",
            escaped_current_exe
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        return format!(
            "#!/bin/sh\nif command -v devwannawave >/dev/null 2>&1; then\n  exec devwannawave \"$@\"\nfi\nexec \"{}\" \"$@\"\n",
            escaped_current_exe
        );
    }
}

fn init_state<R: Runtime>(
    app: &tauri::App<R>,
    pending_open_paths: Vec<String>,
) -> Result<AppState, AppError> {
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
    seed_demo_track_if_needed(&db, &app_data_dir)?;
    let volume = get_setting_from_db(&db, "volume")?
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    let gain = get_setting_from_db(&db, "volume_gain")?
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(1.0)
        .clamp(0.5, 2.0);
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
            gain,
            elapsed_before_play_ms: 0,
            started_at: None,
        }),
        pending_open_paths: Mutex::new(pending_open_paths),
        active_scans: Mutex::new(std::collections::HashSet::new()),
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
    ensure_column(db, "tracks", "liked", "INTEGER DEFAULT 0")?;
    ensure_column(db, "tracks", "play_count", "INTEGER DEFAULT 0")?;
    ensure_column(db, "tracks", "genre", "TEXT")?;
    ensure_column(db, "tracks", "year", "INTEGER")?;
    ensure_column(db, "tracks", "genre_override", "TEXT")?;
    ensure_column(db, "tracks", "year_override", "INTEGER")?;
    ensure_column(db, "tracks", "last_position_ms", "INTEGER DEFAULT 0")?;
    ensure_column(db, "playlists", "pinned", "INTEGER DEFAULT 0")?;
    ensure_column(db, "folders", "pinned", "INTEGER DEFAULT 0")?;
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

fn set_setting_in_db(db: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    db.execute(
        "INSERT INTO app_settings (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn seed_demo_track_if_needed(db: &Connection, app_data_dir: &Path) -> Result<(), AppError> {
    if get_setting_from_db(db, "starter_track_seeded")?.as_deref() == Some("1") {
        return Ok(());
    }

    let track_count = db.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get::<_, i64>(0))?;
    if track_count > 0 {
        return Ok(());
    }

    let demo_dir = app_data_dir.join("starter");
    fs::create_dir_all(&demo_dir)?;
    let demo_path = demo_dir.join("devwannawave - first light.wav");
    if !demo_path.exists() {
        write_demo_wave_file(&demo_path)?;
    }

    let folder = ensure_music_folder_row(db, &demo_dir)?;
    let _ = insert_track_row(db, folder.id, &demo_path)?;
    set_setting_in_db(db, "starter_track_seeded", "1")?;
    Ok(())
}

fn write_demo_wave_file(path: &Path) -> Result<(), AppError> {
    const SAMPLE_RATE: u32 = 44_100;
    const DURATION_SECONDS: f32 = 6.0;
    const CHANNELS: u16 = 1;
    const BITS_PER_SAMPLE: u16 = 16;
    const BYTES_PER_SAMPLE: u16 = BITS_PER_SAMPLE / 8;

    let sample_count = (SAMPLE_RATE as f32 * DURATION_SECONDS) as usize;
    let mut pcm = Vec::with_capacity(sample_count * BYTES_PER_SAMPLE as usize);

    for i in 0..sample_count {
        let t = i as f32 / SAMPLE_RATE as f32;
        let envelope = if t < 0.15 {
            t / 0.15
        } else if t > DURATION_SECONDS - 0.4 {
            ((DURATION_SECONDS - t) / 0.4).max(0.0)
        } else {
            1.0
        };
        let note = if t < 2.0 {
            293.66
        } else if t < 4.0 {
            369.99
        } else {
            440.0
        };
        let shimmer = (2.0 * std::f32::consts::PI * (note * 0.5) * t).sin() * 0.25;
        let sample = ((2.0 * std::f32::consts::PI * note * t).sin() * 0.55 + shimmer)
            * envelope
            * 0.22;
        let value = (sample * i16::MAX as f32) as i16;
        pcm.extend_from_slice(&value.to_le_bytes());
    }

    let data_len = pcm.len() as u32;
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * BYTES_PER_SAMPLE as u32;
    let block_align = CHANNELS * BYTES_PER_SAMPLE;
    let riff_len = 36 + data_len;

    let mut file = File::create(path)?;
    file.write_all(b"RIFF")?;
    file.write_all(&riff_len.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&CHANNELS.to_le_bytes())?;
    file.write_all(&SAMPLE_RATE.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&BITS_PER_SAMPLE.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;
    file.write_all(&pcm)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                use tauri_plugin_global_shortcut::{Code, Modifiers};
                if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    if shortcut.key == Code::MediaPlayPause || (shortcut.mods == Modifiers::ALT && shortcut.key == Code::KeyP) {
                        let _ = app.emit("global_play_pause", ());
                    } else if shortcut.key == Code::MediaTrackNext || (shortcut.mods == Modifiers::ALT && shortcut.key == Code::KeyN) {
                        let _ = app.emit("global_next", ());
                    } else if shortcut.key == Code::MediaTrackPrevious || (shortcut.mods == Modifiers::ALT && shortcut.key == Code::KeyB) {
                        let _ = app.emit("global_prev", ());
                    }
                }
            })
            .build()
        )
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let incoming_paths = collect_audio_paths_from_window_args(args);
            if incoming_paths.is_empty() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                return;
            }

            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut pending) = state.pending_open_paths.lock() {
                    pending.extend(incoming_paths.clone());
                }
            }

            let _ = app.emit("open_audio_paths", incoming_paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let pending_open_paths = collect_launch_audio_paths();
            let state = init_state(app, pending_open_paths)?;
            app.manage(state);

            // Set up System Tray
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let play_pause = MenuItem::with_id(app, "play_pause", "Play / Pause", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "Next Track", true, None::<&str>)?;
            let prev = MenuItem::with_id(app, "prev", "Previous Track", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&play_pause, &next, &prev, &quit])?;

            let icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "play_pause" => {
                            let _ = app.emit("tray_play_pause", ());
                        }
                        "next" => {
                            let _ = app.emit("tray_next", ());
                        }
                        "prev" => {
                            let _ = app.emit("tray_prev", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                });

            if let Some(i) = icon {
                tray_builder = tray_builder.icon(i);
            }
            let _tray = tray_builder.build(app)?;

            // Set up Global Shortcuts
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Code, Modifiers};

            let play_pause_shortcut = Shortcut::new(None, Code::MediaPlayPause);
            let play_pause_alt = Shortcut::new(Some(Modifiers::ALT), Code::KeyP);
            let next_shortcut = Shortcut::new(None, Code::MediaTrackNext);
            let next_alt = Shortcut::new(Some(Modifiers::ALT), Code::KeyN);
            let prev_shortcut = Shortcut::new(None, Code::MediaTrackPrevious);
            let prev_alt = Shortcut::new(Some(Modifiers::ALT), Code::KeyB);

            let _ = app.global_shortcut().register(play_pause_shortcut);
            let _ = app.global_shortcut().register(play_pause_alt);
            let _ = app.global_shortcut().register(next_shortcut);
            let _ = app.global_shortcut().register(next_alt);
            let _ = app.global_shortcut().register(prev_shortcut);
            let _ = app.global_shortcut().register(prev_alt);

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
            remove_track,
            take_pending_open_paths,
            get_cli_command_status,
            install_cli_command,
            toggle_track_liked,
            toggle_playlist_pinned,
            toggle_folder_pinned,
            check_library_health,
            prune_missing_tracks,
            relink_folder_path,
            relink_track_path,
            get_track_cover_art,
            cancel_scan_music_folder,
            get_system_music_folders,
            play_test_sound,
            set_volume_gain
        ])
        .run(tauri::generate_context!())
        .expect("error while running devwannawave");
}
