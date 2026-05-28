import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  PhysicalPosition,
  PhysicalSize,
  availableMonitors,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";

type Track = {
  id: number;
  folderId: number;
  path: string;
  title: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
  createdAt: string;
  lastPlayedAt?: string;
  fileName: string;
  liked: boolean;
  playCount: number;
  genre?: string;
  year?: number;
  genreOverride?: string;
  yearOverride?: number;
  lastPositionMs?: number;
};

type TrackSortKey = "title" | "artist" | "album" | "duration" | "playCount" | "genre" | "year";
type SortDirection = "asc" | "desc";
type TrackBrowseMode = "all" | "recent-added" | "recent-played" | "most-played" | "never-played";

type BackendTrack = {
  id: number;
  folder_id: number;
  path: string;
  file_name: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  created_at: string;
  last_played_at: string | null;
  liked: boolean;
  play_count: number;
  genre: string | null;
  year: number | null;
  genre_override: string | null;
  year_override: number | null;
  last_position_ms: number;
};

type BackendFolder = {
  id: number;
  path: string;
  pinned: boolean;
};

type BackendLibrary = {
  db_path: string;
  folders: BackendFolder[];
  tracks: BackendTrack[];
  playlists: BackendPlaylist[];
};

type BackendPlaylist = {
  id: number;
  name: string;
  track_ids: number[];
  pinned: boolean;
};

type Folder = {
  id: number;
  path: string;
  pinned: boolean;
  trackCount: number;
};

type Album = {
  id: string;
  name: string;
  artist: string;
  trackCount: number;
  tracks: Track[];
};

type Artist = {
  name: string;
  trackCount: number;
  tracks: Track[];
};

type Playlist = {
  id: number;
  name: string;
  trackCount: number;
  tracks: Track[];
  pinned: boolean;
};

type ScanSummary = {
  scanned: number;
  added: number;
  errors: number;
};

type ImportSummary = ScanSummary & {
  existing: number;
  track_ids: number[];
  imported_paths: string[];
  existing_paths: string[];
};
type QueueItem = {
  id: string;
  trackId: number;
};

type DropTarget =
  | { type: "all-tracks" }
  | { type: "playlist"; playlistId: number };

type TrackContextMenuState = {
  trackId: number;
  x: number;
  y: number;
};

type TrackMetadataDraft = {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
};

type PlaybackState = {
  current_track_id: number | null;
  duration_seconds: number | null;
  is_paused: boolean;
  volume: number;
  elapsed_ms: number;
  gain: number;
};

type CliCommandStatus = {
  installed: boolean;
  location: string | null;
  reachable_hint: string | null;
};

type StoredWindowState = {
  height: number;
  isMaximized: boolean;
  width: number;
  x: number;
  y: number;
};

type View = "all-tracks" | "albums" | "artists" | "playlists" | "liked";
type PlaybackMode = "normal" | "shuffle" | "repeat" | "repeat-one";
type AppTheme = "light" | "pink" | "solarized-light" | "dark" | "rose-pine" | "coal";

const THEME_STORAGE_KEY = "devwannawave.theme";
const QUEUE_STORAGE_KEY = "devwannawave.queue";
const SIDEBAR_WIDTH_STORAGE_KEY = "devwannawave.sidebar-width";
const PLAYBACK_MODE_STORAGE_KEY = "devwannawave.playback-mode";
const WINDOW_STATE_STORAGE_KEY = "devwannawave.window-state";
const QUICK_SETUP_STORAGE_KEY = "devwannawave.quick-setup.v1";

const THEME_OPTIONS: Array<{
  description: string;
  label: string;
  theme: AppTheme;
  tone: "light" | "dark" | "coal";
}> = [
  { description: "plain paper, low contrast", label: "light", theme: "light", tone: "light" },
  { description: "warm soft pink", label: "pink", theme: "pink", tone: "light" },
  {
    description: "cream terminal palette",
    label: "solarized",
    theme: "solarized-light",
    tone: "light",
  },
  { description: "soft black, default", label: "dark", theme: "dark", tone: "dark" },
  { description: "muted violet dark", label: "rose pine", theme: "rose-pine", tone: "dark" },
  { description: "neutral grey-black", label: "coal", theme: "coal", tone: "coal" },
];

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

