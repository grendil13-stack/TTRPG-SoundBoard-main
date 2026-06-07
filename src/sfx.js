import { supabase } from "../supabase.js";
import { AudioLibrary } from "./audioLibrary.js";
import { Favorites } from "./favorites.js";
import { UserTags, createUserTagButton } from "./userTags.js";

const USER_UPLOAD_PREFIX = "user-upload:";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** @type {null | {
 *   getCurrentScene: () => string | null,
 *   isCustomSceneKey: (sceneKey: string) => boolean,
 *   getCustomSceneByKey: (sceneKey: string) => object | null,
 *   getCustomScenesList: () => object[],
 *   saveCustomScenesToStorage: (list: object[]) => void,
 *   resolveAudioPlaybackUrl: (rawPath: string) => Promise<string>,
 *   getIosAudioCtx: () => AudioContext | null,
 *   getOrCreateIosAudioCtx: () => AudioContext | null,
 *   iosGainNodes: WeakMap<object, GainNode>,
 * }} */
let sfxAppBridge = null;


    const sfxSectionFiltersEl = document.getElementById("sfx-section-filters");
    const sfxSearchInput = document.getElementById("sfx-search");
    const fxGrid = document.getElementById("fx-grid");
    const sfxPinnedSection = document.getElementById("sfx-pinned-section");
    const sfxPinnedRow = document.getElementById("sfx-pinned-row");
    const activeFxAudio = new Map();
    let sfxFavoritesOnlyFilter = false;
    const sfxVolumeSlider = document.getElementById("sfx-volume");

    let iosSfxGroupGain = null;
    function routeSfxThroughIosGain(audioEl) {
      if (!isIOS || !sfxAppBridge) return;
      const ctx = sfxAppBridge.getOrCreateIosAudioCtx();
      if (!ctx || !iosSfxGroupGain) return;
      if (sfxAppBridge.iosGainNodes.has(audioEl)) return;
      try {
        const source = ctx.createMediaElementSource(audioEl);
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(1, ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(iosSfxGroupGain);
        sfxAppBridge.iosGainNodes.set(audioEl, gainNode);
      } catch (e) {
        console.warn('[Skald iOS SFX] GainNode failed:', e.message);
      }
    }
    let sfxSectionFilter = null;
    let sfxSearchTerm = "";
    /** @type {string | null} */
    let sfxMyTagFilter = null;
    function syncSfxFilterPillsActive() {
      if (!sfxSectionFiltersEl) {
        return;
      }
      sfxSectionFiltersEl.querySelectorAll(".sfx-filter-pill").forEach((b) => {
        if (b.dataset.sfxFavPill === "1") {
          b.classList.toggle("active", sfxFavoritesOnlyFilter);
          b.setAttribute("aria-pressed", sfxFavoritesOnlyFilter ? "true" : "false");
          return;
        }
        if (b.dataset.sfxMyTag != null && b.dataset.sfxMyTag !== "") {
          const active = sfxMyTagFilter === b.dataset.sfxMyTag;
          b.classList.toggle("active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
          return;
        }
        const sec = b.dataset.sfxSection;
        const active =
          sfxSectionFilter == null ? sec === "" : sec === sfxSectionFilter;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    async function buildSfxSectionFilterPills() {
      if (!sfxSectionFiltersEl) {
        return;
      }
      sfxSectionFiltersEl.innerHTML = "";
      const desiredOrder = ["Combat", "Magic", "Nature", "Object", "Stinger", "Social", "Creature"];
      const addPill = (label, value) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sfx-filter-pill";
        b.textContent = label;
        b.dataset.sfxSection = value;
        b.addEventListener("click", () => {
          sfxSectionFilter = value === "" ? null : value;
          syncSfxFilterPillsActive();
          void renderFxButtons();
        });
        sfxSectionFiltersEl.appendChild(b);
      };
      const addFavoritesPill = () => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sfx-filter-pill sfx-filter-pill-fav";
        b.dataset.sfxFavPill = "1";
        b.title = "Show only favorites";
        b.setAttribute("aria-label", "Show only favorited SFX");
        b.setAttribute("aria-pressed", "false");
        b.innerHTML = '<span class="fav-icon" aria-hidden="true">★</span>';
        b.addEventListener("click", () => {
          sfxFavoritesOnlyFilter = !sfxFavoritesOnlyFilter;
          syncSfxFilterPillsActive();
          void renderFxButtons();
        });
        sfxSectionFiltersEl.appendChild(b);
      };
      addFavoritesPill();
      addPill("All", "");
      desiredOrder.forEach((section) => addPill(section, section));
      const { data: { session } } = await supabase.auth.getSession();
      const tagSummary = UserTags.getMyTagSummary();
      if (session?.user && tagSummary.length) {
        const myWrap = document.createElement("div");
        myWrap.className = "sfx-my-tags-step";
        const myLab = document.createElement("p");
        myLab.className = "sfx-my-tags-label";
        myLab.textContent = "My Tags";
        myWrap.appendChild(myLab);
        for (const row of tagSummary) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "sfx-filter-pill sfx-my-tag-pill";
          b.dataset.sfxMyTag = row.tag;
          const nm = document.createElement("span");
          nm.className = "file-picker-my-tag-name";
          nm.textContent = row.tag;
          const ct = document.createElement("span");
          ct.className = "file-picker-my-tag-count";
          ct.textContent = String(row.count);
          b.appendChild(nm);
          b.appendChild(ct);
          b.addEventListener("click", () => {
            sfxMyTagFilter = sfxMyTagFilter === row.tag ? null : row.tag;
            syncSfxFilterPillsActive();
            void renderFxButtons();
          });
          myWrap.appendChild(b);
        }
        sfxSectionFiltersEl.appendChild(myWrap);
      }
      syncSfxFilterPillsActive();
    }
    function getSfxLevel() {
      return Number(sfxVolumeSlider.value) / 100;
    }

    function effectiveSfxVolume() {
      return getSfxLevel();
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

    function getTrackLabel(filePath) {
      const s = String(filePath || "");
      const rest = s.startsWith(USER_UPLOAD_PREFIX) ? s.slice(USER_UPLOAD_PREFIX.length) : s;
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

    function stopFxSound(buttonElement) {
      const currentAudio = activeFxAudio.get(buttonElement);
      if (!currentAudio) {
        return;
      }

      currentAudio.pause();
      currentAudio.currentTime = 0;
      activeFxAudio.delete(buttonElement);
      buttonElement.classList.remove("fx-playing");
    }

    function getSfxPathCandidates(filePath) {
      const raw = String(filePath || "").trim();
      if (!raw) {
        return [];
      }
      if (raw.startsWith(USER_UPLOAD_PREFIX)) {
        return [raw];
      }
      if (/^https?:\/\//i.test(raw)) {
        return [raw];
      }
      const normalized = raw.replace(/\\/g, "/");
      const candidates = [normalized];
      if (/^sound\//i.test(normalized)) {
        candidates.push(normalized.replace(/^sound\//i, "Sounds/"));
      }
      if (/^sounds\//i.test(normalized)) {
        candidates.push(normalized.replace(/^sounds\//i, "sound/"));
      }
      return [...new Set(candidates)];
    }

    function playCustomFxSound(filePath, buttonElement) {
      const candidates = getSfxPathCandidates(filePath);
      if (!candidates.length) {
        return;
      }

      if (activeFxAudio.has(buttonElement)) {
        stopFxSound(buttonElement);
        return;
      }

      buttonElement.classList.add("fx-flash");
      window.setTimeout(() => {
        buttonElement.classList.remove("fx-flash");
      }, 140);
      buttonElement.classList.add("fx-playing");
      const tryPlayCandidate = async (candidateIndex) => {
        if (candidateIndex >= candidates.length) {
          activeFxAudio.delete(buttonElement);
          buttonElement.classList.remove("fx-playing");
          return;
        }
        let src = candidates[candidateIndex];
        if (String(src).startsWith(USER_UPLOAD_PREFIX)) {
          src = await sfxAppBridge.resolveAudioPlaybackUrl(src);
          if (!src) {
            tryPlayCandidate(candidateIndex + 1);
            return;
          }
        }
        const audio = new Audio();
        if (isIOS) {
          audio.crossOrigin = 'anonymous';
        }
        audio.src = src;
        if (isIOS) {
          // Resume context in case it suspended
          const iosAudioCtx = sfxAppBridge && sfxAppBridge.getIosAudioCtx();
          if (iosAudioCtx && iosAudioCtx.state === 'suspended') {
            void iosAudioCtx.resume();
          }
          routeSfxThroughIosGain(audio);
        } else {
          audio.volume = effectiveSfxVolume();
        }
        activeFxAudio.set(buttonElement, audio);

        const clearPlayingState = () => {
          if (activeFxAudio.get(buttonElement) === audio) {
            activeFxAudio.delete(buttonElement);
            buttonElement.classList.remove("fx-playing");
          }
        };

        const tryNext = () => {
          if (activeFxAudio.get(buttonElement) !== audio) {
            return;
          }
          audio.pause();
          audio.currentTime = 0;
          void tryPlayCandidate(candidateIndex + 1);
        };

        audio.addEventListener("ended", clearPlayingState, { once: true });
        audio.addEventListener("error", tryNext, { once: true });
        audio.play().catch(tryNext);
      };

      void tryPlayCandidate(0);
    }

    function scenePinUIRenderActive() {
      if (!sfxAppBridge) {
        return false;
      }
      const scene = sfxAppBridge.getCurrentScene();
      return Boolean(scene && sfxAppBridge.isCustomSceneKey(scene));
    }

    function getActiveCustomSceneForPins() {
      if (!scenePinUIRenderActive()) {
        return null;
      }
      return sfxAppBridge.getCustomSceneByKey(sfxAppBridge.getCurrentScene());
    }

    function isEntryPinnedToActiveScene(entryId) {
      const sc = getActiveCustomSceneForPins();
      if (!sc || !Array.isArray(sc.pinnedSfx)) {
        return false;
      }
      return sc.pinnedSfx.map(String).includes(String(entryId));
    }

    function createScenePinButton(entry) {
      if (!scenePinUIRenderActive()) {
        return null;
      }
      const pinned = isEntryPinnedToActiveScene(entry.id);
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = `scene-pin-btn${pinned ? " scene-pin-btn--active" : ""}`;
      pinBtn.dataset.scenePin = "1";
      const label = pinned ? "Unpin from this scene" : "Pin to this scene";
      pinBtn.title = label;
      pinBtn.setAttribute("aria-label", label);
      pinBtn.innerHTML =
        '<svg class="scene-pin-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" fill-opacity=".92" d="M8 1.25a4.25 4.25 0 0 0-4.25 4.25c0 2.1 2.35 5.35 3.9 7.05.2.22.52.22.72 0 1.55-1.7 3.9-4.95 3.9-7.05A4.25 4.25 0 0 0 8 1.25zm0 2a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5z"/></svg>';
      pinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleScenePinForActiveScene(entry.id);
      });
      return pinBtn;
    }

    async function toggleScenePinForActiveScene(audioId) {
      const key = sfxAppBridge.getCurrentScene();
      if (!key || !sfxAppBridge.isCustomSceneKey(key)) {
        return;
      }
      const sceneId = key.slice("custom:".length);
      const scene = sfxAppBridge.getCustomScenesList().find((s) => s.id === sceneId);
      if (!scene) {
        return;
      }
      const aid = String(audioId);
      const prev = Array.isArray(scene.pinnedSfx) ? scene.pinnedSfx.map(String) : [];
      const next = prev.includes(aid) ? prev.filter((x) => x !== aid) : [...prev, aid];
      scene.pinnedSfx = next;

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { error } = await supabase
          .from("scenes")
          .update({ pinned_sfx: next })
          .eq("id", scene.id)
          .eq("user_id", session.user.id);
        if (error) {
          scene.pinnedSfx = prev;
          window.alert(`Could not update pins: ${error.message}`);
          return;
        }
      } else {
        sfxAppBridge.saveCustomScenesToStorage(sfxAppBridge.getCustomScenesList());
      }
      void renderFxButtons();
    }

    function appendSfxTile(entry) {
      const title =
        formatAutoLabelFromPath(entry.manifestPath) ||
        entry.name ||
        getTrackLabel(entry.manifestPath || "");
      const soundButton = document.createElement("button");
      soundButton.type = "button";
      if (entry.generated === false) {
        soundButton.classList.add("fx-unavailable");
      }

      const catEl = document.createElement("span");
      catEl.className = "fx-cat";
      catEl.textContent = (entry.section ? String(entry.section).trim() : "") || "SFX";
      const nameEl = document.createElement("span");
      nameEl.className = "fx-name";
      nameEl.textContent = title;
      soundButton.appendChild(catEl);
      soundButton.appendChild(nameEl);

      const ctrls = document.createElement("span");
      ctrls.className = "fx-btn-ctrls";
      const star = createFavoriteStarButton(
        Favorites.has("sfx", entry.id),
        () => {
          void Favorites.toggle("sfx", entry.id).then(() => {
            star.sync(Favorites.has("sfx", entry.id));
          });
        },
      );
      ctrls.appendChild(star);
      const pinBtn = createScenePinButton(entry);
      if (pinBtn) {
        ctrls.appendChild(pinBtn);
      }
      const tagBtn = createUserTagButton(entry.id);
      ctrls.appendChild(tagBtn);
      soundButton.appendChild(ctrls);

      soundButton.addEventListener("click", (e) => {
        if (e.target && e.target.closest && e.target.closest("[data-fav-star]")) {
          return;
        }
        if (e.target && e.target.closest && e.target.closest("[data-user-tag-btn]")) {
          return;
        }
        if (e.target && e.target.closest && e.target.closest("[data-scene-pin]")) {
          return;
        }
        playCustomFxSound(entry.path, soundButton);
      });
      return soundButton;
    }

    let renderFxButtonsGeneration = 0;

    async function renderFxButtons() {
      const gen = ++renderFxButtonsGeneration;
      activeFxAudio.forEach((_, buttonElement) => {
        stopFxSound(buttonElement);
      });
      if (sfxPinnedRow) {
        sfxPinnedRow.innerHTML = "";
      }
      fxGrid.innerHTML = "";
      const allSfx = await AudioLibrary.listFiles("sfx");
      if (gen !== renderFxButtonsGeneration) {
        return;
      }
      const byId = new Map(allSfx.map((e) => [String(e.id), e]));

      if (sfxPinnedSection && sfxPinnedRow) {
        const sc = getActiveCustomSceneForPins();
        const pinIds =
          sc && Array.isArray(sc.pinnedSfx)
            ? [...new Set(sc.pinnedSfx.map(String))]
            : [];
        const visiblePins = pinIds.map((id) => byId.get(id)).filter(Boolean);
        if (visiblePins.length) {
          sfxPinnedSection.hidden = false;
          visiblePins.forEach((entry) => {
            sfxPinnedRow.appendChild(appendSfxTile(entry));
          });
        } else {
          sfxPinnedSection.hidden = true;
        }
      }

      const search = sfxSearchTerm;
      allSfx.forEach((entry) => {
        const section = entry.section ? String(entry.section).trim() : "";
        if (sfxSectionFilter && section.toLowerCase() !== sfxSectionFilter.toLowerCase()) {
          return;
        }
        if (sfxFavoritesOnlyFilter && !Favorites.has("sfx", entry.id)) {
          return;
        }
        if (sfxMyTagFilter) {
          const row = UserTags.getMyTagSummary().find((r) => r.tag === sfxMyTagFilter);
          const ids = row?.audio_ids ? row.audio_ids.map(String) : [];
          if (!ids.includes(String(entry.id))) {
            return;
          }
        }
        const title =
          formatAutoLabelFromPath(entry.manifestPath) ||
          entry.name ||
          getTrackLabel(entry.manifestPath || "");
        if (search && !title.toLowerCase().includes(search)) {
          return;
        }

        fxGrid.appendChild(appendSfxTile(entry));
      });
    }

if (sfxSearchInput) {
  sfxSearchInput.addEventListener("input", () => {
    sfxSearchTerm = sfxSearchInput.value.trim().toLowerCase();
    void renderFxButtons();
  });
}

if (sfxVolumeSlider) {
  sfxVolumeSlider.addEventListener("input", () => {
    const iosAudioCtx = sfxAppBridge && sfxAppBridge.getIosAudioCtx();
    if (isIOS && iosSfxGroupGain && iosAudioCtx) {
      iosSfxGroupGain.gain.setValueAtTime(
        getSfxLevel(),
        iosAudioCtx.currentTime
      );
    } else {
      activeFxAudio.forEach((audio) => {
        audio.volume = effectiveSfxVolume();
      });
    }
  });
}

Favorites.subscribe((type) => {
  if (type === "sfx") {
    void renderFxButtons();
  }
});

UserTags.subscribe(() => {
  const summary = UserTags.getMyTagSummary();
  if (sfxMyTagFilter && !summary.some((r) => r.tag === sfxMyTagFilter)) {
    sfxMyTagFilter = null;
  }
  void buildSfxSectionFilterPills();
  void renderFxButtons();
});

renderFxButtons.configure = (bridge) => {
  sfxAppBridge = bridge;
};

renderFxButtons.wireIosSfxGain = (iosAudioCtx, iosMasterGain) => {
  if (!iosAudioCtx || !iosMasterGain) {
    return;
  }
  iosSfxGroupGain = iosAudioCtx.createGain();
  iosSfxGroupGain.gain.setValueAtTime(getSfxLevel(), iosAudioCtx.currentTime);
  iosSfxGroupGain.connect(iosMasterGain);
};

renderFxButtons.refreshIosSfxGroupGain = (iosAudioCtx) => {
  if (isIOS && iosSfxGroupGain && iosAudioCtx) {
    iosSfxGroupGain.gain.setValueAtTime(getSfxLevel(), iosAudioCtx.currentTime);
  }
};

renderFxButtons.clearMyTagFilter = () => {
  sfxMyTagFilter = null;
};

export { renderFxButtons, appendSfxTile, buildSfxSectionFilterPills };
