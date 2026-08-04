import { supabase } from "../supabase.js";
import { initProductTour } from "./tour.js";
import { AudioLibrary } from "./audioLibrary.js";
import { Favorites } from "./favorites.js";
import { UserTags, loadSuggestedTagsOnce, createUserTagButton, openUserTagPopover } from "./userTags.js";
import { renderFxButtons, appendSfxTile, buildSfxSectionFilterPills } from "./sfx.js";
import { openFilePicker, closeFilePicker, renderFilePickerList } from "./filePicker.js";

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

    const sceneButtonsBar = document.getElementById("scene-buttons-bar");
    const customBgmContainer = document.getElementById("custom-bgm-layers");
    const ambientPanelActions = document.getElementById("ambient-panel-actions");
    const ambientPlayAllButton = document.getElementById("ambient-play-all");
    const ambientStopAllButton = document.getElementById("ambient-stop-all");
    let customBgmLayerRegistry = [];
    /** Ambient layers still playing after switching away from their scene (fade out when new scene ambient starts). */
    let ambientCarryoverAudios = [];
    let ambientFadeGeneration = 0;
    let ambientFadeRafId = null;
    /** When a fade is in progress; cancelled fades dispose these entries. */
    let ambientFadePendingEntries = null;
    let ambientFadeGenAtStart = 0;
    let ambientFadeStartTime = 0;
    let ambientFadeStartVols = [];
    let ambientFadeHiddenMsAccum = 0;
    let ambientFadeHiddenAt = null;
    let ambientFadeOnComplete = null;
    let ambientFadeDisposeOnComplete = true;
    const CUSTOM_SCENES_STORAGE_KEY = "dndMoodBuilder.v1.customScenes";
    const ACTIVE_SCENE_STORAGE_KEY = "dndMoodBuilder.v1.activeSceneKey";
    const ACTIVE_SESSION_STORAGE_KEY = "dndMoodBuilder.v1.activeSessionId";
    let customScenesList = [];
    /** @type {{ id: string, name: string, description: string | null, sort_order: number }[]} */
    let sessionsList = [];
    /** @type {string | null} */
    let activeSessionId = null;
    /** Last auth session from Supabase; used for session UI without async. */
    let lastAuthSession = null;
    /** After first scene bootstrap; avoids re-activating scene (and killing ambient) on repeat auth events. */
    let sceneBootstrapComplete = false;
    let bootstrappedAuthUserId = null;
    let sessionMenuOpen = false;
    let sessionMenuGlobalCloseBound = false;

    const sessionSelectorWrap = document.getElementById("session-selector-wrap");
    const editorSessionFieldMount = document.getElementById("editor-session-field-mount");

    function getEditorSessionField() {
      return document.getElementById("editor-session-field");
    }

    function getEditorSceneSessionSelect() {
      return document.getElementById("editor-scene-session");
    }

    /**
     * Scene editor session UI exists only for signed-in users. Clears the mount when anonymous.
     */
    async function buildSceneEditorSessionSectionIfSignedIn() {
      const mount = editorSessionFieldMount || document.getElementById("editor-session-field-mount");
      if (!mount) {
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const isSignedIn = !!user;
      mount.innerHTML = "";
      if (!isSignedIn) {
        return;
      }
      mount.innerHTML =
        '<div class="editor-field" id="editor-session-field">' +
        '<label for="editor-scene-session">Session</label>' +
        '<select id="editor-scene-session"></select>' +
        "</div>";
    }

    const sceneEditorBackdrop = document.getElementById("scene-editor-backdrop");
    const createNewSceneButton = document.getElementById("create-new-scene");
    const editorSceneName = document.getElementById("editor-scene-name");
    const editorSceneTags = document.getElementById("editor-scene-tags");
    const editorPlaylistList = document.getElementById("editor-playlist-list");
    const editorPlaylistFile = document.getElementById("editor-playlist-file");
    const editorPlaylistSelectedFile = document.getElementById("editor-playlist-selected-file");
    const editorPlaylistBrowse = document.getElementById("editor-playlist-browse");
    const editorAmbientRows = document.getElementById("editor-ambient-rows");
    const editorAmbientAdd = document.getElementById("editor-ambient-add");
    const editorSaveScene = document.getElementById("editor-save-scene");
    const editorCancelScene = document.getElementById("editor-cancel-scene");
    const deleteSceneBackdrop = document.getElementById("delete-scene-backdrop");
    const deleteSceneMessageEl = document.getElementById("delete-scene-message");
    const deleteSceneCancelBtn = document.getElementById("delete-scene-cancel");
    const deleteSceneConfirmBtn = document.getElementById("delete-scene-confirm");
    const accountSignInBtn = document.getElementById("account-sign-in");
    const accountSignedInEl = document.getElementById("account-signed-in");
    const accountEmailEl = document.getElementById("account-email");
    const accountSubscribeBtn = document.getElementById("account-subscribe");
    const accountManageWrap = document.getElementById("account-manage-wrap");
    const accountManageSubscriptionBtn = document.getElementById("account-manage-subscription");
    const accountManageMenu = document.getElementById("account-manage-menu");
    const accountBillingBtn = document.getElementById("account-billing");
    const accountManageMenuDivider = document.getElementById("account-manage-menu-divider");
    const accountDeleteBtn = document.getElementById("account-delete");
    const deleteAccountModalBackdrop = document.getElementById("delete-account-modal-backdrop");
    const deleteAccountConfirmInput = document.getElementById("delete-account-confirm-input");
    const deleteAccountConfirmBtn = document.getElementById("delete-account-confirm");
    const deleteAccountCancelBtn = document.getElementById("delete-account-cancel");
    const deleteAccountErrorEl = document.getElementById("delete-account-error");
    let deleteAccountInFlight = false;
    const accountSignOutBtn = document.getElementById("account-sign-out");
    const authModalBackdrop = document.getElementById("auth-modal-backdrop");
    const authModalErrorEl = document.getElementById("auth-modal-error");
    const authEmailInput = document.getElementById("auth-email");
    const authPasswordInput = document.getElementById("auth-password");
    const authModalCancelBtn = document.getElementById("auth-modal-cancel");
    const authModalSubmitBtn = document.getElementById("auth-modal-submit");
    const authModalSignUpBtn = document.getElementById("auth-modal-sign-up");
    const authForgotPasswordLink = document.getElementById("auth-forgot-password-link");
    const authTosCheckbox = document.getElementById("auth-tos-checkbox");
    const PENDING_TOS_AGREEMENT_KEY = "skald_pending_tos_agreement";
    const sceneLimitModalBackdrop = document.getElementById("scene-limit-modal-backdrop");
    const sceneLimitDismissBtn = document.getElementById("scene-limit-modal-dismiss");
    const sceneLimitSignInBtn = document.getElementById("scene-limit-modal-sign-in");
    const sceneLimitSignUpBtn = document.getElementById("scene-limit-modal-sign-up");
    const upgradeModalBackdrop = document.getElementById("upgrade-modal-backdrop");
    const upgradeModalLaterBtn = document.getElementById("upgrade-modal-later");
    const upgradeModalRestoreSignInBtn = document.getElementById("upgrade-modal-restore-sign-in");
    const upgradeModalBodyEl = document.getElementById("upgrade-modal-body");
    const upgradeModalBodyDefaultHtml = upgradeModalBodyEl?.innerHTML ?? "";
    const railSceneUsageEl = document.getElementById("rail-scene-usage");
    const feedbackModalBackdrop = document.getElementById("feedback-modal-backdrop");
    const feedbackBtnDesktop = document.getElementById("feedback-btn-desktop");
    const feedbackBtnDock = document.getElementById("feedback-btn-dock");
    const feedbackFormWrap = document.getElementById("feedback-modal-form-wrap");
    const feedbackThanksWrap = document.getElementById("feedback-modal-thanks");
    const feedbackMessageEl = document.getElementById("feedback-message");
    const feedbackEmailEl = document.getElementById("feedback-email");
    const feedbackSubmitBtn = document.getElementById("feedback-modal-submit");
    const feedbackCancelBtn = document.getElementById("feedback-modal-cancel");
    const feedbackSubmitErrorEl = document.getElementById("feedback-submit-error");

    const ANON_CUSTOM_SCENE_LIMIT = 3;
    const FREE_SIGNED_IN_SCENE_LIMIT = 5;
    const FREE_SIGNED_IN_SESSION_LIMIT = 1;
    const DEFAULT_SESSION_NAME = "My Scenes";
    const PAID_TIERS = new Set(["paid", "subscriber", "subscription", "pro"]);
    /** @type {Map<string, Promise<boolean>>} */
    const ensureSessionsInFlight = new Map();

    /** @type {null | { scene_count: number, session_count: number, scene_limit: number, session_limit: number, scene_limit_reached: boolean, session_limit_reached: boolean }} */
    let userLimits = null;
    let userTier = "free";
    let stripeCustomerId = null;
    let limitModalCooldownUntil = 0;
    const LIMIT_MODAL_COOLDOWN_MS = 2000;

    let selectedFeedbackCategory = null;
    let feedbackCloseTimerId = null;
    let pendingDeleteSceneKey = null;
    let sceneEditorDraftPlaylist = [];
    let sceneEditorDraftAmbient = [];
    let sceneEditorEditingId = null;
    let sceneEditorPreviewAudio = null;
    /** @type {HTMLElement | null} */
    let sceneEditorReturnFocus = null;
    const nowPlayingTitle = document.querySelector(".track-title");
    const musicProgressRange = document.getElementById("music-progress");
    const musicProgressCurrentEl = document.getElementById("music-progress-current");
    const musicProgressDurationEl = document.getElementById("music-progress-duration");
    const musicPrevButton = document.getElementById("music-prev");
    const musicPlayButton = document.getElementById("music-play");
    const musicPauseButton = document.getElementById("music-pause");
    const musicNextButton = document.getElementById("music-next");
    const musicShuffleButton = document.getElementById("music-shuffle");
    const editSceneTopButton = document.getElementById("edit-scene-top");
    const masterVolumeSliderDesktop = document.getElementById("master-volume");
    const masterVolumeSliderMobile = document.getElementById("master-volume-mobile");
    const masterVolumePctEl = document.getElementById("master-volume-pct");
    const musicVolumeSlider = document.getElementById("music-volume");
    const musicPlaylistElement = document.getElementById("music-playlist");
    const musicRepeatToggleButton = document.getElementById("music-repeat-toggle");
    const MUSIC_SCENE_HANDOFF_MS = 2000;
    const musicPlayer = new Audio();
    const USER_UPLOAD_PREFIX = "user-upload:";
    const USER_UPLOAD_BUCKET = "user-uploads";
    const USER_LIBRARY_QUOTA_BYTES = 500 * 1024 * 1024;
    const USER_UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024;
    /** storage path within bucket → { url, expiresAt: unix seconds } */
    const userUploadSignedUrlCache = new Map();

    // iOS volume control via Web Audio API
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    let iosAudioCtx = null;
    let iosMasterGain = null;

    function getOrCreateIosAudioCtx() {
      if (!isIOS) return null;
      if (iosAudioCtx) return iosAudioCtx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      iosAudioCtx = new AC();
      iosMasterGain = iosAudioCtx.createGain();
      iosMasterGain.gain.setValueAtTime(getMasterLevel(), iosAudioCtx.currentTime);
      iosMasterGain.connect(iosAudioCtx.destination);
      renderFxButtons.wireIosSfxGain(iosAudioCtx, iosMasterGain);
      return iosAudioCtx;
    }

    function resumeIosAudioCtx() {
      if (!iosAudioCtx) return;
      if (iosAudioCtx.state === 'suspended') {
        void iosAudioCtx.resume();
      }
    }

    const iosGainNodes = new WeakMap();

    function getOrCreateIosGainNode(audioEl) {
      if (!isIOS || !audioEl) return null;
      const ctx = getOrCreateIosAudioCtx();
      if (!ctx) return null;
      if (iosGainNodes.has(audioEl)) return iosGainNodes.get(audioEl);
      // crossOrigin must be set before src for CORS to work
      // Only wrap if element has a src already set
      if (!audioEl.src && !audioEl.currentSrc) return null;
      try {
        const source = ctx.createMediaElementSource(audioEl);
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(1, ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(iosMasterGain);
        iosGainNodes.set(audioEl, gainNode);
        return gainNode;
      } catch (e) {
        console.warn('[Skald iOS] GainNode creation failed:', e.message);
        return null;
      }
    }

    function setAudioVolume(audioEl, effectiveVolume) {
      audioEl.volume = Math.max(0, Math.min(1, effectiveVolume));
    }


    function attachIosDeviceVolumeHintBelow(sliderEl, wrapStyle) {
      if (!isIOS || !sliderEl?.parentElement) {
        return;
      }
      const parent = sliderEl.parentElement;
      const wrap = document.createElement("div");
      wrap.className = "ios-vol-hint-stack";
      wrap.style.cssText =
        wrapStyle ||
        "display:flex;flex-direction:column;align-items:stretch;min-width:0;";
      parent.insertBefore(wrap, sliderEl);
      wrap.appendChild(sliderEl);
      const hint = document.createElement("p");
      hint.className = "ios-device-vol-hint";
      hint.textContent = "Use device volume on iPhone";
      hint.style.cssText =
        "font-size:11px;color:var(--muted);font-weight:normal;margin:2px 0 0;line-height:1.3;";
      wrap.appendChild(hint);
    }

    async function getSignedUserUploadUrl(storagePath) {
      const path = String(storagePath || "").replace(/^\/+/, "");
      if (!path) {
        return "";
      }
      const now = Date.now() / 1000;
      const cached = userUploadSignedUrlCache.get(path);
      if (cached && cached.expiresAt > now + 120) {
        return cached.url;
      }
      const { data, error } = await supabase.storage
        .from(USER_UPLOAD_BUCKET)
        .createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) {
        console.error("user-upload signed URL", error);
        return "";
      }
      userUploadSignedUrlCache.set(path, {
        url: data.signedUrl,
        expiresAt: now + 3600,
      });
      return data.signedUrl;
    }

    async function resolveAudioPlaybackUrl(rawPath) {
      const s = String(rawPath || "").trim();
      if (!s) {
        return "";
      }
      if (/^https?:\/\//i.test(s)) {
        return s;
      }
      if (s.startsWith(USER_UPLOAD_PREFIX)) {
        const rel = s.slice(USER_UPLOAD_PREFIX.length).replace(/^\/+/, "");
        return getSignedUserUploadUrl(rel);
      }
      return AudioLibrary.resolvePlaybackUrl(s);
    }

    function stripUserUploadRef(rawPath) {
      const s = String(rawPath || "");
      if (s.startsWith(USER_UPLOAD_PREFIX)) {
        return s.slice(USER_UPLOAD_PREFIX.length);
      }
      return s;
    }

    let musicVolumeAnimFrameId = null;
    let musicVolumeAnimGeneration = 0;

    let currentScene = null;
    /** Scene whose playlist drives the loaded track (may differ from `currentScene` while old music keeps playing after a scene change). */
    let musicPlaybackScene = null;
    let currentTrackIndex = 0;
    /** When `musicPlaybackScene !== currentScene`, index in the selected scene's list that Play will use after the old track fades out. */
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
      if (!sceneKey || !isCustomSceneKey(sceneKey)) {
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
      if (!sceneKey || !isCustomSceneKey(sceneKey)) {
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

    function isSceneAudiblyActive(sceneKey) {
      if (!sceneKey) {
        return false;
      }
      const musicActive = musicPlaybackScene === sceneKey && !musicPlayer.paused;
      const ambientActive =
        currentScene === sceneKey &&
        customBgmLayerRegistry.some(({ audio }) => !audio.paused);
      return musicActive || ambientActive;
    }

    function syncSceneAudioIndicators() {
      if (!sceneButtonsBar) {
        return;
      }
      sceneButtonsBar.querySelectorAll("[data-custom-scene-area]").forEach((card) => {
        const btn = card.querySelector(".scene-btn");
        const key = btn && btn.dataset.sceneKey;
        const active = Boolean(key && isSceneAudiblyActive(key));
        card.classList.toggle("scene-card--audio-active", active);
        if (btn) {
          btn.setAttribute("aria-description", active ? "Scene audio is playing" : "");
        }
      });
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
      const uiTracks = getSceneTracks(currentScene);
      if (!uiTracks.length) {
        return;
      }
      index = clampPlaylistIndex(index, uiTracks);
      pendingPlayTrackIndex = index;
      if (currentScene) {
        saveMusicSelectionForScene(currentScene, index);
      }

      // Scene switched while old music still plays — selection applies when Play is used.
      if (musicPlaybackScene !== currentScene) {
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
        syncSceneAudioIndicators();
        return;
      }

      // While playing, click queues that track after the current one ends.
      musicQueuedNextTrackIndex = index === currentTrackIndex ? null : index;
      renderMusicPlaylist();
    }


    function isCustomSceneKey(sceneKey) {
      return typeof sceneKey === "string" && sceneKey.startsWith("custom:");
    }

    function normalizeCustomScene(raw) {
      if (!raw || typeof raw !== "object") {
        return raw;
      }
      const pins = raw.pinnedSfx ?? raw.pinned_sfx;
      const pinnedSfx = Array.isArray(pins) ? pins.map(String) : [];
      return { ...raw, pinnedSfx };
    }

    function loadCustomScenesFromStorage() {
      try {
        const raw = localStorage.getItem(CUSTOM_SCENES_STORAGE_KEY);
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : [];
        return arr.map(normalizeCustomScene);
      } catch {
        return [];
      }
    }

    function saveCustomScenesToStorage(list) {
      try {
        localStorage.setItem(CUSTOM_SCENES_STORAGE_KEY, JSON.stringify(list));
      } catch {
        /* localStorage may be unavailable */
      }
    }

    function tagsStringToArray(tags) {
      return String(tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }

    function userHasPaidSessionFeatures(authSession) {
      if (!authSession?.user) {
        return false;
      }
      return userTier === "pro";
    }

    function isLimitModalOnCooldown() {
      return Date.now() < limitModalCooldownUntil;
    }

    function startLimitModalCooldown() {
      limitModalCooldownUntil = Date.now() + LIMIT_MODAL_COOLDOWN_MS;
    }

    async function fetchUserTier(userId) {
      if (!userId) {
        userTier = "free";
        stripeCustomerId = null;
        return userTier;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("tier, stripe_subscription_id, stripe_customer_id")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        console.error("profiles tier load", error);
        userTier = "free";
        stripeCustomerId = null;
        return userTier;
      }
      userTier = data?.tier ? String(data.tier).toLowerCase() : "free";
      stripeCustomerId = data?.stripe_customer_id ? String(data.stripe_customer_id) : null;
      return userTier;
    }

    async function fetchUserLimits() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        userLimits = null;
        return null;
      }
      if (userHasPaidSessionFeatures(session)) {
        userLimits = null;
        return null;
      }
      const { data, error } = await supabase.from("user_limits").select("*").maybeSingle();
      if (error) {
        console.error("user_limits load", error);
        userLimits = buildFallbackUserLimits();
        return userLimits;
      }
      userLimits = data || buildFallbackUserLimits();
      return userLimits;
    }

    function buildFallbackUserLimits() {
      const sceneCount = customScenesList.length;
      const sessionCount = sessionsList.length;
      return {
        scene_count: sceneCount,
        session_count: sessionCount,
        scene_limit: FREE_SIGNED_IN_SCENE_LIMIT,
        session_limit: FREE_SIGNED_IN_SESSION_LIMIT,
        scene_limit_reached: sceneCount >= FREE_SIGNED_IN_SCENE_LIMIT,
        session_limit_reached: sessionCount >= FREE_SIGNED_IN_SESSION_LIMIT,
      };
    }

    async function refreshUserLimits() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        userLimits = null;
        updateTierUsageIndicators();
        return null;
      }
      await fetchUserTier(session.user.id);
      if (userHasPaidSessionFeatures(session)) {
        userLimits = null;
        updateTierUsageIndicators();
        return null;
      }
      await fetchUserLimits();
      updateTierUsageIndicators();
      return userLimits;
    }

    function isAnonSceneLimitReached() {
      return loadCustomScenesFromStorage().length >= ANON_CUSTOM_SCENE_LIMIT;
    }

    function isFreeSignedInSceneLimitReached() {
      if (userTier === "pro") {
        return false;
      }
      if (userLimits && typeof userLimits.scene_limit_reached === "boolean") {
        return userLimits.scene_limit_reached;
      }
      const count =
        userLimits && typeof userLimits.scene_count === "number"
          ? userLimits.scene_count
          : customScenesList.length;
      const limit =
        userLimits && typeof userLimits.scene_limit === "number"
          ? userLimits.scene_limit
          : FREE_SIGNED_IN_SCENE_LIMIT;
      return count >= limit;
    }

    function isFreeSignedInSessionLimitReached() {
      if (userTier === "pro") {
        return false;
      }
      if (userLimits && typeof userLimits.session_limit_reached === "boolean") {
        return userLimits.session_limit_reached;
      }
      const count =
        userLimits && typeof userLimits.session_count === "number"
          ? userLimits.session_count
          : sessionsList.length;
      const limit =
        userLimits && typeof userLimits.session_limit === "number"
          ? userLimits.session_limit
          : FREE_SIGNED_IN_SESSION_LIMIT;
      return count >= limit;
    }

    function restoreUpgradeModalBody() {
      if (!upgradeModalBodyEl || !upgradeModalBodyDefaultHtml) {
        return;
      }
      upgradeModalBodyEl.innerHTML = upgradeModalBodyDefaultHtml;
      wireDefaultUpgradeModalBodyHandlers();
    }

    function wireDefaultUpgradeModalBodyHandlers() {
      document.getElementById("upgrade-checkout-monthly")?.addEventListener("click", () => {
        void doCheckout("price_1ThthV07rpjVXRecuZndtEbH");
      });
      document.getElementById("upgrade-checkout-yearly")?.addEventListener("click", () => {
        void doCheckout("price_1ThthU07rpjVXRec7rT4LCOp");
      });
      document.getElementById("upgrade-modal-later")?.addEventListener("click", () => {
        closeUpgradeModal();
      });
      document.getElementById("upgrade-modal-restore-sign-in")?.addEventListener("click", () => {
        closeUpgradeModal();
        openAuthModal();
      });
    }

    async function doCheckout(priceId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const userId = session?.user?.id || null;
        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ priceId, userId }),
        });
        const data = await response.json();
        if (!response.ok || !data.url) {
          throw new Error(data.error || "Checkout failed");
        }
        window.location.href = data.url;
      } catch (e) {
        alert("Something went wrong. Please try again.");
      }
    }

    function openUpgradeModal() {
      if (!upgradeModalBackdrop) {
        return;
      }
      restoreUpgradeModalBody();
      const freeList = document.getElementById("upgrade-free-features");
      if (freeList) {
        freeList.innerHTML = [
          "<li>5 scenes</li>",
          "<li>1 session</li>",
          "<li>Full curated audio library</li>",
          "<li>SFX and ambient sounds</li>",
          "<li>Favorites and tagging</li>",
        ].join("");
      }
      upgradeModalBackdrop.classList.add("open");
      upgradeModalBackdrop.setAttribute("aria-hidden", "false");
      document.getElementById("upgrade-modal-later")?.focus();
    }

    function closeUpgradeModal() {
      if (!upgradeModalBackdrop) {
        return;
      }
      upgradeModalBackdrop.classList.remove("open");
      upgradeModalBackdrop.setAttribute("aria-hidden", "true");
      restoreUpgradeModalBody();
      startLimitModalCooldown();
    }

    function updateTierUsageIndicators() {
      const { data: { session } } = { data: { session: lastAuthSession } };
      const signedIn = Boolean(session?.user);

      if (createNewSceneButton) {
        createNewSceneButton.classList.remove("limit-reached");
        createNewSceneButton.removeAttribute("aria-disabled");
        let blocked = false;
        let tip = "";
        if (userTier === "pro") {
          blocked = false;
        } else if (!signedIn) {
          blocked = isAnonSceneLimitReached();
          tip = blocked
            ? "You have used all 3 anonymous scenes. Sign in or create a free account to save more."
            : "";
        } else {
          blocked = isFreeSignedInSceneLimitReached();
          tip = blocked
            ? "You have reached the free limit of 5 scenes. Upgrade to create more."
            : "";
        }
        if (blocked) {
          createNewSceneButton.classList.add("limit-reached");
          createNewSceneButton.setAttribute("aria-disabled", "true");
          createNewSceneButton.title = tip;
        } else {
          createNewSceneButton.removeAttribute("title");
        }
      }

      updateTopbarSubscribeButton();

      if (railSceneUsageEl) {
        let showSceneUsage = false;
        let count = 0;
        let limit = 0;
        if (userTier === "pro") {
          showSceneUsage = false;
        } else if (!signedIn) {
          count = loadCustomScenesFromStorage().length;
          limit = ANON_CUSTOM_SCENE_LIMIT;
          showSceneUsage = true;
        } else {
          count =
            userLimits && typeof userLimits.scene_count === "number"
              ? userLimits.scene_count
              : customScenesList.length;
          limit =
            userLimits && typeof userLimits.scene_limit === "number"
              ? userLimits.scene_limit
              : FREE_SIGNED_IN_SCENE_LIMIT;
          showSceneUsage = true;
        }
        if (showSceneUsage) {
          railSceneUsageEl.hidden = false;
          railSceneUsageEl.textContent = `${count} of ${limit} scenes used`;
          railSceneUsageEl.classList.remove("is-warning", "is-limit");
          if (count >= limit) {
            railSceneUsageEl.classList.add("is-limit");
          } else if (count >= limit - 1) {
            railSceneUsageEl.classList.add("is-warning");
          }
        } else {
          railSceneUsageEl.hidden = true;
          railSceneUsageEl.textContent = "";
          railSceneUsageEl.classList.remove("is-warning", "is-limit");
        }
      }

      const sessionUsageEl = sessionSelectorWrap?.querySelector(".session-usage-indicator");
      if (sessionUsageEl) {
        sessionUsageEl.remove();
      }
      if (userTier !== "pro" && signedIn && sessionSelectorWrap && !sessionSelectorWrap.hidden) {
        const sessionCount =
          userLimits && typeof userLimits.session_count === "number"
            ? userLimits.session_count
            : sessionsList.length;
        const sessionLimit =
          userLimits && typeof userLimits.session_limit === "number"
            ? userLimits.session_limit
            : FREE_SIGNED_IN_SESSION_LIMIT;
        const usage = document.createElement("p");
        usage.className = "session-usage-indicator";
        usage.textContent = `${sessionCount} of ${sessionLimit} sessions`;
        sessionSelectorWrap.appendChild(usage);
      }
    }

    function countScenesInSession(sessionId) {
      if (!sessionId) {
        return customScenesList.length;
      }
      return customScenesList.filter((s) => (s.sessionId || sessionsList[0]?.id) === sessionId).length;
    }

    function customScenesInActiveSession() {
      if (!lastAuthSession?.user || !activeSessionId) {
        return customScenesList;
      }
      return customScenesList.filter(
        (s) => (s.sessionId || sessionsList[0]?.id) === activeSessionId,
      );
    }

    function persistActiveSessionId() {
      if (!activeSessionId) {
        return;
      }
      try {
        localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
      } catch {
        /* ignore */
      }
    }

    function resolveActiveSessionIdFromStorage() {
      let saved = null;
      try {
        saved = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      } catch {
        saved = null;
      }
      if (saved && sessionsList.some((s) => s.id === saved)) {
        activeSessionId = saved;
        return;
      }
      activeSessionId = sessionsList[0]?.id ?? null;
    }

    function clearSessionStateForSignOut() {
      sessionsList = [];
      activeSessionId = null;
      sessionMenuOpen = false;
      try {
        localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }

    async function fetchSessionsFromDb(userId) {
      const { data, error } = await supabase
        .from("sessions")
        .select("id,name,description,sort_order")
        .eq("user_id", userId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) {
        console.error("sessions load error", error);
        return [];
      }
      return data || [];
    }

    async function insertSessionRow(userId, name, sortOrder) {
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          user_id: userId,
          name,
          description: null,
          sort_order: sortOrder,
        })
        .select("id,name,description,sort_order")
        .single();
      if (error) {
        console.error("session insert error (full)", error);
        try {
          console.error("session insert error (JSON)", JSON.stringify(error, Object.getOwnPropertyNames(error)));
        } catch {
          /* ignore */
        }
        return { data: null, error };
      }
      return { data, error: null };
    }

    /** Ensures sessions exist in DB and in `sessionsList` (never inserts if any session exists). */
    async function ensureDefaultSessionRowIfEmptyForSignedInEditor(userId) {
      await ensureSessionsForUser(userId);
    }

    async function attachOrphanScenesToDefaultSession(userId, defaultSessionId) {
      const { error } = await supabase
        .from("scenes")
        .update({ session_id: defaultSessionId })
        .eq("user_id", userId)
        .is("session_id", null);
      if (error) {
        console.error("scene session_id backfill error", error);
      }
    }

    async function ensureSessionsForUser(userId) {
      if (!userId) {
        sessionsList = [];
        activeSessionId = null;
        return false;
      }
      const inFlight = ensureSessionsInFlight.get(userId);
      if (inFlight) {
        return inFlight;
      }
      const work = (async () => {
        let sessions = await fetchSessionsFromDb(userId);
        if (!sessions.length) {
          const { error: createErr } = await insertSessionRow(
            userId,
            DEFAULT_SESSION_NAME,
            0,
          );
          if (createErr) {
            console.error("default session insert error (full)", createErr);
          }
          sessions = await fetchSessionsFromDb(userId);
        }
        if (!sessions.length) {
          sessionsList = [];
          activeSessionId = null;
          return false;
        }
        sessionsList = sessions;
        const defaultId = sessions[0].id;
        await attachOrphanScenesToDefaultSession(userId, defaultId);
        resolveActiveSessionIdFromStorage();
        persistActiveSessionId();
        return true;
      })();
      ensureSessionsInFlight.set(userId, work);
      try {
        return await work;
      } finally {
        ensureSessionsInFlight.delete(userId);
      }
    }

    function closeSessionMenu() {
      sessionMenuOpen = false;
      if (!sessionSelectorWrap) {
        return;
      }
      const menu = sessionSelectorWrap.querySelector(".session-selector-menu");
      if (menu) {
        menu.hidden = true;
      }
      const trig = sessionSelectorWrap.querySelector(".session-selector-trigger");
      if (trig) {
        trig.setAttribute("aria-expanded", "false");
      }
    }

    function bindSessionMenuGlobalClose() {
      if (sessionMenuGlobalCloseBound) {
        return;
      }
      sessionMenuGlobalCloseBound = true;
      document.addEventListener(
        "pointerdown",
        (e) => {
          if (!sessionSelectorWrap || sessionSelectorWrap.hidden) {
            return;
          }
          const menu = sessionSelectorWrap.querySelector(".session-selector-menu");
          if (!menu || menu.hidden) {
            return;
          }
          if (sessionSelectorWrap.contains(e.target)) {
            return;
          }
          closeSessionMenu();
        },
        true,
      );
    }

    function setActiveSessionId(nextId, opts = {}) {
      if (!nextId || !sessionsList.some((s) => s.id === nextId)) {
        return;
      }
      const skipPersist = Boolean(opts.skipPersist);
      const skipReselectScene = Boolean(opts.skipReselectScene);
      const prev = activeSessionId;
      activeSessionId = nextId;
      if (!skipPersist) {
        persistActiveSessionId();
      }
      if (sessionSelectorWrap) {
        sessionSelectorWrap.classList.add("session-transition");
      }
      closeSessionMenu();
      renderSessionSelectorUI();
      refreshSceneSelectorBar();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (sessionSelectorWrap) {
            sessionSelectorWrap.classList.remove("session-transition");
          }
        });
      });
      if (skipReselectScene) {
        const cur = currentScene;
        if (cur && isCustomSceneKey(cur)) {
          const cs = getCustomSceneByKey(cur);
          const sid = cs ? (cs.sessionId || sessionsList[0]?.id) : null;
          if (cs && sid === nextId) {
            setActiveSceneButton(cur);
          }
        }
        return;
      }
      if (prev === nextId) {
        return;
      }
      const cur = currentScene;
      if (cur && isCustomSceneKey(cur)) {
        const cs = getCustomSceneByKey(cur);
        if (cs && (cs.sessionId || sessionsList[0]?.id) === nextId) {
          setActiveSceneButton(cur);
          return;
        }
      }
      selectFirstCustomSceneOrNone();
    }

    async function populateEditorSessionSelect(selectedId) {
      const editorSessionField = getEditorSessionField();
      const editorSceneSessionSelect = getEditorSceneSessionSelect();
      if (!editorSceneSessionSelect || !editorSessionField) {
        return;
      }
      editorSceneSessionSelect.innerHTML = "";
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        return;
      }
      if (!sessionsList.length) {
        await ensureDefaultSessionRowIfEmptyForSignedInEditor(session.user.id);
      }
      if (!sessionsList.length) {
        const mount = editorSessionFieldMount || document.getElementById("editor-session-field-mount");
        if (mount) {
          mount.innerHTML = "";
        }
        return;
      }
      sessionsList.forEach((sess) => {
        const id = sess && sess.id != null ? String(sess.id) : "";
        const name = sess && sess.name != null ? String(sess.name).trim() : "";
        if (!id) {
          return;
        }
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name || "New Session";
        editorSceneSessionSelect.appendChild(opt);
      });
      const optionIds = new Set(
        Array.from(editorSceneSessionSelect.options)
          .map((o) => o.value)
          .filter(Boolean),
      );
      const pick = selectedId != null && selectedId !== "" ? String(selectedId) : "";
      const fallback =
        (activeSessionId && optionIds.has(String(activeSessionId)) ? String(activeSessionId) : "") ||
        (sessionsList[0] && sessionsList[0].id != null ? String(sessionsList[0].id) : "");
      if (pick && optionIds.has(pick)) {
        editorSceneSessionSelect.value = pick;
      } else if (fallback && optionIds.has(fallback)) {
        editorSceneSessionSelect.value = fallback;
      } else if (editorSceneSessionSelect.options.length) {
        editorSceneSessionSelect.selectedIndex = 0;
      }
      editorSceneSessionSelect.disabled = userTier !== "pro";
      editorSceneSessionSelect.title = userTier === "pro"
        ? ""
        : "Upgrade to organize scenes into multiple sessions";
    }

    function updateSessionSelectorTriggerLabel() {
      if (!sessionSelectorWrap || sessionSelectorWrap.hidden) {
        return;
      }
      const label = sessionSelectorWrap.querySelector(".session-selector-trigger-label");
      if (!label) {
        return;
      }
      const s = sessionsList.find((x) => x.id === activeSessionId);
      label.textContent = s?.name || "Session";
    }

    function populateSessionMenuBody(menuEl) {
      menuEl.innerHTML = "";
      sessionsList.forEach((sess) => {
        const row = document.createElement("div");
        row.className = "session-menu-item-wrap";
        row.dataset.sessionId = sess.id;

        const mainBtn = document.createElement("button");
        mainBtn.type = "button";
        mainBtn.className = "session-menu-item";
        if (sess.id === activeSessionId) {
          mainBtn.classList.add("is-active");
        }
        const nm = document.createElement("span");
        nm.className = "session-menu-item-name";
        nm.textContent = sess.name;
        const ct = document.createElement("span");
        ct.className = "session-menu-item-count";
        ct.textContent = String(countScenesInSession(sess.id));
        mainBtn.appendChild(nm);
        mainBtn.appendChild(ct);
        mainBtn.addEventListener("click", () => {
          setActiveSessionId(sess.id);
        });

        const actions = document.createElement("div");
        actions.className = "session-menu-item-actions";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "session-menu-icon-btn";
        editBtn.title = "Rename session";
        editBtn.setAttribute("aria-label", "Rename session");
        editBtn.textContent = "✎";
        editBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          startInlineSessionRename(row, sess);
        });

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "session-menu-icon-btn";
        delBtn.title = "Delete session";
        delBtn.setAttribute("aria-label", "Delete session");
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          void deleteSessionById(sess.id);
        });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        row.appendChild(mainBtn);
        row.appendChild(actions);
        menuEl.appendChild(row);
      });

      const newWrap = document.createElement("div");
      newWrap.className = "session-menu-new";

      const sessionLimitReached = userTier === "pro"
        ? false
        : isFreeSignedInSessionLimitReached();

      const newToggle = document.createElement("button");
      newToggle.type = "button";
      newToggle.className = "session-menu-item session-menu-new-toggle";
      if (sessionLimitReached) {
        newToggle.classList.add("is-locked", "has-lock");
      }
      const newToggleLabel = document.createElement("span");
      newToggleLabel.textContent = "+ New Session";
      newToggle.appendChild(newToggleLabel);
      if (sessionLimitReached) {
        const lockIcon = document.createElement("span");
        lockIcon.className = "session-menu-new-lock";
        lockIcon.textContent = "🔒";
        lockIcon.title = "Upgrade to create multiple sessions";
        newToggle.appendChild(lockIcon);
      }

      const form = document.createElement("div");
      form.className = "session-menu-new-form";
      form.hidden = true;
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Session name";
      nameInput.autocomplete = "off";
      const createErrEl = document.createElement("p");
      createErrEl.className = "session-menu-create-error";
      createErrEl.hidden = true;
      createErrEl.setAttribute("role", "alert");
      const actions = document.createElement("div");
      actions.className = "session-menu-new-form-actions";
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.textContent = "Create";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = "Cancel";

      const showSessionCreateError = (message) => {
        createErrEl.textContent = message;
        createErrEl.hidden = false;
      };

      const clearSessionCreateError = () => {
        createErrEl.textContent = "";
        createErrEl.hidden = true;
      };

      const finishNew = async (commit) => {
        if (!commit) {
          clearSessionCreateError();
          newToggle.hidden = false;
          form.hidden = true;
          nameInput.value = "";
          return;
        }
        const nm = nameInput.value.trim();
        if (!nm) {
          return;
        }
        clearSessionCreateError();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          showSessionCreateError("You must be signed in to create a session.");
          return;
        }
        if (userTier === "pro") {
          /* allow action */
        } else if (isFreeSignedInSessionLimitReached()) {
          closeSessionMenu();
          openUpgradeModal();
          return;
        }
        const maxSort = sessionsList.reduce(
          (m, s) => Math.max(m, Number(s.sort_order) || 0),
          -1,
        );
        const { data: inserted, error: insertErr } = await insertSessionRow(
          session.user.id,
          nm,
          maxSort + 1,
        );
        if (insertErr || !inserted) {
          const detail =
            insertErr && typeof insertErr === "object" && "message" in insertErr
              ? String(insertErr.message)
              : "Unknown error";
          console.error("session create failed (full)", insertErr);
          try {
            console.error(
              "session create failed (JSON)",
              JSON.stringify(insertErr, Object.getOwnPropertyNames(insertErr || {})),
            );
          } catch {
            /* ignore */
          }
          showSessionCreateError(
            `Could not create session: ${detail}. Check the console for details.`,
          );
          return;
        }
        const refetched = await fetchSessionsFromDb(session.user.id);
        const refetchHasRow =
          Array.isArray(refetched) && refetched.some((s) => s.id === inserted.id);
        if (refetched.length && refetchHasRow) {
          sessionsList = refetched;
        } else {
          sessionsList = [...sessionsList, inserted].sort((a, b) => {
            const ao = Number(a.sort_order) || 0;
            const bo = Number(b.sort_order) || 0;
            if (ao !== bo) {
              return ao - bo;
            }
            return String(a.name).localeCompare(String(b.name));
          });
        }
        newToggle.hidden = false;
        form.hidden = true;
        nameInput.value = "";
        clearSessionCreateError();
        setActiveSessionId(inserted.id);
        await refreshUserLimits();
      };

      newToggle.addEventListener("click", () => {
        if (sessionLimitReached) {
          closeSessionMenu();
          openUpgradeModal();
          return;
        }
        clearSessionCreateError();
        newToggle.hidden = true;
        form.hidden = false;
        nameInput.focus();
      });

      createBtn.addEventListener("click", () => {
        void finishNew(true);
      });
      cancelBtn.addEventListener("click", () => {
        void finishNew(false);
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void finishNew(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          void finishNew(false);
        }
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(createBtn);
      form.appendChild(nameInput);
      form.appendChild(createErrEl);
      form.appendChild(actions);

      newWrap.appendChild(newToggle);
      newWrap.appendChild(form);
      menuEl.appendChild(newWrap);
    }

    function startInlineSessionRename(rowEl, sess) {
      const existing = rowEl.querySelector(".session-rename-input");
      if (existing) {
        existing.focus();
        existing.select();
        return;
      }
      rowEl.querySelectorAll(".session-menu-item, .session-menu-item-actions").forEach((n) => {
        n.hidden = true;
      });
      const wrap = document.createElement("div");
      wrap.className = "session-menu-new-form";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "session-rename-input";
      inp.value = sess.name;
      inp.autocomplete = "off";
      const actions = document.createElement("div");
      actions.className = "session-menu-new-form-actions";
      const ok = document.createElement("button");
      ok.type = "button";
      ok.textContent = "Save";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = "Cancel";

      const teardown = () => {
        wrap.remove();
        rowEl.querySelectorAll(".session-menu-item, .session-menu-item-actions").forEach((n) => {
          n.hidden = false;
        });
      };

      const commit = async (save) => {
        if (!save) {
          teardown();
          return;
        }
        const nm = inp.value.trim();
        if (!nm || nm === sess.name) {
          teardown();
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          teardown();
          return;
        }
        const { error } = await supabase
          .from("sessions")
          .update({ name: nm })
          .eq("id", sess.id)
          .eq("user_id", session.user.id);
        if (error) {
          console.error("rename session", error);
          window.alert(`Could not rename: ${error.message}`);
          teardown();
          return;
        }
        sessionsList = sessionsList.map((s) =>
          s.id === sess.id ? { ...s, name: nm } : s,
        );
        teardown();
        renderSessionSelectorUI();
        refreshSceneSelectorBar();
      };

      ok.addEventListener("click", () => {
        void commit(true);
      });
      cancel.addEventListener("click", () => {
        void commit(false);
      });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          void commit(false);
        }
      });

      actions.appendChild(cancel);
      actions.appendChild(ok);
      wrap.appendChild(inp);
      wrap.appendChild(actions);
      rowEl.appendChild(wrap);
      inp.focus();
      inp.select();
    }

    async function deleteSessionById(sessionId) {
      if (sessionsList.length <= 1) {
        window.alert("You need at least one session.");
        return;
      }
      const sess = sessionsList.find((s) => s.id === sessionId);
      if (!sess) {
        return;
      }
      const ok = window.confirm(
        `Delete session "${sess.name}"? Its scenes will be moved to your default session.`,
      );
      if (!ok) {
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        return;
      }
      const sorted = [...sessionsList].sort((a, b) => {
        const ao = Number(a.sort_order) || 0;
        const bo = Number(b.sort_order) || 0;
        if (ao !== bo) {
          return ao - bo;
        }
        return String(a.name).localeCompare(String(b.name));
      });
      const target = sorted.find((s) => s.id !== sessionId);
      if (!target) {
        return;
      }
      const { error: uerr } = await supabase
        .from("scenes")
        .update({ session_id: target.id })
        .eq("user_id", session.user.id)
        .eq("session_id", sessionId);
      if (uerr) {
        console.error("move scenes on session delete", uerr);
        window.alert(`Could not move scenes: ${uerr.message}`);
        return;
      }
      const { error: derr } = await supabase
        .from("sessions")
        .delete()
        .eq("id", sessionId)
        .eq("user_id", session.user.id);
      if (derr) {
        console.error("delete session", derr);
        window.alert(`Could not delete session: ${derr.message}`);
        return;
      }
      sessionsList = sessionsList.filter((s) => s.id !== sessionId);
      closeSessionMenu();
      await refreshCustomScenesList();
      if (activeSessionId === sessionId) {
        setActiveSessionId(target.id, { skipPersist: false, skipReselectScene: false });
      } else {
        renderSessionSelectorUI();
        refreshSceneSelectorBar();
      }
    }

    function openSessionMenu(menuEl, triggerEl) {
      sessionMenuOpen = true;
      menuEl.hidden = false;
      populateSessionMenuBody(menuEl);
      if (triggerEl) {
        triggerEl.setAttribute("aria-expanded", "true");
      }
    }

    function renderSessionSelectorUI() {
      bindSessionMenuGlobalClose();
      if (!sessionSelectorWrap) {
        return;
      }
      sessionSelectorWrap.innerHTML = "";
      const auth = lastAuthSession;
      if (!auth?.user) {
        sessionSelectorWrap.hidden = true;
        return;
      }
      sessionSelectorWrap.hidden = false;

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "session-selector-trigger";
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-haspopup", "true");
      const lab = document.createElement("span");
      lab.className = "session-selector-trigger-label";
      const s0 = sessionsList.find((x) => x.id === activeSessionId) || sessionsList[0];
      lab.textContent = s0?.name || "Session";
      const chev = document.createElement("span");
      chev.className = "session-selector-chevron";
      chev.textContent = "▾";
      chev.setAttribute("aria-hidden", "true");
      trigger.appendChild(lab);
      trigger.appendChild(chev);

      const menu = document.createElement("div");
      menu.className = "session-selector-menu";
      menu.hidden = true;
      menu.setAttribute("role", "menu");

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!menu.hidden) {
          closeSessionMenu();
          return;
        }
        openSessionMenu(menu, trigger);
      });

      sessionSelectorWrap.appendChild(trigger);
      sessionSelectorWrap.appendChild(menu);

      if (sessionMenuOpen) {
        openSessionMenu(menu, trigger);
      }
      updateTierUsageIndicators();
    }

    function sceneRowToApp(row) {
      const pins = row.pinned_sfx;
      return {
        id: row.id,
        name: row.name,
        tags: Array.isArray(row.tags) ? row.tags.join(", ") : String(row.tags || ""),
        playlist: Array.isArray(row.playlist) ? row.playlist : [],
        ambientLayers: Array.isArray(row.ambient_layers) ? row.ambient_layers : [],
        sessionId: row.session_id != null ? row.session_id : null,
        pinnedSfx: Array.isArray(pins) ? pins.map(String) : [],
      };
    }

    function appSceneToRow(scene, userId) {
      const row = {
        id: scene.id,
        user_id: userId,
        name: scene.name,
        tags: tagsStringToArray(scene.tags),
        playlist: scene.playlist || [],
        ambient_layers: scene.ambientLayers || [],
        pinned_sfx: Array.isArray(scene.pinnedSfx) ? scene.pinnedSfx.map(String) : [],
      };
      const sid = scene.sessionId || activeSessionId || sessionsList[0]?.id;
      if (sid) {
        row.session_id = sid;
      }
      return row;
    }

    async function fetchCloudScenesForUser(userId) {
      const { data, error } = await supabase
        .from("scenes")
        .select("id,user_id,name,tags,playlist,ambient_layers,session_id,pinned_sfx")
        .eq("user_id", userId)
        .order("name");
      if (error) {
        console.error("scenes load error", error);
        return [];
      }
      return (data || []).map(sceneRowToApp);
    }

    async function migrateLocalScenesToCloudIfNeeded(userId) {
      const local = loadCustomScenesFromStorage();
      if (!local.length) {
        return;
      }
      const defaultSid = activeSessionId || sessionsList[0]?.id;
      if (!defaultSid) {
        console.error("migrateLocalScenes: no session available after ensureSessionsForUser");
        return;
      }
      const rows = local.map((s) =>
        appSceneToRow(
          defaultSid ? { ...s, sessionId: defaultSid } : s,
          userId,
        ),
      );
      const { error } = await supabase.from("scenes").upsert(rows, { onConflict: "id" });
      if (error) {
        console.error("scene migration error", error);
        return;
      }
      try {
        localStorage.removeItem(CUSTOM_SCENES_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }

    async function refreshCustomScenesList() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await ensureSessionsForUser(session.user.id);
        customScenesList = await fetchCloudScenesForUser(session.user.id);
      } else {
        clearSessionStateForSignOut();
        customScenesList = loadCustomScenesFromStorage();
      }
      renderSessionSelectorUI();
      void renderFxButtons();
      if (lastAuthSession?.user) {
        await refreshUserLimits();
      } else {
        updateTierUsageIndicators();
      }
    }

    function updateTopbarSubscribeButton() {
      if (!accountSubscribeBtn) {
        return;
      }
      const signedIn = Boolean(lastAuthSession?.user);
      const isPro = userTier === "pro";
      accountSubscribeBtn.hidden = !signedIn || isPro;
      if (accountManageWrap) {
        accountManageWrap.hidden = !signedIn;
      }
      if (accountBillingBtn) {
        accountBillingBtn.hidden = !isPro;
      }
      if (accountManageMenuDivider) {
        accountManageMenuDivider.hidden = !isPro;
      }
      if (!signedIn) {
        closeAccountManageMenu();
      }
    }

    function closeAccountManageMenu() {
      if (accountManageMenu) {
        accountManageMenu.hidden = true;
      }
      if (accountManageSubscriptionBtn) {
        accountManageSubscriptionBtn.setAttribute("aria-expanded", "false");
      }
    }

    function openDeleteAccountModal() {
      closeAccountManageMenu();
      deleteAccountInFlight = false;
      if (deleteAccountConfirmInput) {
        deleteAccountConfirmInput.value = "";
        deleteAccountConfirmInput.disabled = false;
      }
      if (deleteAccountConfirmBtn) {
        deleteAccountConfirmBtn.disabled = true;
        deleteAccountConfirmBtn.textContent = "Delete Account";
      }
      if (deleteAccountErrorEl) {
        deleteAccountErrorEl.textContent = "";
      }
      if (deleteAccountModalBackdrop) {
        deleteAccountModalBackdrop.classList.add("open");
        deleteAccountModalBackdrop.setAttribute("aria-hidden", "false");
      }
      deleteAccountConfirmInput?.focus();
    }

    function closeDeleteAccountModal() {
      if (deleteAccountInFlight) {
        return;
      }
      if (deleteAccountModalBackdrop) {
        deleteAccountModalBackdrop.classList.remove("open");
        deleteAccountModalBackdrop.setAttribute("aria-hidden", "true");
      }
      if (deleteAccountConfirmInput) {
        deleteAccountConfirmInput.value = "";
        deleteAccountConfirmInput.disabled = false;
      }
      if (deleteAccountConfirmBtn) {
        deleteAccountConfirmBtn.disabled = true;
        deleteAccountConfirmBtn.textContent = "Delete Account";
      }
      if (deleteAccountErrorEl) {
        deleteAccountErrorEl.textContent = "";
      }
    }

    async function openCustomerPortal() {
      try {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const returnUrl = window.location.href;

        const response = await fetch(`${SUPABASE_URL}/functions/v1/create-portal-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            customerId: stripeCustomerId,
            returnUrl: returnUrl,
          }),
        });

        const data = await response.json();
        if (!response.ok || !data.url) {
          throw new Error(data.error || "Portal failed");
        }
        window.location.href = data.url;
      } catch (e) {
        alert("Could not open subscription management. Please try again.");
      }
    }

    function updateAccountUI(session) {
      lastAuthSession = session;
      if (!accountSignInBtn || !accountSignedInEl || !accountEmailEl) {
        return;
      }
      if (session?.user?.email) {
        accountSignInBtn.hidden = true;
        accountSignedInEl.hidden = false;
        accountEmailEl.textContent = session.user.email;
      } else {
        accountSignInBtn.hidden = false;
        accountSignedInEl.hidden = true;
        accountEmailEl.textContent = "";
      }
      updateTopbarSubscribeButton();
    }

    function updateAuthSignUpEnabled() {
      if (!authModalSignUpBtn) {
        return;
      }
      authModalSignUpBtn.disabled = !(authTosCheckbox && authTosCheckbox.checked);
    }

    async function recordTosAgreement(userId, agreedAt) {
      if (!userId) {
        return false;
      }
      const at = agreedAt || new Date().toISOString();
      const { data, error } = await supabase
        .from("profiles")
        .update({ tos_agreed_at: at })
        .eq("id", userId)
        .select("id")
        .maybeSingle();
      if (!error && data) {
        return true;
      }
      if (error) {
        console.error("profiles tos_agreed_at update", error);
      }
      return false;
    }

    async function applyPendingTosAgreement(userId) {
      if (!userId) {
        return;
      }
      let pending = null;
      try {
        const raw = sessionStorage.getItem(PENDING_TOS_AGREEMENT_KEY);
        if (raw) {
          pending = JSON.parse(raw);
        }
      } catch (_) {
        pending = null;
      }
      if (!pending || pending.userId !== userId) {
        return;
      }
      const ok = await recordTosAgreement(userId, pending.agreedAt);
      if (ok) {
        try {
          sessionStorage.removeItem(PENDING_TOS_AGREEMENT_KEY);
        } catch (_) {
          /* ignore */
        }
      }
    }

    function isPricingRedirectRequested() {
      return new URLSearchParams(window.location.search).get("redirect") === "pricing";
    }

    function isSignInRedirectRequested() {
      return new URLSearchParams(window.location.search).get("signin") === "true";
    }

    function landingPageUrl(pathAndHash = "/") {
      const host = window.location.hostname;
      const isLocal = host === "localhost" || host === "127.0.0.1";
      let path = pathAndHash || "/";
      if (path.startsWith("?") || path.startsWith("#")) {
        path = `/${path}`;
      } else if (!path.startsWith("/")) {
        path = `/${path}`;
      }
      if (isLocal) {
        return path;
      }
      return `https://www.skaldsoundboard.com${path}`;
    }

    async function startCheckoutForPriceId(priceId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || !priceId) {
        return false;
      }
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        return false;
      }
      const response = await fetch(`${supabaseUrl}/functions/v1/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({ priceId, userId: session.user.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Checkout failed");
      }
      window.location.href = data.url;
      return true;
    }

    async function redirectToLandingPricingIfRequested() {
      if (!isPricingRedirectRequested()) {
        return false;
      }
      const priceId = new URLSearchParams(window.location.search).get("priceId");
      if (priceId) {
        try {
          const started = await startCheckoutForPriceId(priceId);
          if (started) {
            return true;
          }
        } catch (_) {
          /* fall through to landing pricing */
        }
      }
      const qs = priceId ? `?priceId=${encodeURIComponent(priceId)}` : "";
      window.location.href = landingPageUrl(`${qs}#pricing`);
      return true;
    }

    function openAuthModal() {
      if (!authModalBackdrop) {
        return;
      }
      if (authModalErrorEl) {
        authModalErrorEl.textContent = "";
      }
      if (authEmailInput) {
        authEmailInput.value = "";
      }
      if (authPasswordInput) {
        authPasswordInput.value = "";
      }
      if (authTosCheckbox) {
        authTosCheckbox.checked = false;
      }
      updateAuthSignUpEnabled();
      authModalBackdrop.classList.add("open");
      authModalBackdrop.setAttribute("aria-hidden", "false");
      if (authEmailInput) {
        authEmailInput.focus();
      }
    }

    function closeAuthModal() {
      if (!authModalBackdrop) {
        return;
      }
      authModalBackdrop.classList.remove("open");
      authModalBackdrop.setAttribute("aria-hidden", "true");
    }

    function openSceneLimitModal() {
      if (!sceneLimitModalBackdrop) {
        return;
      }
      sceneLimitModalBackdrop.classList.add("open");
      sceneLimitModalBackdrop.setAttribute("aria-hidden", "false");
      if (sceneLimitSignUpBtn) {
        sceneLimitSignUpBtn.focus();
      }
    }

    function closeSceneLimitModal() {
      if (!sceneLimitModalBackdrop) {
        return;
      }
      sceneLimitModalBackdrop.classList.remove("open");
      sceneLimitModalBackdrop.setAttribute("aria-hidden", "true");
      startLimitModalCooldown();
    }

    function openFeedbackModal() {
      if (!feedbackModalBackdrop) {
        return;
      }
      if (feedbackCloseTimerId) {
        clearTimeout(feedbackCloseTimerId);
        feedbackCloseTimerId = null;
      }
      selectedFeedbackCategory = null;
      document.querySelectorAll("[data-feedback-category]").forEach((b) => {
        b.classList.remove("active");
      });
      if (feedbackSubmitErrorEl) {
        feedbackSubmitErrorEl.textContent = "";
      }
      if (feedbackMessageEl) {
        feedbackMessageEl.value = "";
      }
      if (feedbackEmailEl) {
        feedbackEmailEl.value = "";
      }
      if (feedbackFormWrap) {
        feedbackFormWrap.hidden = false;
      }
      if (feedbackThanksWrap) {
        feedbackThanksWrap.hidden = true;
      }
      if (feedbackSubmitBtn) {
        feedbackSubmitBtn.disabled = false;
      }
      feedbackModalBackdrop.classList.add("open");
      feedbackModalBackdrop.setAttribute("aria-hidden", "false");
      if (feedbackMessageEl) {
        feedbackMessageEl.focus();
      }
    }

    function closeFeedbackModal() {
      if (feedbackCloseTimerId) {
        clearTimeout(feedbackCloseTimerId);
        feedbackCloseTimerId = null;
      }
      if (!feedbackModalBackdrop) {
        return;
      }
      feedbackModalBackdrop.classList.remove("open");
      feedbackModalBackdrop.setAttribute("aria-hidden", "true");
    }

    async function submitFeedbackForm() {
      if (!feedbackSubmitErrorEl || !feedbackMessageEl) {
        return;
      }
      feedbackSubmitErrorEl.textContent = "";
      const message = feedbackMessageEl.value.trim();
      if (!selectedFeedbackCategory) {
        feedbackSubmitErrorEl.textContent = "Please choose a category.";
        return;
      }
      if (!message) {
        feedbackSubmitErrorEl.textContent = "Please enter a message.";
        return;
      }
      const emailRaw = feedbackEmailEl ? feedbackEmailEl.value.trim() : "";
      if (feedbackSubmitBtn) {
        feedbackSubmitBtn.disabled = true;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const row = {
        category: selectedFeedbackCategory,
        message,
        email: emailRaw || null,
        user_id: session?.user?.id ?? null,
        page_url: typeof window !== "undefined" ? window.location.href : "",
      };
      const { error } = await supabase.from("feedback").insert(row);
      if (feedbackSubmitBtn) {
        feedbackSubmitBtn.disabled = false;
      }
      if (error) {
        console.error("feedback insert", error);
        feedbackSubmitErrorEl.textContent =
          error.message || "Could not submit feedback. Please try again.";
        return;
      }
      if (feedbackFormWrap) {
        feedbackFormWrap.hidden = true;
      }
      if (feedbackThanksWrap) {
        feedbackThanksWrap.hidden = false;
      }
      feedbackCloseTimerId = window.setTimeout(() => {
        feedbackCloseTimerId = null;
        closeFeedbackModal();
        if (feedbackFormWrap) {
          feedbackFormWrap.hidden = false;
        }
        if (feedbackThanksWrap) {
          feedbackThanksWrap.hidden = true;
        }
      }, 2000);
    }

    function getCustomSceneByKey(sceneKey) {
      if (!isCustomSceneKey(sceneKey)) {
        return null;
      }
      const id = sceneKey.slice("custom:".length);
      return customScenesList.find((s) => s.id === id) || null;
    }

    function readMasterVolumeInput() {
      const el = masterVolumeSliderDesktop || masterVolumeSliderMobile;
      if (!el) {
        return 70;
      }
      return Number(el.value);
    }

    function getMasterLevel() {
      return readMasterVolumeInput() / 100;
    }

    function syncMasterVolumeUiFrom(sourceEl) {
      const v = String(sourceEl.value);
      if (masterVolumeSliderDesktop && masterVolumeSliderDesktop !== sourceEl) {
        masterVolumeSliderDesktop.value = v;
      }
      if (masterVolumeSliderMobile && masterVolumeSliderMobile !== sourceEl) {
        masterVolumeSliderMobile.value = v;
      }
      if (masterVolumePctEl) {
        masterVolumePctEl.textContent = `${Math.round(Number(v))}%`;
      }
    }

    function getMusicGroupLevel() {
      return Number(musicVolumeSlider.value) / 100;
    }

    function effectiveMusicVolume() {
      return getMasterLevel() * getMusicGroupLevel();
    }

    function effectiveBgmVolume(sliderValue) {
      return getMasterLevel() * (Number(sliderValue) / 100);
    }


    function cancelMusicVolumeAnim() {
      musicVolumeAnimGeneration += 1;
      if (musicVolumeAnimFrameId !== null) {
        cancelAnimationFrame(musicVolumeAnimFrameId);
        musicVolumeAnimFrameId = null;
      }
    }

    function applyBgmVolumesFromSliders() {
      customBgmLayerRegistry.forEach(({ audio, volumeSlider }) => {
        setAudioVolume(audio, effectiveBgmVolume(volumeSlider.value));
      });
      ambientCarryoverAudios.forEach(({ audio, sliderValue }) => {
        setAudioVolume(audio, effectiveBgmVolume(sliderValue));
      });
    }

    function disposeAmbientAudio(audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    }

    function pauseAmbientAudio(audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    function restoreAmbientFadeEntryVolume(entry) {
      const vol =
        entry.sliderValue ??
        (entry.volumeSlider ? Number(entry.volumeSlider.value) : 50);
      setAudioVolume(entry.audio, effectiveBgmVolume(vol));
    }

    function finalizeAmbientFadeEntry(entry, dispose) {
      if (dispose) {
        disposeAmbientAudio(entry.audio);
      } else {
        pauseAmbientAudio(entry.audio);
        restoreAmbientFadeEntryVolume(entry);
      }
      if (entry.setLayerActiveState) {
        entry.setLayerActiveState(false);
      }
    }

    function cancelAmbientFadeAnim(disposePending = true) {
      ambientFadeGeneration += 1;
      if (ambientFadeRafId !== null) {
        cancelAnimationFrame(ambientFadeRafId);
        ambientFadeRafId = null;
      }
      ambientFadeHiddenAt = null;
      ambientFadeHiddenMsAccum = 0;
      ambientFadeOnComplete = null;
      if (ambientFadePendingEntries && ambientFadePendingEntries.length) {
        ambientFadePendingEntries.forEach((e) => {
          finalizeAmbientFadeEntry(e, disposePending);
        });
        ambientFadePendingEntries = null;
      }
    }

    function getAmbientFadeElapsedMs(now) {
      let elapsed = now - ambientFadeStartTime - ambientFadeHiddenMsAccum;
      if (ambientFadeHiddenAt != null) {
        elapsed -= now - ambientFadeHiddenAt;
      }
      return Math.max(0, elapsed);
    }

    function ambientFadeFrame(now) {
      if (ambientFadeGenAtStart !== ambientFadeGeneration) {
        return;
      }
      const entries = ambientFadePendingEntries;
      if (!entries || !entries.length) {
        ambientFadeRafId = null;
        return;
      }
      const t = Math.min(1, getAmbientFadeElapsedMs(now) / MUSIC_SCENE_HANDOFF_MS);
      entries.forEach((e, i) => {
        e.audio.volume = ambientFadeStartVols[i] * (1 - t);
      });
      if (t < 1) {
        ambientFadeRafId = requestAnimationFrame(ambientFadeFrame);
        return;
      }
      ambientFadeRafId = null;
      ambientFadePendingEntries = null;
      const onComplete = ambientFadeOnComplete;
      const disposeOnComplete = ambientFadeDisposeOnComplete;
      ambientFadeOnComplete = null;
      entries.forEach((e) => {
        finalizeAmbientFadeEntry(e, disposeOnComplete);
      });
      if (ambientFadeGenAtStart === ambientFadeGeneration && onComplete) {
        onComplete();
      }
    }

    function scheduleAmbientFadeFrame() {
      if (ambientFadeRafId !== null) {
        cancelAnimationFrame(ambientFadeRafId);
      }
      ambientFadeRafId = requestAnimationFrame(ambientFadeFrame);
    }

    function pauseAmbientFadeForHiddenTab() {
      if (!ambientFadePendingEntries || !ambientFadePendingEntries.length) {
        return;
      }
      if (ambientFadeRafId !== null) {
        cancelAnimationFrame(ambientFadeRafId);
        ambientFadeRafId = null;
      }
      if (ambientFadeHiddenAt == null) {
        ambientFadeHiddenAt = performance.now();
      }
    }

    function resumeAmbientFadeAfterVisibleTab() {
      if (ambientFadeHiddenAt != null) {
        ambientFadeHiddenMsAccum += performance.now() - ambientFadeHiddenAt;
        ambientFadeHiddenAt = null;
      }
      if (ambientFadePendingEntries && ambientFadePendingEntries.length) {
        scheduleAmbientFadeFrame();
      }
    }

    function fadeOutAmbientEntries(entries, onComplete, options = {}) {
      if (!entries.length) {
        if (onComplete) {
          onComplete();
        }
        return;
      }
      const disposeOnComplete = options.disposeOnComplete !== false;
      cancelAmbientFadeAnim(disposeOnComplete);
      ambientFadeGenAtStart = ambientFadeGeneration;
      ambientFadePendingEntries = entries;
      ambientFadeDisposeOnComplete = disposeOnComplete;
      ambientFadeOnComplete = onComplete;
      ambientFadeStartTime = performance.now();
      ambientFadeHiddenMsAccum = 0;
      ambientFadeHiddenAt = null;
      ambientFadeStartVols = entries.map((e) => e.audio.volume);
      scheduleAmbientFadeFrame();
    }

    function fadeOutAmbientCarryover(then) {
      if (!ambientCarryoverAudios.length) {
        if (then) {
          then();
        }
        return;
      }
      const entries = ambientCarryoverAudios.slice();
      ambientCarryoverAudios = [];
      fadeOutAmbientEntries(entries, then);
    }

    /** Wait until layer audio has enough data to play (after src is set). */
    function waitForAmbientLayerDecode(audio) {
      return new Promise((resolve) => {
        if (!audio || !audio.src) {
          resolve();
          return;
        }
        if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          resolve();
          return;
        }
        const onDone = () => {
          audio.removeEventListener("canplay", onDone);
          audio.removeEventListener("error", onDone);
          resolve();
        };
        audio.addEventListener("canplay", onDone, { once: true });
        audio.addEventListener("error", onDone, { once: true });
      });
    }

    function fadeOutAllAmbientPlaying(options = {}) {
      const fromRegistry = customBgmLayerRegistry
        .filter(({ audio }) => !audio.paused)
        .map(({ audio, volumeSlider, setLayerActiveState }) => ({
          audio,
          sliderValue: Number(volumeSlider.value),
          setLayerActiveState,
        }));
      const fromCarryover = ambientCarryoverAudios.slice();
      ambientCarryoverAudios = [];
      const all = [...fromCarryover, ...fromRegistry];
      if (!all.length) {
        return;
      }
      fadeOutAmbientEntries(all, () => {}, options);
    }

    function promotePlayingLayersToCarryover() {
      customBgmLayerRegistry.forEach(({ audio, volumeSlider }) => {
        if (!audio.paused) {
          ambientCarryoverAudios.push({
            audio,
            sliderValue: Number(volumeSlider.value),
          });
        } else {
          disposeAmbientAudio(audio);
        }
      });
      customBgmLayerRegistry = [];
      customBgmContainer.innerHTML = "";
    }

    function captureAmbientLayerPlaybackSnapshot() {
      const snap = [];
      customBgmLayerRegistry.forEach(({ audio, volumeSlider, layerElement }) => {
        const file = layerElement?.dataset?.ambientFile;
        if (
          file &&
          layerElement.classList.contains("active") &&
          !audio.paused
        ) {
          snap.push({
            file,
            volume: Number(volumeSlider.value) || 50,
          });
        }
      });
      return snap;
    }

    function restoreAmbientLayerPlaybackSnapshot(snap) {
      if (!snap.length) {
        return;
      }
      fadeOutAmbientCarryover(() => {
        snap.forEach(({ file, volume }) => {
          const entry = customBgmLayerRegistry.find(
            (e) => e.layerElement?.dataset?.ambientFile === file,
          );
          if (!entry) {
            return;
          }
          entry.volumeSlider.value = String(volume);
          entry.audio.volume = effectiveBgmVolume(volume);
          entry.audio
            .play()
            .then(() => {
              entry.setLayerActiveState(true);
            })
            .catch(() => {
              entry.setLayerActiveState(false);
            });
        });
      });
    }

    function clearCustomBgmLayersHard() {
      customBgmLayerRegistry.forEach(({ audio }) => {
        disposeAmbientAudio(audio);
      });
      customBgmLayerRegistry = [];
      customBgmContainer.innerHTML = "";
    }

    function playAllAmbientLayers() {
      if (!customBgmLayerRegistry.length) {
        return;
      }
      fadeOutAmbientCarryover(() => {
        customBgmLayerRegistry.forEach(({ audio, setLayerActiveState }) => {
          if (!audio.paused) {
            return;
          }
          audio.play()
            .then(() => {
              setLayerActiveState(true);
            })
            .catch(() => {
              setLayerActiveState(false);
            });
        });
      });
    }

    function resumeAmbientAudioEntry(audio, volumeSliderOrValue, setLayerActiveState) {
      if (!audio || !audio.src) {
        return;
      }
      const vol =
        volumeSliderOrValue && typeof volumeSliderOrValue === "object"
          ? effectiveBgmVolume(volumeSliderOrValue.value)
          : effectiveBgmVolume(volumeSliderOrValue);
      setAudioVolume(audio, vol);
      const playPromise = audio.paused ? audio.play() : Promise.resolve();
      playPromise
        .then(() => {
          if (setLayerActiveState) {
            setLayerActiveState(true);
          }
        })
        .catch(() => {
          if (setLayerActiveState) {
            setLayerActiveState(false);
          }
        });
    }

    /** Keep ambient playing after the tab was in the background (fade + browser pause). */
    function resumeAmbientPlaybackAfterTabVisible() {
      customBgmLayerRegistry.forEach(
        ({ audio, volumeSlider, setLayerActiveState, layerElement }) => {
          if (!layerElement || !layerElement.classList.contains("active")) {
            return;
          }
          resumeAmbientAudioEntry(audio, volumeSlider, setLayerActiveState);
        },
      );
      ambientCarryoverAudios.forEach(({ audio, sliderValue }) => {
        resumeAmbientAudioEntry(audio, sliderValue, null);
      });
    }

    function scheduleAmbientResumeAfterTabVisible() {
      resumeAmbientPlaybackAfterTabVisible();
      requestAnimationFrame(resumeAmbientPlaybackAfterTabVisible);
      setTimeout(resumeAmbientPlaybackAfterTabVisible, 0);
      setTimeout(resumeAmbientPlaybackAfterTabVisible, 100);
    }

    function onDocumentVisibilityForAmbient() {
      if (document.hidden) {
        pauseAmbientFadeForHiddenTab();
        return;
      }
      resumeAmbientFadeAfterVisibleTab();
      scheduleAmbientResumeAfterTabVisible();
      renderMusicPlaylist();
      syncSceneAudioIndicators();
    }

    const SCENE_PLAY_SVG =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 6l12 6-12 6V6z"/></svg>';

    const SCENE_AUDIO_INDICATOR_HTML =
      '<span class="scene-audio-indicator" title="Audio playing">' +
      '<span class="scene-audio-bars" aria-hidden="true">' +
      "<span></span><span></span><span></span>" +
      "</span></span>";

    function playSceneFromSelector(sceneKey) {
      if (!sceneKey || !isCustomSceneKey(sceneKey)) {
        return;
      }
      setActiveSceneButton(sceneKey);
      let ambientHydration = Promise.resolve();
      if (currentScene !== sceneKey) {
        ambientHydration = activateSceneKey(sceneKey);
      } else if (musicPlayer.paused) {
        musicPlaybackScene = sceneKey;
        pendingPlayTrackIndex = currentTrackIndex;
        void loadCurrentTrack();
      }
      void playMusic();
      void ambientHydration.then(() => {
        playAllAmbientLayers();
      });
    }

    function stopAllAmbientLayers() {
      fadeOutAllAmbientPlaying({ disposeOnComplete: false });
    }

    function applyIdleMusicVolume() {
      if (!musicPlayer.paused) {
        return;
      }
      musicPlayer.volume = effectiveMusicVolume();
    }

    function refreshMasterAndGroupVolumes() {
      if (isIOS && iosMasterGain && iosAudioCtx) {
        iosMasterGain.gain.setValueAtTime(getMasterLevel(), iosAudioCtx.currentTime);
      }
      renderFxButtons.refreshIosSfxGroupGain(iosAudioCtx);
      applyBgmVolumesFromSliders();
      if (!musicPlayer.paused) {
        musicPlayer.volume = effectiveMusicVolume();
      } else {
        applyIdleMusicVolume();
      }
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
        musicPlaybackScene === currentScene
      ) {
        currentTrackIndex = musicQueuedNextTrackIndex;
        pendingPlayTrackIndex = currentTrackIndex;
        if (currentScene) {
          saveMusicSelectionForScene(currentScene, pendingPlayTrackIndex);
        }
        musicQueuedNextTrackIndex = null;
        musicPlayer.volume = effectiveMusicVolume();
        void loadCurrentTrack().then((ok) => {
          if (ok) {
            musicPlayer.play().then(() => {
              setupMediaSession();
              renderMusicPlaylist();
              syncSceneAudioIndicators();
            }).catch(() => {
              renderMusicPlaylist();
              syncSceneAudioIndicators();
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
          syncSceneAudioIndicators();
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
      if (isCustomSceneKey(sceneKey)) {
        const cs = getCustomSceneByKey(sceneKey);
        return cs && Array.isArray(cs.playlist) ? cs.playlist : [];
      }
      return [];
    }

    function getTrackLabel(filePath) {
      const rest = stripUserUploadRef(String(filePath || ""));
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
        album: currentScene ? String(currentScene) : "Session",
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
      const tracks = getSceneTracks(currentScene);
      musicPlaylistElement.innerHTML = "";

      if (!tracks.length) {
        const emptyItem = document.createElement("li");
        emptyItem.textContent = "No tracks for this scene.";
        musicPlaylistElement.appendChild(emptyItem);
        return;
      }

      const synced = musicPlaybackScene === currentScene;
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
      syncSceneAudioIndicators();
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

      const nextSrc = await resolveAudioPlaybackUrl(tracks[currentTrackIndex]);
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
      const sceneKey = opts.sceneKey != null ? opts.sceneKey : currentScene;
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
      syncSceneAudioIndicators();
    }

    async function playMusic() {
      const destTracks = getSceneTracks(currentScene);
      if (!destTracks.length) {
        return;
      }

      const targetIndex = clampPlaylistIndex(pendingPlayTrackIndex, destTracks);
      pendingPlayTrackIndex = targetIndex;
      saveMusicSelectionForScene(currentScene, targetIndex);

      cancelMusicVolumeAnim();

      if (musicPlaybackScene !== currentScene) {
        if (!musicPlayer.paused) {
          detachMusicEnded(musicPlayer);
          runMusicFadeOut(musicPlayer, () => {
            void startMusicPlaybackAtIndex(targetIndex, { sceneKey: currentScene });
          });
          return;
        }
        await startMusicPlaybackAtIndex(targetIndex, { sceneKey: currentScene });
        return;
      }

      if (
        musicPlaybackScene === currentScene &&
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
        syncSceneAudioIndicators();
        return;
      }

      const playingOtherTrack =
        !musicPlayer.paused && targetIndex !== currentTrackIndex;

      if (playingOtherTrack) {
        detachMusicEnded(musicPlayer);
        runMusicFadeOut(musicPlayer, () => {
          void startMusicPlaybackAtIndex(targetIndex, { sceneKey: currentScene });
        });
        return;
      }

      await startMusicPlaybackAtIndex(targetIndex, { sceneKey: currentScene });
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
      syncSceneAudioIndicators();
    }

    function goToNextTrack(shouldPlay) {
      musicQueuedNextTrackIndex = null;
      if (musicPlaybackScene !== currentScene) {
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
        const uiTracks = getSceneTracks(currentScene);
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
      if (musicPlaybackScene !== currentScene) {
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
        const uiTracks = getSceneTracks(currentScene);
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
      const previousScene = currentScene;
      currentScene = sceneName;
      const sameScene = previousScene === sceneName;

      if (sameScene) {
        updateNowPlayingDisplay();
        renderMusicPlaylist();
        syncSceneAudioIndicators();
        return;
      }

      musicQueuedNextTrackIndex = null;
      cancelMusicVolumeAnim();

      const newTracks = getSceneTracks(currentScene);
      const savedSelection = loadMusicSelectionForScene(sceneName);
      pendingPlayTrackIndex = clampPlaylistIndex(savedSelection, newTracks);

      if (musicPlayer.paused) {
        currentTrackIndex = pendingPlayTrackIndex;
        musicPlaybackScene = currentScene;
        detachMusicEnded(musicPlayer);
        void loadCurrentTrack();
        return;
      }

      if (!newTracks.length) {
        currentTrackIndex = 0;
        pendingPlayTrackIndex = 0;
        detachMusicEnded(musicPlayer);
        runMusicFadeOut(musicPlayer, () => {
          musicPlaybackScene = currentScene;
          musicPlayer.removeAttribute("src");
          musicPlayer.load();
          musicPlayer.volume = effectiveMusicVolume();
          updateNowPlayingDisplay();
          renderMusicPlaylist();
          updateMusicProgressUi();
          syncSceneAudioIndicators();
        });
        return;
      }

      updateNowPlayingDisplay();
      renderMusicPlaylist();
      syncSceneAudioIndicators();
    }

    function initializeMusicPlayer() {
      musicPlayer.preload = "auto";
      musicPlaybackScene = currentScene;
      musicPlayer.volume = effectiveMusicVolume();

      if (isIOS && musicVolumeSlider) {
        attachIosDeviceVolumeHintBelow(musicVolumeSlider);
      }

      document.addEventListener("visibilitychange", onDocumentVisibilityForAmbient);

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
      const primaryMaster = masterVolumeSliderDesktop || masterVolumeSliderMobile;
      if (primaryMaster) {
        syncMasterVolumeUiFrom(primaryMaster);
      }
      const onMasterInput = (e) => {
        syncMasterVolumeUiFrom(e.target);
        refreshMasterAndGroupVolumes();
      };
      if (masterVolumeSliderDesktop) {
        masterVolumeSliderDesktop.addEventListener("input", onMasterInput);
      }
      if (masterVolumeSliderMobile) {
        masterVolumeSliderMobile.addEventListener("input", onMasterInput);
      }
      musicVolumeSlider.addEventListener("input", () => {
        refreshMasterAndGroupVolumes();
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

      if (editSceneTopButton) {
        editSceneTopButton.addEventListener("click", () => {
          if (currentScene && isCustomSceneKey(currentScene)) {
            void openSceneEditorForEdit(currentScene);
          } else {
            void openSceneEditorNew();
          }
        });
      }

      if (ambientPlayAllButton) {
        ambientPlayAllButton.addEventListener("click", () => {
          playAllAmbientLayers();
        });
      }
      if (ambientStopAllButton) {
        ambientStopAllButton.addEventListener("click", () => {
          stopAllAmbientLayers();
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
        void buildSfxSectionFilterPills();
        void renderFxButtons();
        renderMusicPlaylist();
        updateNowPlayingDisplay();
      });

      void loadCurrentTrack();
    }

    function renderAmbientLayersForScene(sceneKey, ambientPreviousSceneKey) {
      cancelAmbientFadeAnim();

      const explicitPrevious = arguments.length >= 2;
      const prev = explicitPrevious ? ambientPreviousSceneKey : sceneKey;
      const isSameSceneRefresh = Boolean(sceneKey && prev === sceneKey);
      const playbackSnapshot = isSameSceneRefresh
        ? captureAmbientLayerPlaybackSnapshot()
        : [];

      if (isSameSceneRefresh) {
        clearCustomBgmLayersHard();
      } else {
        promotePlayingLayersToCarryover();
      }

      if (!isCustomSceneKey(sceneKey)) {
        customBgmContainer.hidden = true;
        customBgmContainer.style.display = "none";
        if (ambientPanelActions) {
          ambientPanelActions.hidden = true;
        }
        fadeOutAllAmbientPlaying();
        return Promise.resolve();
      }

      customBgmContainer.hidden = false;
      customBgmContainer.style.display = "grid";
      if (ambientPanelActions) {
        ambientPanelActions.hidden = false;
      }

      const cs = getCustomSceneByKey(sceneKey);
      const layers = (cs && Array.isArray(cs.ambientLayers) ? cs.ambientLayers : []).slice(0, 6);
      const layerReadyPromises = [];
      layers.forEach((layerDef, index) => {
        const file = (layerDef.file || "").trim();
        if (!file) {
          return;
        }
        const name = (layerDef.name || `Layer ${index + 1}`).trim() || `Layer ${index + 1}`;
        const defaultVol = Math.min(100, Math.max(0, Number(layerDef.defaultVolume) || 50));

        const layerElement = document.createElement("div");
        layerElement.className = "layer";
        layerElement.dataset.bgmLayer = "";
        layerElement.dataset.ambientFile = file;

        const rowMain = document.createElement("div");
        rowMain.className = "layer-row-main";

        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "layer-toggle";
        toggleButton.setAttribute("aria-pressed", "false");
        toggleButton.setAttribute("aria-label", `Start ${name}`);
        toggleButton.title = `Start ${name}`;
        toggleButton.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3.5a.5.5 0 0 1 .76-.43l6 3.5a.5.5 0 0 1 0 .86l-6 3.5A.5.5 0 0 1 5 10.5v-7z"/></svg>';

        const nameCol = document.createElement("div");
        nameCol.className = "layer-name-col";
        const nameEl = document.createElement("div");
        nameEl.className = "layer-name";
        nameEl.textContent = name;

        const volRow = document.createElement("div");
        volRow.className = "layer-vol-row";
        const rangeId = `custom-layer-${cs.id}-${index}`;
        const volumeSlider = document.createElement("input");
        volumeSlider.type = "range";
        volumeSlider.min = "0";
        volumeSlider.max = "100";
        volumeSlider.value = String(defaultVol);
        volumeSlider.className = "layer-volume";
        volumeSlider.id = rangeId;
        volumeSlider.setAttribute("aria-label", `${name} volume`);

        const pctEl = document.createElement("span");
        pctEl.className = "layer-vol-pct";
        pctEl.textContent = `${Math.round(defaultVol)}%`;

        volRow.appendChild(volumeSlider);
        if (isIOS) {
          attachIosDeviceVolumeHintBelow(
            volumeSlider,
            "display:flex;flex-direction:column;align-items:stretch;min-width:0;flex:1;",
          );
        }
        nameCol.appendChild(nameEl);
        rowMain.appendChild(toggleButton);
        rowMain.appendChild(nameCol);
        rowMain.appendChild(volRow);
        rowMain.appendChild(pctEl);
        layerElement.appendChild(rowMain);
        customBgmContainer.appendChild(layerElement);

        const layerAudio = new Audio();
        layerAudio.loop = true;
        layerAudio.volume = effectiveBgmVolume(volumeSlider.value);
        layerReadyPromises.push(
          resolveAudioPlaybackUrl(file)
            .then((url) => {
              if (url) {
                layerAudio.src = url;
              }
              return waitForAmbientLayerDecode(layerAudio);
            })
            .catch(() => {}),
        );

        const setLayerActiveState = (isActive) => {
          layerElement.classList.toggle("active", isActive);
          toggleButton.classList.toggle("active", isActive);
          toggleButton.innerHTML = isActive
            ? '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 4.5h7v7h-7z"/></svg>'
            : '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3.5a.5.5 0 0 1 .76-.43l6 3.5a.5.5 0 0 1 0 .86l-6 3.5A.5.5 0 0 1 5 10.5v-7z"/></svg>';
          toggleButton.setAttribute("aria-label", `${isActive ? "Stop" : "Start"} ${name}`);
          toggleButton.title = `${isActive ? "Stop" : "Start"} ${name}`;
          toggleButton.setAttribute("aria-pressed", String(isActive));
          syncSceneAudioIndicators();
        };

        toggleButton.addEventListener("click", () => {
          if (!layerAudio.paused) {
            layerAudio.pause();
            layerAudio.currentTime = 0;
            setLayerActiveState(false);
            return;
          }

          fadeOutAmbientCarryover(() => {
            layerAudio.play()
              .then(() => {
                setLayerActiveState(true);
              })
              .catch(() => {
                setLayerActiveState(false);
              });
          });
        });

        volumeSlider.addEventListener("input", () => {
          setAudioVolume(layerAudio, effectiveBgmVolume(volumeSlider.value));
          pctEl.textContent = `${Math.round(Number(volumeSlider.value) || 0)}%`;
        });

        customBgmLayerRegistry.push({
          audio: layerAudio,
          volumeSlider,
          setLayerActiveState,
          layerElement,
        });
      });
      return Promise.all(layerReadyPromises).then(() => {
        if (playbackSnapshot.length) {
          restoreAmbientLayerPlaybackSnapshot(playbackSnapshot);
        }
      });
    }


    function activateSceneKey(sceneKey) {
      const previousSceneKey = currentScene;
      if (previousSceneKey === sceneKey) {
        try {
          if (sceneKey && isCustomSceneKey(sceneKey)) {
            localStorage.setItem(ACTIVE_SCENE_STORAGE_KEY, sceneKey);
          }
        } catch (_) {
          /* ignore */
        }
        void renderFxButtons();
        return Promise.resolve();
      }
      setSceneMusic(sceneKey);
      const ambientReady = renderAmbientLayersForScene(sceneKey, previousSceneKey);
      try {
        if (sceneKey && isCustomSceneKey(sceneKey)) {
          localStorage.setItem(ACTIVE_SCENE_STORAGE_KEY, sceneKey);
        } else {
          localStorage.removeItem(ACTIVE_SCENE_STORAGE_KEY);
        }
      } catch (_) {
        /* ignore */
      }
      void renderFxButtons();
      return ambientReady;
    }

    function setActiveSceneButton(sceneKey) {
      sceneButtonsBar.querySelectorAll(".scene-card").forEach((card) => {
        const btn = card.querySelector(".scene-btn");
        const active = Boolean(sceneKey && btn && btn.dataset.sceneKey === sceneKey);
        card.classList.toggle("active", active);
      });
      sceneButtonsBar.querySelectorAll(".scene-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
        if (sceneKey && b.dataset.sceneKey === sceneKey) {
          b.classList.add("active");
          b.setAttribute("aria-pressed", "true");
        }
      });
    }

    function getFirstCustomSceneKey() {
      const list = customScenesInActiveSession();
      return list.length ? `custom:${list[0].id}` : null;
    }

    function applyNoSceneSelection() {
      const ambientPrevSceneKey = currentScene;
      currentScene = null;
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
      setActiveSceneButton(null);
      setSceneMusic(null);
      void renderAmbientLayersForScene(null, ambientPrevSceneKey);
      try {
        localStorage.removeItem(ACTIVE_SCENE_STORAGE_KEY);
      } catch (_) {
        /* ignore */
      }
      void renderFxButtons();
    }

    function selectFirstCustomSceneOrNone() {
      const key = getFirstCustomSceneKey();
      if (!key) {
        applyNoSceneSelection();
        return;
      }
      setActiveSceneButton(key);
      activateSceneKey(key);
    }

    function restorePersistedActiveSceneOrDefault() {
      let saved = null;
      try {
        saved = localStorage.getItem(ACTIVE_SCENE_STORAGE_KEY);
      } catch (_) {
        saved = null;
      }
      if (saved && isCustomSceneKey(saved)) {
        const cs = getCustomSceneByKey(saved);
        const sid = cs ? (cs.sessionId || sessionsList[0]?.id) : null;
        if (cs && lastAuthSession?.user && sid && activeSessionId && sid !== activeSessionId) {
          setActiveSessionId(sid, { skipPersist: false, skipReselectScene: true });
        }
        if (getCustomSceneByKey(saved)) {
          setActiveSceneButton(saved);
          if (currentScene !== saved) {
            activateSceneKey(saved);
          }
          return;
        }
      }
      selectFirstCustomSceneOrNone();
    }

    function refreshSceneSelectorBar() {
      sceneButtonsBar.querySelectorAll("[data-custom-scene-area]").forEach((el) => {
        el.remove();
      });
      const visibleScenes = customScenesInActiveSession();
      visibleScenes.forEach((scene) => {
        const key = `custom:${scene.id}`;
        const wrap = document.createElement("div");
        wrap.className = "scene-card";
        wrap.dataset.customSceneArea = "1";

        const primaryRow = document.createElement("div");
        primaryRow.className = "scene-card-primary";

        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "scene-play-btn";
        playBtn.dataset.scenePlay = key;
        const playLabel = `Play ${scene.name}`;
        playBtn.setAttribute("aria-label", playLabel);
        playBtn.title = playLabel;
        playBtn.innerHTML = SCENE_PLAY_SVG;

        const sceneBtn = document.createElement("button");
        sceneBtn.type = "button";
        sceneBtn.className = "scene-btn";
        sceneBtn.dataset.sceneKey = key;
        sceneBtn.setAttribute("aria-pressed", "false");
        sceneBtn.textContent = scene.name;
        if (scene.tags) {
          sceneBtn.title = scene.tags;
        }

        const audioIndicator = document.createElement("span");
        audioIndicator.className = "scene-audio-indicator-wrap";
        audioIndicator.innerHTML = SCENE_AUDIO_INDICATOR_HTML;

        primaryRow.appendChild(audioIndicator);
        primaryRow.appendChild(sceneBtn);

        const tagRow = document.createElement("div");
        tagRow.className = "scene-card-tags";
        String(scene.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((tag) => {
            const pill = document.createElement("span");
            pill.className = "tag-pill";
            pill.textContent = tag;
            tagRow.appendChild(pill);
          });

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "scene-edit-btn";
        editBtn.textContent = "Edit";
        editBtn.dataset.editScene = key;

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "scene-delete-btn";
        delBtn.textContent = "Del";
        delBtn.dataset.deleteScene = key;

        const actions = document.createElement("div");
        actions.className = "scene-card-actions";
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        const controlsRow = document.createElement("div");
        controlsRow.className = "scene-card-controls";
        controlsRow.appendChild(playBtn);
        controlsRow.appendChild(actions);

        wrap.appendChild(primaryRow);
        wrap.appendChild(tagRow);
        wrap.appendChild(controlsRow);
        sceneButtonsBar.appendChild(wrap);
      });

      const emptyHint = document.getElementById("scene-selector-empty");
      if (emptyHint) {
        emptyHint.hidden = visibleScenes.length > 0;
      }
      updateSessionSelectorTriggerLabel();
      if (currentScene) {
        setActiveSceneButton(currentScene);
      }
      syncSceneAudioIndicators();
      updateTierUsageIndicators();
    }

    function closeDeleteSceneConfirm() {
      pendingDeleteSceneKey = null;
      if (!deleteSceneBackdrop) {
        return;
      }
      deleteSceneBackdrop.classList.remove("open");
      deleteSceneBackdrop.setAttribute("aria-hidden", "true");
    }

    async function confirmPendingDeleteScene() {
      const sceneKey = pendingDeleteSceneKey;
      closeDeleteSceneConfirm();
      if (!sceneKey || !isCustomSceneKey(sceneKey)) {
        return;
      }
      const id = sceneKey.slice("custom:".length);
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { error } = await supabase
          .from("scenes")
          .delete()
          .eq("id", id)
          .eq("user_id", session.user.id);
        if (error) {
          console.error("delete scene", error);
        }
        await refreshCustomScenesList();
        await refreshUserLimits();
      } else {
        customScenesList = customScenesList.filter((s) => s.id !== id);
        saveCustomScenesToStorage(customScenesList);
        await refreshCustomScenesList();
        updateTierUsageIndicators();
      }
      refreshSceneSelectorBar();

      if (currentScene === sceneKey || musicPlaybackScene === sceneKey) {
        selectFirstCustomSceneOrNone();
      }
    }

    function deleteCustomSceneByKey(sceneKey) {
      if (!isCustomSceneKey(sceneKey)) {
        return;
      }
      const cs = getCustomSceneByKey(sceneKey);
      const name =
        cs && cs.name != null && String(cs.name).trim() !== ""
          ? String(cs.name).trim()
          : "this scene";
      pendingDeleteSceneKey = sceneKey;
      if (deleteSceneMessageEl) {
        deleteSceneMessageEl.textContent =
          `Delete "${name}"? This cannot be undone.`;
      }
      if (deleteSceneBackdrop) {
        deleteSceneBackdrop.classList.add("open");
        deleteSceneBackdrop.setAttribute("aria-hidden", "false");
      }
      if (deleteSceneConfirmBtn) {
        deleteSceneConfirmBtn.focus();
      }
    }


    function stopSceneEditorPreview() {
      if (!sceneEditorPreviewAudio) return;
      sceneEditorPreviewAudio.pause();
      sceneEditorPreviewAudio.currentTime = 0;
      sceneEditorPreviewAudio = null;
    }

    function closeSceneEditor() {
      stopSceneEditorPreview();
      const returnEl = sceneEditorReturnFocus;
      sceneEditorReturnFocus = null;
      sceneEditorBackdrop.classList.remove("open");
      sceneEditorBackdrop.setAttribute("inert", "");
      if (returnEl && typeof returnEl.focus === "function" && document.body.contains(returnEl)) {
        try {
          returnEl.focus();
        } catch (_) {
          /* ignore */
        }
      }
    }

    function renderEditorPlaylist() {
      editorPlaylistList.innerHTML = "";
      sceneEditorDraftPlaylist.forEach((path, index) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        const displayTitle =
          AudioLibrary.getPlaylistTrackTitle(path) || getTrackLabel(path);
        span.textContent = displayTitle;
        span.title = path;

        const up = document.createElement("button");
        up.type = "button";
        up.textContent = "Up";
        up.disabled = index === 0;
        up.addEventListener("click", () => {
          if (index <= 0) {
            return;
          }
          const t = sceneEditorDraftPlaylist[index - 1];
          sceneEditorDraftPlaylist[index - 1] = sceneEditorDraftPlaylist[index];
          sceneEditorDraftPlaylist[index] = t;
          renderEditorPlaylist();
        });

        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.className = "editor-playlist-preview-btn";
        previewBtn.textContent = "▶";
        previewBtn.setAttribute("aria-label", `Preview ${displayTitle}`);
        previewBtn.addEventListener("click", () => {
          stopSceneEditorPreview();
          void resolveAudioPlaybackUrl(path).then((url) => {
            if (!url) return;
            const audio = new Audio(url);
            audio.volume = 0.7;
            audio.play().catch(() => { sceneEditorPreviewAudio = null; });
            sceneEditorPreviewAudio = audio;
            audio.addEventListener("ended", () => { sceneEditorPreviewAudio = null; }, { once: true });
          });
        });

        const down = document.createElement("button");
        down.type = "button";
        down.textContent = "Down";
        down.disabled = index >= sceneEditorDraftPlaylist.length - 1;
        down.addEventListener("click", () => {
          if (index >= sceneEditorDraftPlaylist.length - 1) {
            return;
          }
          const t = sceneEditorDraftPlaylist[index + 1];
          sceneEditorDraftPlaylist[index + 1] = sceneEditorDraftPlaylist[index];
          sceneEditorDraftPlaylist[index] = t;
          renderEditorPlaylist();
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          sceneEditorDraftPlaylist.splice(index, 1);
          renderEditorPlaylist();
        });

        li.appendChild(span);
        li.appendChild(up);
        li.insertBefore(previewBtn, up);
        li.appendChild(down);
        li.appendChild(remove);
        editorPlaylistList.appendChild(li);
      });
    }

    function renderEditorAmbient() {
      editorAmbientRows.innerHTML = "";
      sceneEditorDraftAmbient.forEach((row, index) => {
        const wrap = document.createElement("div");
        wrap.className = "ambient-editor-row";
        wrap.innerHTML = `
          <div class="row-grid">
            <div class="editor-inline-wrap">
              <span class="editor-inline-label" data-field="name-view" tabindex="0" role="button"></span>
              <input class="editor-inline-input" type="text" data-field="name-edit" hidden />
            </div>
            <div class="editor-file-row">
              <span class="editor-selected-file" data-field="file-label">No file selected</span>
              <button type="button" data-field="browse">Browse</button>
            </div>
          </div>
          <label>Default volume (0–100)
            <input type="range" min="0" max="100" data-field="vol" />
          </label>
          <button type="button" class="editor-remove-ambient">Remove layer</button>
        `;
        const nameView = wrap.querySelector('[data-field="name-view"]');
        const nameEdit = wrap.querySelector('[data-field="name-edit"]');
        const fileLabel = wrap.querySelector('[data-field="file-label"]');
        const browseButton = wrap.querySelector('[data-field="browse"]');
        const volInput = wrap.querySelector('[data-field="vol"]');
        nameView.textContent = row.name || "";
        nameEdit.value = row.name || "";
        fileLabel.textContent = row.file || "No file selected";
        volInput.value = String(row.defaultVolume);
        const startEditName = () => {
          nameView.hidden = true;
          nameEdit.hidden = false;
          nameEdit.value = sceneEditorDraftAmbient[index].name || "";
          nameEdit.focus();
          nameEdit.select();
        };
        const commitName = () => {
          const draft = sceneEditorDraftAmbient[index];
          const value = nameEdit.value.trim();
          draft.name = value || formatAutoLabelFromPath(draft.file) || `Layer ${index + 1}`;
          draft.nameManuallyEdited = true;
          renderEditorAmbient();
        };
        nameView.addEventListener("click", startEditName);
        nameView.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            startEditName();
          }
        });
        nameEdit.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitName();
          } else if (event.key === "Escape") {
            event.preventDefault();
            renderEditorAmbient();
          }
        });
        nameEdit.addEventListener("blur", commitName);
        browseButton.addEventListener("click", () => {
          openFilePicker("ambient", (selectedPath) => {
            const draft = sceneEditorDraftAmbient[index];
            draft.file = selectedPath;
            const autoLabel = formatAutoLabelFromPath(selectedPath);
            const trimmed = String(draft.name || "").trim();
            // Auto-label with the file name until the user edits the layer name.
            if (!draft.nameManuallyEdited || !trimmed) {
              draft.name = autoLabel;
            }
            renderEditorAmbient();
          });
        });
        volInput.addEventListener("input", () => {
          sceneEditorDraftAmbient[index].defaultVolume = Number(volInput.value) || 0;
        });
        wrap.querySelector(".editor-remove-ambient").addEventListener("click", () => {
          sceneEditorDraftAmbient.splice(index, 1);
          renderEditorAmbient();
        });
        editorAmbientRows.appendChild(wrap);
      });
    }

    async function resetEditorDraftFromSceneObject(scene) {
      sceneEditorEditingId = scene ? scene.id : null;
      editorSceneName.value = scene ? scene.name : "";
      editorSceneTags.value = scene ? (scene.tags || "") : "";
      editorPlaylistFile.value = "";
      editorPlaylistSelectedFile.textContent = "No file selected";
      sceneEditorDraftPlaylist = scene && Array.isArray(scene.playlist) ? [...scene.playlist] : [];
      sceneEditorDraftAmbient = scene && Array.isArray(scene.ambientLayers)
        ? scene.ambientLayers.map((l) => ({
            name: l.name || "",
            file: l.file || "",
            nameManuallyEdited: false,
            defaultVolume: Math.min(100, Math.max(0, Number(l.defaultVolume) || 50)),
          }))
        : [];
      renderEditorPlaylist();
      renderEditorAmbient();
      const sessPick = scene ? (scene.sessionId || activeSessionId) : activeSessionId;
      await populateEditorSessionSelect(sessPick || null);
    }

    async function openSceneEditorNew() {
      await buildSceneEditorSessionSectionIfSignedIn();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await ensureDefaultSessionRowIfEmptyForSignedInEditor(session.user.id);
      }
      const ae = document.activeElement;
      sceneEditorReturnFocus = ae instanceof HTMLElement ? ae : null;
      sceneEditorBackdrop.removeAttribute("inert");
      document.getElementById("scene-editor-title").textContent = "Create new scene";
      await resetEditorDraftFromSceneObject(null);
      sceneEditorBackdrop.classList.add("open");
      void Promise.resolve().then(() => {
        editorSceneName.focus();
      });
    }

    async function openSceneEditorForEdit(sceneKey) {
      if (!isCustomSceneKey(sceneKey)) {
        return;
      }
      const scene = getCustomSceneByKey(sceneKey);
      if (!scene) {
        return;
      }
      await buildSceneEditorSessionSectionIfSignedIn();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await ensureDefaultSessionRowIfEmptyForSignedInEditor(session.user.id);
      }
      const ae = document.activeElement;
      sceneEditorReturnFocus = ae instanceof HTMLElement ? ae : null;
      sceneEditorBackdrop.removeAttribute("inert");
      document.getElementById("scene-editor-title").textContent = "Edit scene";
      await resetEditorDraftFromSceneObject(scene);
      sceneEditorBackdrop.classList.add("open");
      void Promise.resolve().then(() => {
        editorSceneName.focus();
      });
    }

    async function saveSceneFromEditor() {
      stopSceneEditorPreview();
      const name = editorSceneName.value.trim();
      if (!name) {
        window.alert("Please enter a scene name.");
        return;
      }

      const ambientLayers = sceneEditorDraftAmbient
        .map((r) => ({
          name: (r.name || "").trim(),
          file: (r.file || "").trim(),
          defaultVolume: Math.min(100, Math.max(0, Number(r.defaultVolume) || 0)),
        }))
        .filter((r) => r.file);

      const { data: { session } } = await supabase.auth.getSession();

      let nextSessionId = null;
      if (session?.user) {
        nextSessionId = activeSessionId || sessionsList[0]?.id || null;
        const editorSceneSessionSelect = getEditorSceneSessionSelect();
        if (
          editorSceneSessionSelect &&
          !editorSceneSessionSelect.disabled &&
          editorSceneSessionSelect.value
        ) {
          nextSessionId = editorSceneSessionSelect.value;
        }
      }

      const existingForPins = sceneEditorEditingId
        ? customScenesList.find((s) => s.id === sceneEditorEditingId)
        : null;
      const sceneObj = {
        id: sceneEditorEditingId || (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
        name,
        tags: editorSceneTags.value.trim(),
        playlist: sceneEditorDraftPlaylist.map((p) => p.trim()).filter(Boolean),
        ambientLayers: ambientLayers.slice(0, 6),
        pinnedSfx:
          existingForPins && Array.isArray(existingForPins.pinnedSfx)
            ? [...existingForPins.pinnedSfx.map(String)]
            : [],
        ...(session?.user ? { sessionId: nextSessionId || undefined } : {}),
      };

      if (session?.user) {
        if (userTier === "pro") {
          /* allow action */
        } else {
          let limits = null;
          await fetchUserTier(session.user.id);
          limits = await fetchUserLimits();
          if (
            !sceneEditorEditingId &&
            (limits?.scene_limit_reached || isFreeSignedInSceneLimitReached())
          ) {
            openUpgradeModal();
            return;
          }
          if (limits?.session_limit_reached && sessionsList.length > 1) {
            const firstSid = sessionsList[0]?.id;
            if (firstSid) {
              nextSessionId = firstSid;
              sceneObj.sessionId = firstSid;
            }
          }
        }
        const row = appSceneToRow(sceneObj, session.user.id);
        const { error } = await supabase.from("scenes").upsert(row, { onConflict: "id" });
        if (error) {
          window.alert(`Could not save scene: ${error.message}`);
          return;
        }
        await refreshCustomScenesList();
        await refreshUserLimits();
      } else {
        let list = loadCustomScenesFromStorage();
        if (!sceneEditorEditingId) {
          if (list.length >= ANON_CUSTOM_SCENE_LIMIT) {
            openSceneLimitModal();
            return;
          }
        }
        const anonScene = { ...sceneObj };
        if (sceneEditorEditingId) {
          list = list.map((s) => (s.id === sceneEditorEditingId ? anonScene : s));
        } else {
          list.push(anonScene);
        }
        saveCustomScenesToStorage(list);
        await refreshCustomScenesList();
        updateTierUsageIndicators();
      }

      refreshSceneSelectorBar();
      closeSceneEditor();

      const key = `custom:${sceneObj.id}`;
      setActiveSceneButton(key);
      if (key === currentScene) {
        renderAmbientLayersForScene(key);
        if (musicPlayer.paused) {
          musicPlaybackScene = key;
          detachMusicEnded(musicPlayer);
          void loadCurrentTrack();
        }
        renderMusicPlaylist();
      } else {
        activateSceneKey(key);
      }
    }

    sceneButtonsBar.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest("[data-delete-scene]");
      if (deleteBtn) {
        e.preventDefault();
        deleteCustomSceneByKey(deleteBtn.getAttribute("data-delete-scene"));
        return;
      }

      const editBtn = e.target.closest("[data-edit-scene]");
      if (editBtn) {
        e.preventDefault();
        void openSceneEditorForEdit(editBtn.getAttribute("data-edit-scene"));
        return;
      }

      const scenePlayBtn = e.target.closest("[data-scene-play]");
      if (scenePlayBtn && sceneButtonsBar.contains(scenePlayBtn)) {
        e.preventDefault();
        e.stopPropagation();
        playSceneFromSelector(scenePlayBtn.getAttribute("data-scene-play"));
        return;
      }

      const sceneBtn = e.target.closest(".scene-btn");
      if (!sceneBtn || !sceneButtonsBar.contains(sceneBtn)) {
        return;
      }
      const sceneKey = sceneBtn.dataset.sceneKey;
      if (!sceneKey) {
        return;
      }

      setActiveSceneButton(sceneKey);
      activateSceneKey(sceneKey);
    });

    createNewSceneButton.addEventListener("click", async () => {
      if (isLimitModalOnCooldown()) {
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (userTier === "pro") {
        void openSceneEditorNew();
        return;
      }
      if (!session?.user) {
        if (isAnonSceneLimitReached()) {
          openSceneLimitModal();
          return;
        }
      } else if (isFreeSignedInSceneLimitReached()) {
        openUpgradeModal();
        return;
      }
      void openSceneEditorNew();
    });

    editorCancelScene.addEventListener("click", () => {
      closeSceneEditor();
    });

    sceneEditorBackdrop.addEventListener("click", (e) => {
      if (e.target === sceneEditorBackdrop) {
        closeSceneEditor();
      }
    });


    editorPlaylistBrowse.addEventListener("click", () => {
      stopSceneEditorPreview();
      openFilePicker(
        "music",
        (paths) => {
          const list = Array.isArray(paths) ? paths : [paths];
          list.forEach((p) => {
            const t = String(p).trim();
            if (t) {
              sceneEditorDraftPlaylist.push(t);
            }
          });
          editorPlaylistFile.value = "";
          editorPlaylistSelectedFile.textContent = "No file selected";
          renderEditorPlaylist();
        },
        { multi: true },
      );
    });

    editorAmbientAdd.addEventListener("click", () => {
      if (sceneEditorDraftAmbient.length >= 6) {
        return;
      }
      sceneEditorDraftAmbient.push({
        name: "",
        file: "",
        defaultVolume: 50,
        nameManuallyEdited: false,
      });
      renderEditorAmbient();
    });

    editorSaveScene.addEventListener("click", () => {
      void saveSceneFromEditor();
    });

    deleteSceneCancelBtn.addEventListener("click", () => {
      closeDeleteSceneConfirm();
    });
    deleteSceneConfirmBtn.addEventListener("click", () => {
      void confirmPendingDeleteScene();
    });
    deleteSceneBackdrop.addEventListener("click", (e) => {
      if (e.target === deleteSceneBackdrop) {
        closeDeleteSceneConfirm();
      }
    });

    Favorites.subscribe((type) => {
      if (type === "music") {
        renderMusicPlaylist();
      }
    });

    if (accountSignInBtn) {
      accountSignInBtn.addEventListener("click", () => openAuthModal());
    }
    if (accountSignOutBtn) {
      accountSignOutBtn.addEventListener("click", () => {
        void supabase.auth.signOut();
      });
    }
    if (accountSubscribeBtn) {
      accountSubscribeBtn.addEventListener("click", () => {
        openUpgradeModal();
      });
    }
    if (accountManageSubscriptionBtn) {
      accountManageSubscriptionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!accountManageMenu) {
          return;
        }
        const open = accountManageMenu.hidden;
        accountManageMenu.hidden = !open;
        accountManageSubscriptionBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    if (accountBillingBtn) {
      accountBillingBtn.addEventListener("click", () => {
        closeAccountManageMenu();
        void openCustomerPortal();
      });
    }
    if (accountDeleteBtn) {
      accountDeleteBtn.addEventListener("click", () => {
        openDeleteAccountModal();
      });
    }
    if (deleteAccountConfirmInput) {
      deleteAccountConfirmInput.addEventListener("input", () => {
        if (deleteAccountInFlight || !deleteAccountConfirmBtn) {
          return;
        }
        deleteAccountConfirmBtn.disabled =
          deleteAccountConfirmInput.value !== "DELETE";
      });
    }
    if (deleteAccountConfirmBtn) {
      deleteAccountConfirmBtn.addEventListener("click", async () => {
        if (deleteAccountInFlight) {
          return;
        }
        if (deleteAccountConfirmInput?.value !== "DELETE") {
          return;
        }

        deleteAccountInFlight = true;
        deleteAccountConfirmBtn.disabled = true;
        deleteAccountConfirmBtn.textContent = "Deleting…";
        if (deleteAccountConfirmInput) {
          deleteAccountConfirmInput.disabled = true;
        }
        if (deleteAccountErrorEl) {
          deleteAccountErrorEl.textContent = "";
        }

        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const accessToken = session?.access_token;
          if (!accessToken) {
            throw new Error("not-authenticated");
          }

          const response = await fetch(
            "https://kquiougzmjxtaneeedip.supabase.co/functions/v1/delete-account",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          );

          if (!response.ok) {
            throw new Error("delete-failed");
          }

          await supabase.auth.signOut();
          window.location.href = landingPageUrl("/?account=deleted");
        } catch (_) {
          deleteAccountInFlight = false;
          if (deleteAccountConfirmInput) {
            deleteAccountConfirmInput.disabled = false;
          }
          if (deleteAccountConfirmBtn) {
            deleteAccountConfirmBtn.disabled =
              deleteAccountConfirmInput?.value !== "DELETE";
            deleteAccountConfirmBtn.textContent = "Delete Account";
          }
          if (deleteAccountErrorEl) {
            deleteAccountErrorEl.textContent =
              "Something went wrong. Please contact support@skaldsoundboard.com";
          }
        }
      });
    }
    if (deleteAccountCancelBtn) {
      deleteAccountCancelBtn.addEventListener("click", () => {
        closeDeleteAccountModal();
      });
    }
    if (deleteAccountModalBackdrop) {
      deleteAccountModalBackdrop.addEventListener("click", (e) => {
        if (e.target === deleteAccountModalBackdrop) {
          closeDeleteAccountModal();
        }
      });
    }
    document.addEventListener("click", (e) => {
      if (accountManageWrap && !accountManageWrap.contains(e.target)) {
        closeAccountManageMenu();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAccountManageMenu();
        if (deleteAccountModalBackdrop?.classList.contains("open")) {
          closeDeleteAccountModal();
        }
      }
    });
    if (authModalCancelBtn) {
      authModalCancelBtn.addEventListener("click", () => closeAuthModal());
    }
    if (authModalBackdrop) {
      authModalBackdrop.addEventListener("click", (e) => {
        if (e.target === authModalBackdrop) {
          closeAuthModal();
        }
      });
    }
    if (authForgotPasswordLink) {
      authForgotPasswordLink.addEventListener("click", async () => {
        const email = (authEmailInput && authEmailInput.value.trim()) || "";
        if (!email) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent =
              "Enter your email above, then click 'Forgot password?' again.";
          }
          return;
        }
        if (authModalErrorEl) {
          authModalErrorEl.textContent = "";
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: "https://app.skaldsoundboard.com/reset-password",
        });
        if (error) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent = error.message;
          }
          return;
        }
        if (authModalErrorEl) {
          authModalErrorEl.textContent = "Check your email for a password reset link.";
        }
      });
    }
    if (authModalSubmitBtn) {
      authModalSubmitBtn.addEventListener("click", async () => {
        const email = (authEmailInput && authEmailInput.value.trim()) || "";
        const password = (authPasswordInput && authPasswordInput.value) || "";
        if (!email || !password) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent = "Enter email and password.";
          }
          return;
        }
        if (authModalErrorEl) {
          authModalErrorEl.textContent = "";
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent = error.message;
          }
          return;
        }
        if (await redirectToLandingPricingIfRequested()) {
          return;
        }
        closeAuthModal();
      });
    }
    if (authTosCheckbox) {
      authTosCheckbox.addEventListener("change", updateAuthSignUpEnabled);
    }
    if (authModalSignUpBtn) {
      authModalSignUpBtn.addEventListener("click", async () => {
        const email = (authEmailInput && authEmailInput.value.trim()) || "";
        const password = (authPasswordInput && authPasswordInput.value) || "";
        if (!email || !password) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent = "Enter email and password.";
          }
          return;
        }
        if (authModalErrorEl) {
          authModalErrorEl.textContent = "";
        }
        if (!authTosCheckbox?.checked) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent =
              "You must agree to the Terms of Service and Privacy Policy.";
          }
          return;
        }
        const agreedAt = new Date().toISOString();
        const { data: signUpData, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent = error.message;
          }
          return;
        }
        const newUserId = signUpData?.user?.id;
        if (newUserId) {
          const recorded = await recordTosAgreement(newUserId, agreedAt);
          if (!recorded) {
            try {
              sessionStorage.setItem(
                PENDING_TOS_AGREEMENT_KEY,
                JSON.stringify({ userId: newUserId, agreedAt })
              );
            } catch (_) {
              /* ignore */
            }
          }
        }
        if (await redirectToLandingPricingIfRequested()) {
          return;
        }
        closeAuthModal();
      });
    }
    if (sceneLimitDismissBtn) {
      sceneLimitDismissBtn.addEventListener("click", () => closeSceneLimitModal());
    }
    if (sceneLimitSignInBtn) {
      sceneLimitSignInBtn.addEventListener("click", () => {
        closeSceneLimitModal();
        openAuthModal();
      });
    }
    if (sceneLimitSignUpBtn) {
      sceneLimitSignUpBtn.addEventListener("click", () => {
        closeSceneLimitModal();
        openAuthModal();
      });
    }
    if (sceneLimitModalBackdrop) {
      sceneLimitModalBackdrop.addEventListener("click", (e) => {
        if (e.target === sceneLimitModalBackdrop) {
          closeSceneLimitModal();
        }
      });
    }
    wireDefaultUpgradeModalBodyHandlers();
    if (upgradeModalBackdrop) {
      upgradeModalBackdrop.addEventListener("click", (e) => {
        if (e.target === upgradeModalBackdrop) {
          closeUpgradeModal();
        }
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") {
        return;
      }
      if (upgradeModalBackdrop?.classList.contains("open")) {
        closeUpgradeModal();
        return;
      }
      if (sceneLimitModalBackdrop?.classList.contains("open")) {
        closeSceneLimitModal();
      }
    });

    document.querySelectorAll("[data-feedback-category]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.getAttribute("data-feedback-category");
        selectedFeedbackCategory = cat;
        document.querySelectorAll("[data-feedback-category]").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
      });
    });
    if (feedbackBtnDesktop) {
      feedbackBtnDesktop.addEventListener("click", () => openFeedbackModal());
    }
    if (feedbackBtnDock) {
      feedbackBtnDock.addEventListener("click", () => openFeedbackModal());
    }
    if (feedbackCancelBtn) {
      feedbackCancelBtn.addEventListener("click", () => closeFeedbackModal());
    }
    if (feedbackModalBackdrop) {
      feedbackModalBackdrop.addEventListener("click", (e) => {
        if (e.target === feedbackModalBackdrop) {
          closeFeedbackModal();
        }
      });
    }
    if (feedbackSubmitBtn) {
      feedbackSubmitBtn.addEventListener("click", () => {
        void submitFeedbackForm();
      });
    }

    function setSkaldAuthHintCookie() {
      document.cookie =
        "skald_auth=true; domain=.skaldsoundboard.com; path=/; max-age=2592000; SameSite=Lax; Secure";
    }

    function clearSkaldAuthHintCookie() {
      document.cookie =
        "skald_auth=; domain=.skaldsoundboard.com; path=/; max-age=0";
    }

    async function handleSupabaseAuthChange(event, nextSession) {
      updateAccountUI(nextSession);
      if (
        (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
        nextSession?.user
      ) {
        const uid = nextSession.user.id;
        void applyPendingTosAgreement(uid);
        const repeatForUser =
          sceneBootstrapComplete && bootstrappedAuthUserId === uid;
        closeAuthModal();
        if (!repeatForUser) {
          await migrateLocalScenesToCloudIfNeeded(uid);
          await Favorites.migrateLocalToCloud(uid);
        }
        await Favorites.syncFromSupabase(uid);
        await UserTags.syncFromSupabase(uid);
        await refreshCustomScenesList();
        await refreshUserLimits();
        refreshSceneSelectorBar();
        if (!repeatForUser) {
          restorePersistedActiveSceneOrDefault();
        }
        bootstrappedAuthUserId = uid;
        sceneBootstrapComplete = true;
        void buildSfxSectionFilterPills();
        void renderFxButtons();
        renderMusicPlaylist();
        openFilePicker.refreshIfOpen();
        return;
      }
      if (event === "SIGNED_OUT") {
        sceneBootstrapComplete = false;
        bootstrappedAuthUserId = null;
        closeAuthModal();
        Favorites.loadFromLocalStorage();
        UserTags.clear();
        renderFxButtons.clearMyTagFilter();
        openFilePicker.onSignedOut();
        userLimits = null;
        userTier = "free";
        stripeCustomerId = null;
        await refreshCustomScenesList();
        refreshSceneSelectorBar();
        restorePersistedActiveSceneOrDefault();
        updateTierUsageIndicators();
        void buildSfxSectionFilterPills();
        void renderFxButtons();
        renderMusicPlaylist();
      }
    }

    void (async () => {
      void loadSuggestedTagsOnce();
      supabase.auth.onAuthStateChange((event, nextSession) => {
        if (nextSession?.user) {
          setSkaldAuthHintCookie();
        } else if (event === "SIGNED_OUT") {
          clearSkaldAuthHintCookie();
        }
        void handleSupabaseAuthChange(event, nextSession);
      });

      const { data: { session } } = await supabase.auth.getSession();
      updateAccountUI(session);
      if (session?.user) {
        setSkaldAuthHintCookie();
      } else {
        clearSkaldAuthHintCookie();
      }
      if ((isPricingRedirectRequested() || isSignInRedirectRequested()) && !session?.user) {
        openAuthModal();
      }
      if (session?.user && isPricingRedirectRequested()) {
        if (await redirectToLandingPricingIfRequested()) {
          return;
        }
      }
      if (session?.user) {
        await migrateLocalScenesToCloudIfNeeded(session.user.id);
        await Favorites.migrateLocalToCloud(session.user.id);
        await Favorites.syncFromSupabase(session.user.id);
        await UserTags.syncFromSupabase(session.user.id);
      } else {
        Favorites.loadFromLocalStorage();
        UserTags.clear();
        renderFxButtons.clearMyTagFilter();
      }
      await refreshCustomScenesList();
      if (session?.user) {
        await refreshUserLimits();
      } else {
        updateTierUsageIndicators();
      }
      refreshSceneSelectorBar();
      restorePersistedActiveSceneOrDefault();
      sceneBootstrapComplete = true;
      bootstrappedAuthUserId = session?.user?.id ?? null;
      renderFxButtons.configure({
        getCurrentScene: () => currentScene,
        isCustomSceneKey,
        getCustomSceneByKey,
        getCustomScenesList: () => customScenesList,
        saveCustomScenesToStorage,
        resolveAudioPlaybackUrl,
        getIosAudioCtx: () => iosAudioCtx,
        getOrCreateIosAudioCtx,
        iosGainNodes,
      });

      void buildSfxSectionFilterPills();
      void renderFxButtons();
      initializeMusicPlayer();
      openFilePicker.configure({
        getLastAuthSession: () => lastAuthSession,
        openAuthModal,
        resolveAudioPlaybackUrl,
        userUploadSignedUrlCache,
      });
    })();

    (function initAboutSkaldFooterLink() {
      const footer = document.querySelector(".app-legal-footer");
      if (!footer || footer.querySelector("[data-about-skald-link]")) {
        return;
      }
      const link = document.createElement("a");
      link.href = landingPageUrl("/");
      link.textContent = "About Skald";
      link.style.marginLeft = "16px";
      link.dataset.aboutSkaldLink = "1";
      footer.appendChild(link);
    })();

    initProductTour({
      helpButton: document.getElementById("tour-help-btn"),
    });

    (function initEnvironmentBadge() {
      const badge = document.getElementById("env-badge");
      if (!badge) {
        return;
      }
      const isStaging =
        import.meta.env.MODE === "staging" ||
        import.meta.env.VITE_ENV === "staging";
      if (!isStaging) {
        return;
      }
      badge.hidden = false;
      badge.removeAttribute("aria-hidden");
    })();