function Icon({ name, size = 18, className = "" }: { name: string; size?: 12 | 14 | 16 | 18 | 24; className?: string }) {
  const sizeClass = {
    12: "text-icon-12",
    14: "text-icon-14",
    16: "text-icon-16",
    18: "text-icon-18",
    24: "text-icon-24",
  }[size];

  return (
    <span className={`material-symbols-outlined ${sizeClass} ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

function PlayingEqualizer({ isPaused }: { isPaused: boolean }) {
  return (
    <div
      className="flex h-xs w-[12px] items-end gap-[2px] shrink-0"
      style={isPaused ? { opacity: 0.6 } : undefined}
    >
      <span
        className="w-[2px] bg-primary animate-equalizer-bar-1"
        style={isPaused ? { animationPlayState: "paused", height: "5px" } : { transformOrigin: "bottom" }}
      />
      <span
        className="w-[2px] bg-primary animate-equalizer-bar-2"
        style={isPaused ? { animationPlayState: "paused", height: "8px" } : { transformOrigin: "bottom" }}
      />
      <span
        className="w-[2px] bg-primary animate-equalizer-bar-3"
        style={isPaused ? { animationPlayState: "paused", height: "4px" } : { transformOrigin: "bottom" }}
      />
    </div>
  );
}

function DeterministicCoverArt({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const palettes = [
    ["#1a1b26", "#24283b"], // Tokyo Night dark forest/navy
    ["#11111b", "#181825"], // Catppuccin deep blue
    ["#18181b", "#27272a"], // Coal / Charcoal
    ["#2c1b24", "#3d2a35"], // Muted Cherry / Plum
    ["#1a231f", "#26352f"], // Forest Moss / Emerald
    ["#232136", "#393556"], // Warm Sand / Violet
    ["#1f1f28", "#2a2a37"], // Autumn Slate / Rust
  ];
  
  const paletteIndex = Math.abs(hash) % palettes.length;
  const [bg1, bg2] = palettes[paletteIndex];

  return (
    <div
      className="h-h-cover w-w-cover shrink-0 select-none border border-outline-variant bg-surface-container-lowest transition-all duration-300"
      style={{ background: `radial-gradient(circle at top left, ${bg2}, ${bg1})` }}
    />
  );
}

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredSidebarWidth());
  const [folderPath, setFolderPath] = useState("");
  const [filterFolderId, setFilterFolderId] = useState<number | null>(null);
  const [volumeGain, setVolumeGain] = useState(1.0);
  const [scanningFolderId, setScanningFolderId] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    scanned: number;
    added: number;
    currentFile: string;
  } | null>(null);
  const [missingTracks, setMissingTracks] = useState<Track[]>([]);
  const [hasCheckedHealth, setHasCheckedHealth] = useState(false);
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | undefined>(undefined);
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<number>>(new Set());
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenuState | null>(null);
  const [metadataEditTrackId, setMetadataEditTrackId] = useState<number | null>(null);
  const [playlistCreateRequest, setPlaylistCreateRequest] = useState<{
    trackId: number;
    initialName: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(() => !hasCompletedQuickSetup());
  const [view, setView] = useState<View>("all-tracks");
  const [queueOpen, setQueueOpen] = useState(false);
  const [queuedTracks, setQueuedTracks] = useState<QueueItem[]>(() => readStoredQueue());
  const [error, setError] = useState<string | null>(null);
  const [cliCommandStatus, setCliCommandStatus] = useState<CliCommandStatus | null>(null);
  const [isInstallingCliCommand, setIsInstallingCliCommand] = useState(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [importHint, setImportHint] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [volume, setVolumeState] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackDurationSeconds, setPlaybackDurationSeconds] = useState<number | undefined>();
  const [lastAutoNextTrackId, setLastAutoNextTrackId] = useState<number | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(() => readStoredPlaybackMode());
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme());
  // null = no dialog; number = track id whose file was not found
  const [fileNotFoundTrackId, setFileNotFoundTrackId] = useState<number | null>(null);
  const [shuffledTrackIds, setShuffledTrackIds] = useState<number[]>([]);
  const autoNextInFlightRef = useRef(false);
  const importHintTimeoutRef = useRef<number | null>(null);
  const scanSummaryTimeoutRef = useRef<number | null>(null);
  const trackSearchInputRef = useRef<HTMLInputElement>(null);
  const preMuteVolumeRef = useRef(1.0);
  // Stable ref to handlePathDrop so drag-drop listener never re-registers
  const handlePathDropRef = useRef<typeof handlePathDrop | null>(null);
  // Debounce timer for localStorage queue writes
  const queueSaveTimerRef = useRef<number | null>(null);
  const windowStateSaveTimerRef = useRef<number | null>(null);
  const lastStateUpdateRef = useRef({ elapsedMs: 0, timestamp: performance.now() });

  function updateAuthoritativeElapsed(ms: number) {
    setElapsedMs(ms);
    lastStateUpdateRef.current = {
      elapsedMs: ms,
      timestamp: performance.now(),
    };
  }

  // O(1) track lookup by id — recomputed only when tracks array changes
  const trackById = useMemo(
    () => new Map(tracks.map((t) => [t.id, t])),
    [tracks],
  );

  useEffect(() => {
    return () => {
      if (importHintTimeoutRef.current !== null) {
        window.clearTimeout(importHintTimeoutRef.current);
      }
      if (scanSummaryTimeoutRef.current !== null) {
        window.clearTimeout(scanSummaryTimeoutRef.current);
      }
    };
  }, []);

  // Debounce queue persistence — only write after 300ms of no changes
  useEffect(() => {
    if (queueSaveTimerRef.current !== null) {
      window.clearTimeout(queueSaveTimerRef.current);
    }
    queueSaveTimerRef.current = window.setTimeout(() => {
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queuedTracks));
      queueSaveTimerRef.current = null;
    }, 300);
  }, [queuedTracks]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, playbackMode);
  }, [playbackMode]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!scanSummary) {
      if (scanSummaryTimeoutRef.current !== null) {
        window.clearTimeout(scanSummaryTimeoutRef.current);
        scanSummaryTimeoutRef.current = null;
      }
      return;
    }

    if (scanSummaryTimeoutRef.current !== null) {
      window.clearTimeout(scanSummaryTimeoutRef.current);
    }
    scanSummaryTimeoutRef.current = window.setTimeout(() => {
      setScanSummary(null);
      scanSummaryTimeoutRef.current = null;
    }, 4200);

    return () => {
      if (scanSummaryTimeoutRef.current !== null) {
        window.clearTimeout(scanSummaryTimeoutRef.current);
        scanSummaryTimeoutRef.current = null;
      }
    };
  }, [scanSummary]);

  // Shuffle explicit queue when shuffle mode is enabled
  useEffect(() => {
    if (playbackMode === "shuffle") {
      setQueuedTracks((current) => shuffleArray(current));
    }
  }, [playbackMode]);

  // Maintain stable shuffled track deck for sequential shuffle traversal
  useEffect(() => {
    if (playbackMode === "shuffle") {
      setShuffledTrackIds((currentShuffled) => {
        const trackIds = tracks.map((t) => t.id);
        
        // If current shuffled deck is a valid subset of current track pool and contains current active track, keep it stable
        const isStillValid =
          trackIds.length > 0 &&
          currentShuffled.length > 0 &&
          currentShuffled.every((id) => trackIds.includes(id)) &&
          (currentTrackId == null || currentShuffled.includes(currentTrackId));

        if (isStillValid) {
          return currentShuffled;
        }

        const activeId = currentTrackId ?? selectedTrackId;
        if (activeId != null && trackIds.includes(activeId)) {
          const remaining = trackIds.filter((id) => id !== activeId);
          return [activeId, ...shuffleArray(remaining)];
        } else {
          return shuffleArray(trackIds);
        }
      });
    } else {
      setShuffledTrackIds([]);
    }
  }, [playbackMode, tracks, currentTrackId, selectedTrackId]);

  useEffect(() => {
    void loadLibrary();
    void refreshPlaybackState();
    void refreshCliCommandStatus();
  }, []);

  useEffect(() => {
    if (!isRunningInTauri()) return;

    let cancelled = false;
    void invoke<string[]>("take_pending_open_paths")
      .then((paths) => {
        if (cancelled || paths.length === 0) return;
        void openAudioPathsFromSystem(paths);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(toErrorMessage(caught));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isRunningInTauri()) return;

    let unlisten: (() => void) | undefined;
    void listen<string[]>("open_audio_paths", (event) => {
      if (event.payload.length === 0) return;
      void openAudioPathsFromSystem(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isRunningInTauri()) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    void (async () => {
      const storedState = readStoredWindowState();
      if (storedState) {
        await restoreWindowState(appWindow, storedState);
      }
      await waitForNextFrame();
      if (!disposed) {
        await appWindow.show().catch(() => {
          // Showing the window should not block app startup.
        });
      }
    })();

    const scheduleSave = () => {
      if (windowStateSaveTimerRef.current !== null) {
        window.clearTimeout(windowStateSaveTimerRef.current);
      }
      windowStateSaveTimerRef.current = window.setTimeout(() => {
        windowStateSaveTimerRef.current = null;
        void persistWindowState();
      }, 180);
    };

    const unlistenFns: Array<() => void> = [];
    void Promise.all([
      appWindow.onResized(scheduleSave),
      appWindow.onMoved(scheduleSave),
    ]).then((unlisteners) => {
      if (disposed) {
        for (const unlisten of unlisteners) {
          unlisten();
        }
        return;
      }
      unlistenFns.push(...unlisteners);
    });

    return () => {
      disposed = true;
      for (const unlisten of unlistenFns) {
        unlisten();
      }
      if (windowStateSaveTimerRef.current !== null) {
        window.clearTimeout(windowStateSaveTimerRef.current);
        windowStateSaveTimerRef.current = null;
      }
      void persistWindowState();
    };
  }, []);

  // O(1) queue cleanup using Map instead of O(n*m) Array.some
  useEffect(() => {
    setQueuedTracks((current) =>
      current.filter((item) => trackById.has(item.trackId)),
    );
  }, [trackById]);

  useEffect(() => {
    if (!isRunningInTauri()) return;

    // Subscribe to instant state-change events emitted by Rust
    let unlisten: (() => void) | undefined;
    void listen<PlaybackState>("playback_state_changed", (event) => {
      applyPlaybackState(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    // Keep a slow fallback poll (5 s) to handle edge cases like rodio
    // finishing a track naturally (which doesn't emit an event)
    const intervalId = window.setInterval(() => {
      void refreshPlaybackState();
    }, 5000);

    return () => {
      unlisten?.();
      window.clearInterval(intervalId);
    };
  }, []);

  // Register drag-drop listener only once; access latest handlePathDrop via ref
  useEffect(() => {
    handlePathDropRef.current = handlePathDrop;
  });

  useEffect(() => {
    if (!isRunningInTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over" || event.payload.type === "enter") {
          setDropTarget(readDropTarget(event.payload.position));
          return;
        }

        if (event.payload.type === "drop") {
          const target = readDropTarget(event.payload.position) ?? { type: "all-tracks" };
          setDropTarget(null);
          void handlePathDropRef.current?.(event.payload.paths, target);
          return;
        }

        setDropTarget(null);
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  // Empty deps: register once and use the stable ref for the latest handler
  }, []);

  // Stable refs for media keys and tray events to avoid stale closures
  const togglePlayPauseRef = useRef(togglePlayPause);
  const playRelativeTrackRef = useRef(playRelativeTrack);
  useEffect(() => {
    togglePlayPauseRef.current = togglePlayPause;
    playRelativeTrackRef.current = playRelativeTrack;
  });

  // Listen to tray and media key shortcuts
  useEffect(() => {
    if (!isRunningInTauri()) return;

    const unlisteners: Array<() => void> = [];

    const eventActions = [
      { name: "tray_play_pause", action: () => togglePlayPauseRef.current() },
      { name: "tray_next", action: () => playRelativeTrackRef.current(1) },
      { name: "tray_prev", action: () => playRelativeTrackRef.current(-1) },
      { name: "global_play_pause", action: () => togglePlayPauseRef.current() },
      { name: "global_next", action: () => playRelativeTrackRef.current(1) },
      { name: "global_prev", action: () => playRelativeTrackRef.current(-1) },
    ];

    void Promise.all(
      eventActions.map((ev) =>
        listen(ev.name, () => {
          ev.action();
        })
      )
    ).then((unlistenFns) => {
      unlisteners.push(...unlistenFns);
    });

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  // Listen to scan progress updates
  useEffect(() => {
    if (!isRunningInTauri()) return;

    let unlisten: (() => void) | undefined;
    void listen<{
      folder_id: number;
      scanned: number;
      added: number;
      current_file: string;
      is_done: boolean;
    }>("scan_progress", (event) => {
      const payload = event.payload;
      if (payload.is_done) {
        setScanProgress(null);
      } else {
        setScanProgress({
          scanned: payload.scanned,
          added: payload.added,
          currentFile: payload.current_file,
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Fetch cover art URL when current track changes
  useEffect(() => {
    if (currentTrackId == null) {
      setCurrentCoverUrl(undefined);
      return;
    }

    let active = true;
    void invoke<string | null>("get_track_cover_art", { trackId: currentTrackId })
      .then((art) => {
        if (active) {
          setCurrentCoverUrl(art ?? undefined);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch cover art", err);
        if (active) {
          setCurrentCoverUrl(undefined);
        }
      });

    return () => {
      active = false;
    };
  }, [currentTrackId]);

  // Show HTML5 Native OS Notification on track change
  useEffect(() => {
    if (currentTrackId == null || !currentTrack) return;

    if (typeof Notification !== "undefined") {
      const showNotification = () => {
        const body = `${currentTrack.title || currentTrack.fileName}${
          currentTrack.artist ? ` - ${currentTrack.artist}` : ""
        }`;
        new Notification("Now Playing", {
          body,
          icon: currentCoverUrl,
          silent: true,
        });
      };

      if (Notification.permission === "granted") {
        showNotification();
      } else if (Notification.permission !== "denied") {
        void Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            showNotification();
          }
        });
      }
    }
  }, [currentTrackId, currentCoverUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setView("all-tracks");
        window.requestAnimationFrame(() => trackSearchInputRef.current?.focus());
        return;
      }

      if (isInputTarget(event.target)) return;

      if (event.key === "/") {
        event.preventDefault();
        setView("all-tracks");
        window.requestAnimationFrame(() => trackSearchInputRef.current?.focus());
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayPause();
      } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
        event.preventDefault();
        void playRelativeTrack(1);
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "h") {
        event.preventDefault();
        void playRelativeTrack(-1);
      } else if (event.key === "Enter" && selectedTrackId !== null) {
        event.preventDefault();
        void playTrack(selectedTrackId);
      } else if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        if (selectedTrackId !== null) {
          addTrackToQueue(selectedTrackId);
        } else {
          setQueueOpen((prev) => !prev);
        }
      } else if (event.key === "Delete" && selectedTrackId !== null) {
        event.preventDefault();
        setHiddenTrackIds((current) => new Set(current).add(selectedTrackId));
      } else if (event.key === "+" || event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        void setVolume(volume + 0.1);
      } else if (event.key === "-" || event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        void setVolume(volume - 0.1);
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        if (volume > 0) {
          preMuteVolumeRef.current = volume;
          void setVolume(0);
        } else {
          void setVolume(preMuteVolumeRef.current || 1.0);
        }
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void stopPlayback();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTrackId, isPaused, selectedTrackId, tracks, volume]);

  useEffect(() => {
    const currentTrack = currentTrackId != null ? trackById.get(currentTrackId) : undefined;
    const durationSeconds = currentTrack?.durationSeconds ?? playbackDurationSeconds;
    if (
      !currentTrack ||
      isPaused ||
      lastAutoNextTrackId === currentTrack.id ||
      autoNextInFlightRef.current ||
      !durationSeconds ||
      durationSeconds <= 0
    ) {
      return;
    }

    const now = performance.now();
    const estimatedElapsedMs =
      lastStateUpdateRef.current.elapsedMs + (now - lastStateUpdateRef.current.timestamp);
    const remainingMs = durationSeconds * 1000 - estimatedElapsedMs - 250;

    const triggerAutoNext = () => {
      autoNextInFlightRef.current = true;
      setLastAutoNextTrackId(currentTrack.id);
      const next =
        playbackMode === "repeat-one" ? playTrack(currentTrack.id) : playRelativeTrack(1);
      void next.finally(() => {
        autoNextInFlightRef.current = false;
      });
    };

    if (remainingMs <= 0) {
      triggerAutoNext();
      return;
    }

    const timeoutId = window.setTimeout(triggerAutoNext, remainingMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    currentTrackId,
    isPaused,
    lastAutoNextTrackId,
    playbackMode,
    playbackDurationSeconds,
    trackById,
    queuedTracks,
    shuffledTrackIds,
    selectedTrackId,
    tracks,
  ]);

  async function loadLibrary() {
    if (!isRunningInTauri()) return;

    try {
      const library = await invoke<BackendLibrary>("get_library");
      const nextTracks = library.tracks.map(fromBackendTrack);
      setTracks(nextTracks);
      setFolders(fromBackendFolders(library.folders, nextTracks));
      setPlaylists(fromBackendPlaylists(library.playlists, nextTracks));
      setError(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function refreshPlaybackState() {
    if (!isRunningInTauri()) return;

    try {
      const playback = await invoke<PlaybackState>("get_playback_state");
      applyPlaybackState(playback);
    } catch {
      // Playback polling should stay quiet; explicit commands surface errors.
    }
  }

  async function refreshCliCommandStatus() {
    if (!isRunningInTauri()) return;

    try {
      const status = await invoke<CliCommandStatus>("get_cli_command_status");
      setCliCommandStatus(status);
    } catch {
      // Optional installer status should stay quiet.
    }
  }

  async function openAudioPathsFromSystem(paths: string[]) {
    if (!isRunningInTauri() || paths.length === 0) return;

    const invalidFolderPath = paths.find(
      (path) => !looksLikeAudioPath(path) && validateMusicFolderPath(path) != null,
    );
    if (invalidFolderPath) {
      setError(validateMusicFolderPath(invalidFolderPath));
      return;
    }

    setIsScanning(true);
    setError(null);
    try {
      const summary = await invoke<ImportSummary>("import_music_paths", { paths });
      setView("all-tracks");
      await loadLibrary();

      if (summary.track_ids.length > 0 && paths.some(looksLikeAudioPath)) {
        await playTrack(summary.track_ids[0]);
      }

      showImportHint(
        paths.length === 1 && looksLikeAudioPath(paths[0])
          ? `opened ${fileNameFromPath(paths[0])}`
          : formatImportHint(paths, summary, { type: "all-tracks" }),
      );
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setIsScanning(false);
    }
  }

  async function persistWindowState() {
    if (!isRunningInTauri()) return;

    try {
      const appWindow = getCurrentWindow();
      const [isMaximized, outerSize, outerPosition] = await Promise.all([
        appWindow.isMaximized(),
        appWindow.outerSize(),
        appWindow.outerPosition(),
      ]);

      const nextState: StoredWindowState = {
        isMaximized,
        width: outerSize.width,
        height: outerSize.height,
        x: outerPosition.x,
        y: outerPosition.y,
      };
      window.localStorage.setItem(WINDOW_STATE_STORAGE_KEY, JSON.stringify(nextState));
    } catch {
      // Persisting window state should stay silent.
    }
  }

  async function restoreWindowState(appWindow: ReturnType<typeof getCurrentWindow>, state: StoredWindowState) {
    try {
      const monitors = await availableMonitors();
      const monitor = findMonitorForWindowState(monitors, state) ?? (await primaryMonitor());
      const nextPosition = monitor ? clampWindowStateToMonitor(state, monitor) : state;

      await appWindow.setSize(new PhysicalSize(state.width, state.height));
      await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
      if (state.isMaximized) {
        await appWindow.maximize();
      }
    } catch {
      // Invalid persisted window coordinates should not block launch.
    }
  }

  async function cancelScanning() {
    if (scanningFolderId !== null) {
      try {
        await invoke("cancel_scan_music_folder", { folderId: scanningFolderId });
        setScanningFolderId(null);
        setScanProgress(null);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function addAndScanFolder(pathOverride?: string) {
    if (!isRunningInTauri()) {
      setError("open this in the Tauri app to scan local folders.");
      return false;
    }

    const targetPath = (pathOverride ?? folderPath).trim();
    if (!targetPath) {
      setError("pick a folder first.");
      return false;
    }

    const invalidReason = validateMusicFolderPath(targetPath);
    if (invalidReason) {
      setError(invalidReason);
      return false;
    }

    setIsScanning(true);
    setError(null);
    setScanSummary(null);

    try {
      const folder = await invoke<BackendFolder>("add_music_folder", { path: targetPath });
      setScanningFolderId(folder.id);
      
      const summary = await invoke<ScanSummary>("scan_music_folder", {
        folderId: folder.id,
      });
      
      const skipped = summary.scanned - summary.added - summary.errors;
      let summaryText = `Scanned ${summary.scanned} files / Added ${summary.added} new / Errors ${summary.errors}`;
      if (skipped > 0) {
        summaryText += ` / Warning: Skipped ${skipped} duplicate(s) already in library`;
      }
      
      setScanSummary(summaryText);
      setFolderPath("");
      await loadLibrary();
      return true;
    } catch (caught) {
      setError(toErrorMessage(caught));
      return false;
    } finally {
      setIsScanning(false);
      setScanningFolderId(null);
    }
  }

  async function toggleTrackLiked(trackId: number) {
    try {
      await invoke("toggle_track_liked", { trackId });
      await loadLibrary();
    } catch (err) {
      console.error(err);
    }
  }

  async function rescanFolder(folderId: number) {
    setIsScanning(true);
    setError(null);
    setScanSummary(null);
    setScanningFolderId(folderId);
    try {
      const summary = await invoke<ScanSummary>("scan_music_folder", { folderId });
      const skipped = summary.scanned - summary.added - summary.errors;
      let summaryText = `Scanned ${summary.scanned} files / Added ${summary.added} new / Errors ${summary.errors}`;
      if (skipped > 0) {
        summaryText += ` / Warning: Skipped ${skipped} duplicate(s) already in library`;
      }
      setScanSummary(summaryText);
      await loadLibrary();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setIsScanning(false);
      setScanningFolderId(null);
    }
  }

  async function toggleFolderPinned(folderId: number) {
    try {
      await invoke("toggle_folder_pinned", { folderId });
      await loadLibrary();
    } catch (err) {
      console.error(err);
    }
  }

  async function relinkFolder(folderId: number) {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose New Path for Folder",
      });
      if (selected && typeof selected === "string") {
        await invoke("relink_folder_path", { folderId, newPath: selected });
        await loadLibrary();
        showImportHint("Folder path relinked successfully.");
      }
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }

  async function relinkTrack(trackId: number) {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Relink Track File",
      });
      if (selected && typeof selected === "string") {
        await invoke("relink_track_path", { trackId, newPath: selected });
        await loadLibrary();
        showImportHint("Track file relinked successfully.");
      }
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }

  async function openFolderPicker() {
    if (!isRunningInTauri()) {
      setError("open this in the Tauri app to pick a local folder.");
      return false;
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose music folder",
      });
      if (typeof selected !== "string" || selected.trim() === "") {
        return false;
      }

      setFolderPath(selected);
      return await addAndScanFolder(selected);
    } catch (caught) {
      setError(toErrorMessage(caught));
      return false;
    }
  }

  async function playTrack(trackId: number) {
    if (!isRunningInTauri()) {
      setError("open this in the Tauri app to play local audio.");
      return;
    }

    try {
      const playback = await invoke<PlaybackState>("play_track", { trackId });
      applyPlaybackState(playback);
      setLastAutoNextTrackId(null);
      setSelectedTrackId(trackId);
      setError(null);
    } catch (caught) {
      const msg = toErrorMessage(caught);
      // Rust signals a missing file with a "file_not_found:" prefix
      if (msg.startsWith("file_not_found:")) {
        setFileNotFoundTrackId(trackId);
      } else {
        setError(msg);
      }
    }
  }

  async function playRelativeTrack(direction: -1 | 1) {
    if (tracks.length === 0) return;

    const baseTrackId = currentTrackId ?? selectedTrackId ?? tracks[0]?.id;
    const currentIndex = tracks.findIndex((track) => track.id === baseTrackId);
    if (direction === 1 && queuedTracks.length > 0) {
      const [nextQueuedItem, ...remainingQueuedTracks] = queuedTracks;
      setQueuedTracks(remainingQueuedTracks);
      await playTrack(nextQueuedItem.trackId);
      return;
    }

    if (playbackMode === "shuffle" && shuffledTrackIds.length > 1) {
      const currentIndexInShuffle = shuffledTrackIds.indexOf(baseTrackId);
      if (currentIndexInShuffle !== -1) {
        const nextIndex =
          (currentIndexInShuffle + direction + shuffledTrackIds.length) %
          shuffledTrackIds.length;
        const nextTrackId = shuffledTrackIds[nextIndex];
        await playTrack(nextTrackId);
        return;
      }
    }

    if (playbackMode === "normal" && direction === 1 && currentIndex === tracks.length - 1) {
      await stopPlayback();
      return;
    }

    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + direction + tracks.length) % tracks.length;
    const nextTrack = tracks[nextIndex];
    if (nextTrack) await playTrack(nextTrack.id);
  }

  function addTrackToQueue(trackId: number) {
    const track = tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;

    setQueuedTracks((current) => [
      ...current,
      { id: `${trackId}-${Math.random()}-${Date.now()}`, trackId },
    ]);
    setQueueOpen(true);
    showImportHint(`queued ${track.title || track.fileName}`);
  }

  function playNext(trackId: number) {
    const track = tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;

    setQueuedTracks((current) => [
      { id: `${trackId}-${Math.random()}-${Date.now()}`, trackId },
      ...current,
    ]);
    showImportHint(`play next: ${track.title || track.fileName}`);
  }

  function removeTrackFromQueue(queueItemId: string) {
    setQueuedTracks((current) => current.filter((item) => item.id !== queueItemId));
  }

  function reorderQueue(fromIndex: number, toIndex: number) {
    const explicitCount = queuedTracks.length;

    // 1. Check if we are reordering entirely within the explicit queue
    if (fromIndex < explicitCount && toIndex < explicitCount) {
      setQueuedTracks((current) => {
        const next = [...current];
        const [removed] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, removed);
        return next;
      });
      return;
    }

    // 2. Check if we are reordering entirely within the shuffle deck
    if (playbackMode === "shuffle" && fromIndex >= explicitCount && toIndex >= explicitCount) {
      const fallbackFrom = fromIndex - explicitCount;
      const fallbackTo = toIndex - explicitCount;
      reorderShuffleDeck(fallbackFrom, fallbackTo);
      return;
    }

    // 3. Otherwise, crossing boundaries: promoting fallback tracks to explicit
    const explicitIds = queuedTracks.map((item) => item.trackId);
    let fallbackIds: number[] = [];
    if (playbackMode === "shuffle") {
      const currentIdx = shuffledTrackIds.indexOf(currentTrackId ?? -1);
      const startIdx = currentIdx !== -1 ? currentIdx + 1 : 0;
      fallbackIds = shuffledTrackIds.slice(startIdx);
    } else {
      const currentIdx = tracks.findIndex((t) => t.id === currentTrackId);
      const startIdx = currentIdx !== -1 ? currentIdx + 1 : 0;
      fallbackIds = tracks.slice(startIdx, startIdx + 50).map((t) => t.id);
    }

    const unifiedIds = [...explicitIds, ...fallbackIds];

    if (fromIndex < 0 || fromIndex >= unifiedIds.length || toIndex < 0 || toIndex >= unifiedIds.length) {
      return;
    }
    const [removedId] = unifiedIds.splice(fromIndex, 1);
    unifiedIds.splice(toIndex, 0, removedId);

    const newExplicitCount = Math.max(explicitCount, fromIndex + 1, toIndex + 1);
    const newExplicitIds = unifiedIds.slice(0, newExplicitCount);

    setQueuedTracks(
      newExplicitIds.map((trackId) => ({
        id: `${trackId}-${Math.random()}-${Date.now()}`,
        trackId,
      }))
    );

    if (playbackMode === "shuffle") {
      const currentIdx = shuffledTrackIds.indexOf(currentTrackId ?? -1);
      const startIdx = currentIdx !== -1 ? currentIdx + 1 : 0;
      const newFallbackIds = unifiedIds.slice(newExplicitCount);
      setShuffledTrackIds((current) => {
        const next = [...current];
        next.splice(startIdx, next.length - startIdx, ...newFallbackIds);
        return next;
      });
    }
  }

  async function playQueueItem(queueItemId: string) {
    const index = queuedTracks.findIndex((item) => item.id === queueItemId);
    if (index === -1) return;

    const targetItem = queuedTracks[index];
    const remaining = queuedTracks.slice(index + 1);
    setQueuedTracks(remaining);
    await playTrack(targetItem.trackId);
  }

  function reorderShuffleDeck(fromIndex: number, toIndex: number) {
    setShuffledTrackIds((current) => {
      const next = [...current];
      const currentIdx = next.indexOf(currentTrackId ?? -1);
      const startIdx = currentIdx !== -1 ? currentIdx + 1 : 0;

      const actualFrom = startIdx + fromIndex;
      const actualTo = startIdx + toIndex;

      if (actualFrom >= 0 && actualFrom < next.length && actualTo >= 0 && actualTo < next.length) {
        const [removed] = next.splice(actualFrom, 1);
        next.splice(actualTo, 0, removed);
      }
      return next;
    });
  }

  function removeFromShuffleDeck(trackId: number) {
    setShuffledTrackIds((current) => current.filter((id) => id !== trackId));
  }

  async function togglePlayPause() {
    if (currentTrackId) {
      try {
        const playback = await invoke<PlaybackState>(
          isPaused ? "resume_playback" : "pause_playback",
        );
        applyPlaybackState(playback);
        setError(null);
      } catch (caught) {
        setError(toErrorMessage(caught));
      }
    } else {
      const targetId = selectedTrackId ?? tracks[0]?.id;
      if (targetId != null) {
        await playTrack(targetId);
      }
    }
  }

  async function stopPlayback() {
    try {
      const playback = await invoke<PlaybackState>("stop_playback");
      applyPlaybackState(playback);
      setError(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function seekPlayback(nextElapsedMs: number) {
    const currentTrack = tracks.find((track) => track.id === currentTrackId);
    const durationMs =
      (currentTrack?.durationSeconds ?? playbackDurationSeconds ?? 0) * 1000;
    const clampedElapsedMs =
      durationMs > 0
        ? Math.max(0, Math.min(durationMs, nextElapsedMs))
        : Math.max(0, nextElapsedMs);

    if (!isRunningInTauri()) {
      updateAuthoritativeElapsed(clampedElapsedMs);
      return;
    }

    try {
      const playback = await invoke<PlaybackState>("seek_playback", {
        elapsedMs: Math.round(clampedElapsedMs),
      });
      applyPlaybackState(playback);
      if (!durationMs || clampedElapsedMs < durationMs - 500) {
        setLastAutoNextTrackId(null);
      }
      setError(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function setVolume(volumeValue: number) {
    if (!isRunningInTauri()) {
      setVolumeState(clampVolume(volumeValue));
      return;
    }

    try {
      const playback = await invoke<PlaybackState>("set_volume", {
        volume: clampVolume(volumeValue),
      });
      applyPlaybackState(playback);
      setError(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  async function handlePathDrop(paths: string[], target: DropTarget | null) {
    if (!target || paths.length === 0) return;

    const invalidFolder = paths.find((path) => validateMusicFolderPath(path) != null);
    if (invalidFolder) {
      setError(validateMusicFolderPath(invalidFolder));
      return;
    }

    setIsScanning(true);
    try {
      const summary = await invoke<ImportSummary>("import_music_paths", { paths });
      if (target.type === "playlist") {
        for (const trackId of summary.track_ids) {
          await invoke("add_track_to_playlist", {
            playlistId: target.playlistId,
            trackId,
          });
        }
      }

      setScanSummary(
        target.type === "playlist"
          ? `dropped ${summary.track_ids.length} tracks to playlist.`
          : summary.added > 0 || summary.existing > 0
            ? `added ${summary.added}, already in library ${summary.existing}.`
            : `scanned ${summary.scanned}, errors ${summary.errors}.`,
      );
      showImportHint(formatImportHint(paths, summary, target));
      setError(null);
      await loadLibrary();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setIsScanning(false);
    }
  }

  async function installCliCommand() {
    if (!isRunningInTauri() || isInstallingCliCommand) return;

    setIsInstallingCliCommand(true);
    try {
      const status = await invoke<CliCommandStatus>("install_cli_command");
      setCliCommandStatus(status);
      setError(null);
      showImportHint("installed dww command");
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setIsInstallingCliCommand(false);
    }
  }

  function showImportHint(message: string) {
    if (importHintTimeoutRef.current !== null) {
      window.clearTimeout(importHintTimeoutRef.current);
    }

    setImportHint(message);
    importHintTimeoutRef.current = window.setTimeout(() => {
      setImportHint(null);
      importHintTimeoutRef.current = null;
    }, 2600);
  }

  function completeQuickSetup() {
    window.localStorage.setItem(QUICK_SETUP_STORAGE_KEY, "done");
    setQuickSetupOpen(false);
  }

  function applyPlaybackState(playback: PlaybackState) {
    setCurrentTrackId(playback.current_track_id);
    setIsPaused(playback.is_paused);
    setVolumeState(playback.volume);
    updateAuthoritativeElapsed(playback.elapsed_ms);
    setPlaybackDurationSeconds(playback.duration_seconds ?? undefined);
    if (playback.gain !== undefined) {
      setVolumeGain(playback.gain);
    }
  }

  // O(1) current track lookup using pre-built Map
  const currentTrack = currentTrackId != null ? trackById.get(currentTrackId) : undefined;

  return (
    <main
      className={[
        `theme-${theme}`,
        "h-full bg-background text-body-md text-on-surface",
        isLinuxDesktop() ? "dwt-platform-linux" : "",
      ].join(" ")}
    >
      <div className="dwt-window relative flex h-full flex-col bg-background">
        {dropTarget ? <DropOverlay target={dropTarget} /> : null}
        {importHint ? <ImportHint message={importHint} /> : null}
        {quickSetupOpen ? (
          <QuickSetupDialog
            cliCommandStatus={cliCommandStatus}
            error={error}
            isInstallingCliCommand={isInstallingCliCommand}
            isScanning={isScanning}
            theme={theme}
            onComplete={completeQuickSetup}
            onInstallCliCommand={installCliCommand}
            onOpenFolderPicker={openFolderPicker}
            onAddFolderWithPath={addAndScanFolder}
            onThemeChange={setTheme}
          />
        ) : null}
        {fileNotFoundTrackId != null ? (
          <FileNotFoundDialog
            track={trackById.get(fileNotFoundTrackId)}
            onRemove={async () => {
              await invoke("remove_track", { trackId: fileNotFoundTrackId });
              setFileNotFoundTrackId(null);
              await loadLibrary();
            }}
            onDismiss={() => setFileNotFoundTrackId(null)}
          />
        ) : null}
        {trackContextMenu ? (
          <TrackContextMenu
            menu={trackContextMenu}
            playlists={playlists}
        track={trackContextMenu != null ? trackById.get(trackContextMenu.trackId) : undefined}
            onAddToPlaylist={async (playlistId) => {
              await invoke("add_track_to_playlist", {
                playlistId,
                trackId: trackContextMenu.trackId,
              });
              await loadLibrary();
              setTrackContextMenu(null);
            }}
            onAddToQueue={() => {
              addTrackToQueue(trackContextMenu.trackId);
              setTrackContextMenu(null);
            }}
            onPlayNext={() => {
              playNext(trackContextMenu.trackId);
              setTrackContextMenu(null);
            }}
            onClose={() => setTrackContextMenu(null)}
            onCreatePlaylist={(initialName) => {
              setPlaylistCreateRequest({ trackId: trackContextMenu.trackId, initialName });
              setTrackContextMenu(null);
            }}
            onEditMetadata={() => {
              setMetadataEditTrackId(trackContextMenu.trackId);
              setTrackContextMenu(null);
            }}
            onHideTrack={() => {
              setHiddenTrackIds((current) => new Set(current).add(trackContextMenu.trackId));
              setTrackContextMenu(null);
            }}
            onPlay={() => {
              void playTrack(trackContextMenu.trackId);
              setTrackContextMenu(null);
            }}
          />
        ) : null}
        <TopAppBar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        />
        <div className="flex min-h-0 flex-1">
          <SideNav
            collapsed={sidebarCollapsed}
            width={sidebarWidth}
            view={view}
            onResize={setSidebarWidth}
            onViewChange={(v) => {
              setView(v);
              if (v !== "all-tracks") {
                setFilterFolderId(null);
              }
            }}
            playlists={playlists}
            folders={folders}
            onSelectPlaylist={(playlistId) => {
              setView("playlists");
              void playlistId; // PlaylistsView manages its own selected state
            }}
            onSelectFolder={(folderId) => {
              setView("all-tracks");
              setFilterFolderId(folderId);
            }}
          />
          <section className="flex min-w-0 flex-1 flex-col">
            {view === "all-tracks" && (
              <AllTracksView
                folderPath={folderPath}
                onFolderPathChange={setFolderPath}
                onAddFolder={addAndScanFolder}
                onOpenFolderPicker={openFolderPicker}
                searchInputRef={trackSearchInputRef}
                selectedTrackId={selectedTrackId}
                onSelectTrack={setSelectedTrackId}
                currentTrackId={currentTrackId}
                onPlayTrack={playTrack}
                onAddToQueue={addTrackToQueue}
                onPlayNext={playNext}
                playlists={playlists}
                tracks={tracks
                  .filter((track) => !hiddenTrackIds.has(track.id))
                  .filter((track) => filterFolderId === null || track.folderId === filterFolderId)
                }
                error={error}
                isScanning={isScanning}
                scanSummary={scanSummary}
                scanProgress={scanProgress}
                onCancelScan={cancelScanning}
                onAddTrackToPlaylist={async (trackId, playlistId) => {
                  await invoke("add_track_to_playlist", { trackId, playlistId });
                  await loadLibrary();
                }}
                onCreatePlaylistForTrack={(trackId, initialName) =>
                  setPlaylistCreateRequest({ trackId, initialName })
                }
                onEditTrackMetadata={(trackId) => setMetadataEditTrackId(trackId)}
                onHideTrack={(trackId) =>
                  setHiddenTrackIds((current) => new Set(current).add(trackId))
                }
                onToggleLiked={toggleTrackLiked}
                filterFolderId={filterFolderId}
                onClearFolderFilter={() => setFilterFolderId(null)}
                folders={folders}
                isPaused={isPaused}
              />
            )}
            {view === "liked" && (
              <AllTracksView
                folderPath={folderPath}
                onFolderPathChange={setFolderPath}
                onAddFolder={addAndScanFolder}
                onOpenFolderPicker={openFolderPicker}
                searchInputRef={trackSearchInputRef}
                selectedTrackId={selectedTrackId}
                onSelectTrack={setSelectedTrackId}
                currentTrackId={currentTrackId}
                onPlayTrack={playTrack}
                onAddToQueue={addTrackToQueue}
                onPlayNext={playNext}
                playlists={playlists}
                tracks={tracks.filter((track) => !hiddenTrackIds.has(track.id) && track.liked)}
                error={error}
                isScanning={isScanning}
                scanSummary={scanSummary}
                scanProgress={scanProgress}
                onCancelScan={cancelScanning}
                onAddTrackToPlaylist={async (trackId, playlistId) => {
                  await invoke("add_track_to_playlist", { trackId, playlistId });
                  await loadLibrary();
                }}
                onCreatePlaylistForTrack={(trackId, initialName) =>
                  setPlaylistCreateRequest({ trackId, initialName })
                }
                onEditTrackMetadata={(trackId) => setMetadataEditTrackId(trackId)}
                onHideTrack={(trackId) =>
                  setHiddenTrackIds((current) => new Set(current).add(trackId))
                }
                onToggleLiked={toggleTrackLiked}
                isLikedView={true}
                isPaused={isPaused}
              />
            )}
            {view === "albums" && (
              <AlbumsView
                albums={buildAlbums(tracks)}
                currentTrackId={currentTrackId}
                onTrackContextMenu={(trackId, x, y) => setTrackContextMenu({ trackId, x, y })}
                onPlayTrack={(trackId) => void playTrack(trackId)}
                isPaused={isPaused}
              />
            )}
            {view === "artists" && (
              <ArtistsView
                artists={buildArtists(tracks)}
                currentTrackId={currentTrackId}
                onTrackContextMenu={(trackId, x, y) => setTrackContextMenu({ trackId, x, y })}
                onPlayTrack={(trackId) => void playTrack(trackId)}
                isPaused={isPaused}
              />
            )}
            {view === "playlists" && (
              <PlaylistsView
                currentTrackId={currentTrackId}
                playlists={playlists}
                selectedTrackId={selectedTrackId}
                tracks={tracks}
                onChanged={() => void loadLibrary()}
                onTrackContextMenu={(trackId, x, y) => setTrackContextMenu({ trackId, x, y })}
                onPlayTrack={(trackId) => void playTrack(trackId)}
                isPaused={isPaused}
              />
            )}
          </section>
        </div>
        <QueuePanel
          currentTrackId={currentTrackId}
          open={queueOpen}
          queuedTracks={queuedTracks}
          tracks={tracks}
          shuffledTrackIds={shuffledTrackIds}
          playbackMode={playbackMode}
          onClose={() => setQueueOpen(false)}
          onTrackContextMenu={(trackId, x, y) => setTrackContextMenu({ trackId, x, y })}
          onPlayTrack={(trackId) => void playTrack(trackId)}
          onPlayQueueItem={(queueItemId) => void playQueueItem(queueItemId)}
          onRemoveQueueItem={removeTrackFromQueue}
          onReorderQueue={reorderQueue}
          onRemoveFromShuffleDeck={removeFromShuffleDeck}
          onClearQueue={() => setQueuedTracks([])}
          isPaused={isPaused}
        />
        {playlistCreateRequest ? (
          <CreatePlaylistDialog
            initialName={playlistCreateRequest.initialName}
            onCancel={() => setPlaylistCreateRequest(null)}
            onCreate={async (name) => {
              const playlist = await invoke<BackendPlaylist>("create_playlist", { name });
              await invoke("add_track_to_playlist", {
                playlistId: playlist.id,
                trackId: playlistCreateRequest.trackId,
              });
              setPlaylistCreateRequest(null);
              await loadLibrary();
            }}
          />
        ) : null}
        {metadataEditTrackId ? (
          <TrackMetadataDialog
            track={tracks.find((track) => track.id === metadataEditTrackId)}
            onCancel={() => setMetadataEditTrackId(null)}
            onSave={async (value) => {
              await invoke("update_track_metadata", {
                trackId: metadataEditTrackId,
                title: value.title,
                artist: value.artist,
                album: value.album,
              });
              setMetadataEditTrackId(null);
              await loadLibrary();
            }}
          />
        ) : null}
        {settingsOpen ? (
          <SettingsDialog
            folders={folders}
            cliCommandStatus={cliCommandStatus}
            isInstallingCliCommand={isInstallingCliCommand}
            onClearHiddenTracks={() => setHiddenTrackIds(new Set())}
            onClearQueue={() => setQueuedTracks([])}
            onInstallCliCommand={installCliCommand}
            playbackMode={playbackMode}
            sidebarWidth={sidebarWidth}
            onPlaybackModeChange={setPlaybackMode}
            onSidebarWidthChange={setSidebarWidth}
            onOpenQuickSetup={() => {
              setSettingsOpen(false);
              setQuickSetupOpen(true);
            }}
            theme={theme}
            volume={volume}
            volumeGain={volumeGain}
            onVolumeGainChange={async (gain) => {
              try {
                await invoke("set_volume_gain", { gain });
                setVolumeGain(gain);
              } catch (err) {
                console.error(err);
              }
            }}
            onScanFolder={rescanFolder}
            onToggleFolderPinned={toggleFolderPinned}
            onRelinkFolder={relinkFolder}
            onRelinkTrack={relinkTrack}
            onLibraryChanged={loadLibrary}
            missingTracks={missingTracks}
            setMissingTracks={setMissingTracks}
            hasCheckedHealth={hasCheckedHealth}
            setHasCheckedHealth={setHasCheckedHealth}
            showImportHint={showImportHint}
            setError={setError}
            onClose={() => setSettingsOpen(false)}
            onThemeChange={setTheme}
          />
        ) : null}
        {shortcutsOpen ? (
          <ShortcutsHud onClose={() => setShortcutsOpen(false)} />
        ) : null}
        <NowPlayingBar
          currentTrack={currentTrack}
          playbackDurationSeconds={playbackDurationSeconds}
          isPaused={isPaused}
          playbackMode={playbackMode}
          volume={volume}
          authoritativeElapsedMs={elapsedMs}
          onNext={() => void playRelativeTrack(1)}
          onPrevious={() => void playRelativeTrack(-1)}
          onQueueToggle={() => setQueueOpen((value) => !value)}
          onPlaybackModeChange={setPlaybackMode}
          onSeek={(nextElapsedMs) => void seekPlayback(nextElapsedMs)}
          onStop={() => void stopPlayback()}
          onTogglePlayPause={() => void togglePlayPause()}
          onVolumeChange={(value) => void setVolume(value)}
        />
      </div>
    </main>
  );
}

function TopAppBar({
  onOpenSettings,
  onOpenShortcuts,
  onToggleSidebar,
}: {
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onToggleSidebar: () => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isRunningInTauri()) return;

    const appWindow = getCurrentWindow();
    void appWindow.isMaximized().then(setIsMaximized).catch(() => setIsMaximized(false));
  }, []);

  async function startWindowDrag(event: ReactMouseEvent<HTMLElement>) {
    if (!isRunningInTauri() || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".no-drag")) return;

    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Best-effort fallback for Linux custom title bars.
    }
  }

  async function runWindowAction(action: "minimize" | "toggleMaximize" | "close") {
    if (!isRunningInTauri()) return;
    const appWindow = getCurrentWindow();
    try {
      if (action === "minimize") {
        await appWindow.minimize();
        return;
      }

      if (action === "toggleMaximize") {
        await appWindow.toggleMaximize();
        setIsMaximized(await appWindow.isMaximized());
        return;
      }

      await appWindow.close();
    } catch (caught) {
      console.error("window action failed", caught);
    }
  }

  return (
    <header
      className="drag-region flex h-h-bar shrink-0 items-center border-b border-surface-container-high bg-surface-container-low px-lg"
      data-tauri-drag-region
      onMouseDown={(event) => void startWindowDrag(event)}
    >
      <button
        aria-label="toggle sidebar"
        className="no-drag grid h-h-row w-h-row place-items-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        type="button"
        onClick={onToggleSidebar}
      >
        <Icon name="menu" />
      </button>
      <span className="ml-md text-body-md text-on-surface" data-tauri-drag-region>
        devwannawave
      </span>
      <div className="min-w-md flex-1" data-tauri-drag-region />
      <button
        aria-label="open keyboard shortcuts"
        className="no-drag flex h-h-row items-center gap-xs px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        type="button"
        onClick={onOpenShortcuts}
      >
        <Icon name="keyboard" size={16} />
        <span>shortcuts</span>
      </button>
      <button
        aria-label="open settings"
        className="no-drag flex h-h-row items-center gap-xs px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        type="button"
        onClick={onOpenSettings}
      >
        <Icon name="settings" size={16} />
        <span>settings</span>
      </button>
      <WindowControls isMaximized={isMaximized} onWindowAction={runWindowAction} />
    </header>
  );
}

function WindowControls({
  isMaximized,
  onWindowAction,
}: {
  isMaximized: boolean;
  onWindowAction: (action: "minimize" | "toggleMaximize" | "close") => void;
}) {
  const controls: Array<{
    icon: string;
    label: string;
    action: "minimize" | "toggleMaximize" | "close";
  }> = [
    { icon: "minimize", label: "minimize window", action: "minimize" },
    {
      icon: isMaximized ? "filter_none" : "crop_square",
      label: isMaximized ? "restore window" : "maximize window",
      action: "toggleMaximize",
    },
    { icon: "close", label: "close window", action: "close" },
  ];

  return (
    <div className="no-drag ml-sm flex items-center">
      {controls.map((control) => (
        <button
          key={control.action}
          aria-label={control.label}
          className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          type="button"
          onClick={() => void onWindowAction(control.action)}
        >
          <Icon name={control.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

function QuickSetupDialog({
  cliCommandStatus,
  error,
  isInstallingCliCommand,
  isScanning,
  theme,
  onInstallCliCommand,
  onComplete,
  onOpenFolderPicker,
  onAddFolderWithPath,
  onThemeChange,
}: {
  cliCommandStatus: CliCommandStatus | null;
  error: string | null;
  isInstallingCliCommand: boolean;
  isScanning: boolean;
  theme: AppTheme;
  onInstallCliCommand: () => Promise<void>;
  onComplete: () => void;
  onOpenFolderPicker: () => Promise<boolean>;
  onAddFolderWithPath: (path: string) => Promise<boolean>;
  onThemeChange: (theme: AppTheme) => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [testPlaying, setTestPlaying] = useState(false);

  useEffect(() => {
    if (isRunningInTauri()) {
      invoke<string[]>("get_system_music_folders")
        .then(setSuggestions)
        .catch(console.error);
    }
  }, []);

  function completeAndClose() {
    setIsClosing(true);
    window.setTimeout(onComplete, 180);
  }

  async function handlePickFolder() {
    const didImport = await onOpenFolderPicker();
    if (didImport) {
      completeAndClose();
    }
  }

  async function handleSelectSuggestion(path: string) {
    const didImport = await onAddFolderWithPath(path);
    if (didImport) {
      completeAndClose();
    }
  }

  async function handlePlayTestSound() {
    if (!isRunningInTauri()) return;
    try {
      setTestPlaying(true);
      await invoke("play_test_sound");
      window.setTimeout(() => setTestPlaying(false), 1500);
    } catch (e) {
      console.error(e);
      setTestPlaying(false);
    }
  }

  return (
    <div
      className={[
        "wave-dim-layer absolute inset-0 z-45 grid place-items-center",
        isClosing ? "wave-overlay-exit" : "",
      ].join(" ")}
    >
      <section
        aria-label="quick setup"
        className={[
          "wave-dialog-panel w-[520px] max-w-[calc(100vw-32px)] border border-outline-variant bg-surface-container-low",
          isClosing ? "wave-popover-exit" : "",
        ].join(" ")}
      >
        <header className="flex items-start justify-between gap-md border-b border-surface-container-high px-lg py-md">
          <div className="min-w-0">
            <div className="mb-xs text-label-caps uppercase text-on-surface-variant">quick setup</div>
            <h2 className="m-0 text-headline font-semibold text-on-surface">set the mood, then pick your music</h2>
            <p className="mb-0 mt-xs text-body-sm text-on-surface-variant">
              choose a theme and start with a music folder. avoid scanning a whole drive like
              {" "}
              <span className="text-on-surface">{`C:\\`}</span>
              {" "}
              or
              {" "}
              <span className="text-on-surface">{`D:\\`}</span>
              .
            </p>
          </div>
          <button
            className="h-h-row shrink-0 border border-outline-variant px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={completeAndClose}
          >
            skip
          </button>
        </header>
        <div className="p-lg">
          <div className="mb-sm text-label-caps uppercase text-on-surface-variant">theme</div>
          <div className="grid gap-xs border border-outline-variant">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.theme}
                className={[
                  "grid h-h-row w-full grid-cols-[32px_minmax(0,1fr)_64px_24px] items-center border-b border-outline-variant px-md text-left text-body-sm last:border-b-0 hover:bg-surface-container-high",
                  option.theme === theme ? "bg-surface-variant text-primary" : "text-on-surface-variant",
                ].join(" ")}
                type="button"
                onClick={() => onThemeChange(option.theme)}
              >
                <ThemeSwatch theme={option.theme} />
                <span className="truncate text-on-surface">{option.label}</span>
                <span className="text-label uppercase tracking-[0.12em]">{option.tone}</span>
                {option.theme === theme ? <Icon name="check" size={16} /> : null}
              </button>
            ))}
          </div>

          <div className="mb-sm mt-lg text-label-caps uppercase text-on-surface-variant">library & sound</div>
          <div className="border border-outline-variant p-md">
            <p className="m-0 text-body-sm text-on-surface-variant">
              pick your main music folder first. you can add more folders later from
              {" "}
              <span className="text-on-surface">all tracks</span>
              .
            </p>
            
            {suggestions.length > 0 && (
              <div className="mt-sm flex flex-col gap-xs">
                <span className="text-body-xs text-on-surface-variant font-medium">SUGGESTED MUSIC DIRECTORIES:</span>
                <div className="flex flex-wrap gap-xs">
                  {suggestions.map((path) => (
                    <button
                      key={path}
                      className="flex items-center gap-xs rounded bg-surface-container-high hover:bg-surface-container-highest px-xs py-xxs text-body-xs text-on-surface text-left border border-outline-variant/50 max-w-full truncate"
                      title={path}
                      disabled={isScanning}
                      type="button"
                      onClick={() => void handleSelectSuggestion(path)}
                    >
                      <Icon name="folder" size={12} />
                      <span className="truncate">{path.split(/[\\/]/).pop() || path}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-md flex items-center justify-between gap-sm">
              <div className="flex items-center gap-sm">
                <button
                  className="h-h-row border border-primary px-md text-body-sm text-primary hover:bg-surface-variant hover:text-on-surface disabled:opacity-50"
                  disabled={isScanning}
                  type="button"
                  onClick={() => {
                    void handlePickFolder();
                  }}
                >
                  {isScanning ? "scanning..." : "choose music folder"}
                </button>
                <button
                  className="h-h-row border border-outline-variant px-md text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  type="button"
                  onClick={completeAndClose}
                >
                  finish later
                </button>
              </div>

              <button
                className={[
                  "h-h-row border px-md text-body-sm flex items-center gap-xs transition-all",
                  testPlaying 
                    ? "border-primary bg-primary/10 text-primary font-bold animate-pulse" 
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                ].join(" ")}
                type="button"
                onClick={handlePlayTestSound}
              >
                <Icon name={testPlaying ? "volume_up" : "music_note"} size={16} />
                <span>{testPlaying ? "playing chime..." : "test sound"}</span>
              </button>
            </div>
            {error ? <p className="mb-0 mt-sm text-body-sm text-error">{error}</p> : null}
          </div>

          {!isWindowsDesktop() ? (
            <>
              <div className="mb-sm mt-lg text-label-caps uppercase text-on-surface-variant">
                terminal
              </div>
              <div className="border border-outline-variant p-md">
                <p className="m-0 text-body-sm text-on-surface-variant">
                  install
                  {" "}
                  <span className="text-on-surface">dww</span>
                  {" "}
                  so you can launch the app from a terminal.
                </p>
                <div className="mt-md flex items-center gap-sm">
                  <button
                    className="h-h-row border border-outline-variant px-md text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
                    disabled={isInstallingCliCommand || cliCommandStatus?.installed === true}
                    type="button"
                    onClick={() => {
                      void onInstallCliCommand();
                    }}
                  >
                    {cliCommandStatus?.installed
                      ? "dww ready"
                      : isInstallingCliCommand
                        ? "installing..."
                        : "install dww"}
                  </button>
                  {cliCommandStatus?.location ? (
                    <span className="truncate text-body-sm text-on-surface-variant">
                      {cliCommandStatus.location}
                    </span>
                  ) : null}
                </div>
                {cliCommandStatus?.reachable_hint ? (
                  <p className="mb-0 mt-sm text-body-sm text-on-surface-variant">
                    {cliCommandStatus.reachable_hint}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  cliCommandStatus,
  folders,
  isInstallingCliCommand,
  onClearHiddenTracks,
  onClearQueue,
  onClose,
  onInstallCliCommand,
  onOpenQuickSetup,
  onThemeChange,
  onPlaybackModeChange,
  onSidebarWidthChange,
  playbackMode,
  sidebarWidth,
  theme,
  volume,
  volumeGain,
  onVolumeGainChange,
  onScanFolder,
  onToggleFolderPinned,
  onRelinkFolder,
  onRelinkTrack,
  onLibraryChanged,
  missingTracks,
  setMissingTracks,
  hasCheckedHealth,
  setHasCheckedHealth,
  showImportHint,
  setError,
}: {
  cliCommandStatus: CliCommandStatus | null;
  folders: Folder[];
  isInstallingCliCommand: boolean;
  onClearHiddenTracks: () => void;
  onClearQueue: () => void;
  onClose: () => void;
  onInstallCliCommand: () => Promise<void>;
  onOpenQuickSetup: () => void;
  onThemeChange: (theme: AppTheme) => void;
  onPlaybackModeChange: (mode: PlaybackMode) => void;
  onSidebarWidthChange: (width: number) => void;
  playbackMode: PlaybackMode;
  sidebarWidth: number;
  theme: AppTheme;
  volume: number;
  volumeGain: number;
  onVolumeGainChange: (gain: number) => Promise<void>;
  onScanFolder: (id: number) => Promise<void>;
  onToggleFolderPinned: (id: number) => Promise<void>;
  onRelinkFolder: (id: number) => Promise<void>;
  onRelinkTrack: (id: number) => Promise<void>;
  onLibraryChanged: () => Promise<void>;
  missingTracks: Track[];
  setMissingTracks: (tracks: Track[]) => void;
  hasCheckedHealth: boolean;
  setHasCheckedHealth: (checked: boolean) => void;
  showImportHint: (msg: string) => void;
  setError: (err: string | null) => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "folders" | "health">("general");

  function requestClose() {
    setIsClosing(true);
    window.setTimeout(onClose, 180);
  }

  return (
    <div
      className={[
        "wave-dim-layer absolute inset-0 z-30 grid place-items-center",
        isClosing ? "wave-overlay-exit" : "",
      ].join(" ")}
      onClick={requestClose}
    >
      <section
        aria-label="settings"
        className={[
          "wave-dialog-panel w-[460px] max-w-[calc(100vw-32px)] border border-outline-variant bg-surface-container-low",
          isClosing ? "wave-popover-exit" : "",
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-h-bar items-center border-b border-surface-container-high px-md">
          <div className="flex min-w-0 flex-1 items-center gap-xs text-on-surface">
            <Icon name="settings" size={16} />
            <h2 className="m-0 text-body-md font-semibold">settings</h2>
          </div>
          <button
            aria-label="close settings"
            className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={requestClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="flex border-b border-outline-variant bg-surface-container-lowest">
          {[
            { id: "general", label: "general", icon: "settings" },
            { id: "folders", label: "folders", icon: "folder" },
            { id: "health", label: "health", icon: "healing" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={[
                "flex-1 flex items-center justify-center gap-xs py-sm text-body-sm font-semibold border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary bg-surface-variant/20"
                  : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40",
              ].join(" ")}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
            >
              <Icon name={tab.icon} size={14} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="max-h-[calc(100vh-160px)] overflow-auto p-md">
          {activeTab === "general" && (
            <>
              <div className="mb-md text-label-caps uppercase text-on-surface-variant">
                theme
              </div>
              <div className="border border-outline-variant mb-lg">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.theme}
                    className={[
                      "grid h-h-row w-full grid-cols-[32px_minmax(0,1fr)_64px_24px] items-center border-b border-outline-variant px-md text-left text-body-sm hover:bg-surface-container-high",
                      option.theme === theme
                        ? "bg-surface-variant text-primary"
                        : "text-on-surface-variant",
                    ].join(" ")}
                    type="button"
                    onClick={() => onThemeChange(option.theme)}
                  >
                    <ThemeSwatch theme={option.theme} />
                    <span className="truncate text-on-surface">{option.label}</span>
                    <span className="text-label uppercase tracking-[0.12em]">{option.tone}</span>
                    {option.theme === theme ? <Icon name="check" size={16} /> : null}
                  </button>
                ))}
              </div>

              <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
                layout
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] border border-outline-variant text-body-sm mb-lg">
                <SettingsStat label="sidebar width" value={`${sidebarWidth}px`} />
                <div className="col-span-2 border-b border-outline-variant px-md py-sm">
                  <input
                    aria-label="sidebar width"
                    className="w-full accent-primary"
                    max={320}
                    min={180}
                    type="range"
                    value={sidebarWidth}
                    onChange={(event) => onSidebarWidthChange(Number(event.target.value))}
                  />
                  <div className="mt-xs flex items-center justify-between text-body-sm text-on-surface-variant">
                    <span>compact to roomy</span>
                    <button
                      className="text-primary hover:text-on-surface"
                      type="button"
                      onClick={() => onSidebarWidthChange(220)}
                    >
                      reset
                    </button>
                  </div>
                </div>
              </div>

              <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
                playback & volume
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] border border-outline-variant text-body-sm mb-lg">
                <SettingsStat label="mode" value={playbackMode} />
                <div className="col-span-2 border-b border-outline-variant px-md py-sm">
                  <div className="flex items-center justify-between gap-sm">
                    <span className="text-on-surface-variant">default mode</span>
                    <button
                      className="h-h-row border border-outline-variant px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                      type="button"
                      onClick={() => onPlaybackModeChange(nextPlaybackMode(playbackMode))}
                    >
                      cycle
                    </button>
                  </div>
                </div>
                <SettingsStat label="volume" value={`${Math.round(volume * 100)}%`} />
              </div>

              <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
                preamp volume gain
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] border border-outline-variant text-body-sm mb-lg">
                <SettingsStat label="multiplier" value={`${Math.round(volumeGain * 10) / 10}x`} />
                <div className="col-span-2 border-b border-outline-variant px-md py-sm">
                  <input
                    aria-label="preamp gain multiplier"
                    className="w-full accent-primary"
                    max={2.0}
                    min={0.5}
                    step={0.1}
                    type="range"
                    value={volumeGain}
                    onChange={(event) => void onVolumeGainChange(Number(event.target.value))}
                  />
                  <div className="mt-xs flex items-center justify-between text-body-sm text-on-surface-variant">
                    <span>0.5x (softer) to 2.0x (boosted)</span>
                    <button
                      className="text-primary hover:text-on-surface"
                      type="button"
                      onClick={() => void onVolumeGainChange(1.0)}
                    >
                      reset
                    </button>
                  </div>
                </div>
              </div>

              <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
                maintenance
              </div>
              <div className="grid gap-sm">
                {!isWindowsDesktop() ? (
                  <button
                    className="flex min-h-[44px] items-center justify-between border border-outline-variant px-md py-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
                    disabled={isInstallingCliCommand || cliCommandStatus?.installed === true}
                    type="button"
                    onClick={() => {
                      void onInstallCliCommand();
                    }}
                  >
                    <span>{cliCommandStatus?.installed ? "dww installed" : "install dww command"}</span>
                    <span className="max-w-[220px] truncate text-on-surface-variant">
                      {cliCommandStatus?.location ?? "terminal launcher"}
                    </span>
                  </button>
                ) : null}
                {!isWindowsDesktop() && cliCommandStatus?.reachable_hint ? (
                  <div className="px-xs text-body-sm text-on-surface-variant">
                    {cliCommandStatus.reachable_hint}
                  </div>
                ) : null}
                <button
                  className="flex h-h-row items-center justify-between border border-outline-variant px-md text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  type="button"
                  onClick={onOpenQuickSetup}
                >
                  <span>quick setup</span>
                  <span className="text-on-surface-variant">rerun onboarding wizard</span>
                </button>
                <button
                  className="flex h-h-row items-center justify-between border border-outline-variant px-md text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  type="button"
                  onClick={onClearQueue}
                >
                  <span>clear queue</span>
                  <span className="text-on-surface-variant">reset playback queue</span>
                </button>
                <button
                  className="flex h-h-row items-center justify-between border border-outline-variant px-md text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  type="button"
                  onClick={onClearHiddenTracks}
                >
                  <span>clear hidden</span>
                  <span className="text-on-surface-variant">show all library tracks again</span>
                </button>
              </div>
            </>
          )}

          {activeTab === "folders" && (
            <div className="grid gap-sm">
              <div className="text-body-sm text-on-surface-variant mb-xs">
                Manage your scanned music directories:
              </div>
              <div className="flex flex-col gap-xs max-h-[360px] overflow-auto border border-outline-variant p-xs">
                {folders.length === 0 ? (
                  <div className="text-center py-md text-on-surface-variant text-body-sm">
                    No folders added yet.
                  </div>
                ) : (
                  folders.map((folder) => {
                    const name = folder.path.split(/[\\/]/).pop() || folder.path;
                    return (
                      <div
                        key={folder.id}
                        className="flex flex-col gap-xs border border-outline-variant/50 p-sm bg-surface-container-lowest"
                      >
                        <div className="flex items-start justify-between min-w-0">
                          <div className="min-w-0 pr-sm">
                            <div className="text-body-sm font-semibold truncate text-on-surface" title={folder.path}>
                              {name}
                            </div>
                            <div className="text-[10px] text-on-surface-variant truncate" title={folder.path}>
                              {folder.path}
                            </div>
                            <div className="text-[10px] text-primary/80 mt-[2px] font-medium">
                              {folder.trackCount} track(s) imported
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-[4px]">
                            <button
                              title="Rescan Folder"
                              className="h-[28px] w-[28px] grid place-items-center hover:bg-surface-container-high hover:text-on-surface text-on-surface-variant border border-outline-variant"
                              type="button"
                              onClick={() => onScanFolder(folder.id)}
                            >
                              <Icon name="refresh" size={14} />
                            </button>
                            <button
                              title={folder.pinned ? "Unpin Folder" : "Pin Folder"}
                              className={[
                                "h-[28px] w-[28px] grid place-items-center border border-outline-variant",
                                folder.pinned
                                  ? "bg-primary/10 text-primary hover:bg-primary/20 border-primary/30"
                                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                              ].join(" ")}
                              type="button"
                              onClick={() => onToggleFolderPinned(folder.id)}
                            >
                              <Icon name="push_pin" size={14} className={folder.pinned ? "" : "opacity-40"} />
                            </button>
                            <button
                              title="Relink Path"
                              className="h-[28px] w-[28px] grid place-items-center hover:bg-surface-container-high hover:text-on-surface text-on-surface-variant border border-outline-variant"
                              type="button"
                              onClick={() => onRelinkFolder(folder.id)}
                            >
                              <Icon name="link" size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === "health" && (
            <div className="grid gap-sm">
              <div className="flex items-center gap-sm">
                <button
                  className="flex-1 h-h-row border border-primary px-sm text-body-sm text-primary hover:bg-surface-variant hover:text-on-surface"
                  type="button"
                  onClick={async () => {
                    setError(null);
                    try {
                      const missing = await invoke<BackendTrack[]>("check_library_health");
                      setMissingTracks(missing.map(fromBackendTrack));
                      setHasCheckedHealth(true);
                    } catch (err) {
                      setError(toErrorMessage(err));
                    }
                  }}
                >
                  Run Health Check
                </button>
                <button
                  className="flex-1 h-h-row border border-error px-sm text-body-sm text-error hover:bg-error/10"
                  type="button"
                  onClick={async () => {
                    setError(null);
                    try {
                      const count = await invoke<number>("prune_missing_tracks");
                      showImportHint(`Pruned ${count} missing track(s) from database.`);
                      setMissingTracks([]);
                      setHasCheckedHealth(false);
                      await onLibraryChanged();
                    } catch (err) {
                      setError(toErrorMessage(err));
                    }
                  }}
                >
                  Prune All Missing
                </button>
              </div>

              {hasCheckedHealth && (
                <div className="mt-sm">
                  <div className="text-body-sm font-semibold mb-xs text-on-surface">
                    Health Check Results:
                  </div>
                  <div className="max-h-[220px] overflow-auto border border-outline-variant p-xs flex flex-col gap-xs">
                    {missingTracks.length === 0 ? (
                      <div className="text-center py-sm text-primary text-body-sm flex items-center justify-center gap-xs bg-surface-variant/20 border border-outline-variant">
                        <Icon name="check_circle" size={16} />
                        <span>All library files are present on disk!</span>
                      </div>
                    ) : (
                      missingTracks.map((track) => (
                        <div
                          key={track.id}
                          className="flex flex-col gap-xs border border-error/20 p-sm bg-error/5 text-body-sm text-on-surface"
                        >
                          <div className="flex items-start justify-between min-w-0">
                            <div className="min-w-0 pr-sm">
                              <div className="font-semibold truncate text-on-surface">
                                {track.title || track.fileName}
                              </div>
                              <div className="text-[10px] text-on-surface-variant truncate" title={track.path}>
                                {track.path}
                              </div>
                            </div>
                            <button
                              title="Relink Track File"
                              className="h-[28px] px-xs flex items-center gap-[4px] border border-outline-variant hover:bg-surface-container-high text-body-xs font-semibold text-primary shrink-0"
                              type="button"
                              onClick={() => void onRelinkTrack(track.id)}
                            >
                              <Icon name="link" size={12} />
                              <span>Relink</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsStat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="border-b border-outline-variant px-md py-sm text-on-surface-variant">
        {label}
      </div>
      <div className="border-b border-outline-variant px-md py-sm text-right text-on-surface">
        {value}
      </div>
    </>
  );
}

function ShortcutsHud({
  onClose,
}: {
  onClose: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);

  function requestClose() {
    setIsClosing(true);
    window.setTimeout(onClose, 180);
  }

  const shortcuts = [
    { keys: ["Space"], description: "Play / Pause" },
    { keys: ["S"], description: "Stop playback" },
    { keys: ["L", "→"], description: "Next track" },
    { keys: ["H", "←"], description: "Previous track" },
    { keys: ["K", "↑"], description: "Volume up" },
    { keys: ["J", "↓"], description: "Volume down" },
    { keys: ["M"], description: "Mute / Unmute" },
    { keys: ["Q"], description: "Toggle queue panel (or add selected track)" },
    { keys: ["/"], description: "Focus search input" },
    { keys: ["?"], description: "Toggle keyboard shortcuts HUD" },
  ];

  return (
    <div
      className={[
        "wave-dim-layer absolute inset-0 z-30 grid place-items-center",
        isClosing ? "wave-overlay-exit" : "",
      ].join(" ")}
      onClick={requestClose}
    >
      <section
        aria-label="keyboard shortcuts"
        className={[
          "wave-dialog-panel w-[420px] max-w-[calc(100vw-32px)] border border-outline-variant bg-surface-container-low",
          isClosing ? "wave-popover-exit" : "",
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-h-bar items-center border-b border-surface-container-high px-md">
          <div className="flex min-w-0 flex-1 items-center gap-xs text-on-surface">
            <Icon name="keyboard" size={16} />
            <h2 className="m-0 text-body-md font-semibold">keyboard shortcuts</h2>
          </div>
          <button
            aria-label="close shortcuts"
            className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={requestClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="max-h-[calc(100vh-120px)] overflow-auto p-md">
          <div className="flex flex-col gap-sm">
            {shortcuts.map((shortcut, idx) => (
              <div key={idx} className="flex h-h-row items-center justify-between border-b border-outline-variant/30 pb-xs last:border-0 last:pb-0">
                <span className="text-body-sm text-on-surface">{shortcut.description}</span>
                <div className="flex items-center gap-xs">
                  {shortcut.keys.map((key, keyIdx) => (
                    <kbd
                      key={keyIdx}
                      className="inline-flex h-[24px] min-w-[24px] items-center justify-center rounded border border-outline bg-surface-variant px-xs text-[11px] font-mono font-semibold text-primary uppercase shadow-sm"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}


function DropOverlay({ target }: { target: DropTarget }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center border border-primary bg-background/70 text-primary">
      <div className="border border-primary bg-surface-container-low px-lg py-md text-body-md">
        drop to {target.type === "playlist" ? "playlist" : "all tracks"}
      </div>
    </div>
  );
}

function ImportHint({ message }: { message: string }) {
  return (
    <div className="wave-import-hint pointer-events-none absolute right-lg top-[calc(var(--h-bar)+12px)] z-50 border border-primary bg-surface-container-low px-md py-sm text-body-sm text-on-surface">
      <span className="mr-xs text-primary">imported</span>
      {message}
    </div>
  );
}

function ThemeSwatch({ theme }: { theme: AppTheme }) {
  const colors: Record<AppTheme, [string, string, string]> = {
    coal: ["38 38 40", "67 67 70", "210 210 214"],
    dark: ["21 21 24", "34 34 38", "202 202 208"],
    light: ["250 250 250", "230 230 230", "26 26 31"],
    pink: ["254 245 247", "241 210 221", "176 48 96"],
    "rose-pine": ["25 23 36", "64 61 82", "196 167 231"],
    "solarized-light": ["253 246 227", "238 232 213", "38 139 210"],
  };

  return (
    <span className="grid h-[14px] w-[24px] grid-cols-3 border border-outline-variant">
      {colors[theme].map((color, index) => (
        <span
          key={`${theme}-${color}-${index}`}
          style={{ backgroundColor: `rgb(${color})` } as CSSProperties}
        />
      ))}
    </span>
  );
}

function SideNav({
  collapsed,
  width,
  onResize,
  view,
  onViewChange,
  playlists,
  folders,
  onSelectPlaylist,
  onSelectFolder,
}: {
  collapsed: boolean;
  width: number;
  onResize: (width: number) => void;
  view: View;
  onViewChange: (view: View) => void;
  playlists: Playlist[];
  folders: Folder[];
  onSelectPlaylist: (id: number) => void;
  onSelectFolder: (id: number) => void;
}) {
  const items = [
    {
      label: "all tracks",
      icon: "queue_music",
      view: "all-tracks" as const,
      disabled: false,
    },
    {
      label: "liked songs",
      icon: "favorite",
      view: "liked" as const,
      disabled: false,
    },
    { label: "albums", icon: "album", view: "albums" as const, disabled: false },
    { label: "artists", icon: "artist", view: "artists" as const, disabled: false },
    {
      label: "playlists",
      icon: "playlist_play",
      view: "playlists" as const,
      disabled: false,
    },
  ];

  const pinnedPlaylists = playlists.filter((p) => p.pinned);
  const pinnedFolders = folders.filter((f) => f.pinned);

  return (
    <nav
      data-sidebar-drop
      className={[
        "wave-panel-left relative shrink-0 overflow-hidden border-r border-surface-container-high bg-surface-container-low p-sm",
        collapsed ? "w-w-nav-collapsed" : "",
      ].join(" ")}
      style={
        {
          "--wave-sidebar-width": `${width}px`,
        } as CSSProperties
      }
      aria-label="primary"
    >
      <div className="flex flex-col gap-xs">
        {items.map((item) => (
          <button
            key={item.label}
            aria-current={item.view === view ? "page" : undefined}
            className={[
              "relative flex h-h-row items-center border-l-2 px-sm text-left text-body-sm",
              item.view === view
                ? "border-primary bg-surface-variant text-primary"
                : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
              item.disabled ? "pointer-events-none opacity-50" : "",
              collapsed ? "justify-center" : "",
            ].join(" ")}
            disabled={item.disabled}
            tabIndex={item.disabled ? -1 : 0}
            type="button"
            onClick={() => {
              if (item.view) onViewChange(item.view);
            }}
          >
            <Icon name={item.icon} size={16} />
            <span
              className={[
                "wave-nav-label absolute whitespace-nowrap",
                collapsed ? "opacity-0" : "opacity-100",
              ].join(" ")}
            >
              {item.label}
            </span>
          </button>
        ))}

        {!collapsed && (pinnedPlaylists.length > 0 || pinnedFolders.length > 0) && (
          <div className="mt-md flex flex-col gap-xs border-t border-outline-variant/30 pt-sm">
            <div className="px-sm text-[10px] font-bold tracking-wider text-on-surface-variant uppercase opacity-70">
              pinned items
            </div>
            
            {pinnedPlaylists.map((playlist) => (
              <button
                key={`pinned-pl-${playlist.id}`}
                className="flex h-[36px] items-center gap-xs px-sm text-left text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface rounded transition-colors"
                type="button"
                onClick={() => onSelectPlaylist(playlist.id)}
              >
                <Icon name="playlist_play" size={14} className="text-primary" />
                <span className="truncate text-body-sm font-medium">{playlist.name}</span>
              </button>
            ))}

            {pinnedFolders.map((folder) => {
              const name = folder.path.split(/[\\/]/).pop() || folder.path;
              return (
                <button
                  key={`pinned-fld-${folder.id}`}
                  className="flex h-[36px] items-center gap-xs px-sm text-left text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface rounded transition-colors"
                  title={folder.path}
                  type="button"
                  onClick={() => onSelectFolder(folder.id)}
                >
                  <Icon name="folder" size={14} className="text-primary" />
                  <span className="truncate text-body-sm font-medium">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!collapsed ? <ResizeRail onResize={onResize} /> : null}
    </nav>
  );
}

function ResizeRail({ onResize }: { onResize: (width: number) => void }) {
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      onResize(Math.max(160, Math.min(360, moveEvent.clientX)));
    };
    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }

  return (
    <div
      aria-label="resize sidebar"
      className="absolute right-0 top-0 h-full w-xs cursor-col-resize bg-transparent hover:bg-primary"
      role="separator"
      onPointerDown={startResize}
    />
  );
}

function AlbumsView({
  albums,
  currentTrackId,
  onTrackContextMenu,
  onPlayTrack,
  isPaused,
}: {
  albums: Album[];
  currentTrackId: number | null;
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onPlayTrack: (trackId: number) => void;
  isPaused: boolean;
}) {
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(albums[0]?.id ?? null);
  const selectedAlbum =
    albums.find((album) => album.id === selectedAlbumId) ?? albums[0];

  return (
    <LibraryDetailView
      detail={
        selectedAlbum ? (
          <AlbumDetail
            album={selectedAlbum}
            currentTrackId={currentTrackId}
            onTrackContextMenu={onTrackContextMenu}
            onPlayTrack={onPlayTrack}
            isPaused={isPaused}
          />
        ) : null
      }
      emptyBody="rescan your library to populate album metadata."
      emptyTitle="no albums yet."
      rows={albums.map((album) => ({
        id: album.id,
        primary: album.name,
        secondary: album.artist,
        count: album.trackCount,
      }))}
      selectedId={selectedAlbum?.id ?? null}
      title="albums"
      onSelect={setSelectedAlbumId}
    />
  );
}

function ArtistsView({
  artists,
  currentTrackId,
  onTrackContextMenu,
  onPlayTrack,
  isPaused,
}: {
  artists: Artist[];
  currentTrackId: number | null;
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onPlayTrack: (trackId: number) => void;
  isPaused: boolean;
}) {
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(
    artists[0]?.name ?? null,
  );
  const selectedArtist =
    artists.find((artist) => artist.name === selectedArtistName) ?? artists[0];

  return (
    <LibraryDetailView
      detail={
        selectedArtist ? (
          <ArtistDetail
            artist={selectedArtist}
            currentTrackId={currentTrackId}
            onTrackContextMenu={onTrackContextMenu}
            onPlayTrack={onPlayTrack}
            isPaused={isPaused}
          />
        ) : null
      }
      emptyBody="artist names come from audio tags or filename fallback."
      emptyTitle="no artists yet."
      rows={artists.map((artist) => ({
        id: artist.name,
        primary: artist.name,
        secondary: "artist",
        count: artist.trackCount,
      }))}
      selectedId={selectedArtist?.name ?? null}
      title="artists"
      onSelect={setSelectedArtistName}
    />
  );
}

function PlaylistsView({
  currentTrackId,
  playlists,
  selectedTrackId,
  tracks,
  onChanged,
  onTrackContextMenu,
  onPlayTrack,
  isPaused,
}: {
  currentTrackId: number | null;
  playlists: Playlist[];
  selectedTrackId: number | null;
  tracks: Track[];
  onChanged: () => void;
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onPlayTrack: (trackId: number) => void;
  isPaused: boolean;
}) {
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(
    playlists[0]?.id ?? null,
  );
  const selectedPlaylist =
    playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? playlists[0];
  const addableTrackId = currentTrackId ?? selectedTrackId;

  async function createPlaylist(name: string) {
    const playlist = await invoke<BackendPlaylist>("create_playlist", { name });
    setSelectedPlaylistId(playlist.id);
    setCreatingPlaylist(false);
    onChanged();
  }

  async function deleteSelectedPlaylist() {
    if (!selectedPlaylist) return;
    await invoke("delete_playlist", { playlistId: selectedPlaylist.id });
    setSelectedPlaylistId(null);
    onChanged();
  }

  async function addCurrentTrack() {
    if (!selectedPlaylist || !addableTrackId) return;
    await addTrackToSelected(addableTrackId);
  }

  async function addTrackToSelected(trackId: number) {
    if (!selectedPlaylist) return;
    await invoke("add_track_to_playlist", {
      playlistId: selectedPlaylist.id,
      trackId,
    });
    onChanged();
  }

  async function removeTrack(trackId: number) {
    if (!selectedPlaylist) return;
    await invoke("remove_track_from_playlist", {
      playlistId: selectedPlaylist.id,
      trackId,
    });
    onChanged();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-h-bar shrink-0 items-center border-b border-surface-container-high px-lg">
        <h1 className="m-0 text-headline font-semibold text-on-surface">playlists</h1>
        <span className="ml-auto text-body-sm text-on-surface-variant">
          {playlists.length} playlists
        </span>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
        <div className="min-h-0 border-r border-surface-container-high bg-surface-container-low">
          <div className="border-b border-surface-container-high px-md py-sm">
            <button
              className="flex h-h-row w-full items-center justify-center gap-xs border border-primary bg-surface-container-lowest px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              type="button"
              onClick={() => setCreatingPlaylist(true)}
            >
              <Icon name="add" size={16} />
              <span>new playlist</span>
            </button>
          </div>
          <div className="min-h-0 overflow-auto">
            {playlists.map((playlist) => {
              const selected = playlist.id === selectedPlaylist?.id;
              return (
                <button
                  key={playlist.id}
                  data-drop-target="playlist"
                  data-playlist-id={playlist.id}
                  className={[
                    "grid h-h-row w-full grid-cols-[minmax(0,1fr)_64px] items-center border-l-2 px-md text-left text-body-sm",
                    selected
                      ? "border-primary bg-surface-variant text-primary"
                      : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                  ].join(" ")}
                  type="button"
                  onClick={() => setSelectedPlaylistId(playlist.id)}
                >
                  <span className="truncate text-on-surface">{playlist.name}</span>
                  <span className="tabular text-right text-body-sm text-on-surface-variant">
                    {playlist.trackCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <PlaylistDetail
          addableTrackId={addableTrackId}
          currentTrackId={currentTrackId}
          playlist={selectedPlaylist}
          tracks={tracks}
          onTrackContextMenu={onTrackContextMenu}
          onAddCurrentTrack={addCurrentTrack}
          onAddTrack={(trackId) => void addTrackToSelected(trackId)}
          onDeletePlaylist={deleteSelectedPlaylist}
          onPlayTrack={onPlayTrack}
          onRemoveTrack={(trackId) => void removeTrack(trackId)}
          isPaused={isPaused}
        />
      </div>
      {creatingPlaylist ? (
        <CreatePlaylistDialog
          initialName=""
          onCancel={() => setCreatingPlaylist(false)}
          onCreate={createPlaylist}
        />
      ) : null}
    </div>
  );
}

function PlaylistDetail({
  addableTrackId,
  currentTrackId,
  playlist,
  tracks,
  onTrackContextMenu,
  onAddCurrentTrack,
  onAddTrack,
  onDeletePlaylist,
  onPlayTrack,
  onRemoveTrack,
  isPaused,
}: {
  addableTrackId: number | null;
  currentTrackId: number | null;
  playlist?: Playlist;
  tracks: Track[];
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onAddCurrentTrack: () => void;
  onAddTrack: (trackId: number) => void;
  onDeletePlaylist: () => void;
  onPlayTrack: (trackId: number) => void;
  onRemoveTrack: (trackId: number) => void;
  isPaused: boolean;
}) {
  const addableTrack = tracks.find((track) => track.id === addableTrackId);
  const [trackQuery, setTrackQuery] = useState("");

  if (!playlist) {
    return (
      <div className="flex flex-col justify-center px-xl text-body-md text-on-surface-variant">
        no playlist selected.
      </div>
    );
  }

  const candidates = filterPlaylistCandidates(tracks, playlist, trackQuery);

  return (
    <div
      className="flex min-h-0 flex-col"
      data-drop-target="playlist"
      data-playlist-id={playlist.id}
    >
      <section className="flex shrink-0 gap-lg border-b border-surface-container-high p-lg">
        <DeterministicCoverArt name={playlist.name} />
        <div className="flex min-w-0 flex-1 flex-col justify-end">
          <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
            playlist
          </div>
          <h2 className="m-0 truncate text-headline font-semibold text-on-surface">
            {playlist.name}
          </h2>
          <div className="mt-sm text-body-sm text-on-surface-variant">
            {playlist.trackCount} tracks
          </div>
          {addableTrack ? (
            <div className="mt-md grid grid-cols-[72px_minmax(0,1fr)] gap-sm text-body-sm">
              <span className="text-on-surface-variant">current</span>
              <span className="truncate text-on-surface">
                {addableTrack.title || addableTrack.fileName}
              </span>
            </div>
          ) : null}
          <div className="mt-md flex gap-sm">
            <button
              className="flex h-h-row items-center gap-xs border border-outline-variant px-sm text-body-sm text-error hover:bg-surface-container-high"
              type="button"
              onClick={onDeletePlaylist}
            >
              <Icon name="delete" size={16} />
              <span>delete</span>
            </button>
          </div>
        </div>
      </section>
      <section className="shrink-0 border-b border-surface-container-high p-sm">
        <div className="flex gap-sm">
          <input
            className="h-h-row min-w-0 flex-1 border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface placeholder:text-on-surface-variant"
            placeholder="add track..."
            value={trackQuery}
            onChange={(event) => setTrackQuery(event.target.value)}
          />
          <button
            className="flex h-h-row items-center gap-xs border border-outline-variant px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            disabled={!addableTrack}
            type="button"
            onClick={onAddCurrentTrack}
          >
            <Icon name="add" size={16} />
            <span>current</span>
          </button>
        </div>
        {trackQuery.trim() ? (
          <div className="mt-sm max-h-h-search-results overflow-auto border border-outline-variant">
            {candidates.length === 0 ? (
              <p className="m-0 px-md py-sm text-body-sm text-on-surface-variant">
                no matching tracks.
              </p>
            ) : (
              candidates.map((track) => (
                <button
                  key={track.id}
                  className="grid h-h-row w-full grid-cols-[minmax(0,1fr)_48px] items-center px-sm text-left text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  type="button"
                  onClick={() => {
                    onAddTrack(track.id);
                    setTrackQuery("");
                  }}
                >
                  <span className="truncate">{track.title || track.fileName}</span>
                  <span className="text-right text-primary">add</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </section>
      <div className="min-h-0 flex-1 overflow-auto">
        {playlist.tracks.length === 0 ? (
          <p className="m-0 p-lg text-body-md text-on-surface-variant">
            no tracks in this playlist.
          </p>
        ) : (
          playlist.tracks.map((track) => {
            const playing = track.id === currentTrackId;
            return (
              <div
                key={track.id}
                className={[
                    "grid h-h-row select-none grid-cols-[32px_minmax(0,1fr)_64px_32px] items-center border-l-2 px-md text-body-md",
                  playing
                    ? "border-primary bg-surface-variant text-primary"
                    : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                ].join(" ")}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onTrackContextMenu(track.id, event.clientX, event.clientY);
                }}
              >
                <button
                  aria-label={playing ? "pause track" : "play track"}
                  className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:text-on-surface"
                  type="button"
                  onClick={() => onPlayTrack(track.id)}
                >
                  {playing ? (
                    <PlayingEqualizer isPaused={isPaused} />
                  ) : (
                    <Icon name="play_arrow" size={12} />
                  )}
                </button>
                <span className={playing ? "truncate text-primary font-medium" : "truncate text-on-surface"}>{track.title || track.fileName}</span>
                <span className="tabular text-right text-body-sm text-on-surface-variant">
                  {formatDuration(track.durationSeconds)}
                </span>
                <button
                  aria-label="remove from playlist"
                  className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:text-error"
                  type="button"
                  onClick={() => onRemoveTrack(track.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function LibraryDetailView({
  detail,
  emptyBody,
  emptyTitle,
  rows,
  selectedId,
  title,
  onSelect,
}: {
  detail: ReactNode;
  emptyBody: string;
  emptyTitle: string;
  rows: Array<{ id: string; primary: string; secondary: string; count: number }>;
  selectedId: string | null;
  title: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-h-bar shrink-0 items-center border-b border-surface-container-high px-lg">
        <h1 className="m-0 text-headline font-semibold text-on-surface">{title}</h1>
        <span className="ml-sm text-body-sm text-on-surface-variant">
          {rows.length} {title}
        </span>
      </header>
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-xl">
          <p className="m-0 text-body-md text-on-surface-variant">{emptyTitle}</p>
          <p className="mb-0 mt-xs text-body-md text-on-surface-variant">{emptyBody}</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-auto border-r border-surface-container-high bg-surface-container-low">
            {rows.map((row) => {
              const selected = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  className={[
                    "grid h-h-row w-full grid-cols-[minmax(0,1fr)_64px] items-center border-l-2 px-md text-left text-body-sm",
                    selected
                      ? "border-primary bg-surface-variant text-primary"
                      : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                  ].join(" ")}
                  type="button"
                  onClick={() => onSelect(row.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-on-surface">{row.primary}</span>
                  </span>
                  <span className="tabular text-right text-body-sm text-on-surface-variant">
                    {row.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 overflow-auto">{detail}</div>
        </div>
      )}
    </div>
  );
}

function AlbumDetail({
  album,
  currentTrackId,
  onTrackContextMenu,
  onPlayTrack,
  isPaused,
}: {
  album: Album;
  currentTrackId: number | null;
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onPlayTrack: (trackId: number) => void;
  isPaused: boolean;
}) {
  return (
    <EntityDetail
      eyebrow="album"
      title={album.name}
      subtitle={`${album.artist} / ${album.trackCount} tracks`}
      tracks={album.tracks}
      currentTrackId={currentTrackId}
      onTrackContextMenu={onTrackContextMenu}
      onPlayTrack={onPlayTrack}
      isPaused={isPaused}
    />
  );
}

function ArtistDetail({
  artist,
  currentTrackId,
  onTrackContextMenu,
  onPlayTrack,
  isPaused,
}: {
  artist: Artist;
  currentTrackId: number | null;
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onPlayTrack: (trackId: number) => void;
  isPaused: boolean;
}) {
  return (
    <EntityDetail
      eyebrow="artist"
      title={artist.name}
      subtitle={`${artist.trackCount} tracks`}
      tracks={artist.tracks}
      currentTrackId={currentTrackId}
      onTrackContextMenu={onTrackContextMenu}
      onPlayTrack={onPlayTrack}
      isPaused={isPaused}
    />
  );
}

function EntityDetail({
  currentTrackId,
  eyebrow,
  subtitle,
  title,
  tracks,
  onTrackContextMenu,
  onPlayTrack,
  isPaused,
}: {
  currentTrackId: number | null;
  eyebrow: string;
  subtitle: string;
  title: string;
  tracks: Track[];
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onPlayTrack: (trackId: number) => void;
  isPaused: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <section className="flex shrink-0 gap-lg border-b border-surface-container-high p-lg">
        <DeterministicCoverArt name={title} />
        <div className="min-w-0 self-end">
          <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
            {eyebrow}
          </div>
          <h2 className="m-0 truncate text-headline font-semibold text-on-surface">
            {title}
          </h2>
          <p className="mb-0 mt-sm text-body-sm text-on-surface-variant">{subtitle}</p>
        </div>
      </section>
      <div className="min-h-0 flex-1 overflow-auto">
        {tracks.map((track) => {
          const playing = track.id === currentTrackId;
          return (
            <button
              key={track.id}
            className={[
                "grid h-h-row w-full select-none grid-cols-[32px_minmax(0,1fr)_minmax(120px,25%)_64px] items-center border-l-2 px-md text-left text-body-md",
                playing
                  ? "border-primary bg-surface-variant text-primary"
                  : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
              ].join(" ")}
              type="button"
              onContextMenu={(event) => {
                event.preventDefault();
                onTrackContextMenu(track.id, event.clientX, event.clientY);
              }}
              onDoubleClick={() => onPlayTrack(track.id)}
            >
              <span className="flex h-h-row items-center text-on-surface-variant">
                {playing ? <PlayingEqualizer isPaused={isPaused} /> : null}
              </span>
              <span className={playing ? "truncate text-primary font-medium" : "truncate text-on-surface"}>{track.title || track.fileName}</span>
              <span className="truncate px-sm text-on-surface-variant">
                {track.album ?? track.artist ?? "-"}
              </span>
              <span className="tabular text-right text-body-sm text-on-surface-variant">
                {formatDuration(track.durationSeconds)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QueuePanel({
  currentTrackId,
  open,
  queuedTracks,
  tracks,
  shuffledTrackIds,
  playbackMode,
  onClose,
  onTrackContextMenu,
  onPlayTrack,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  onRemoveFromShuffleDeck,
  onClearQueue,
  isPaused,
}: {
  currentTrackId: number | null;
  open: boolean;
  queuedTracks: QueueItem[];
  tracks: Track[];
  shuffledTrackIds: number[];
  playbackMode: PlaybackMode;
  onClose: () => void;
  onTrackContextMenu: (trackId: number, x: number, y: number) => void;
  onPlayTrack: (trackId: number) => void;
  onPlayQueueItem: (queueItemId: string) => void;
  onRemoveQueueItem: (queueItemId: string) => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onRemoveFromShuffleDeck?: (trackId: number) => void;
  onClearQueue: () => void;
  isPaused: boolean;
}) {
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  const queuedTracksMapped = useMemo(() => {
    return queuedTracks
      .map((item) => {
        const track = trackById.get(item.trackId);
        return track ? { ...track, queueItemId: item.id } : null;
      })
      .filter((track): track is Track & { queueItemId: string } => track !== null);
  }, [queuedTracks, trackById]);

  const upcomingTracks = useMemo(() => {
    const explicit = queuedTracksMapped;

    // Fallback: tracks from library (shuffled or sequential)
    let sourceFallback: Track[] = [];
    if (playbackMode === "shuffle" && shuffledTrackIds.length > 0) {
      const idx = shuffledTrackIds.indexOf(currentTrackId ?? -1);
      const startIdx = idx !== -1 ? idx + 1 : 0;
      sourceFallback = shuffledTrackIds
        .slice(startIdx)
        .map((id) => trackById.get(id))
        .filter((track): track is Track => track !== undefined);
    } else {
      const idx = tracks.findIndex((t) => t.id === currentTrackId);
      const startIdx = idx !== -1 ? idx + 1 : 0;
      sourceFallback = tracks.slice(startIdx, startIdx + 50);
    }

    const fallbackMapped = sourceFallback.map((t) => ({
      ...t,
      queueItemId: `fallback-${t.id}`,
    }));

    return [...explicit, ...fallbackMapped];
  }, [queuedTracksMapped, playbackMode, shuffledTrackIds, currentTrackId, trackById, tracks]);

  const nowPlayingTrack = currentTrackId != null ? trackById.get(currentTrackId) : undefined;

  return (
    <div
      aria-hidden={!open}
      className={[
        "wave-queue-layer absolute bottom-h-now left-0 right-0 top-h-bar z-20",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      ].join(" ")}
    >
      <button
        aria-label="close queue backdrop"
        className="absolute inset-0 bg-background/70"
        type="button"
        onClick={onClose}
      />
      <aside
        className={[
          "wave-panel-right absolute bottom-0 right-0 top-0 overflow-hidden border-l border-surface-container-high bg-surface-container-low",
          open ? "w-w-nav opacity-100" : "w-0 opacity-0",
        ].join(" ")}
      >
        <header className="wave-panel-content flex h-h-bar min-w-w-nav items-center border-b border-surface-container-high px-md gap-sm">
          <h2 className="m-0 text-headline font-semibold text-on-surface">queue</h2>
          <div className="flex-1" />
          {queuedTracks.length > 0 && (
            <button
              className="px-sm py-xs text-[10px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
              type="button"
              onClick={onClearQueue}
            >
              clear all
            </button>
          )}
          <button
            aria-label="close queue"
            className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="wave-panel-content min-h-0 min-w-w-nav overflow-auto p-sm">
          {nowPlayingTrack && (
            <div className="mb-md">
              <div className="px-sm pb-xs text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
                now playing
              </div>
              <div
                className="flex h-[56px] w-full items-center gap-sm border-l-2 border-primary bg-surface-variant/40 px-sm text-left text-body-sm transition-all duration-200"
                onContextMenu={(event) => {
                  event.preventDefault();
                  onTrackContextMenu(nowPlayingTrack.id, event.clientX, event.clientY);
                }}
              >
                <div className="flex h-h-row w-h-row shrink-0 items-center justify-center text-primary">
                  <PlayingEqualizer isPaused={isPaused} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-primary">
                    {nowPlayingTrack.title || nowPlayingTrack.fileName}
                  </div>
                  <div className="truncate text-[11px] text-on-surface-variant">
                    {nowPlayingTrack.artist ?? "unknown artist"}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="px-sm pb-xs text-[10px] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
            next up
          </div>
          {upcomingTracks.length === 0 ? (
            <p className="m-0 px-sm py-md text-body-sm text-on-surface-variant">
              no upcoming tracks.
            </p>
          ) : (
            <div className="flex flex-col gap-[2px]">
              {upcomingTracks.map((track, idx) => {
                const isExplicit = !track.queueItemId.startsWith("fallback-");
                const isShuffleFallback = playbackMode === "shuffle" && !isExplicit;
                return (
                  <div
                    key={track.queueItemId}
                    className="group grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)_96px] items-center border-l-2 border-transparent px-sm text-left text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all duration-150"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onTrackContextMenu(track.id, event.clientX, event.clientY);
                    }}
                    onDoubleClick={() => {
                      if (isExplicit) {
                        onPlayQueueItem(track.queueItemId);
                      } else {
                        onPlayTrack(track.id);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="h-full w-full flex items-center justify-start text-[11px] tabular text-on-surface-variant/50 group-hover:hidden"
                      onClick={() => {
                        if (isExplicit) {
                          onPlayQueueItem(track.queueItemId);
                        } else {
                          onPlayTrack(track.id);
                        }
                      }}
                    >
                      {idx + 1}
                    </button>
                    <button
                      type="button"
                      className="hidden text-primary group-hover:flex items-center h-full w-full justify-start"
                      onClick={() => {
                        if (isExplicit) {
                          onPlayQueueItem(track.queueItemId);
                        } else {
                          onPlayTrack(track.id);
                        }
                      }}
                    >
                      <Icon name="play_arrow" size={14} />
                    </button>
                    <div className="truncate text-on-surface pr-sm font-medium">
                      {track.title || track.fileName}
                    </div>
                    <div className="h-full flex items-center justify-end">
                      {isExplicit || isShuffleFallback ? (
                        <>
                          <span className="tabular text-right text-[11px] text-on-surface-variant/50 group-hover:hidden">
                            {formatDuration(track.durationSeconds)}
                          </span>
                          <div className="hidden group-hover:flex items-center gap-[4px]">
                            {/* Move Up */}
                            {idx > 0 && (
                              <button
                                type="button"
                                aria-label="Move up"
                                className="h-6 w-6 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-variant transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReorderQueue(idx, idx - 1);
                                }}
                              >
                                <Icon name="keyboard_arrow_up" size={16} />
                              </button>
                            )}
                            {/* Move Down */}
                            {idx < upcomingTracks.length - 1 && (
                              <button
                                type="button"
                                aria-label="Move down"
                                className="h-6 w-6 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-variant transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReorderQueue(idx, idx + 1);
                                }}
                              >
                                <Icon name="keyboard_arrow_down" size={16} />
                              </button>
                            )}
                            {/* Remove */}
                            <button
                              type="button"
                              aria-label="Remove from queue"
                              className="h-6 w-6 flex items-center justify-center rounded-full text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isExplicit) {
                                  onRemoveQueueItem(track.queueItemId);
                                } else {
                                  onRemoveFromShuffleDeck?.(track.id);
                                }
                              }}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <span className="tabular text-right text-[11px] text-on-surface-variant/50">
                          {formatDuration(track.durationSeconds)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function CreatePlaylistDialog({
  initialName,
  onCancel,
  onCreate,
}: {
  initialName: string;
  onCancel: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  function requestCancel() {
    setIsClosing(true);
    window.setTimeout(onCancel, 180);
  }

  async function submit() {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onCreate(name.trim());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className={[
        "wave-dim-layer absolute inset-0 z-30 grid place-items-center",
        isClosing ? "wave-overlay-exit" : "",
      ].join(" ")}
      onClick={requestCancel}
    >
      <form
        className={[
          "wave-dialog-panel w-w-nav border border-outline-variant bg-surface-container-low p-md",
          isClosing ? "wave-popover-exit" : "",
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
          new playlist
        </div>
        <input
          className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="mt-md flex justify-end gap-sm">
          <button
            className="h-h-row border border-outline-variant px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={requestCancel}
          >
            cancel
          </button>
          <button
            className="h-h-row bg-primary px-sm text-body-sm text-on-primary disabled:opacity-50"
            disabled={!name.trim() || isSaving}
            type="submit"
          >
            {isSaving ? "creating..." : "create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TrackMetadataDialog({
  track,
  onCancel,
  onSave,
}: {
  track?: Track;
  onCancel: () => void;
  onSave: (draft: TrackMetadataDraft) => Promise<void>;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [draft, setDraft] = useState<TrackMetadataDraft>(() => ({
    title: track?.title ?? "",
    artist: track?.artist ?? "",
    album: track?.album ?? "",
    genre: track?.genreOverride ?? track?.genre ?? "",
    year: (track?.yearOverride ?? track?.year ?? "").toString(),
  }));

  useEffect(() => {
    setDraft({
      title: track?.title ?? "",
      artist: track?.artist ?? "",
      album: track?.album ?? "",
      genre: track?.genreOverride ?? track?.genre ?? "",
      year: (track?.yearOverride ?? track?.year ?? "").toString(),
    });
  }, [track]);

  async function submit() {
    if (!track || isClosing) return;
    setIsClosing(true);
    try {
      await onSave(draft);
    } finally {
      setIsClosing(false);
    }
  }

  function requestCancel() {
    setIsClosing(true);
    window.setTimeout(onCancel, 180);
  }

  if (!track) return null;

  return (
    <div
      className={[
        "wave-dim-layer absolute inset-0 z-30 grid place-items-center",
        isClosing ? "wave-overlay-exit" : "",
      ].join(" ")}
      onClick={requestCancel}
    >
      <form
        className={[
          "wave-dialog-panel w-[440px] max-w-[calc(100vw-32px)] border border-outline-variant bg-surface-container-low p-md",
          isClosing ? "wave-popover-exit" : "",
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="mb-sm text-label-caps uppercase text-on-surface-variant">
          edit metadata
        </div>
        <div className="grid gap-sm">
          <input
            className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface placeholder:text-on-surface-variant"
            placeholder="title"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
          <input
            className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface placeholder:text-on-surface-variant"
            placeholder="artist"
            value={draft.artist}
            onChange={(event) => setDraft((current) => ({ ...current, artist: event.target.value }))}
          />
          <input
            className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface placeholder:text-on-surface-variant"
            placeholder="album"
            value={draft.album}
            onChange={(event) => setDraft((current) => ({ ...current, album: event.target.value }))}
          />
          <input
            className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface placeholder:text-on-surface-variant"
            placeholder="genre"
            value={draft.genre}
            onChange={(event) => setDraft((current) => ({ ...current, genre: event.target.value }))}
          />
          <input
            className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface placeholder:text-on-surface-variant"
            placeholder="year"
            value={draft.year}
            onChange={(event) => setDraft((current) => ({ ...current, year: event.target.value }))}
          />
        </div>
        <div className="mt-md flex justify-end gap-sm">
          <button
            className="h-h-row border border-outline-variant px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={requestCancel}
          >
            cancel
          </button>
          <button
            className="h-h-row bg-primary px-sm text-body-sm text-on-primary disabled:opacity-50"
            disabled={isClosing}
            type="submit"
          >
            save
          </button>
        </div>
      </form>
    </div>
  );
}

function AllTracksView({
  folderPath,
  onFolderPathChange,
  onAddFolder,
  onOpenFolderPicker,
  searchInputRef,
  selectedTrackId,
  onSelectTrack,
  currentTrackId,
  onPlayTrack,
  playlists,
  tracks,
  error,
  isScanning,
  scanSummary,
  onAddTrackToPlaylist,
  onAddToQueue,
  onPlayNext,
  onCreatePlaylistForTrack,
  onEditTrackMetadata,
  onHideTrack,
  onToggleLiked,
  isLikedView = false,
  filterFolderId = null,
  onClearFolderFilter,
  folders = [],
  scanProgress = null,
  onCancelScan,
  isPaused,
}: {
  folderPath: string;
  onFolderPathChange: (value: string) => void;
  onAddFolder: () => Promise<boolean>;
  onOpenFolderPicker: () => Promise<boolean>;
  searchInputRef: RefObject<HTMLInputElement>;
  selectedTrackId: number | null;
  onSelectTrack: (id: number) => void;
  currentTrackId: number | null;
  onPlayTrack: (id: number) => void;
  playlists: Playlist[];
  tracks: Track[];
  error: string | null;
  isScanning: boolean;
  scanSummary: string | null;
  onAddTrackToPlaylist: (trackId: number, playlistId: number) => Promise<void>;
  onAddToQueue: (trackId: number) => void;
  onPlayNext: (trackId: number) => void;
  onCreatePlaylistForTrack: (trackId: number, initialName: string) => void;
  onEditTrackMetadata: (trackId: number) => void;
  onHideTrack: (trackId: number) => void;
  onToggleLiked: (trackId: number) => void;
  isLikedView?: boolean;
  filterFolderId?: number | null;
  onClearFolderFilter?: () => void;
  folders?: Folder[];
  scanProgress?: { scanned: number; added: number; currentFile: string } | null;
  onCancelScan?: () => void;
  isPaused: boolean;
}) {
  const windowWidth = useWindowWidth();
  const isWideEnough = windowWidth >= 1280;
  const [trackQuery, setTrackQuery] = useState("");
  const [browseMode, setBrowseMode] = useState<TrackBrowseMode>("all");
  const [sortKey, setSortKey] = useState<TrackSortKey>("title");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const filteredTracks = filterTracks(filterTracksByBrowseMode(tracks, browseMode), trackQuery);
  const sortedTracks =
    browseMode === "all"
      ? sortTracks(filteredTracks, sortKey, sortDirection)
      : sortRecentTracks(filteredTracks, browseMode);

  const updateSort = (nextSortKey: TrackSortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  };

  const currentFolder = filterFolderId ? folders.find((f) => f.id === filterFolderId) : null;
  const folderName = currentFolder ? currentFolder.path.split(/[\\/]/).pop() || currentFolder.path : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-[64px] shrink-0 items-center gap-md border-b border-surface-container-high px-lg py-sm">
        <div className="flex flex-col gap-xs min-w-[120px]">
          <h1 className="m-0 text-headline font-semibold text-on-surface">
            {isLikedView ? "liked songs" : "all tracks"}
          </h1>
          {filterFolderId && currentFolder && onClearFolderFilter && (
            <div className="flex items-center gap-xs rounded-full bg-primary/10 border border-primary/20 px-xs py-[2px] text-body-xs text-primary self-start mt-xxs">
              <Icon name="folder" size={12} />
              <span className="max-w-[100px] truncate" title={currentFolder.path}>
                {folderName}
              </span>
              <button
                className="hover:bg-primary/20 rounded-full p-[2px] flex items-center justify-center transition-colors"
                type="button"
                onClick={onClearFolderFilter}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="min-w-[180px] max-w-[640px] flex-1">
          <input
            ref={searchInputRef}
            className="h-[40px] w-full border border-outline-variant bg-surface-container-low px-md text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
            placeholder="search tracks..."
            value={trackQuery}
            onChange={(event) => setTrackQuery(event.target.value)}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-xs">
          {!isLikedView && (
            <button
              className="h-h-row border border-outline-variant px-sm text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              type="button"
              onClick={onOpenFolderPicker}
            >
              + folder
            </button>
          )}
          {[
            { key: "all", label: "all" },
            { key: "recent-added", label: "recent added" },
            { key: "recent-played", label: "recent played" },
            ...(isWideEnough
              ? [
                  { key: "most-played", label: "most played" },
                  { key: "never-played", label: "never played" },
                ]
              : []),
          ].map((item) => (
            <button
              key={item.key}
              className={[
                "h-h-row border px-sm text-body-sm",
                browseMode === item.key
                  ? "border-primary bg-surface-variant text-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
              ].join(" ")}
              type="button"
              onClick={() => setBrowseMode(item.key as TrackBrowseMode)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      {tracks.length === 0 ? (
        isLikedView ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-md text-center select-none py-2xl">
            <span className="material-symbols-outlined text-[48px] text-on-surface-variant/20">favorite</span>
            <div>
              <p className="m-0 text-body-md font-semibold text-on-surface-variant">No liked songs yet</p>
              <p className="m-0 mt-xs text-body-sm text-on-surface-variant/50">Press the heart icon on any track to save it here</p>
            </div>
          </div>
        ) : (
          <EmptyTracksState
            folderPath={folderPath}
            onFolderPathChange={onFolderPathChange}
            onAddFolder={onAddFolder}
            onOpenFolderPicker={onOpenFolderPicker}
            error={error}
            isScanning={isScanning}
            scanSummary={scanSummary}
            scanProgress={scanProgress}
            onCancelScan={onCancelScan}
          />
        )
      ) : (
        <>
          {scanProgress && onCancelScan && (
            <div className="flex items-center justify-between gap-md border-b border-outline-variant bg-surface-container-low px-lg py-sm text-body-sm text-on-surface-variant">
              <div className="flex min-w-0 flex-1 items-center gap-sm">
                <span className="font-semibold text-primary">SCANNING</span>
                <span className="truncate">
                  {scanProgress.scanned} files scanned ({scanProgress.added} added)
                  {scanProgress.currentFile ? ` - ${scanProgress.currentFile}` : ""}
                </span>
              </div>
              <button
                className="flex h-[28px] shrink-0 items-center gap-xs border border-error px-sm text-[11px] font-medium text-error hover:bg-error/10 transition-colors"
                type="button"
                onClick={onCancelScan}
              >
                <Icon name="close" size={14} />
                <span>Cancel</span>
              </button>
            </div>
          )}
          {error ? (
            <div className="border-b border-surface-container-high px-lg py-sm">
              <p className="m-0 text-body-sm text-error">{error}</p>
            </div>
          ) : null}
          <TrackList
            currentTrackId={currentTrackId}
            selectedTrackId={selectedTrackId}
            playlists={playlists}
            onPlayTrack={onPlayTrack}
            onSelectTrack={onSelectTrack}
            onAddTrackToPlaylist={onAddTrackToPlaylist}
            onAddToQueue={onAddToQueue}
            onPlayNext={onPlayNext}
            onCreatePlaylistForTrack={onCreatePlaylistForTrack}
            onEditTrackMetadata={onEditTrackMetadata}
            onHideTrack={onHideTrack}
            onToggleLiked={onToggleLiked}
            sortDirection={sortDirection}
            sortKey={sortKey}
            tracks={sortedTracks}
            onSortChange={updateSort}
            isPaused={isPaused}
          />
        </>
      )}
    </div>
  );
}

function EmptyTracksState({
  folderPath,
  onFolderPathChange,
  onAddFolder,
  onOpenFolderPicker,
  error,
  isScanning,
  scanSummary,
  scanProgress = null,
  onCancelScan,
}: {
  folderPath: string;
  onFolderPathChange: (value: string) => void;
  onAddFolder: () => Promise<boolean>;
  onOpenFolderPicker: () => Promise<boolean>;
  error: string | null;
  isScanning: boolean;
  scanSummary: string | null;
  scanProgress?: { scanned: number; added: number; currentFile: string } | null;
  onCancelScan?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center px-xl">
      <p className="m-0 text-body-md text-on-surface-variant">no tracks yet.</p>
      <p className="mb-lg mt-xs text-body-md text-on-surface-variant">
        add a folder to scan local audio files.
      </p>
      <AddFolderPanel
        error={error}
        folderPath={folderPath}
        isScanning={isScanning}
        scanSummary={scanSummary}
        scanProgress={scanProgress}
        onCancelScan={onCancelScan}
        onAddFolder={onAddFolder}
        onFolderPathChange={onFolderPathChange}
        onOpenFolderPicker={onOpenFolderPicker}
      />
    </div>
  );
}

function AddFolderPanel({
  error,
  folderPath,
  isScanning,
  scanSummary,
  scanProgress = null,
  onCancelScan,
  onAddFolder,
  onFolderPathChange,
  onOpenFolderPicker,
}: {
  error: string | null;
  folderPath: string;
  isScanning: boolean;
  scanSummary: string | null;
  scanProgress?: { scanned: number; added: number; currentFile: string } | null;
  onCancelScan?: () => void;
  onAddFolder: () => Promise<boolean>;
  onFolderPathChange: (value: string) => void;
  onOpenFolderPicker: () => Promise<boolean>;
}) {
  return (
    <div>
      <div className="mb-sm flex items-center gap-sm">
        {isScanning && onCancelScan ? (
          <div className="flex items-center gap-sm">
            <span className="flex h-h-row items-center px-md text-body-sm text-on-surface-variant animate-pulse">
              scanning... {scanProgress ? `(${scanProgress.scanned} scanned / ${scanProgress.added} added)` : ""}
            </span>
            <button
              className="flex h-[28px] shrink-0 items-center gap-xs border border-error px-sm text-[11px] font-medium text-error hover:bg-error/10 transition-colors"
              type="button"
              onClick={onCancelScan}
            >
              <Icon name="close" size={14} />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <button
            className="h-h-row border border-outline-variant px-md text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={() => {
              void onOpenFolderPicker();
            }}
          >
            choose folder
          </button>
        )}
      </div>
      <form
        className="flex gap-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void onAddFolder();
        }}
      >
        <input
          className="h-h-row min-w-0 flex-1 border border-outline-variant bg-surface-container-low px-md text-body-sm text-on-surface placeholder:text-on-surface-variant"
          placeholder="manual path fallback..."
          value={folderPath}
          onChange={(event) => onFolderPathChange(event.target.value)}
        />
        <button
          className="h-h-row border border-outline-variant px-md text-body-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
          disabled={isScanning}
          type="submit"
        >
          add
        </button>
      </form>
      {error ? <p className="mb-0 mt-sm text-body-sm text-error">{error}</p> : null}
      {scanSummary ? (
        <p className="mb-0 mt-sm text-body-sm text-on-surface-variant">{scanSummary}</p>
      ) : null}
    </div>
  );
}

function TrackList({
  currentTrackId,
  selectedTrackId,
  playlists,
  onPlayTrack,
  onSelectTrack,
  onAddTrackToPlaylist,
  onAddToQueue,
  onPlayNext,
  onCreatePlaylistForTrack,
  onEditTrackMetadata,
  onHideTrack,
  onToggleLiked,
  onSortChange,
  sortDirection,
  sortKey,
  tracks,
  isPaused,
}: {
  currentTrackId: number | null;
  selectedTrackId: number | null;
  playlists: Playlist[];
  onPlayTrack: (id: number) => void;
  onSelectTrack: (id: number) => void;
  onAddTrackToPlaylist: (trackId: number, playlistId: number) => Promise<void>;
  onAddToQueue: (trackId: number) => void;
  onPlayNext: (trackId: number) => void;
  onCreatePlaylistForTrack: (trackId: number, initialName: string) => void;
  onEditTrackMetadata: (trackId: number) => void;
  onHideTrack: (trackId: number) => void;
  onToggleLiked: (trackId: number) => void;
  onSortChange: (sortKey: TrackSortKey) => void;
  sortDirection: SortDirection;
  sortKey: TrackSortKey;
  tracks: Track[];
  isPaused: boolean;
}) {
  const [menuTrackId, setMenuTrackId] = useState<number | null>(null);
  const [closingMenuTrackId, setClosingMenuTrackId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<TrackContextMenuState | null>(null);
  const closeMenuTimeoutRef = useRef<number | null>(null);

  const closeMenu = () => {
    if (closeMenuTimeoutRef.current !== null) {
      window.clearTimeout(closeMenuTimeoutRef.current);
    }

    if (menuTrackId !== null) {
      setClosingMenuTrackId(menuTrackId);
      setMenuTrackId(null);
      closeMenuTimeoutRef.current = window.setTimeout(() => {
        setClosingMenuTrackId(null);
        closeMenuTimeoutRef.current = null;
      }, 180);
    }
  };

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      if (closeMenuTimeoutRef.current !== null) {
        window.clearTimeout(closeMenuTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {menuTrackId !== null || closingMenuTrackId !== null ? (
        <button
          aria-label="close track actions"
          className={[
            "wave-dim-layer fixed inset-0 z-30 cursor-default",
            menuTrackId === null ? "wave-overlay-exit" : "",
          ].join(" ")}
          type="button"
          onClick={closeMenu}
        />
      ) : null}
      {contextMenu ? (
        <TrackContextMenu
          menu={contextMenu}
          playlists={playlists}
          track={tracks.find((track) => track.id === contextMenu.trackId)}
          onAddToPlaylist={async (playlistId) => {
            await onAddTrackToPlaylist(contextMenu.trackId, playlistId);
            setContextMenu(null);
          }}
          onAddToQueue={() => {
            onAddToQueue(contextMenu.trackId);
            setContextMenu(null);
          }}
          onPlayNext={() => {
            onPlayNext(contextMenu.trackId);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
          onCreatePlaylist={(initialName) => {
            onCreatePlaylistForTrack(contextMenu.trackId, initialName);
            setContextMenu(null);
          }}
          onEditMetadata={() => {
            onEditTrackMetadata(contextMenu.trackId);
            setContextMenu(null);
          }}
          onHideTrack={() => {
            onHideTrack(contextMenu.trackId);
            setContextMenu(null);
          }}
          onPlay={() => {
            void onPlayTrack(contextMenu.trackId);
            setContextMenu(null);
          }}
        />
      ) : null}
      <div className="sticky top-0 z-10 grid h-h-row w-full select-none grid-cols-[minmax(0,1fr)_36px_minmax(100px,20%)_minmax(100px,20%)_64px_32px] items-center border-b border-surface-container-high bg-surface px-md text-label uppercase tracking-[0.16em] text-on-surface-variant">
        <SortHeaderButton
          active={sortKey === "title"}
          direction={sortDirection}
          label="title"
          onClick={() => onSortChange("title")}
        />
        <span />
        <SortHeaderButton
          active={sortKey === "artist"}
          className="px-sm"
          direction={sortDirection}
          label="artist"
          onClick={() => onSortChange("artist")}
        />
        <SortHeaderButton
          active={sortKey === "album"}
          className="px-sm"
          direction={sortDirection}
          label="album"
          onClick={() => onSortChange("album")}
        />

        <SortHeaderButton
          active={sortKey === "duration"}
          className="justify-end text-right"
          direction={sortDirection}
          label="time"
          onClick={() => onSortChange("duration")}
        />
        <span />
      </div>
      {tracks.map((track) => {
        const selected = track.id === selectedTrackId;
        const playing = track.id === currentTrackId;
        return (
          <div
            key={track.id}
            className={[
              "relative grid h-h-row w-full select-none grid-cols-[minmax(0,1fr)_36px_minmax(100px,20%)_minmax(100px,20%)_64px_32px] items-center border-l-2 px-md text-left text-body-md transition-colors duration-150",
              selected
                ? "border-primary bg-surface-variant text-primary"
                : playing
                  ? "border-primary/50 bg-surface-container/50 text-primary font-medium"
                  : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
            ].join(" ")}
            onClick={() => onSelectTrack(track.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeMenu();
              onSelectTrack(track.id);
              setContextMenu({
                trackId: track.id,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onDoubleClick={() => void onPlayTrack(track.id)}
          >
            <span className="flex min-w-0 items-center gap-sm text-on-surface">
              {playing ? <PlayingEqualizer isPaused={isPaused} /> : null}
              <span className={playing ? "truncate text-primary" : "truncate"}>{track.title || track.fileName}</span>
            </span>
            <button
              aria-label={track.liked ? "unlike track" : "like track"}
              className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:text-primary transition-colors"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleLiked(track.id);
              }}
            >
              <Icon
                name={track.liked ? "favorite" : "favorite_border"}
                size={16}
                className={track.liked ? "text-primary" : "opacity-40"}
              />
            </button>
            <span className="truncate px-sm text-on-surface-variant">
              {track.artist ?? "-"}
            </span>
            <span className="truncate px-sm text-on-surface-variant">
              {track.album ?? "-"}
            </span>

            <span className="tabular text-right text-body-sm text-on-surface-variant">
              {formatDuration(track.durationSeconds)}
            </span>
            <button
              aria-label="track actions"
              className="grid h-h-row w-h-row place-items-center text-on-surface-variant hover:text-on-surface"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (menuTrackId === track.id) {
                  closeMenu();
                  return;
                }

                if (closeMenuTimeoutRef.current !== null) {
                  window.clearTimeout(closeMenuTimeoutRef.current);
                  closeMenuTimeoutRef.current = null;
                }
                setClosingMenuTrackId(null);
                setMenuTrackId(track.id);
              }}
            >
              <Icon name="more_horiz" size={18} />
            </button>
            {menuTrackId === track.id || closingMenuTrackId === track.id ? (
              <TrackActionMenu
                exiting={menuTrackId !== track.id}
                playlists={playlists}
                onAddTrackToPlaylist={async (playlistId) => {
                  await onAddTrackToPlaylist(track.id, playlistId);
                  closeMenu();
                }}
                onCreatePlaylist={(initialName) => {
                  onCreatePlaylistForTrack(track.id, initialName);
                  closeMenu();
                }}
                onHideTrack={() => {
                  onHideTrack(track.id);
                  closeMenu();
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SortHeaderButton({
  active,
  className = "",
  direction,
  label,
  onClick,
}: {
  active: boolean;
  className?: string;
  direction: SortDirection;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "flex min-w-0 items-center gap-xs text-left text-label uppercase tracking-[0.16em] hover:text-on-surface",
        active ? "text-primary" : "text-on-surface-variant",
        className,
      ].join(" ")}
      type="button"
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      {active ? (
        <Icon name={direction === "asc" ? "arrow_upward" : "arrow_downward"} size={12} />
      ) : null}
    </button>
  );
}

function TrackContextMenu({
  menu,
  playlists,
  track,
  onAddToPlaylist,
  onAddToQueue,
  onPlayNext,
  onClose,
  onCreatePlaylist,
  onEditMetadata,
  onHideTrack,
  onPlay,
}: {
  menu: TrackContextMenuState;
  playlists: Playlist[];
  track?: Track;
  onAddToPlaylist: (playlistId: number) => Promise<void>;
  onAddToQueue: () => void;
  onPlayNext: () => void;
  onClose: () => void;
  onCreatePlaylist: (initialName: string) => void;
  onEditMetadata: () => void;
  onHideTrack: () => void;
  onPlay: () => void;
}) {
  const [playlistQuery, setPlaylistQuery] = useState("");
  const filteredPlaylists = playlists.filter((playlist) =>
    playlist.name.toLowerCase().includes(playlistQuery.trim().toLowerCase()),
  );

  if (!track) return null;

  return (
    <>
      <button
        aria-label="close track context menu"
        className="fixed inset-0 z-30 cursor-default bg-transparent"
        type="button"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="wave-context-menu fixed z-40 w-[260px] border border-outline-variant bg-surface-container-low text-body-sm text-on-surface-variant"
        style={fitContextMenuPosition(menu.x, menu.y)}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="border-b border-surface-container-high px-md py-sm">
          <div className="truncate text-on-surface">{track.title || track.fileName}</div>
        </div>
        <button
          className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center px-md text-left hover:bg-surface-container-high hover:text-on-surface"
          type="button"
          onClick={onPlay}
        >
          <Icon name="play_arrow" size={16} />
          <span>play</span>
        </button>
        <button
          className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center px-md text-left hover:bg-surface-container-high hover:text-on-surface"
          type="button"
          onClick={onPlayNext}
        >
          <Icon name="queue_music" size={16} />
          <span>play next</span>
        </button>
        <button
          className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center px-md text-left hover:bg-surface-container-high hover:text-on-surface"
          type="button"
          onClick={onAddToQueue}
        >
          <Icon name="playlist_add" size={16} />
          <span>add to queue</span>
        </button>
        <button
          className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center px-md text-left hover:bg-surface-container-high hover:text-on-surface"
          type="button"
          onClick={onEditMetadata}
        >
          <Icon name="edit" size={16} />
          <span>edit metadata</span>
        </button>
        <div className="border-t border-surface-container-high px-md pt-sm pb-sm">
          <input
            className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm text-on-surface placeholder:text-on-surface-variant"
            placeholder="search or create playlist..."
            value={playlistQuery}
            onChange={(event) => setPlaylistQuery(event.target.value)}
          />
        </div>
        {filteredPlaylists.length === 0 ? (
          <div className="px-md py-sm text-on-surface-variant">no matching playlists</div>
        ) : (
          filteredPlaylists.map((playlist) => (
            <button
              key={playlist.id}
              className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)_24px] items-center px-md text-left hover:bg-surface-container-high hover:text-on-surface"
              type="button"
              onClick={() => void onAddToPlaylist(playlist.id)}
            >
              <Icon name="library_music" size={16} />
              <span className="truncate">{playlist.name}</span>
              <Icon name="add" size={16} />
            </button>
          ))
        )}
        {playlistQuery.trim() ? (
          <button
            className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center border-t border-surface-container-high px-md text-left text-primary hover:bg-surface-container-high"
            type="button"
            onClick={() => onCreatePlaylist(playlistQuery.trim())}
          >
            <Icon name="add" size={16} />
            <span className="truncate">create "{playlistQuery.trim()}"</span>
          </button>
        ) : null}
        <button
          className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center border-t border-surface-container-high px-md text-left text-on-surface-variant hover:bg-surface-container-high hover:text-error"
          type="button"
          onClick={onHideTrack}
        >
          <Icon name="visibility_off" size={16} />
          <span>hide from library</span>
        </button>
      </div>
    </>
  );
}

function TrackActionMenu({
  exiting,
  playlists,
  onAddTrackToPlaylist,
  onCreatePlaylist,
  onHideTrack,
}: {
  exiting: boolean;
  playlists: Playlist[];
  onAddTrackToPlaylist: (playlistId: number) => Promise<void>;
  onCreatePlaylist: (initialName: string) => void;
  onHideTrack: () => void;
}) {
  const [playlistQuery, setPlaylistQuery] = useState("");
  const filteredPlaylists = playlists.filter((playlist) =>
    playlist.name.toLowerCase().includes(playlistQuery.trim().toLowerCase()),
  );

  return (
    <div
      className={[
        "wave-popover-panel absolute right-md top-h-row z-40 min-w-w-nav border border-outline-variant bg-surface-container-low text-body-sm text-on-surface-variant",
        exiting ? "wave-popover-exit" : "",
      ].join(" ")}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-surface-container-high px-md py-sm">
        <div className="text-label-caps uppercase text-on-surface-variant">track actions</div>
      </div>
      <div className="px-md pt-sm pb-sm">
        <input
          className="h-h-row w-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm text-on-surface placeholder:text-on-surface-variant"
          placeholder="search or create playlist..."
          value={playlistQuery}
          onChange={(event) => setPlaylistQuery(event.target.value)}
        />
      </div>
      {filteredPlaylists.length === 0 ? (
        <div className="px-md py-sm text-on-surface-variant">no matching playlists</div>
      ) : (
        filteredPlaylists.map((playlist) => (
          <button
            key={playlist.id}
            className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)_24px] items-center px-md text-left hover:bg-surface-container-high hover:text-on-surface"
            type="button"
            onClick={() => void onAddTrackToPlaylist(playlist.id)}
          >
            <Icon name="playlist_add" size={16} />
            <span className="truncate">{playlist.name}</span>
            <span className="text-primary">
              <Icon name="add" size={16} />
            </span>
          </button>
        ))
      )}
      {playlistQuery.trim() ? (
        <button
          className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center border-t border-surface-container-high px-md text-left text-primary hover:bg-surface-container-high"
          type="button"
          onClick={() => onCreatePlaylist(playlistQuery.trim())}
        >
          <Icon name="add" size={16} />
          <span className="truncate">create "{playlistQuery.trim()}"</span>
        </button>
      ) : null}
      <button
        className="grid h-h-row w-full grid-cols-[24px_minmax(0,1fr)] items-center border-t border-surface-container-high px-md text-left text-on-surface-variant hover:bg-surface-container-high hover:text-error"
        type="button"
        onClick={onHideTrack}
      >
        <Icon name="visibility_off" size={16} />
        <span>hide from library</span>
      </button>
    </div>
  );
}

function NowPlayingBar({
  currentTrack,
  playbackDurationSeconds,
  isPaused,
  playbackMode,
  volume,
  authoritativeElapsedMs,
  onNext,
  onPlaybackModeChange,
  onPrevious,
  onQueueToggle,
  onSeek,
  onStop,
  onTogglePlayPause,
  onVolumeChange,
}: {
  currentTrack?: Track;
  playbackDurationSeconds?: number;
  isPaused: boolean;
  playbackMode: PlaybackMode;
  volume: number;
  authoritativeElapsedMs: number;
  onNext: () => void;
  onPlaybackModeChange: (mode: PlaybackMode) => void;
  onPrevious: () => void;
  onQueueToggle: () => void;
  onSeek: (elapsedMs: number) => void;
  onStop: () => void;
  onTogglePlayPause: () => void;
  onVolumeChange: (volume: number) => void;
}) {
  const hasTrack = currentTrack !== undefined;
  const durationSeconds = currentTrack?.durationSeconds ?? playbackDurationSeconds;
  const volumePercent = Math.round(volume * 100);
  const [displayElapsedMs, setDisplayElapsedMs] = useState(authoritativeElapsedMs);
  const clampedElapsedMs =
    durationSeconds && durationSeconds > 0
      ? Math.min(displayElapsedMs, durationSeconds * 1000)
      : displayElapsedMs;
  const elapsedSeconds = clampedElapsedMs / 1000;
  const elapsedPercent =
    durationSeconds && durationSeconds > 0
      ? Math.min(100, (elapsedSeconds / durationSeconds) * 100)
      : 0;
  const progressScale = String(clampPercent(elapsedPercent) / 100);
  const [isUserSeeking, setIsUserSeeking] = useState(false);

  useEffect(() => {
    setDisplayElapsedMs(authoritativeElapsedMs);
  }, [authoritativeElapsedMs, currentTrack?.id]);

  useEffect(() => {
    if (isPaused || !hasTrack || isUserSeeking) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setDisplayElapsedMs((current) => {
        const next = current + 100;
        return durationSeconds && durationSeconds > 0
          ? Math.min(next, durationSeconds * 1000)
          : next;
      });
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [durationSeconds, hasTrack, isPaused, isUserSeeking]);

  return (
    <footer className="relative h-h-now shrink-0 border-t border-surface-container-high bg-surface-container-low overflow-hidden">
      {hasTrack && !isPaused && (
        <div className="animate-ambient-glow pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-primary/5 blur-xl" />
      )}
      <div
        aria-label="progress"
        className={[
          "group absolute left-0 top-0 z-20 h-lg w-full",
          durationSeconds ? "cursor-pointer" : "cursor-default",
        ].join(" ")}
        role="progressbar"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(elapsedPercent)}
        onClick={(event) => {
          if (!durationSeconds) return;
          const nextElapsedMs = readPointerRatio(event) * durationSeconds * 1000;
          setDisplayElapsedMs(nextElapsedMs);
          onSeek(nextElapsedMs);
        }}
        onPointerDown={() => setIsUserSeeking(true)}
        onPointerUp={() => setIsUserSeeking(false)}
        onPointerLeave={() => setIsUserSeeking(false)}
      >
        <div className="relative h-sm w-full bg-surface-container-high group-hover:h-md group-focus-visible:h-md overflow-hidden">
          {hasTrack && !durationSeconds ? (
            <div
              className={[
                "wave-progress-indeterminate",
                isPaused ? "pause" : "",
              ].join(" ")}
            />
          ) : (
            <>
              <div
                className={[
                  "wave-progress-fill h-full w-full bg-primary",
                  hasTrack && !isPaused ? "wave-progress-fill-glow" : "",
                ].join(" ")}
                style={{
                  "--wave-progress": progressScale,
                  // Disable glide transition while user is dragging the bar
                  transition: isUserSeeking ? "none" : undefined,
                } as CSSProperties}
              />
              {hasTrack ? (
                <div
                  className="wave-progress-marker absolute top-0 h-full w-xs bg-on-surface"
                  style={{ "--wave-progress": progressScale } as CSSProperties}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className="relative z-10 flex h-full items-center px-lg pt-xs">
        <section className="min-w-0 flex-1 pr-md">
          <div className="text-body-md font-semibold text-on-surface">
            <MarqueeText text={currentTrack?.title ?? "-"} />
          </div>
          {currentTrack ? (
            <div className="text-[11px] text-on-surface-variant">
              <MarqueeText text={formatTrackSubtitle(currentTrack)} />
            </div>
          ) : (
            <div className="text-[11px] text-on-surface-variant/40">
              no track playing
            </div>
          )}
        </section>
        <section className="flex w-w-transport items-center justify-center gap-sm">
          <IconButton
            disabled={!hasTrack}
            icon="skip_previous"
            label="previous track"
            onClick={onPrevious}
          />
          <IconButton
            active={playbackMode === "shuffle"}
            icon="shuffle"
            label="shuffle"
            onClick={() =>
              onPlaybackModeChange(playbackMode === "shuffle" ? "normal" : "shuffle")
            }
          />
          <IconButton
            active={playbackMode === "repeat" || playbackMode === "repeat-one"}
            icon={playbackMode === "repeat-one" ? "repeat_one" : "repeat"}
            label="repeat"
            onClick={() => onPlaybackModeChange(nextRepeatMode(playbackMode))}
          />
          <IconButton
            disabled={!hasTrack}
            icon={isPaused ? "play_arrow" : "pause"}
            label={isPaused ? "play" : "pause"}
            primary
            onClick={onTogglePlayPause}
          />
          <IconButton disabled={!hasTrack} icon="stop" label="stop" onClick={onStop} />
          <IconButton
            disabled={!hasTrack}
            icon="skip_next"
            label="next track"
            onClick={onNext}
          />
        </section>
        <section className="flex min-w-0 flex-1 items-center justify-end gap-md">
          <span className="tabular w-w-meter text-right text-body-sm text-on-surface-variant">
            {formatDuration(elapsedSeconds)} / {formatDuration(durationSeconds)}
          </span>
          <IconButton icon="low_priority" label="toggle queue" onClick={onQueueToggle} />
          <IconButton
            icon="volume_down"
            label="volume down"
            onClick={() => onVolumeChange(volume - 0.1)}
          />
          <div
            aria-label="volume"
            className="flex h-xs w-w-meter gap-px"
            role="progressbar"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={volumePercent}
            onClick={(event) => onVolumeChange(readPointerRatio(event))}
          >
            <SegmentedMeter segments={10} value={volumePercent} />
          </div>
          <IconButton
            icon="volume_up"
            label="volume up"
            onClick={() => onVolumeChange(volume + 0.1)}
          />
        </section>
      </div>
    </footer>
  );
}

function SegmentedMeter({ segments, value }: { segments: number; value: number }) {
  const filledSegments = Math.round((clampPercent(value) / 100) * segments);

  return (
    <div className="flex h-full w-full gap-px">
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          className={[
            "h-full min-w-0 flex-1",
            index < filledSegments ? "bg-primary" : "bg-surface-container-high",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

function IconButton({
  active = false,
  disabled,
  icon,
  label,
  onClick,
  primary = false,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className={[
        "grid place-items-center",
        primary
          ? "h-h-cta w-h-cta rounded-button bg-primary text-on-primary"
          : active
            ? "h-h-row w-h-row bg-surface-variant text-primary"
          : "h-h-row w-h-row text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
      ].join(" ")}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <Icon name={icon} size={primary ? 24 : 18} />
    </button>
  );
}

function fromBackendTrack(track: BackendTrack): Track {
  return {
    id: track.id,
    folderId: track.folder_id,
    path: track.path,
    title: track.title ?? track.file_name,
    artist: track.artist ?? undefined,
    album: track.album ?? undefined,
    durationSeconds: track.duration_seconds ?? undefined,
    createdAt: track.created_at,
    lastPlayedAt: track.last_played_at ?? undefined,
    fileName: track.file_name,
    liked: track.liked,
    playCount: track.play_count,
    genre: track.genre ?? undefined,
    year: track.year ?? undefined,
    genreOverride: track.genre_override ?? undefined,
    yearOverride: track.year_override ?? undefined,
    lastPositionMs: track.last_position_ms,
  };
}

function fromBackendFolders(backendFolders: BackendFolder[], tracks: Track[]): Folder[] {
  return backendFolders.map((folder) => ({
    id: folder.id,
    path: folder.path,
    pinned: folder.pinned,
    trackCount: tracks.filter((track) => track.folderId === folder.id).length,
  }));
}

function fromBackendPlaylists(
  backendPlaylists: BackendPlaylist[],
  tracks: Track[],
): Playlist[] {
  return backendPlaylists.map((playlist) => {
    const playlistTracks = playlist.track_ids
      .map((trackId) => tracks.find((track) => track.id === trackId))
      .filter((track): track is Track => track !== undefined);

    return {
      id: playlist.id,
      name: playlist.name,
      trackCount: playlistTracks.length,
      tracks: playlistTracks,
      pinned: playlist.pinned,
    };
  });
}

function buildAlbums(tracks: Track[]): Album[] {
  const albums = new Map<string, Album>();

  for (const track of tracks) {
    if (!track.album) continue;
    const artist = track.artist ?? "-";
    const key = `${artist}\u0000${track.album}`;
    const existing = albums.get(key);
    if (existing) {
      existing.trackCount += 1;
      existing.tracks.push(track);
    } else {
      albums.set(key, {
        id: key,
        name: track.album,
        artist,
        trackCount: 1,
        tracks: [track],
      });
    }
  }

  return [...albums.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildArtists(tracks: Track[]): Artist[] {
  const artists = new Map<string, Artist>();

  for (const track of tracks) {
    if (!track.artist) continue;
    const existing = artists.get(track.artist);
    if (existing) {
      existing.trackCount += 1;
      existing.tracks.push(track);
    } else {
      artists.set(track.artist, { name: track.artist, trackCount: 1, tracks: [track] });
    }
  }

  return [...artists.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function filterPlaylistCandidates(tracks: Track[], playlist: Playlist, query: string): Track[] {
  const normalizedQuery = query.trim().toLowerCase();
  const playlistTrackIds = new Set(playlist.tracks.map((track) => track.id));

  return tracks
    .filter((track) => !playlistTrackIds.has(track.id))
    .filter((track) => {
      if (!normalizedQuery) return true;
      const haystack = [
        track.title,
        track.artist ?? "",
        track.album ?? "",
        track.fileName,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .slice(0, 20);
}

function filterTracks(tracks: Track[], query: string): Track[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return tracks;

  return tracks.filter((track) => matchesTrackQuery(track, normalizedQuery));
}

function matchesTrackQuery(track: Track, query: string) {
  return [track.title, track.artist ?? "", track.album ?? "", track.fileName]
    .join(" ")
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}

function filterTracksByBrowseMode(tracks: Track[], mode: TrackBrowseMode): Track[] {
  if (mode === "recent-added") {
    return [...tracks].sort((first, second) => {
      const compared = compareIsoDates(second.createdAt, first.createdAt);
      if (compared !== 0) return compared;
      return first.id - second.id;
    });
  }

  if (mode === "recent-played") {
    return [...tracks]
      .filter((track) => track.lastPlayedAt !== undefined)
      .sort((first, second) => {
        const compared = compareIsoDates(second.lastPlayedAt ?? "", first.lastPlayedAt ?? "");
        if (compared !== 0) return compared;
        return first.id - second.id;
      });
  }

  return tracks;
}

function sortRecentTracks(tracks: Track[], mode: Exclude<TrackBrowseMode, "all">): Track[] {
  if (mode === "recent-added") {
    return [...tracks].sort((first, second) => {
      const compared = compareIsoDates(second.createdAt, first.createdAt);
      if (compared !== 0) return compared;
      return first.id - second.id;
    });
  }

  return [...tracks]
    .filter((track) => track.lastPlayedAt !== undefined)
    .sort((first, second) => {
      const compared = compareIsoDates(second.lastPlayedAt ?? "", first.lastPlayedAt ?? "");
      if (compared !== 0) return compared;
      return first.id - second.id;
    });
}

function compareIsoDates(first: string, second: string) {
  return Date.parse(first || "0") - Date.parse(second || "0");
}

function sortTracks(
  tracks: Track[],
  sortKey: TrackSortKey,
  direction: SortDirection,
): Track[] {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...tracks].sort((first, second) => {
    const compared = compareTracks(first, second, sortKey);
    if (compared !== 0) return compared * multiplier;

    return first.id - second.id;
  });
}

function compareTracks(first: Track, second: Track, sortKey: TrackSortKey): number {
  if (sortKey === "duration") {
    return (first.durationSeconds ?? Number.MAX_SAFE_INTEGER) -
      (second.durationSeconds ?? Number.MAX_SAFE_INTEGER);
  }

  const firstValue = getTrackSortText(first, sortKey);
  const secondValue = getTrackSortText(second, sortKey);

  return firstValue.localeCompare(secondValue, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getTrackSortText(track: Track, sortKey: Exclude<TrackSortKey, "duration">): string {
  if (sortKey === "title") return track.title || track.fileName;
  if (sortKey === "artist") return track.artist ?? "";
  return track.album ?? "";
}

function readStoredTheme(): AppTheme {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isAppTheme(storedTheme)) return storedTheme;
  return "dark";
}

function readStoredSidebarWidth() {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!raw) return 220;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 220;
  return Math.max(180, Math.min(320, Math.round(parsed)));
}

function readStoredPlaybackMode(): PlaybackMode {
  const raw = window.localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY);
  if (raw === "normal" || raw === "shuffle" || raw === "repeat" || raw === "repeat-one") {
    return raw;
  }
  return "normal";
}

function readStoredWindowState(): StoredWindowState | null {
  const raw = window.localStorage.getItem(WINDOW_STATE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWindowState>;
    if (
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number" ||
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.isMaximized !== "boolean"
    ) {
      return null;
    }

    if (parsed.width < 720 || parsed.height < 480) {
      return null;
    }

    return {
      width: Math.round(parsed.width),
      height: Math.round(parsed.height),
      x: Math.round(parsed.x),
      y: Math.round(parsed.y),
      isMaximized: parsed.isMaximized,
    };
  } catch {
    return null;
  }
}

function readStoredQueue(): QueueItem[] {
  const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "number") {
          return {
            id: `${item}-${Math.random()}-${Date.now()}`,
            trackId: item,
          };
        } else if (item && typeof item === "object" && typeof item.trackId === "number") {
          return {
            id: item.id || `${item.trackId}-${Math.random()}-${Date.now()}`,
            trackId: item.trackId,
          };
        }
        return null;
      })
      .filter((item): item is QueueItem => item !== null);
  } catch {
    return [];
  }
}

function isAppTheme(value: string | null): value is AppTheme {
  return THEME_OPTIONS.some((option) => option.theme === value);
}

function readDropTarget(position: { x: number; y: number }): DropTarget | null {
  const candidates = [
    document.elementFromPoint(position.x, position.y),
    document.elementFromPoint(position.x / window.devicePixelRatio, position.y / window.devicePixelRatio),
  ];

  for (const element of candidates) {
    const target = element?.closest<HTMLElement>("[data-drop-target]");
    if (!target) continue;

    if (target.dataset.dropTarget === "all-tracks") return { type: "all-tracks" };
    if (target.dataset.dropTarget === "playlist") {
      const playlistId = Number(target.dataset.playlistId);
      if (Number.isFinite(playlistId)) return { type: "playlist", playlistId };
    }
  }

  if (document.elementFromPoint(position.x, position.y)?.closest("[data-sidebar-drop]")) {
    return { type: "all-tracks" };
  }

  const scaledElement = document.elementFromPoint(
    position.x / window.devicePixelRatio,
    position.y / window.devicePixelRatio,
  );
  if (scaledElement?.closest("[data-sidebar-drop]")) return { type: "all-tracks" };

  return null;
}

function fitContextMenuPosition(x: number, y: number): CSSProperties {
  const menuWidth = 260;
  const estimatedMenuHeight = 360;
  const gap = 8;

  return {
    left: Math.min(x, window.innerWidth - menuWidth - gap),
    top: Math.min(y, window.innerHeight - estimatedMenuHeight - gap),
  };
}

function formatImportHint(paths: string[], summary: ImportSummary, target: DropTarget) {
  const destination = target.type === "playlist" ? " to playlist" : "";
  if (summary.track_ids.length === 0) {
    return `no audio tracks found${summary.errors ? `, ${summary.errors} errors` : ""}`;
  }

  if (paths.length === 1 && looksLikeAudioPath(paths[0])) {
    if (summary.existing === 1 && summary.added === 0) {
      return `${fileNameFromPath(paths[0])} already in library`;
    }
    return `${fileNameFromPath(paths[0])} imported${destination}`;
  }

  if (summary.added > 0) {
    return `${summary.added} imported${destination}${summary.existing ? `, ${summary.existing} already existed` : ""}`;
  }

  return `${summary.track_ids.length} tracks${destination}`;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function isLinuxDesktop() {
  if (typeof navigator === "undefined") return false;
  return /linux/i.test(navigator.userAgent);
}

function isWindowsDesktop() {
  if (typeof navigator === "undefined") return false;
  return /windows/i.test(navigator.userAgent);
}

function hasCompletedQuickSetup() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.localStorage.getItem(QUICK_SETUP_STORAGE_KEY) === "done";
}

function validateMusicFolderPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  if (isFilesystemRootPath(trimmed)) {
    return "choose a music folder, not a whole drive root like C:\\ or D:\\.";
  }

  return null;
}

function isFilesystemRootPath(path: string) {
  if (/^[a-zA-Z]:[\\\/]*$/.test(path)) {
    return true;
  }

  const normalized = path.replace(/\\/g, "/");
  return normalized === "/";
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function findMonitorForWindowState(
  monitors: Awaited<ReturnType<typeof availableMonitors>>,
  state: StoredWindowState,
) {
  const centerX = state.x + state.width / 2;
  const centerY = state.y + state.height / 2;
  return (
    monitors.find((monitor) => {
      const { position, workArea } = monitor;
      const minX = workArea.position.x ?? position.x;
      const minY = workArea.position.y ?? position.y;
      const maxX = minX + workArea.size.width;
      const maxY = minY + workArea.size.height;
      return centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
    }) ?? null
  );
}

function clampWindowStateToMonitor(
  state: StoredWindowState,
  monitor: NonNullable<Awaited<ReturnType<typeof primaryMonitor>>>,
) {
  const area = monitor.workArea;
  const width = Math.min(state.width, area.size.width);
  const height = Math.min(state.height, area.size.height);
  const minX = area.position.x;
  const minY = area.position.y;
  const maxX = area.position.x + area.size.width - width;
  const maxY = area.position.y + area.size.height - height;

  return {
    ...state,
    width,
    height,
    x: Math.min(Math.max(state.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(state.y, minY), Math.max(minY, maxY)),
  };
}

function looksLikeAudioPath(path: string) {
  return /\.(aac|aiff?|alac|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(path);
}


function formatDuration(durationSeconds: number | undefined) {
  if (durationSeconds === undefined) return "-";

  const wholeSeconds = Math.floor(durationSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function clampVolume(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function nextRepeatMode(mode: PlaybackMode): PlaybackMode {
  if (mode === "repeat") return "repeat-one";
  if (mode === "repeat-one") return "normal";
  return "repeat";
}

function nextPlaybackMode(mode: PlaybackMode): PlaybackMode {
  if (mode === "normal") return "shuffle";
  if (mode === "shuffle") return "repeat";
  if (mode === "repeat") return "repeat-one";
  return "normal";
}

function isInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function readPointerRatio(event: ReactMouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}

function formatTrackSubtitle(track: Track) {
  if (track.artist && track.album) return `${track.artist} / ${track.album}`;
  if (track.artist) return track.artist;
  if (track.album) return track.album;

  const pathParts = track.path.split(/[\\/]/);
  return pathParts.at(-2) ?? track.fileName;
}

function isRunningInTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    // Debounce: avoid setState on every ResizeObserver tick
    let debounceTimer: number | undefined;
    const checkOverflow = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        setShouldScroll(textEl.offsetWidth > container.offsetWidth);
      }, 100);
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(container);

    return () => {
      window.clearTimeout(debounceTimer);
      resizeObserver.disconnect();
    };
  }, [text]);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden whitespace-nowrap">
      <span
        ref={textRef}
        className={[
          "inline-block",
          shouldScroll ? "animate-marquee" : "",
          className || "",
        ].join(" ")}
        style={{
          paddingRight: shouldScroll ? "2rem" : "0",
        }}
      >
        {text}
        {shouldScroll && <span className="pl-8">{text}</span>}
      </span>
    </div>
  );
}
function FileNotFoundDialog({
  track,
  onRemove,
  onDismiss,
}: {
  track?: Track;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const name = track?.title || track?.fileName || "Unknown track";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="relative flex w-[400px] max-w-[90vw] flex-col gap-4 rounded-xl border border-outline-variant bg-surface-container p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
      >
        {/* Icon */}
        <div className="flex items-center gap-3">
          <span
            className="material-symbols-outlined text-icon-24 text-error"
            aria-hidden="true"
            style={{ fontSize: 28 }}
          >
            folder_off
          </span>
          <h2 className="text-title-md font-semibold text-on-surface">File not found</h2>
        </div>

        {/* Message */}
        <p className="text-body-md text-on-surface-variant leading-relaxed">
          The audio file for{" "}
          <span className="font-medium text-on-surface">"{name}"</span> could not be found on
          disk — it may have been moved, renamed, or deleted.
        </p>
        <p className="text-body-sm text-on-surface-variant">
          Do you want to remove it from your library?
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            id="file-not-found-dismiss"
            className="rounded-md px-4 py-2 text-body-md text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-highest"
            onClick={onDismiss}
          >
            Keep it
          </button>
          <button
            id="file-not-found-remove"
            className="rounded-md bg-error px-4 py-2 text-body-md text-on-primary font-medium transition-all duration-150 hover:opacity-90 active:scale-95"
            onClick={onRemove}
          >
            Remove from library
          </button>
        </div>
      </div>
    </div>
  );
}

function shuffleArray<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default App;
