import { supabase } from "../supabase.js";
import { AudioLibrary } from "./audioLibrary.js";
import { Favorites } from "./favorites.js";

const MUSIC_SCENE_HANDOFF_MS = 2000;

/** @type {null | Record<string, unknown>} */
let musicAppBridge = null;

    const nowPlayingTitle = document.querySelector(".track-title");
    const musicProgressRange = document.getElementById("music-progress");
    const musicProgressCurrentEl = document.getElementById("music-progress-current");
    const musicProgressDurationEl = document.getElementById("music-progress-duration");
    const musicPrevButton = document.getElementById("music-prev");
    const musicPlayButton = document.getElementById("music-play");
    const musicPauseButton = document.getElementById("music-pause");
    const musicNextButton = document.getElementById("music-next");
    const musicShuffleButton = document.getElementById("music-shuffle");
    const musicVolumeSlider = document.getElementById("music-volume");
    const musicPlaylistElement = document.getElementById("music-playlist");
    const musicRepeatToggleButton = document.getElementById("music-repeat-toggle");
    const musicPlayer = new Audio();
    let musicVolumeAnimFrameId = null;
    let musicVolumeAnimGeneration = 0;
    let musicPlaybackScene = null;
    let currentTrackIndex = 0;
    /** When `musicPlaybackScene !== musicAppBridge.getCurrentScene()`, index in the selected scene's list that Play will use after the old track fades out. */
    let pendingPlayTrackIndex = 0;
    let musicRepeatMode = "list"; // "list" | "one"
    let musicQueuedNextTrackIndex = null;
    let musicShuffleEnabled = false;
    const MUSIC_SELECTION_STORAGE_KEY = "ttrpg_music_selection_v1";
    function clampPlaylistIndex(index, tracks) {
      if (!tracks.length) {
        return 0;
      }
      const n = Number(index);
      if (!Number.isFinite(n) || n < 0) {
        return 0;
      }
      if (n >= tracks.length) {
        return tracks.length - 1;
      }
      return n;
    }
    function loadMusicSelectionForScene(sceneKey) {
      if (!sceneKey || !musicAppBridge.isCustomSceneKey(sceneKey)) {
        return 0;
      }
      try {
        const raw = JSON.parse(localStorage.getItem(MUSIC_SELECTION_STORAGE_KEY) || "{}");
        const n = Number(raw[sceneKey]);
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    }

    function saveMusicSelectionForScene(sceneKey, index) {
      if (!sceneKey || !musicAppBridge.isCustomSceneKey(sceneKey)) {
        return;
      }
      try {
        const raw = JSON.parse(localStorage.getItem(MUSIC_SELECTION_STORAGE_KEY) || "{}");
        raw[sceneKey] = index;
        localStorage.setItem(MUSIC_SELECTION_STORAGE_KEY, JSON.stringify(raw));
      } catch {
        /* ignore */
      }
    }
    function setMusicRepeatMode(mode) {
      if (mode !== "list" && mode !== "one") {
        return;
      }
      musicRepeatMode = mode;
      musicQueuedNextTrackIndex = null;
      if (musicRepeatToggleButton) {
        musicRepeatToggleButton.textContent = mode === "one" ? "Repeat: 1 track" : "Repeat: List";
      }
    }

    function queueNextMusicTrack(index) {
      const uiTracks = getSceneTracks(musicAppBridge.getCurrentScene());
      if (!uiTracks.length) {
        return;
      }
      index = clampPlaylistIndex(index, uiTracks);
      pendingPlayTrackIndex = index;
      if (musicAppBridge.getCurrentScene()) {
        saveMusicSelectionForScene(musicAppBridge.getCurrentScene(), index);
      }

      // Scene switched while old music still plays — selection applies when Play is used.
      if (musicPlaybackScene !== musicAppBridge.getCurrentScene()) {
        musicQueuedNextTrackIndex = null;
        renderMusicPlaylist();
        return;
      }

      if (musicPlayer.paused) {
        musicQueuedNextTrackIndex = null;
        currentTrackIndex = index;
        void loadCurrentTrack();
        updateNowPlayingDisplay();
        renderMusicPlaylist();
        musicAppBridge.syncSceneAudioIndicators();
        return;
      }

      // While playing, click queues that track after the current one ends.
      musicQueuedNextTrackIndex = index === currentTrackIndex ? null : index;
      renderMusicPlaylist();
    }
    function getMusicGroupLevel() {
      return Number(musicVolumeSlider.value) / 100;
    }

    function effectiveMusicVolume() {
      return musicAppBridge.getMasterLevel() * getMusicGroupLevel();
    }
    function cancelMusicVolumeAnim() {
      musicVolumeAnimGeneration += 1;
      if (musicVolumeAnimFrameId !== null) {
        cancelAnimationFrame(musicVolumeAnimFrameId);
        musicVolumeAnimFrameId = null;
      }
    }
    function createFavoriteStarButton(initialActive, onToggle) {
      const star = document.createElement("span");
      star.className = "fav-star";
      star.setAttribute("role", "button");
      star.tabIndex = 0;
      star.dataset.favStar = "1";
      const sync = (isActive) => {
        star.classList.toggle("is-fav", Boolean(isActive));
        star.textContent = isActive ? "★" : "☆";
        star.setAttribute("aria-pressed", isActive ? "true" : "false");
        star.setAttribute(
          "aria-label",
          isActive ? "Unfavorite" : "Favorite",
        );
        star.title = isActive ? "Unfavorite" : "Favorite";
      };
      sync(Boolean(initialActive));
      const handle = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof onToggle === "function") {
          onToggle(e);
        }
      };
      star.addEventListener("click", handle);
      star.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          handle(e);
        }
      });
      star.sync = sync;
      return star;
    }
    function applyIdleMusicVolume() {
      if (!musicPlayer.paused) {
        return;
      }
      musicPlayer.volume = effectiveMusicVolume();
    }
    function runMusicFadeOut(outEl, onComplete) {
      const generation = musicVolumeAnimGeneration;
      const start = performance.now();
      const startVol = outEl.volume;

      function frame(now) {
        if (generation !== musicVolumeAnimGeneration) {
          return;
        }
        const t = Math.min(1, (now - start) / MUSIC_SCENE_HANDOFF_MS);
        outEl.volume = startVol * (1 - t);
        if (t < 1) {
          musicVolumeAnimFrameId = requestAnimationFrame(frame);
        } else {
          musicVolumeAnimFrameId = null;
          outEl.pause();
          outEl.removeAttribute("src");
          outEl.load();
          outEl.volume = effectiveMusicVolume();
          if (generation === musicVolumeAnimGeneration) {
            onComplete();
          }
        }
      }

      musicVolumeAnimFrameId = requestAnimationFrame(frame);
    }

    function detachMusicEnded(player) {
      player.removeEventListener("ended", onMusicTrackEnded);
    }

    function attachMusicEnded(player) {
      detachMusicEnded(player);
      player.addEventListener("ended", onMusicTrackEnded);
    }

    function onMusicTrackEnded() {
      if (
        musicQueuedNextTrackIndex != null &&
        musicPlaybackScene === musicAppBridge.getCurrentScene()
      ) {
        currentTrackIndex = musicQueuedNextTrackIndex;
        pendingPlayTrackIndex = currentTrackIndex;
        if (musicAppBridge.getCurrentScene()) {
          saveMusicSelectionForScene(musicAppBridge.getCurrentScene(), pendingPlayTrackIndex);
        }
        musicQueuedNextTrackIndex = null;
        musicPlayer.volume = effectiveMusicVolume();
        void loadCurrentTrack().then((ok) => {
          if (ok) {
            musicPlayer.play().then(() => {
              setupMediaSession();
              renderMusicPlaylist();
              musicAppBridge.syncSceneAudioIndicators();
            }).catch(() => {
              renderMusicPlaylist();
              musicAppBridge.syncSceneAudioIndicators();
            });
          }
        });
        return;
      }

      if (musicRepeatMode === "one") {
        // Restart the same track when it ends.
        musicPlayer.currentTime = 0;
        musicPlayer.play().then(() => {
          updateNowPlayingDisplay();
          renderMusicPlaylist();
          updateMusicProgressUi();
          musicAppBridge.syncSceneAudioIndicators();
        }).catch(() => {
          // Fallback to old behavior if replay fails.
          goToNextTrack(true);
        });
        return;
      }

      musicQueuedNextTrackIndex = null;
      goToNextTrack(true);
    }

    let musicProgressSeeking = false;

    function formatPlaybackTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00";
      }
      const totalSec = Math.floor(seconds);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}:${String(s).padStart(2, "0")}`;
    }

    function updateMusicProgressUi() {
      if (!musicProgressRange || !musicProgressCurrentEl || !musicProgressDurationEl) {
        return;
      }
      const tracks = getSceneTracks(musicPlaybackScene);
      const hasPlaylistSlot =
        tracks.length > 0 &&
        currentTrackIndex >= 0 &&
        currentTrackIndex < tracks.length;
      const hasSrc = Boolean(musicPlayer.src && musicPlayer.src !== "");
      const dur = Number.isFinite(musicPlayer.duration) ? musicPlayer.duration : 0;
      const cur = Number.isFinite(musicPlayer.currentTime) ? musicPlayer.currentTime : 0;

      if (!hasPlaylistSlot || !hasSrc || dur <= 0) {
        musicProgressRange.disabled = true;
        musicProgressRange.max = 1;
        if (!musicProgressSeeking) {
          musicProgressRange.value = 0;
        }
        musicProgressRange.setAttribute("aria-valuemax", "1");
        musicProgressRange.setAttribute("aria-valuenow", "0");
        musicProgressCurrentEl.textContent = formatPlaybackTime(0);
        musicProgressDurationEl.textContent = formatPlaybackTime(0);
        return;
      }

      musicProgressRange.disabled = false;
      musicProgressRange.max = dur;
      if (!musicProgressSeeking) {
        musicProgressRange.value = cur;
      }
      musicProgressRange.setAttribute("aria-valuemax", String(dur));
      musicProgressRange.setAttribute("aria-valuenow", String(cur));
      musicProgressCurrentEl.textContent = formatPlaybackTime(cur);
      musicProgressDurationEl.textContent = formatPlaybackTime(dur);
    }

    function getSceneTracks(sceneKey) {
      if (musicAppBridge.isCustomSceneKey(sceneKey)) {
        const cs = musicAppBridge.getCustomSceneByKey(sceneKey);
        return cs && Array.isArray(cs.playlist) ? cs.playlist : [];
      }
      return [];
    }

    function getTrackLabel(filePath) {
      const rest = musicAppBridge.stripUserUploadRef(String(filePath || ""));
      const parts = rest.split("/");
      const fileName = parts[parts.length - 1] || rest;
      return fileName.replace(/\.[^.]+$/, "");
    }

    function formatAutoLabelFromPath(filePath) {
      const raw = getTrackLabel(String(filePath || ""));
      const compact = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      if (!compact) {
        return "";
      }
      return compact
        .split(" ")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }

    function updateNowPlayingDisplay() {
      const tracks = getSceneTracks(musicPlaybackScene);
      if (!tracks.length) {
        nowPlayingTitle.textContent = "Now Playing: No tracks in this scene";
        updateMusicProgressUi();
        return;
      }

      const title =
        AudioLibrary.getPlaylistTrackTitle(tracks[currentTrackIndex]) ||
        getTrackLabel(tracks[currentTrackIndex]);
      nowPlayingTitle.textContent = `Now Playing: ${title}`;
      updateMusicProgressUi();
    }

    function setupMediaSession() {
      if (!("mediaSession" in navigator)) return;

      const tracks = getSceneTracks(musicPlaybackScene);
      if (!tracks.length || currentTrackIndex < 0) return;

      const title = AudioLibrary.getPlaylistTrackTitle(tracks[currentTrackIndex])
        || getTrackLabel(tracks[currentTrackIndex])
        || "Skald";

      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: "Skald Sound Board",
        album: musicAppBridge.getCurrentScene() ? String(musicAppBridge.getCurrentScene()) : "Session",
      });

      navigator.mediaSession.setActionHandler("play", () => {
        void playMusic();
      });

      navigator.mediaSession.setActionHandler("pause", () => {
        pauseMusic();
      });

      navigator.mediaSession.setActionHandler("nexttrack", () => {
        goToNextTrack(true);
      });

      navigator.mediaSession.setActionHandler("previoustrack", () => {
        goToPreviousTrack(true);
      });

      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime != null && Number.isFinite(details.seekTime)) {
          try {
            musicPlayer.currentTime = details.seekTime;
          } catch {
            /* ignore seek failures */
          }
        }
      });

      navigator.mediaSession.playbackState = "playing";
    }

    function updateMediaSessionPosition() {
      if (!("mediaSession" in navigator)) return;
      if (!navigator.mediaSession.setPositionState) return;
      if (!musicPlayer.duration || !Number.isFinite(musicPlayer.duration)) return;

      try {
        navigator.mediaSession.setPositionState({
          duration: musicPlayer.duration,
          playbackRate: musicPlayer.playbackRate || 1,
          position: Math.min(musicPlayer.currentTime, musicPlayer.duration),
        });
      } catch {
        /* ignore position state failures */
      }
    }

    function renderMusicPlaylist() {
      const tracks = getSceneTracks(musicAppBridge.getCurrentScene());
      musicPlaylistElement.innerHTML = "";

      if (!tracks.length) {
        const emptyItem = document.createElement("li");
        emptyItem.textContent = "No tracks for this scene.";
        musicPlaylistElement.appendChild(emptyItem);
        return;
      }

      const synced = musicPlaybackScene === musicAppBridge.getCurrentScene();
      tracks.forEach((trackFilePath, index) => {
        const trackItem = document.createElement("li");
        const titleText =
          AudioLibrary.getPlaylistTrackTitle(trackFilePath) || getTrackLabel(trackFilePath);

        const row = document.createElement("div");
        row.className = "playlist-row";
        const titleEl = document.createElement("span");
        titleEl.className = "playlist-title";
        titleEl.textContent = titleText;
        row.appendChild(titleEl);

        const entry = AudioLibrary.getEntryByPathSync(trackFilePath, "music");
        const trackId = entry ? entry.id : null;
        const star = createFavoriteStarButton(
          trackId ? Favorites.has("music", trackId) : false,
          () => {
            if (!trackId) {
              return;
            }
            void Favorites.toggle("music", trackId).then((on) => {
              star.sync(Boolean(on));
            });
          },
        );
        if (!trackId) {
          star.style.visibility = "hidden";
          star.tabIndex = -1;
        }
        row.appendChild(star);
        trackItem.appendChild(row);

        const isNowPlaying =
          synced && !musicPlayer.paused && index === currentTrackIndex;
        const isSelected = index === pendingPlayTrackIndex;
        const isNextUp =
          synced &&
          !musicPlayer.paused &&
          musicQueuedNextTrackIndex != null &&
          musicQueuedNextTrackIndex === index;

        if (isNowPlaying) {
          trackItem.classList.add("active");
        } else if (isSelected && (!isNowPlaying || musicPlayer.paused)) {
          trackItem.classList.add("selected");
        } else if (!synced && isSelected) {
          trackItem.classList.add("selected");
        }
        if (isNextUp) {
          trackItem.classList.add("next-up");
        }

        trackItem.title = trackFilePath;
        trackItem.setAttribute("role", "button");
        trackItem.tabIndex = 0;
        trackItem.addEventListener("click", (e) => {
          if (e.target && e.target.closest && e.target.closest("[data-fav-star]")) {
            return;
          }
          queueNextMusicTrack(index);
        });
        trackItem.addEventListener("keydown", (e) => {
          if (e.target && e.target.closest && e.target.closest("[data-fav-star]")) {
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            queueNextMusicTrack(index);
          }
        });
        musicPlaylistElement.appendChild(trackItem);
      });
      musicAppBridge.syncSceneAudioIndicators();
    }

    async function loadCurrentTrack() {
      const tracks = getSceneTracks(musicPlaybackScene);
      if (!tracks.length) {
        musicPlayer.removeAttribute("src");
        musicPlayer.load();
        updateNowPlayingDisplay();
        renderMusicPlaylist();
        return false;
      }

      if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        currentTrackIndex = 0;
      }

      const nextSrc = await musicAppBridge.resolveAudioPlaybackUrl(tracks[currentTrackIndex]);
      if (!nextSrc) {
        updateNowPlayingDisplay();
        renderMusicPlaylist();
        return false;
      }
      if (musicPlayer.getAttribute("src") !== nextSrc) {
        musicPlayer.src = nextSrc;
      }

      updateNowPlayingDisplay();
      renderMusicPlaylist();
      return true;
    }

    async function startMusicPlaybackAtIndex(targetIndex, options) {
      const opts = options || {};
      const sceneKey = opts.sceneKey != null ? opts.sceneKey : musicAppBridge.getCurrentScene();
      const tracks = getSceneTracks(sceneKey);
      if (!tracks.length) {
        return;
      }
      const index = clampPlaylistIndex(targetIndex, tracks);
      musicQueuedNextTrackIndex = null;
      currentTrackIndex = index;
      pendingPlayTrackIndex = index;
      if (sceneKey) {
        saveMusicSelectionForScene(sceneKey, index);
      }
      musicPlaybackScene = sceneKey;

      if (!(await loadCurrentTrack())) {
        return;
      }

      detachMusicEnded(musicPlayer);
      attachMusicEnded(musicPlayer);
      musicPlayer.volume = effectiveMusicVolume();
      try {
        await musicPlayer.play();
        setupMediaSession();
      } catch {
        /* ignore */
      }
      renderMusicPlaylist();
      musicAppBridge.syncSceneAudioIndicators();
    }

    async function playMusic() {
      const destTracks = getSceneTracks(musicAppBridge.getCurrentScene());
      if (!destTracks.length) {
        return;
      }

      const targetIndex = clampPlaylistIndex(pendingPlayTrackIndex, destTracks);
      pendingPlayTrackIndex = targetIndex;
      saveMusicSelectionForScene(musicAppBridge.getCurrentScene(), targetIndex);

      cancelMusicVolumeAnim();

      if (musicPlaybackScene !== musicAppBridge.getCurrentScene()) {
        if (!musicPlayer.paused) {
          detachMusicEnded(musicPlayer);
          runMusicFadeOut(musicPlayer, () => {
            void startMusicPlaybackAtIndex(targetIndex, { sceneKey: musicAppBridge.getCurrentScene() });
          });
          return;
        }
        await startMusicPlaybackAtIndex(targetIndex, { sceneKey: musicAppBridge.getCurrentScene() });
        return;
      }

      if (
        musicPlaybackScene === musicAppBridge.getCurrentScene() &&
        targetIndex === currentTrackIndex
      ) {
        if (!musicPlayer.paused) {
          return;
        }
        if (!(await loadCurrentTrack())) {
          return;
        }
        detachMusicEnded(musicPlayer);
        attachMusicEnded(musicPlayer);
        musicPlayer.volume = effectiveMusicVolume();
        try {
          await musicPlayer.play();
          setupMediaSession();
        } catch {
          /* ignore */
        }
        renderMusicPlaylist();
        musicAppBridge.syncSceneAudioIndicators();
        return;
      }

      const playingOtherTrack =
        !musicPlayer.paused && targetIndex !== currentTrackIndex;

      if (playingOtherTrack) {
        detachMusicEnded(musicPlayer);
        runMusicFadeOut(musicPlayer, () => {
          void startMusicPlaybackAtIndex(targetIndex, { sceneKey: musicAppBridge.getCurrentScene() });
        });
        return;
      }

      await startMusicPlaybackAtIndex(targetIndex, { sceneKey: musicAppBridge.getCurrentScene() });
    }

    function pauseMusic() {
      cancelMusicVolumeAnim();
      detachMusicEnded(musicPlayer);
      musicPlayer.pause();
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
      applyIdleMusicVolume();
      renderMusicPlaylist();
      updateMusicProgressUi();
      musicAppBridge.syncSceneAudioIndicators();
    }

    function goToNextTrack(shouldPlay) {
      musicQueuedNextTrackIndex = null;
      if (musicPlaybackScene !== musicAppBridge.getCurrentScene()) {
        if (musicPlayer.paused && shouldPlay) {
          const tracks = getSceneTracks(musicPlaybackScene);
          if (!tracks.length) {
            return;
          }
          cancelMusicVolumeAnim();
          currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
          void loadCurrentTrack().then((ok) => {
            if (!ok) {
              return;
            }
            detachMusicEnded(musicPlayer);
            attachMusicEnded(musicPlayer);
            musicPlayer.volume = effectiveMusicVolume();
            musicPlayer.play()
              .then(() => {
                setupMediaSession();
                renderMusicPlaylist();
              })
              .catch(() => {
                renderMusicPlaylist();
              });
          });
          return;
        }
        const uiTracks = getSceneTracks(musicAppBridge.getCurrentScene());
        if (!uiTracks.length) {
          return;
        }
        pendingPlayTrackIndex = (pendingPlayTrackIndex + 1) % uiTracks.length;
        renderMusicPlaylist();
        return;
      }

      const tracks = getSceneTracks(musicPlaybackScene);
      if (!tracks.length) {
        return;
      }

      cancelMusicVolumeAnim();
      if (musicShuffleEnabled && tracks.length > 1) {
        let next = currentTrackIndex;
        let guard = 0;
        while (next === currentTrackIndex && guard < 48) {
          next = Math.floor(Math.random() * tracks.length);
          guard += 1;
        }
        currentTrackIndex = next;
      } else {
        currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
      }
      void loadCurrentTrack().then((ok) => {
        if (!ok) {
          renderMusicPlaylist();
          return;
        }
        if (shouldPlay) {
          detachMusicEnded(musicPlayer);
          attachMusicEnded(musicPlayer);
          musicPlayer.volume = effectiveMusicVolume();
          musicPlayer.play()
            .then(() => {
              setupMediaSession();
              renderMusicPlaylist();
            })
            .catch(() => {
              renderMusicPlaylist();
            });
        } else {
          renderMusicPlaylist();
        }
      });
    }

    function goToPreviousTrack(shouldPlay) {
      musicQueuedNextTrackIndex = null;
      if (musicPlaybackScene !== musicAppBridge.getCurrentScene()) {
        if (musicPlayer.paused && shouldPlay) {
          const tracks = getSceneTracks(musicPlaybackScene);
          if (!tracks.length) {
            return;
          }
          cancelMusicVolumeAnim();
          currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
          void loadCurrentTrack().then((ok) => {
            if (!ok) {
              return;
            }
            detachMusicEnded(musicPlayer);
            attachMusicEnded(musicPlayer);
            musicPlayer.volume = effectiveMusicVolume();
            musicPlayer.play()
              .then(() => {
                setupMediaSession();
                renderMusicPlaylist();
              })
              .catch(() => {
                renderMusicPlaylist();
              });
          });
          return;
        }
        const uiTracks = getSceneTracks(musicAppBridge.getCurrentScene());
        if (!uiTracks.length) {
          return;
        }
        pendingPlayTrackIndex = (pendingPlayTrackIndex - 1 + uiTracks.length) % uiTracks.length;
        renderMusicPlaylist();
        return;
      }

      const tracks = getSceneTracks(musicPlaybackScene);
      if (!tracks.length) {
        return;
      }

      cancelMusicVolumeAnim();
      currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
      void loadCurrentTrack().then((ok) => {
        if (!ok) {
          renderMusicPlaylist();
          return;
        }
        if (shouldPlay) {
          detachMusicEnded(musicPlayer);
          attachMusicEnded(musicPlayer);
          musicPlayer.volume = effectiveMusicVolume();
          musicPlayer.play()
            .then(() => {
              setupMediaSession();
              renderMusicPlaylist();
            })
            .catch(() => {
              renderMusicPlaylist();
            });
        } else {
          renderMusicPlaylist();
        }
      });
    }

    function setSceneMusic(sceneName) {
      const previousScene = musicAppBridge.getCurrentScene();
      musicAppBridge.setCurrentScene(sceneName);
      const sameScene = previousScene === sceneName;

      if (sameScene) {
        updateNowPlayingDisplay();
        renderMusicPlaylist();
        musicAppBridge.syncSceneAudioIndicators();
        return;
      }

      musicQueuedNextTrackIndex = null;
      cancelMusicVolumeAnim();

      const newTracks = getSceneTracks(musicAppBridge.getCurrentScene());
      const savedSelection = loadMusicSelectionForScene(sceneName);
      pendingPlayTrackIndex = clampPlaylistIndex(savedSelection, newTracks);

      if (musicPlayer.paused) {
        currentTrackIndex = pendingPlayTrackIndex;
        musicPlaybackScene = musicAppBridge.getCurrentScene();
        detachMusicEnded(musicPlayer);
        void loadCurrentTrack();
        return;
      }

      if (!newTracks.length) {
        currentTrackIndex = 0;
        pendingPlayTrackIndex = 0;
        detachMusicEnded(musicPlayer);
        runMusicFadeOut(musicPlayer, () => {
          musicPlaybackScene = musicAppBridge.getCurrentScene();
          musicPlayer.removeAttribute("src");
          musicPlayer.load();
          musicPlayer.volume = effectiveMusicVolume();
          updateNowPlayingDisplay();
          renderMusicPlaylist();
          updateMusicProgressUi();
          musicAppBridge.syncSceneAudioIndicators();
        });
        return;
      }

      updateNowPlayingDisplay();
      renderMusicPlaylist();
      musicAppBridge.syncSceneAudioIndicators();
    }

    function initializeMusicPlayer() {
      musicPlayer.preload = "auto";
      musicPlaybackScene = musicAppBridge.getCurrentScene();
      musicPlayer.volume = effectiveMusicVolume();

      if (musicAppBridge.isIOS && musicVolumeSlider) {
        musicAppBridge.attachIosDeviceVolumeHintBelow(musicVolumeSlider);
      }

      document.addEventListener("visibilitychange", musicAppBridge.onDocumentVisibilityForAmbient);

      musicPlayButton.addEventListener("click", () => {
        void playMusic();
      });
      musicPauseButton.addEventListener("click", () => {
        pauseMusic();
      });
      musicNextButton.addEventListener("click", () => {
        goToNextTrack(!musicPlayer.paused);
      });
      musicPrevButton.addEventListener("click", () => {
        goToPreviousTrack(!musicPlayer.paused);
      });
      const primaryMaster = musicAppBridge.masterVolumeSliderDesktop || musicAppBridge.masterVolumeSliderMobile;
      if (primaryMaster) {
        musicAppBridge.syncMasterVolumeUiFrom(primaryMaster);
      }
      const onMasterInput = (e) => {
        musicAppBridge.syncMasterVolumeUiFrom(e.target);
        musicAppBridge.refreshMasterAndGroupVolumes();
      };
      if (musicAppBridge.masterVolumeSliderDesktop) {
        musicAppBridge.masterVolumeSliderDesktop.addEventListener("input", onMasterInput);
      }
      if (musicAppBridge.masterVolumeSliderMobile) {
        musicAppBridge.masterVolumeSliderMobile.addEventListener("input", onMasterInput);
      }
      musicVolumeSlider.addEventListener("input", () => {
        musicAppBridge.refreshMasterAndGroupVolumes();
      });


      if (musicRepeatToggleButton) {
        musicRepeatToggleButton.addEventListener("click", () => {
          setMusicRepeatMode(musicRepeatMode === "one" ? "list" : "one");
        });
      }

      if (musicShuffleButton) {
        musicShuffleButton.classList.toggle("active", musicShuffleEnabled);
        musicShuffleButton.setAttribute(
          "aria-pressed",
          musicShuffleEnabled ? "true" : "false",
        );
        musicShuffleButton.addEventListener("click", () => {
          musicShuffleEnabled = !musicShuffleEnabled;
          musicShuffleButton.classList.toggle("active", musicShuffleEnabled);
          musicShuffleButton.setAttribute(
            "aria-pressed",
            musicShuffleEnabled ? "true" : "false",
          );
        });
      }

      if (musicAppBridge.editSceneTopButton) {
        musicAppBridge.editSceneTopButton.addEventListener("click", () => {
          if (musicAppBridge.getCurrentScene() && musicAppBridge.isCustomSceneKey(musicAppBridge.getCurrentScene())) {
            void musicAppBridge.openSceneEditorForEdit(musicAppBridge.getCurrentScene());
          } else {
            void musicAppBridge.openSceneEditorNew();
          }
        });
      }

      if (musicAppBridge.ambientPlayAllButton) {
        musicAppBridge.ambientPlayAllButton.addEventListener("click", () => {
          musicAppBridge.playAllAmbientLayers();
        });
      }
      if (musicAppBridge.ambientStopAllButton) {
        musicAppBridge.ambientStopAllButton.addEventListener("click", () => {
          musicAppBridge.stopAllAmbientLayers();
        });
      }

      musicPlayer.addEventListener("timeupdate", () => {
        updateMusicProgressUi();
        updateMediaSessionPosition();
      });
      musicPlayer.addEventListener("loadedmetadata", updateMusicProgressUi);
      musicPlayer.addEventListener("durationchange", updateMusicProgressUi);

      if (musicProgressRange) {
        musicProgressRange.addEventListener("pointerdown", () => {
          musicProgressSeeking = true;
        });
        musicProgressRange.addEventListener("pointerup", () => {
          musicProgressSeeking = false;
          updateMusicProgressUi();
        });
        musicProgressRange.addEventListener("pointercancel", () => {
          musicProgressSeeking = false;
          updateMusicProgressUi();
        });
        musicProgressRange.addEventListener("input", () => {
          const dur = musicPlayer.duration;
          if (!Number.isFinite(dur) || dur <= 0 || musicProgressRange.disabled) {
            return;
          }
          musicPlayer.currentTime = Number(musicProgressRange.value);
          if (musicProgressCurrentEl) {
            musicProgressCurrentEl.textContent = formatPlaybackTime(musicPlayer.currentTime);
          }
          musicProgressRange.setAttribute("aria-valuenow", String(musicPlayer.currentTime));
        });
      }

      window.addEventListener("audio-manifest-loaded", () => {
        void musicAppBridge.buildSfxSectionFilterPills();
        void musicAppBridge.renderFxButtons();
        renderMusicPlaylist();
        updateNowPlayingDisplay();
      });

      void loadCurrentTrack();
    }
function toggleMusicPlayback() {
  if (musicPlayer.paused) {
    void playMusic();
  } else {
    pauseMusic();
  }
}

function isSceneMusicActive(sceneKey) {
  return musicPlaybackScene === sceneKey && !musicPlayer.paused;
}

function getMusicPlaybackScene() {
  return musicPlaybackScene;
}

function getMusicPlayerElement() {
  return musicPlayer;
}

function setMusicPlaybackScene(sceneKey) {
  musicPlaybackScene = sceneKey;
}

function resetMusicForNoScene() {
  musicPlaybackScene = null;
  currentTrackIndex = 0;
  pendingPlayTrackIndex = 0;
  musicQueuedNextTrackIndex = null;
  cancelMusicVolumeAnim();
  detachMusicEnded(musicPlayer);
  musicPlayer.pause();
  musicPlayer.removeAttribute("src");
  musicPlayer.load();
  musicPlayer.volume = effectiveMusicVolume();
}

function preparePausedScenePlay(sceneKey) {
  musicPlaybackScene = sceneKey;
  pendingPlayTrackIndex = currentTrackIndex;
  void loadCurrentTrack();
}

renderMusicPlaylist.configure = (bridge) => {
  musicAppBridge = bridge;
};

renderMusicPlaylist.setSceneMusic = setSceneMusic;
renderMusicPlaylist.initialize = initializeMusicPlayer;
renderMusicPlaylist.playMusic = playMusic;
renderMusicPlaylist.pauseMusic = pauseMusic;
renderMusicPlaylist.detachMusicEnded = detachMusicEnded;
renderMusicPlaylist.startMusicPlaybackAtIndex = startMusicPlaybackAtIndex;
renderMusicPlaylist.updateNowPlayingDisplay = updateNowPlayingDisplay;
renderMusicPlaylist.applyIdleMusicVolume = applyIdleMusicVolume;
renderMusicPlaylist.isSceneMusicActive = isSceneMusicActive;
renderMusicPlaylist.getMusicPlaybackScene = getMusicPlaybackScene;
renderMusicPlaylist.getMusicPlayerElement = getMusicPlayerElement;
renderMusicPlaylist.setMusicPlaybackScene = setMusicPlaybackScene;
renderMusicPlaylist.resetForNoScene = resetMusicForNoScene;
renderMusicPlaylist.preparePausedScenePlay = preparePausedScenePlay;
renderMusicPlaylist.getTrackLabel = getTrackLabel;
renderMusicPlaylist.refreshMasterMusicVolume = () => {
  if (!musicPlayer.paused) {
    musicPlayer.volume = effectiveMusicVolume();
  } else {
    applyIdleMusicVolume();
  }
};

export {
  renderMusicPlaylist as renderMusicPlayer,
  loadCurrentTrack as loadAndPlayTrack,
  goToNextTrack as playNextTrack,
  goToPreviousTrack as playPrevTrack,
  toggleMusicPlayback,
};
