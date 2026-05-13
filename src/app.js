import { supabase } from "../supabase.js";

const AudioLibrary = (() => {
      const STORAGE_BASE_URL =
        "https://kquiougzmjxtaneeedip.supabase.co/storage/v1/object/public";
      /** Set to `true` for local `sounds/…` paths; `false` for Supabase Storage URLs. */
      const LOCAL_MODE = false;

      const SOURCE_KIND = "local";
      const MANIFEST_URL = "audio-manifest.json";
      const MANIFEST_KEYS = ["music", "ambient", "sfx"];

      let catalog = [];
      let manifestReadme = {};
      /** Lowercase manifest path → display title (music only). */
      let musicTitleByNormPath = new Map();
      let loadPromise = null;

      const rebuildMusicTitleLookup = () => {
        musicTitleByNormPath.clear();
        catalog.forEach((item) => {
          if (item.type === "music") {
            musicTitleByNormPath.set(item.manifestPath.toLowerCase(), item.name);
          }
        });
      };

      const normalizePath = (rawPath) => {
        if (typeof rawPath !== "string") {
          return "";
        }
        const trimmed = rawPath.trim().replace(/\\/g, "/");
        const withoutPrefix = trimmed.replace(/^(\.\.\/)+/i, "");
        /* Manifest typo `sound/...` must map like `sounds/...` (bucket is music|ambient|sfx). */
        const withSoundsRoot = withoutPrefix.replace(/^sound\//i, "sounds/");
        const normalizedSounds = withSoundsRoot.replace(/^sounds\//i, "sounds/");
        return normalizedSounds;
      };

      const manifestPathFromManifestEntry = (entry) =>
        normalizePath(entry && entry.path ? entry.path : "");

      /**
       * `sounds/music/battle/track.ogg` → `${STORAGE_BASE_URL}/music/battle/track.ogg`
       * (strip `sounds/`, first segment = bucket name).
       */
      const resolveManifestPathToStorageUrl = (manifestPath) => {
        const norm = normalizePath(manifestPath);
        if (!norm) {
          return "";
        }
        const stripped = norm.replace(/^sounds\//i, "").replace(/^\//, "");
        if (!stripped) {
          return "";
        }
        const slash = stripped.indexOf("/");
        const bucket = slash === -1 ? stripped : stripped.slice(0, slash);
        const objectPath = slash === -1 ? "" : stripped.slice(slash + 1);
        if (!bucket || !objectPath) {
          return "";
        }
        const base = STORAGE_BASE_URL.replace(/\/$/, "");
        return `${base}/${bucket}/${objectPath}`;
      };

      const playbackPathForManifestPath = (manifestPath) => {
        if (LOCAL_MODE) {
          return manifestPath;
        }
        return resolveManifestPathToStorageUrl(manifestPath);
      };

      const getFilename = (path) => {
        const normalized = normalizePath(path);
        const parts = normalized.split("/");
        return parts[parts.length - 1] || normalized;
      };

      const normalizeAudioType = (raw) => {
        const t = typeof raw === "string" ? raw.toLowerCase().trim() : "";
        if (t === "ambient" || t === "sfx" || t === "music") {
          return t;
        }
        return "music";
      };

      const mapManifestEntry = (entry) => {
        const manifestPath = manifestPathFromManifestEntry(entry);
        if (!manifestPath) {
          return null;
        }
        const type = normalizeAudioType(entry.type);
        const baseName = getFilename(manifestPath);
        const name = (entry.title || entry.filename || baseName || entry.id || "").toString().trim() || baseName;
        const moodTags = Array.isArray(entry.mood_tags) ? entry.mood_tags.map((x) => String(x)) : [];
        const settingTags = Array.isArray(entry.setting_tags) ? entry.setting_tags.map((x) => String(x)) : [];
        const section =
          entry.section != null && String(entry.section).trim() !== "" ? String(entry.section).trim() : "";
        let generated = true;
        if (type === "ambient" || type === "sfx") {
          generated = entry.generated === false ? false : true;
        }
        const path = playbackPathForManifestPath(manifestPath);
        if (!LOCAL_MODE && !path) {
          return null;
        }
        return {
          id: (entry.id != null ? String(entry.id) : manifestPath),
          name,
          manifestPath,
          path,
          type,
          mood_tags: moodTags,
          setting_tags: settingTags,
          section,
          generated,
        };
      };

      const buildCatalogFromManifest = (data) => {
        const out = [];
        const seen = new Set();
        MANIFEST_KEYS.forEach((key) => {
          const arr = data && data[key];
          if (!Array.isArray(arr)) {
            return;
          }
          arr.forEach((entry) => {
            const item = mapManifestEntry(entry);
            if (!item) {
              return;
            }
            const dedupeKey = item.manifestPath.toLowerCase();
            if (seen.has(dedupeKey)) {
              return;
            }
            seen.add(dedupeKey);
            out.push(item);
          });
        });
        return out;
      };

      async function ensureLoaded() {
        if (loadPromise) {
          return loadPromise;
        }
        loadPromise = fetch(MANIFEST_URL)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Manifest HTTP ${response.status}`);
            }
            return response.json();
          })
          .then((data) => {
            manifestReadme =
              data && typeof data._readme === "object" && data._readme !== null ? data._readme : {};
            catalog = buildCatalogFromManifest(data);
            rebuildMusicTitleLookup();
            window.dispatchEvent(new CustomEvent("audio-manifest-loaded"));
          })
          .catch((err) => {
            console.error("AudioLibrary: failed to load audio-manifest.json", err);
            manifestReadme = {};
            catalog = [];
            rebuildMusicTitleLookup();
            window.dispatchEvent(new CustomEvent("audio-manifest-loaded"));
          });
        return loadPromise;
      }

      return {
        async listFiles(audioType) {
          await ensureLoaded();
          const t = normalizeAudioType(audioType);
          return catalog
            .filter((item) => item.type === t)
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name));
        },
        async getReadmeFilterLists() {
          await ensureLoaded();
          const r = manifestReadme;
          return {
            all_setting_tags: Array.isArray(r.all_setting_tags) ? r.all_setting_tags.map(String) : [],
            all_mood_tags: Array.isArray(r.all_mood_tags) ? r.all_mood_tags.map(String) : [],
            all_sfx_sections: Array.isArray(r.all_sfx_sections) ? r.all_sfx_sections.map(String) : [],
          };
        },
        getPlaylistTrackTitle(rawPath) {
          const norm = normalizePath(rawPath);
          if (!norm) {
            return "";
          }
          const fromManifest = musicTitleByNormPath.get(norm.toLowerCase());
          if (fromManifest) {
            return fromManifest;
          }
          const base = getFilename(norm);
          return base.replace(/\.[^.]+$/, "") || base;
        },
        getSfxSectionForPath(rawPath) {
          const norm = normalizePath(rawPath);
          if (!norm) {
            return "";
          }
          const key = norm.toLowerCase();
          for (let i = 0; i < catalog.length; i += 1) {
            const item = catalog[i];
            if (item.type === "sfx" && item.manifestPath.toLowerCase() === key) {
              return item.section ? String(item.section) : "";
            }
          }
          return "";
        },
        /** Resolve a scene- or manifest-relative path to a playable URL (or local path). */
        resolvePlaybackUrl(rawPath) {
          const s = String(rawPath || "").trim();
          if (!s) {
            return "";
          }
          if (/^https?:\/\//i.test(s)) {
            return s;
          }
          const resolved = playbackPathForManifestPath(normalizePath(s));
          if (!resolved) {
            return "";
          }
          return LOCAL_MODE ? encodeURI(resolved) : resolved;
        },
        async getEntryById(id) {
          await ensureLoaded();
          if (id == null) {
            return null;
          }
          const target = String(id);
          for (let i = 0; i < catalog.length; i += 1) {
            if (catalog[i].id === target) {
              return catalog[i];
            }
          }
          return null;
        },
        async getEntryByPath(rawPath, audioType) {
          await ensureLoaded();
          const norm = normalizePath(rawPath);
          if (!norm) {
            return null;
          }
          const key = norm.toLowerCase();
          const wantedType = audioType ? normalizeAudioType(audioType) : null;
          for (let i = 0; i < catalog.length; i += 1) {
            const item = catalog[i];
            if (wantedType && item.type !== wantedType) {
              continue;
            }
            if (item.manifestPath.toLowerCase() === key) {
              return item;
            }
          }
          return null;
        },
        getEntryByPathSync(rawPath, audioType) {
          const norm = normalizePath(rawPath);
          if (!norm) {
            return null;
          }
          const key = norm.toLowerCase();
          const wantedType = audioType ? normalizeAudioType(audioType) : null;
          for (let i = 0; i < catalog.length; i += 1) {
            const item = catalog[i];
            if (wantedType && item.type !== wantedType) {
              continue;
            }
            if (item.manifestPath.toLowerCase() === key) {
              return item;
            }
          }
          return null;
        },
        getSourceKind() {
          return SOURCE_KIND;
        },
      };
    })();

    const Favorites = (() => {
      const STORAGE_KEYS = {
        sfx: "dndMoodBuilder.v1.favorites.sfx",
        music: "dndMoodBuilder.v1.favorites.music",
      };
      const state = {
        sfx: new Set(),
        music: new Set(),
      };
      const listeners = new Set();
      let cloudMode = false;
      /** @type {string | null} */
      let cloudUserId = null;

      const normalizeType = (t) => (t === "music" ? "music" : "sfx");

      const notify = (type) => {
        listeners.forEach((cb) => {
          try {
            cb(type);
          } catch (err) {
            console.error("Favorites listener error", err);
          }
        });
      };

      const persistLocal = (type) => {
        if (cloudMode) {
          return;
        }
        try {
          localStorage.setItem(
            STORAGE_KEYS[type],
            JSON.stringify(Array.from(state[type])),
          );
        } catch {
          /* localStorage may be unavailable */
        }
      };

      const loadFromLocalStorage = () => {
        cloudMode = false;
        cloudUserId = null;
        Object.keys(STORAGE_KEYS).forEach((type) => {
          state[type] = new Set();
          try {
            const raw = localStorage.getItem(STORAGE_KEYS[type]);
            if (!raw) {
              return;
            }
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              state[type] = new Set(parsed.map((x) => String(x)).filter(Boolean));
            }
          } catch {
            /* ignore parse errors */
          }
        });
      };

      async function migrateLocalToCloud(userId) {
        /** @type {string[]} */
        let sfxIds = [];
        /** @type {string[]} */
        let musicIds = [];
        try {
          const rawS = localStorage.getItem(STORAGE_KEYS.sfx);
          if (rawS) {
            const parsed = JSON.parse(rawS);
            if (Array.isArray(parsed)) {
              sfxIds = parsed.map((x) => String(x)).filter(Boolean);
            }
          }
          const rawM = localStorage.getItem(STORAGE_KEYS.music);
          if (rawM) {
            const parsed = JSON.parse(rawM);
            if (Array.isArray(parsed)) {
              musicIds = parsed.map((x) => String(x)).filter(Boolean);
            }
          }
        } catch {
          return;
        }
        if (!sfxIds.length && !musicIds.length) {
          return;
        }
        const rows = [
          ...sfxIds.map((audio_id) => ({ user_id: userId, audio_id, audio_type: "sfx" })),
          ...musicIds.map((audio_id) => ({ user_id: userId, audio_id, audio_type: "music" })),
        ];
        const { error } = await supabase.from("favorites").upsert(rows, {
          onConflict: "user_id,audio_id,audio_type",
        });
        if (error) {
          console.error("favorites migration error", error);
          return;
        }
        try {
          localStorage.removeItem(STORAGE_KEYS.sfx);
          localStorage.removeItem(STORAGE_KEYS.music);
        } catch {
          /* ignore */
        }
      }

      async function syncFromSupabase(userId) {
        cloudMode = true;
        cloudUserId = userId;
        state.sfx.clear();
        state.music.clear();
        const { data, error } = await supabase
          .from("favorites")
          .select("audio_id,audio_type")
          .eq("user_id", userId);
        if (error) {
          console.error("favorites load error", error);
          return;
        }
        for (const row of data || []) {
          const t = row.audio_type === "music" ? "music" : "sfx";
          if (row.audio_id) {
            state[t].add(String(row.audio_id));
          }
        }
        notify("sfx");
        notify("music");
      }

      return {
        has(type, id) {
          if (id == null) {
            return false;
          }
          return state[normalizeType(type)].has(String(id));
        },
        async toggle(type, id) {
          if (id == null) {
            return false;
          }
          const t = normalizeType(type);
          const key = String(id);
          if (cloudMode && cloudUserId) {
            const was = state[t].has(key);
            if (was) {
              const { error } = await supabase
                .from("favorites")
                .delete()
                .eq("user_id", cloudUserId)
                .eq("audio_id", key)
                .eq("audio_type", t);
              if (error) {
                console.error("favorite delete error", error);
                return was;
              }
              state[t].delete(key);
            } else {
              const { error } = await supabase.from("favorites").insert({
                user_id: cloudUserId,
                audio_id: key,
                audio_type: t,
              });
              if (error) {
                console.error("favorite insert error", error);
                return was;
              }
              state[t].add(key);
            }
            notify(t);
            return state[t].has(key);
          }
          if (state[t].has(key)) {
            state[t].delete(key);
          } else {
            state[t].add(key);
          }
          persistLocal(t);
          notify(t);
          return state[t].has(key);
        },
        getAll(type) {
          return Array.from(state[normalizeType(type)]);
        },
        size(type) {
          return state[normalizeType(type)].size;
        },
        subscribe(callback) {
          if (typeof callback === "function") {
            listeners.add(callback);
          }
          return () => listeners.delete(callback);
        },
        migrateLocalToCloud,
        syncFromSupabase,
        loadFromLocalStorage,
      };
    })();

    const UserTags = (() => {
      /** @type {Map<string, Set<string>>} */
      const tagsByAudioId = new Map();
      /** @type {{ audio_id: string, tag: string, created_at?: string }[]} */
      let lastRows = [];
      /** @type {{ tag: string, count: number, audio_ids: string[] }[]} */
      let myTagSummary = [];
      /** @type {string | null} */
      let cloudUserId = null;

      const notifyListeners = new Set();

      const notify = () => {
        notifyListeners.forEach((cb) => {
          try {
            cb();
          } catch (err) {
            console.error("UserTags listener error", err);
          }
        });
      };

      function refreshSummary() {
        const m = new Map();
        tagsByAudioId.forEach((set, aid) => {
          set.forEach((tag) => {
            if (!m.has(tag)) {
              m.set(tag, new Set());
            }
            m.get(tag).add(String(aid));
          });
        });
        myTagSummary = [...m.entries()]
          .map(([tag, ids]) => ({ tag, count: ids.size, audio_ids: [...ids] }))
          .sort((a, b) => a.tag.localeCompare(b.tag));
      }

      function recomputeFromRows(rows) {
        tagsByAudioId.clear();
        lastRows = Array.isArray(rows) ? rows.slice() : [];
        for (const row of lastRows) {
          const aid = row.audio_id != null ? String(row.audio_id) : "";
          const tag = String(row.tag || "").trim();
          if (!aid || !tag) {
            continue;
          }
          if (!tagsByAudioId.has(aid)) {
            tagsByAudioId.set(aid, new Set());
          }
          tagsByAudioId.get(aid).add(tag);
        }
        refreshSummary();
        notify();
      }

      async function syncFromSupabase(userId) {
        cloudUserId = userId;
        let query = supabase
          .from("user_tags")
          .select("audio_id, tag, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        let { data, error } = await query;
        if (error) {
          const r2 = await supabase
            .from("user_tags")
            .select("audio_id, tag")
            .eq("user_id", userId);
          data = r2.data;
          error = r2.error;
        }
        if (error) {
          console.error("user_tags load error", error);
          return;
        }
        recomputeFromRows(data || []);
      }

      function clear() {
        tagsByAudioId.clear();
        lastRows = [];
        myTagSummary = [];
        cloudUserId = null;
        notify();
      }

      function hasTagged(audioId) {
        if (audioId == null) {
          return false;
        }
        const set = tagsByAudioId.get(String(audioId));
        return Boolean(set && set.size > 0);
      }

      function getTagsForAudio(audioId) {
        return new Set(tagsByAudioId.get(String(audioId)) || []);
      }

      function getRecentTagNames(limit = 6) {
        const seen = new Set();
        const out = [];
        for (const row of lastRows) {
          const t = String(row.tag || "").trim();
          if (!t || seen.has(t)) {
            continue;
          }
          seen.add(t);
          out.push(t);
          if (out.length >= limit) {
            break;
          }
        }
        return out;
      }

      function pushSyntheticRow(audioId, tag) {
        lastRows.unshift({
          audio_id: String(audioId),
          tag: String(tag).trim(),
          created_at: new Date().toISOString(),
        });
      }

      async function addTag(userId, audioId, tagText) {
        const tag = String(tagText || "").trim();
        if (!tag || !userId || audioId == null) {
          return { error: new Error("Invalid tag") };
        }
        const aid = String(audioId);
        const { error } = await supabase.from("user_tags").insert({
          user_id: userId,
          audio_id: aid,
          tag,
        });
        if (!error) {
          if (!tagsByAudioId.has(aid)) {
            tagsByAudioId.set(aid, new Set());
          }
          tagsByAudioId.get(aid).add(tag);
          pushSyntheticRow(aid, tag);
          refreshSummary();
          notify();
        }
        return { error };
      }

      async function removeTag(userId, audioId, tagText) {
        const tag = String(tagText || "").trim();
        if (!tag || !userId || audioId == null) {
          return { error: new Error("Invalid tag") };
        }
        const aid = String(audioId);
        const { error } = await supabase
          .from("user_tags")
          .delete()
          .match({ user_id: userId, audio_id: aid, tag });
        if (!error) {
          tagsByAudioId.get(aid)?.delete(tag);
          lastRows = lastRows.filter(
            (r) => !(String(r.audio_id) === aid && String(r.tag || "").trim() === tag),
          );
          if (tagsByAudioId.get(aid)?.size === 0) {
            tagsByAudioId.delete(aid);
          }
          refreshSummary();
          notify();
        }
        return { error };
      }

      function subscribe(callback) {
        if (typeof callback === "function") {
          notifyListeners.add(callback);
        }
        return () => notifyListeners.delete(callback);
      }

      return {
        syncFromSupabase,
        clear,
        hasTagged,
        getTagsForAudio,
        getRecentTagNames,
        addTag,
        removeTag,
        getMyTagSummary: () => myTagSummary.slice(),
        subscribe,
      };
    })();

    const SUGGESTED_TAG_CATEGORY_ORDER = ["Moment", "Quality", "Campaign"];
    /** @type {Record<string, { tag: string, category: string }[]>} */
    let suggestedTagsByCategory = { Moment: [], Quality: [], Campaign: [] };
    let suggestedTagsLoaded = false;

    async function loadSuggestedTagsOnce() {
      if (suggestedTagsLoaded) {
        return;
      }
      const { data, error } = await supabase
        .from("suggested_tags")
        .select("tag, category")
        .order("tag");
      if (error) {
        console.error("suggested_tags load error", error);
        suggestedTagsLoaded = true;
        return;
      }
      const buckets = { Moment: [], Quality: [], Campaign: [] };
      for (const row of data || []) {
        const tag = String(row.tag || "").trim();
        if (!tag) {
          continue;
        }
        const rawCat = String(row.category || "").trim();
        const cat =
          rawCat.toLowerCase() === "moment"
            ? "Moment"
            : rawCat.toLowerCase() === "quality"
              ? "Quality"
              : rawCat.toLowerCase() === "campaign"
                ? "Campaign"
                : null;
        if (cat && buckets[cat]) {
          buckets[cat].push({ tag, category: cat });
        }
      }
      suggestedTagsByCategory = buckets;
      suggestedTagsLoaded = true;
    }

    /** Shared tag popover (single instance). */
    let userTagPopoverWrap = null;
    /** @type {HTMLElement | null} */
    let userTagPopoverAnchor = null;
    /** @type {string | null} */
    let userTagPopoverAudioId = null;
    let userTagPopoverDocMousedown = null;

    function ensureUserTagPopover() {
      if (userTagPopoverWrap) {
        return userTagPopoverWrap;
      }
      const wrap = document.createElement("div");
      wrap.className = "user-tag-popover";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-label", "Personal tags");
      wrap.tabIndex = -1;
      wrap.hidden = true;

      const scroll = document.createElement("div");
      scroll.className = "tag-popover-scroll";

      const recentBlock = document.createElement("div");
      const recentLabel = document.createElement("p");
      recentLabel.className = "tag-popover-block-label";
      recentLabel.textContent = "Recently used";
      const recentRow = document.createElement("div");
      recentRow.className = "tag-pill-row";
      recentBlock.appendChild(recentLabel);
      recentBlock.appendChild(recentRow);

      const suggestedHost = document.createElement("div");

      const appliedBlock = document.createElement("div");
      const appliedLabel = document.createElement("p");
      appliedLabel.className = "tag-popover-block-label";
      appliedLabel.textContent = "On this sound";
      const appliedRow = document.createElement("div");
      appliedRow.className = "tag-pill-row";
      appliedBlock.appendChild(appliedLabel);
      appliedBlock.appendChild(appliedRow);

      const footer = document.createElement("div");
      footer.className = "tag-popover-footer";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "user-tag-popover-input";
      input.setAttribute("aria-label", "Custom tag");
      input.placeholder = "or type your own";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "tag-popover-add-btn user-tag-popover-submit";
      addBtn.textContent = "Add";
      footer.appendChild(input);
      footer.appendChild(addBtn);

      scroll.appendChild(recentBlock);
      scroll.appendChild(suggestedHost);
      scroll.appendChild(appliedBlock);
      scroll.appendChild(footer);
      wrap.appendChild(scroll);
      document.body.appendChild(wrap);
      userTagPopoverWrap = wrap;

      const closePopover = () => {
        wrap.hidden = true;
        userTagPopoverAnchor = null;
        userTagPopoverAudioId = null;
        if (userTagPopoverDocMousedown) {
          document.removeEventListener("mousedown", userTagPopoverDocMousedown, true);
          userTagPopoverDocMousedown = null;
        }
      };

      const positionNear = (anchor) => {
        const r = anchor.getBoundingClientRect();
        const margin = 6;
        wrap.style.left = `${Math.min(window.innerWidth - wrap.offsetWidth - margin, Math.max(margin, r.left))}px`;
        const below = r.bottom + margin;
        if (below + wrap.offsetHeight < window.innerHeight - margin) {
          wrap.style.top = `${below}px`;
        } else {
          wrap.style.top = `${Math.max(margin, r.top - wrap.offsetHeight - margin)}px`;
        }
      };

      const handleRemove = async (tagName) => {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        const aid = userTagPopoverAudioId;
        const tag = String(tagName || "").trim();
        if (!uid || !aid || !tag) {
          return;
        }
        await UserTags.removeTag(uid, aid, tag);
        await refreshContents();
        if (userTagPopoverAnchor) {
          requestAnimationFrame(() => positionNear(userTagPopoverAnchor));
        }
      };

      const handleAdd = async (tagName) => {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        const aid = userTagPopoverAudioId;
        const tag = String(tagName || "").trim();
        if (!uid || !aid || !tag) {
          return;
        }
        const existing = UserTags.getTagsForAudio(aid);
        if (existing.has(tag)) {
          return;
        }
        const { error } = await UserTags.addTag(uid, aid, tag);
        if (error) {
          console.error("user_tags insert error", error);
          return;
        }
        await refreshContents();
        if (userTagPopoverAnchor) {
          requestAnimationFrame(() => positionNear(userTagPopoverAnchor));
        }
      };

      const refreshContents = async () => {
        const aid = userTagPopoverAudioId;
        if (aid == null) {
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        const canEdit = Boolean(session?.user?.id);
        input.disabled = !canEdit;
        addBtn.disabled = !canEdit;
        const appliedSet = UserTags.getTagsForAudio(aid);
        const appliedSorted = [...appliedSet].sort((a, b) => a.localeCompare(b));
        const anonTitle = "Sign in to tag sounds";

        recentRow.innerHTML = "";
        for (const tag of UserTags.getRecentTagNames(6)) {
          const isOn = appliedSet.has(tag);
          const b = document.createElement("button");
          b.type = "button";
          b.className = "tag-pill";
          b.textContent = tag;
          b.dataset.tagPill = "1";
          b.dataset.tagName = tag;
          if (isOn) {
            b.classList.add("tag-pill-applied");
            b.dataset.tagApplied = "1";
          }
          b.disabled = !canEdit;
          b.title = canEdit ? (isOn ? "Remove tag" : "Add tag") : anonTitle;
          recentRow.appendChild(b);
        }

        suggestedHost.innerHTML = "";
        for (const cat of SUGGESTED_TAG_CATEGORY_ORDER) {
          const list = suggestedTagsByCategory[cat] || [];
          if (!list.length) {
            continue;
          }
          const catLab = document.createElement("p");
          catLab.className = "tag-popover-cat-label";
          catLab.textContent = cat;
          suggestedHost.appendChild(catLab);
          const grid = document.createElement("div");
          grid.className = "tag-suggested-grid";
          for (const row of list) {
            const tag = row.tag;
            const isOn = appliedSet.has(tag);
            const b = document.createElement("button");
            b.type = "button";
            b.className = "tag-pill";
            b.textContent = tag;
            b.dataset.tagPill = "1";
            b.dataset.tagName = tag;
            if (isOn) {
              b.classList.add("tag-pill-applied");
              b.dataset.tagApplied = "1";
            }
            b.disabled = !canEdit;
            b.title = canEdit ? (isOn ? "Remove tag" : "Add tag") : anonTitle;
            grid.appendChild(b);
          }
          suggestedHost.appendChild(grid);
        }

        appliedRow.innerHTML = "";
        for (const tag of appliedSorted) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "tag-pill tag-pill-applied";
          chip.dataset.appliedTagChip = "1";
          chip.dataset.tagName = tag;
          const lab = document.createElement("span");
          lab.className = "tag-pill-label";
          lab.textContent = tag;
          const x = document.createElement("span");
          x.className = "tag-pill-remove";
          x.setAttribute("aria-hidden", "true");
          x.textContent = "×";
          chip.appendChild(lab);
          chip.appendChild(x);
          chip.disabled = !canEdit;
          chip.title = canEdit ? "Remove tag" : anonTitle;
          appliedRow.appendChild(chip);
        }

        input.value = "";
      };

      scroll.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-applied-tag-chip]");
        if (chip) {
          if (chip.disabled) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const name = chip.dataset.tagName;
          if (name) {
            void handleRemove(name);
          }
          return;
        }
        const pill = e.target.closest("[data-tag-pill]");
        if (!pill || pill.disabled) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const name = pill.dataset.tagName;
        if (!name) {
          return;
        }
        if (pill.dataset.tagApplied === "1") {
          void handleRemove(name);
        } else {
          void handleAdd(name);
        }
      });

      addBtn.addEventListener("click", () => {
        void (async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) {
            return;
          }
          const t = input.value.trim();
          if (!t) {
            input.focus();
            return;
          }
          await handleAdd(t);
        })();
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addBtn.click();
        } else if (e.key === "Escape") {
          e.preventDefault();
          closePopover();
        }
      });

      wrap._close = closePopover;
      wrap._positionNear = positionNear;
      wrap._input = input;
      wrap._refresh = refreshContents;
      return wrap;
    }

    async function openUserTagPopover(anchorEl, audioId) {
      await loadSuggestedTagsOnce();
      const wrap = ensureUserTagPopover();
      if (wrap._close && userTagPopoverAnchor && userTagPopoverAnchor !== anchorEl) {
        wrap._close();
      }
      userTagPopoverAnchor = anchorEl;
      userTagPopoverAudioId = audioId != null ? String(audioId) : null;
      wrap.hidden = false;
      await wrap._refresh();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          wrap._positionNear(anchorEl);
          void supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user && wrap._input) {
              wrap._input.focus();
            }
          });
        });
      });
      if (userTagPopoverDocMousedown) {
        document.removeEventListener("mousedown", userTagPopoverDocMousedown, true);
      }
      userTagPopoverDocMousedown = (e) => {
        if (
          !wrap.hidden &&
          e.target &&
          !wrap.contains(e.target) &&
          e.target !== anchorEl &&
          !anchorEl.contains(e.target)
        ) {
          wrap._close();
        }
      };
      window.setTimeout(() => {
        document.addEventListener("mousedown", userTagPopoverDocMousedown, true);
      }, 0);
    }

    function createUserTagButton(audioId) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "user-tag-btn";
      btn.dataset.userTagBtn = "1";
      btn.setAttribute("aria-label", "Personal tags");
      btn.title = "Tag";
      btn.innerHTML =
        '<svg class="user-tag-btn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2 3h5l1 1v4l-6 6V3zm3.5 1.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM11 7h1.25v1.75H14v1.25h-1.75V12h-1.25v-1.75H9.25V8.75h1.75V7z" opacity=".88"/></svg>';
      const sync = () => {
        btn.classList.toggle("user-tag-btn--tagged", UserTags.hasTagged(audioId));
      };
      sync();
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        void openUserTagPopover(btn, audioId);
      });
      btn.syncTaggedState = sync;
      return btn;
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

    const sceneButtonsBar = document.getElementById("scene-buttons-bar");
    const sfxSectionFiltersEl = document.getElementById("sfx-section-filters");
    const sfxSearchInput = document.getElementById("sfx-search");
    const fxGrid = document.getElementById("fx-grid");
    const activeFxAudio = new Map();
    let sfxFavoritesOnlyFilter = false;
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
    let sessionMenuOpen = false;
    let sessionMenuGlobalCloseBound = false;

    const sessionSelectorWrap = document.getElementById("session-selector-wrap");
    const editorSessionField = document.getElementById("editor-session-field");
    const editorSceneSessionSelect = document.getElementById("editor-scene-session");

    const sceneEditorBackdrop = document.getElementById("scene-editor-backdrop");
    const createNewSceneButton = document.getElementById("create-new-scene");
    const editorSceneName = document.getElementById("editor-scene-name");
    const editorSceneTags = document.getElementById("editor-scene-tags");
    const editorPlaylistList = document.getElementById("editor-playlist-list");
    const editorPlaylistFile = document.getElementById("editor-playlist-file");
    const editorPlaylistSelectedFile = document.getElementById("editor-playlist-selected-file");
    const editorPlaylistBrowse = document.getElementById("editor-playlist-browse");
    const editorPlaylistAdd = document.getElementById("editor-playlist-add");
    const editorAmbientRows = document.getElementById("editor-ambient-rows");
    const editorAmbientAdd = document.getElementById("editor-ambient-add");
    const editorSaveScene = document.getElementById("editor-save-scene");
    const editorCancelScene = document.getElementById("editor-cancel-scene");
    const filePickerBackdrop = document.getElementById("file-picker-backdrop");
    const filePickerTabs = document.getElementById("file-picker-tabs");
    const filePickerTitleEl = document.getElementById("file-picker-title");
    const filePickerSearch = document.getElementById("file-picker-search");
    const filePickerTagFiltersWrap = document.getElementById("file-picker-tag-filters-wrap");
    const filePickerList = document.getElementById("file-picker-list");
    const filePickerClose = document.getElementById("file-picker-close");
    const filePickerAddSelectedBtn = document.getElementById("file-picker-add-selected");
    const deleteSceneBackdrop = document.getElementById("delete-scene-backdrop");
    const deleteSceneMessageEl = document.getElementById("delete-scene-message");
    const deleteSceneCancelBtn = document.getElementById("delete-scene-cancel");
    const deleteSceneConfirmBtn = document.getElementById("delete-scene-confirm");
    const accountSignInBtn = document.getElementById("account-sign-in");
    const accountSignedInEl = document.getElementById("account-signed-in");
    const accountEmailEl = document.getElementById("account-email");
    const accountSignOutBtn = document.getElementById("account-sign-out");
    const authModalBackdrop = document.getElementById("auth-modal-backdrop");
    const authModalErrorEl = document.getElementById("auth-modal-error");
    const authEmailInput = document.getElementById("auth-email");
    const authPasswordInput = document.getElementById("auth-password");
    const authModalCancelBtn = document.getElementById("auth-modal-cancel");
    const authModalSubmitBtn = document.getElementById("auth-modal-submit");
    const authModalSignUpBtn = document.getElementById("auth-modal-sign-up");
    const sceneLimitModalBackdrop = document.getElementById("scene-limit-modal-backdrop");
    const sceneLimitDismissBtn = document.getElementById("scene-limit-modal-dismiss");
    const sceneLimitSignUpBtn = document.getElementById("scene-limit-modal-sign-up");
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

    const ANON_CUSTOM_SCENE_LIMIT = 5;
    /** Free signed-in accounts (when subscription is wired): max scenes in their single session. */
    const FREE_SIGNED_IN_SCENE_LIMIT = 5;

    let selectedFeedbackCategory = null;
    let feedbackCloseTimerId = null;
    let pendingDeleteSceneKey = null;
    let sceneEditorDraftPlaylist = [];
    let sceneEditorDraftAmbient = [];
    let sceneEditorEditingId = null;
    let filePickerActiveType = "music";
    /** When set, the picker is limited to this audio type (only matching tab shown). */
    let filePickerLockedToType = null;
    /** @type {HTMLElement | null} */
    let filePickerReturnFocus = null;
    /** @type {HTMLElement | null} */
    let sceneEditorReturnFocus = null;
    let filePickerOnSelect = null;
    /** When true (music scene browse), rows use checkboxes and Add selected adds many paths. */
    let filePickerMultiSelect = false;
    const filePickerMultiSelectedPaths = new Set();
    let filePickerPreviewAudio = null;
    let filePickerSelectedSetting = null;
    let filePickerSelectedMood = null;
    let filePickerSelectedSfxSection = null;
    let filePickerFavoritesOnly = false;
    /** @type {string | null} */
    let filePickerMyTagFilter = null;
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
    const sfxVolumeSlider = document.getElementById("sfx-volume");
    const musicPlaylistElement = document.getElementById("music-playlist");
    const musicRepeatToggleButton = document.getElementById("music-repeat-toggle");
    const MUSIC_SCENE_HANDOFF_MS = 2000;
    const musicPlayer = new Audio();
    let musicVolumeAnimFrameId = null;
    let musicVolumeAnimGeneration = 0;

    let currentScene = null;
    /** Scene whose playlist drives the loaded track (may differ from `currentScene` while old music keeps playing after a scene change). */
    let musicPlaybackScene = null;
    let currentTrackIndex = 0;
    /** When `musicPlaybackScene !== currentScene`, index in the selected scene's list that Play will use after the old track fades out. */
    let pendingPlayTrackIndex = 0;

    let musicRepeatMode = "list"; // "list" | "one"
    let musicQueuedNextTrackIndex = null; // synced + repeat:list only
    let musicShuffleEnabled = false;
    let sfxSectionFilter = null;
    let sfxSearchTerm = "";
    /** @type {string | null} */
    let sfxMyTagFilter = null;

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
      // If we’re not synced (scene switched while old music plays), "next" maps to pendingPlayTrackIndex.
      if (musicPlaybackScene !== currentScene) {
        musicQueuedNextTrackIndex = null;
        pendingPlayTrackIndex = index;
        renderMusicPlaylist();
        return;
      }

      if (musicRepeatMode === "one" && !musicPlayer.paused) {
        // In repeat-one mode, switching makes the new track play immediately.
        if (index === currentTrackIndex) {
          return;
        }
        musicQueuedNextTrackIndex = null;
        currentTrackIndex = index;
        loadCurrentTrack();
        musicPlayer.volume = effectiveMusicVolume();
        musicPlayer.play().then(() => {
          updateNowPlayingDisplay();
          renderMusicPlaylist();
        }).catch(() => renderMusicPlaylist());
        return;
      }

      if (musicPlayer.paused) {
        // When paused, selecting a track sets what will play next.
        musicQueuedNextTrackIndex = null;
        currentTrackIndex = index;
        loadCurrentTrack();
        updateNowPlayingDisplay();
        renderMusicPlaylist();
        return;
      }

      // Playing: only repeat:list supports queuing.
      if (musicRepeatMode === "list") {
        musicQueuedNextTrackIndex = index === currentTrackIndex ? null : index;
      } else {
        musicQueuedNextTrackIndex = null;
      }
      renderMusicPlaylist();
    }

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

    function isCustomSceneKey(sceneKey) {
      return typeof sceneKey === "string" && sceneKey.startsWith("custom:");
    }

    function loadCustomScenesFromStorage() {
      try {
        const raw = localStorage.getItem(CUSTOM_SCENES_STORAGE_KEY);
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
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

    /**
     * When Stripe is integrated, return false for free-tier signed-in users.
     * Today: any signed-in user is treated as paid for sessions and scene limits.
     */
    function userHasPaidSessionFeatures(authSession) {
      return Boolean(authSession?.user);
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
        console.error("session insert error", error);
        return null;
      }
      return data;
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
      let sessions = await fetchSessionsFromDb(userId);
      if (!sessions.length) {
        const created = await insertSessionRow(userId, "My Scenes", 0);
        if (!created) {
          sessionsList = [];
          activeSessionId = null;
          return false;
        }
        sessions = [created];
      }
      sessionsList = sessions;
      const defaultId = sessions[0].id;
      await attachOrphanScenesToDefaultSession(userId, defaultId);
      resolveActiveSessionIdFromStorage();
      persistActiveSessionId();
      return true;
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

    function populateEditorSessionSelect(selectedId) {
      if (!editorSceneSessionSelect || !editorSessionField) {
        return;
      }
      editorSceneSessionSelect.innerHTML = "";
      if (!lastAuthSession?.user) {
        editorSessionField.hidden = true;
        return;
      }
      editorSessionField.hidden = false;
      const paid = userHasPaidSessionFeatures(lastAuthSession);
      sessionsList.forEach((sess) => {
        const opt = document.createElement("option");
        opt.value = sess.id;
        opt.textContent = sess.name;
        editorSceneSessionSelect.appendChild(opt);
      });
      const fallback = activeSessionId || sessionsList[0]?.id || "";
      editorSceneSessionSelect.value = selectedId || fallback;
      editorSceneSessionSelect.disabled = !paid;
      editorSceneSessionSelect.title = paid
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

      const newToggle = document.createElement("button");
      newToggle.type = "button";
      newToggle.className = "session-menu-item session-menu-new-toggle";
      newToggle.textContent = "+ New Session";
      newToggle.addEventListener("click", () => {
        newToggle.hidden = true;
        form.hidden = false;
        nameInput.focus();
      });

      const form = document.createElement("div");
      form.className = "session-menu-new-form";
      form.hidden = true;
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Session name";
      nameInput.autocomplete = "off";
      const actions = document.createElement("div");
      actions.className = "session-menu-new-form-actions";
      const createBtn = document.createElement("button");
      createBtn.type = "button";
      createBtn.textContent = "Create";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = "Cancel";

      const finishNew = async (commit) => {
        newToggle.hidden = false;
        form.hidden = true;
        nameInput.value = "";
        if (!commit) {
          return;
        }
        const nm = nameInput.value.trim();
        if (!nm) {
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          return;
        }
        const maxSort = sessionsList.reduce(
          (m, s) => Math.max(m, Number(s.sort_order) || 0),
          -1,
        );
        const row = await insertSessionRow(session.user.id, nm, maxSort + 1);
        if (!row) {
          window.alert("Could not create session.");
          return;
        }
        sessionsList = [...sessionsList, row].sort((a, b) => {
          const ao = Number(a.sort_order) || 0;
          const bo = Number(b.sort_order) || 0;
          if (ao !== bo) {
            return ao - bo;
          }
          return String(a.name).localeCompare(String(b.name));
        });
        setActiveSessionId(row.id);
        renderSessionSelectorUI();
      };

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

      if (!userHasPaidSessionFeatures(auth)) {
        const row = document.createElement("div");
        row.className = "session-selector-locked";
        const nm = document.createElement("span");
        nm.className = "session-selector-locked-name";
        const s = sessionsList.find((x) => x.id === activeSessionId) || sessionsList[0];
        nm.textContent = s?.name || "My Scenes";
        const lock = document.createElement("span");
        lock.className = "session-selector-lock";
        lock.textContent = "🔒";
        lock.title = "Upgrade to organize scenes into sessions";
        row.appendChild(nm);
        row.appendChild(lock);
        sessionSelectorWrap.appendChild(row);
        return;
      }

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
    }

    function sceneRowToApp(row) {
      return {
        id: row.id,
        name: row.name,
        tags: Array.isArray(row.tags) ? row.tags.join(", ") : String(row.tags || ""),
        playlist: Array.isArray(row.playlist) ? row.playlist : [],
        ambientLayers: Array.isArray(row.ambient_layers) ? row.ambient_layers : [],
        sessionId: row.session_id != null ? row.session_id : null,
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
        .select("id,user_id,name,tags,playlist,ambient_layers,session_id")
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
      await ensureSessionsForUser(userId);
      const defaultSid = activeSessionId || sessionsList[0]?.id;
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

    function getSfxLevel() {
      return Number(sfxVolumeSlider.value) / 100;
    }

    function effectiveSfxVolume() {
      return getSfxLevel();
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
        audio.volume = effectiveBgmVolume(volumeSlider.value);
      });
      ambientCarryoverAudios.forEach(({ audio, sliderValue }) => {
        audio.volume = effectiveBgmVolume(sliderValue);
      });
    }

    function disposeAmbientAudio(audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    }

    function cancelAmbientFadeAnim() {
      ambientFadeGeneration += 1;
      if (ambientFadeRafId !== null) {
        cancelAnimationFrame(ambientFadeRafId);
        ambientFadeRafId = null;
      }
      if (ambientFadePendingEntries && ambientFadePendingEntries.length) {
        ambientFadePendingEntries.forEach((e) => {
          disposeAmbientAudio(e.audio);
          if (e.setLayerActiveState) {
            e.setLayerActiveState(false);
          }
        });
        ambientFadePendingEntries = null;
      }
    }

    function fadeOutAmbientEntries(entries, onComplete) {
      if (!entries.length) {
        if (onComplete) {
          onComplete();
        }
        return;
      }
      cancelAmbientFadeAnim();
      ambientFadePendingEntries = entries;
      const gen = ambientFadeGeneration;
      const start = performance.now();
      const startVols = entries.map((e) => e.audio.volume);

      function frame(now) {
        if (gen !== ambientFadeGeneration) {
          return;
        }
        const t = Math.min(1, (now - start) / MUSIC_SCENE_HANDOFF_MS);
        entries.forEach((e, i) => {
          e.audio.volume = startVols[i] * (1 - t);
        });
        if (t < 1) {
          ambientFadeRafId = requestAnimationFrame(frame);
        } else {
          ambientFadeRafId = null;
          ambientFadePendingEntries = null;
          entries.forEach((e) => {
            disposeAmbientAudio(e.audio);
            if (e.setLayerActiveState) {
              e.setLayerActiveState(false);
            }
          });
          if (gen === ambientFadeGeneration && onComplete) {
            onComplete();
          }
        }
      }

      ambientFadeRafId = requestAnimationFrame(frame);
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

    function fadeOutAllAmbientPlaying() {
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
      fadeOutAmbientEntries(all, () => {});
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

    function stopAllAmbientLayers() {
      fadeOutAllAmbientPlaying();
    }

    function applyIdleMusicVolume() {
      if (!musicPlayer.paused) {
        return;
      }
      musicPlayer.volume = effectiveMusicVolume();
    }

    function refreshMasterAndGroupVolumes() {
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
      if (musicRepeatMode === "one") {
        // Restart the same track when it ends.
        musicPlayer.currentTime = 0;
        musicPlayer.play().then(() => {
          updateNowPlayingDisplay();
          renderMusicPlaylist();
          updateMusicProgressUi();
        }).catch(() => {
          // Fallback to old behavior if replay fails.
          goToNextTrack(true);
        });
        return;
      }

      // Repeat "list" mode: if a track was queued, jump to it next.
      if (
        musicQueuedNextTrackIndex != null &&
        musicPlaybackScene === currentScene
      ) {
        currentTrackIndex = musicQueuedNextTrackIndex;
        musicQueuedNextTrackIndex = null;
        musicPlayer.volume = effectiveMusicVolume();
        loadCurrentTrack();
        musicPlayer.play().then(() => renderMusicPlaylist()).catch(() => renderMusicPlaylist());
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
      const parts = filePath.split("/");
      const fileName = parts[parts.length - 1] || filePath;
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
        const isNextUp =
          synced &&
          !musicPlayer.paused &&
          musicRepeatMode === "list" &&
          musicQueuedNextTrackIndex === index;

        if (isNowPlaying) {
          trackItem.classList.add("active");
        } else if (!synced && index === pendingPlayTrackIndex) {
          trackItem.classList.add("active");
        } else if (isNextUp) {
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
    }

    function loadCurrentTrack() {
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

      const nextSrc = AudioLibrary.resolvePlaybackUrl(tracks[currentTrackIndex]);
      if (musicPlayer.getAttribute("src") !== nextSrc) {
        musicPlayer.src = nextSrc;
      }

      updateNowPlayingDisplay();
      renderMusicPlaylist();
      return true;
    }

    function playMusic() {
      const destTracks = getSceneTracks(currentScene);
      if (!destTracks.length) {
        return;
      }

      cancelMusicVolumeAnim();

      if (musicPlaybackScene !== currentScene) {
        if (!musicPlayer.paused) {
          detachMusicEnded(musicPlayer);
          runMusicFadeOut(musicPlayer, () => {
            currentTrackIndex = pendingPlayTrackIndex;
            musicPlaybackScene = currentScene;
            if (!loadCurrentTrack()) {
              updateNowPlayingDisplay();
              renderMusicPlaylist();
              return;
            }
            attachMusicEnded(musicPlayer);
            musicPlayer.volume = effectiveMusicVolume();
            musicPlayer.play()
              .then(() => {
                renderMusicPlaylist();
              })
              .catch(() => {
                renderMusicPlaylist();
              });
          });
          return;
        }

        currentTrackIndex = pendingPlayTrackIndex;
        musicPlaybackScene = currentScene;
        if (!loadCurrentTrack()) {
          return;
        }
        attachMusicEnded(musicPlayer);
        musicPlayer.volume = effectiveMusicVolume();
        musicPlayer.play()
          .then(() => {
            renderMusicPlaylist();
          })
          .catch(() => {
            renderMusicPlaylist();
          });
        return;
      }

      if (!loadCurrentTrack()) {
        return;
      }

      detachMusicEnded(musicPlayer);
      attachMusicEnded(musicPlayer);
      musicPlayer.volume = effectiveMusicVolume();
      musicPlayer.play()
        .then(() => {
          renderMusicPlaylist();
        })
        .catch(() => {
          renderMusicPlaylist();
        });
    }

    function pauseMusic() {
      cancelMusicVolumeAnim();
      detachMusicEnded(musicPlayer);
      musicPlayer.pause();
      applyIdleMusicVolume();
      renderMusicPlaylist();
      updateMusicProgressUi();
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
          loadCurrentTrack();
          detachMusicEnded(musicPlayer);
          attachMusicEnded(musicPlayer);
          musicPlayer.volume = effectiveMusicVolume();
          musicPlayer.play()
            .then(() => {
              renderMusicPlaylist();
            })
            .catch(() => {
              renderMusicPlaylist();
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
      loadCurrentTrack();
      if (shouldPlay) {
        detachMusicEnded(musicPlayer);
        attachMusicEnded(musicPlayer);
        musicPlayer.volume = effectiveMusicVolume();
        musicPlayer.play()
          .then(() => {
            renderMusicPlaylist();
          })
          .catch(() => {
            renderMusicPlaylist();
          });
      } else {
        renderMusicPlaylist();
      }
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
          loadCurrentTrack();
          detachMusicEnded(musicPlayer);
          attachMusicEnded(musicPlayer);
          musicPlayer.volume = effectiveMusicVolume();
          musicPlayer.play()
            .then(() => {
              renderMusicPlaylist();
            })
            .catch(() => {
              renderMusicPlaylist();
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
      loadCurrentTrack();
      if (shouldPlay) {
        detachMusicEnded(musicPlayer);
        attachMusicEnded(musicPlayer);
        musicPlayer.volume = effectiveMusicVolume();
        musicPlayer.play()
          .then(() => {
            renderMusicPlaylist();
          })
          .catch(() => {
            renderMusicPlaylist();
          });
      } else {
        renderMusicPlaylist();
      }
    }

    function setSceneMusic(sceneName) {
      currentScene = sceneName;
      musicQueuedNextTrackIndex = null;

      cancelMusicVolumeAnim();

      if (musicPlayer.paused) {
        currentTrackIndex = 0;
        pendingPlayTrackIndex = 0;
        musicPlaybackScene = currentScene;
        detachMusicEnded(musicPlayer);
        loadCurrentTrack();
        return;
      }

      const newTracks = getSceneTracks(currentScene);
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
        });
        return;
      }

      pendingPlayTrackIndex = 0;
      updateNowPlayingDisplay();
      renderMusicPlaylist();
    }

    function initializeMusicPlayer() {
      musicPlayer.preload = "auto";
      musicPlaybackScene = currentScene;
      musicPlayer.volume = effectiveMusicVolume();

      musicPlayButton.addEventListener("click", () => {
        playMusic();
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
      sfxVolumeSlider.addEventListener("input", () => {
        activeFxAudio.forEach((audio) => {
          audio.volume = effectiveSfxVolume();
        });
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
            openSceneEditorForEdit(currentScene);
          } else {
            openSceneEditorNew();
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

      musicPlayer.addEventListener("timeupdate", updateMusicProgressUi);
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

      loadCurrentTrack();
    }

    function renderAmbientLayersForScene(sceneKey, ambientPreviousSceneKey) {
      cancelAmbientFadeAnim();

      const explicitPrevious = arguments.length >= 2;
      const prev = explicitPrevious ? ambientPreviousSceneKey : sceneKey;
      const isSameSceneRefresh = Boolean(sceneKey && prev === sceneKey);

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
        return;
      }

      customBgmContainer.hidden = false;
      customBgmContainer.style.display = "grid";
      if (ambientPanelActions) {
        ambientPanelActions.hidden = false;
      }

      const cs = getCustomSceneByKey(sceneKey);
      const layers = (cs && Array.isArray(cs.ambientLayers) ? cs.ambientLayers : []).slice(0, 6);
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
        nameCol.appendChild(nameEl);
        rowMain.appendChild(toggleButton);
        rowMain.appendChild(nameCol);
        rowMain.appendChild(volRow);
        rowMain.appendChild(pctEl);
        layerElement.appendChild(rowMain);
        customBgmContainer.appendChild(layerElement);

        const layerAudio = new Audio(AudioLibrary.resolvePlaybackUrl(file));
        layerAudio.loop = true;
        layerAudio.volume = effectiveBgmVolume(volumeSlider.value);

        const setLayerActiveState = (isActive) => {
          layerElement.classList.toggle("active", isActive);
          toggleButton.classList.toggle("active", isActive);
          toggleButton.innerHTML = isActive
            ? '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 4.5h7v7h-7z"/></svg>'
            : '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3.5a.5.5 0 0 1 .76-.43l6 3.5a.5.5 0 0 1 0 .86l-6 3.5A.5.5 0 0 1 5 10.5v-7z"/></svg>';
          toggleButton.setAttribute("aria-label", `${isActive ? "Stop" : "Start"} ${name}`);
          toggleButton.title = `${isActive ? "Stop" : "Start"} ${name}`;
          toggleButton.setAttribute("aria-pressed", String(isActive));
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
          layerAudio.volume = effectiveBgmVolume(volumeSlider.value);
          pctEl.textContent = `${Math.round(Number(volumeSlider.value) || 0)}%`;
        });

        customBgmLayerRegistry.push({ audio: layerAudio, volumeSlider, setLayerActiveState });
      });
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
      const tryPlayCandidate = (candidateIndex) => {
        if (candidateIndex >= candidates.length) {
          activeFxAudio.delete(buttonElement);
          buttonElement.classList.remove("fx-playing");
          return;
        }
        const audio = new Audio(candidates[candidateIndex]);
        audio.volume = effectiveSfxVolume();
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
          tryPlayCandidate(candidateIndex + 1);
        };

        audio.addEventListener("ended", clearPlayingState, { once: true });
        audio.addEventListener("error", tryNext, { once: true });
        audio.play().catch(tryNext);
      };

      tryPlayCandidate(0);
    }

    async function renderFxButtons() {
      activeFxAudio.forEach((_, buttonElement) => {
        stopFxSound(buttonElement);
      });
      fxGrid.innerHTML = "";
      const allSfx = await AudioLibrary.listFiles("sfx");
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

        const soundButton = document.createElement("button");
        soundButton.type = "button";
        if (entry.generated === false) {
          soundButton.classList.add("fx-unavailable");
        }

        const catEl = document.createElement("span");
        catEl.className = "fx-cat";
        catEl.textContent = section || "SFX";
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
          playCustomFxSound(entry.path, soundButton);
        });
        fxGrid.appendChild(soundButton);
      });
    }

    function activateSceneKey(sceneKey) {
      const previousSceneKey = currentScene;
      setSceneMusic(sceneKey);
      renderAmbientLayersForScene(sceneKey, previousSceneKey);
      try {
        if (sceneKey && isCustomSceneKey(sceneKey)) {
          localStorage.setItem(ACTIVE_SCENE_STORAGE_KEY, sceneKey);
        } else {
          localStorage.removeItem(ACTIVE_SCENE_STORAGE_KEY);
        }
      } catch (_) {
        /* ignore */
      }
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
      renderAmbientLayersForScene(null, ambientPrevSceneKey);
      try {
        localStorage.removeItem(ACTIVE_SCENE_STORAGE_KEY);
      } catch (_) {
        /* ignore */
      }
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
          activateSceneKey(saved);
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

        const sceneBtn = document.createElement("button");
        sceneBtn.type = "button";
        sceneBtn.className = "scene-btn";
        sceneBtn.dataset.sceneKey = key;
        sceneBtn.setAttribute("aria-pressed", "false");
        sceneBtn.textContent = scene.name;
        if (scene.tags) {
          sceneBtn.title = scene.tags;
        }

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

        wrap.appendChild(sceneBtn);
        wrap.appendChild(tagRow);
        wrap.appendChild(actions);
        sceneButtonsBar.appendChild(wrap);
      });

      const emptyHint = document.getElementById("scene-selector-empty");
      if (emptyHint) {
        emptyHint.hidden = visibleScenes.length > 0;
      }
      updateSessionSelectorTriggerLabel();
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
      } else {
        customScenesList = customScenesList.filter((s) => s.id !== id);
        saveCustomScenesToStorage(customScenesList);
        await refreshCustomScenesList();
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

    function stopFilePreviewAudio() {
      if (!filePickerPreviewAudio) {
        return;
      }
      filePickerPreviewAudio.pause();
      filePickerPreviewAudio.currentTime = 0;
      filePickerPreviewAudio = null;
    }

    function normalizeFilePickerAudioType(raw) {
      const t = typeof raw === "string" ? raw.toLowerCase().trim() : "";
      if (t === "ambient" || t === "sfx" || t === "music") {
        return t;
      }
      return "music";
    }

    function syncFilePickerChromeForLockState() {
      if (!filePickerTitleEl || !filePickerTabs) {
        return;
      }
      const titles = {
        music: "Choose music file",
        ambient: "Choose ambient file",
        sfx: "Choose SFX file",
      };
      filePickerTabs.hidden = false;
      const tabButtons = filePickerTabs.querySelectorAll(".file-picker-tab");
      if (filePickerLockedToType) {
        filePickerTitleEl.textContent =
          titles[filePickerLockedToType] || "Choose audio file";
        tabButtons.forEach((btn) => {
          btn.hidden = btn.dataset.audioType !== filePickerLockedToType;
        });
        return;
      }
      filePickerTitleEl.textContent = "Choose audio file";
      tabButtons.forEach((btn) => {
        btn.hidden = false;
      });
    }

    function appendFilePickerMetaLine(container, label, values) {
      const span = document.createElement("span");
      const text =
        Array.isArray(values) && values.length ? values.join(", ") : "—";
      span.textContent = `${label}: ${text}`;
      container.appendChild(span);
    }

    function collectMoodTagsUsedWithSetting(files, settingTag) {
      const moods = new Set();
      files.forEach((f) => {
        if (!f.setting_tags.includes(settingTag)) {
          return;
        }
        f.mood_tags.forEach((m) => {
          if (m) {
            moods.add(m);
          }
        });
      });
      return moods;
    }

    function pruneFilePickerMoodIfStale(files, readmeMoodOrder) {
      if (!filePickerSelectedMood) {
        return;
      }
      let allowed;
      if (filePickerSelectedSetting) {
        const used = collectMoodTagsUsedWithSetting(files, filePickerSelectedSetting);
        allowed = new Set(readmeMoodOrder.filter((m) => used.has(m)));
      } else {
        allowed = new Set(readmeMoodOrder);
      }
      if (!allowed.has(filePickerSelectedMood)) {
        filePickerSelectedMood = null;
      }
    }

    function fileEntryMatchesFilePickerFilters(file) {
      const t = filePickerActiveType;
      if (filePickerMyTagFilter) {
        const row = UserTags.getMyTagSummary().find((r) => r.tag === filePickerMyTagFilter);
        const ids = row?.audio_ids ? row.audio_ids.map(String) : [];
        if (!ids.includes(String(file.id))) {
          return false;
        }
      }
      if (t === "music" && filePickerFavoritesOnly) {
        if (!Favorites.has("music", file.id)) {
          return false;
        }
      }
      if (t === "sfx") {
        if (!filePickerSelectedSfxSection) {
          return true;
        }
        return file.section === filePickerSelectedSfxSection;
      }
      const settingSel = filePickerSelectedSetting;
      const moodSel = filePickerSelectedMood;
      if (!settingSel && !moodSel) {
        return true;
      }
      const settingOk = !settingSel || file.setting_tags.includes(settingSel);
      const moodOk = !moodSel || file.mood_tags.includes(moodSel);
      return settingOk && moodOk;
    }

    function appendFilePickerClearButton(container) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "file-picker-clear-filters";
      clearBtn.textContent = "Clear Filters";
      clearBtn.addEventListener("click", () => {
        filePickerSelectedSetting = null;
        filePickerSelectedMood = null;
        filePickerSelectedSfxSection = null;
        filePickerFavoritesOnly = false;
        filePickerMyTagFilter = null;
        void renderFilePickerFilters();
        void renderFilePickerList();
      });
      container.appendChild(clearBtn);
    }

    function appendFilePickerFavoritesToggle(container) {
      const wrap = document.createElement("div");
      wrap.className = "file-picker-filter-step";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Favorites filter");
      const label = document.createElement("p");
      label.className = "file-picker-tag-filters-label";
      label.textContent = "Favorites";
      wrap.appendChild(label);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "file-picker-fav-toggle";
      if (filePickerFavoritesOnly) {
        btn.classList.add("active");
      }
      btn.setAttribute("aria-pressed", filePickerFavoritesOnly ? "true" : "false");
      btn.innerHTML =
        '<span class="fav-icon" aria-hidden="true">★</span><span>Favorites only</span>';
      btn.addEventListener("click", () => {
        filePickerFavoritesOnly = !filePickerFavoritesOnly;
        void renderFilePickerFilters();
        void renderFilePickerList();
      });
      wrap.appendChild(btn);
      container.appendChild(wrap);
    }

    function appendFilePickerMyTagsFilterGroup(container, session) {
      const summary = UserTags.getMyTagSummary();
      if (!session?.user?.id || !summary.length) {
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "file-picker-filter-step file-picker-my-tags-step";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "My Tags");
      const lab = document.createElement("p");
      lab.className = "file-picker-tag-filters-label";
      lab.textContent = "My Tags";
      wrap.appendChild(lab);
      const row = document.createElement("div");
      row.className = "tag-pill-row";
      for (const rowSummary of summary) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "file-picker-my-tag-pill";
        const nameSpan = document.createElement("span");
        nameSpan.className = "file-picker-my-tag-name";
        nameSpan.textContent = rowSummary.tag;
        const countSpan = document.createElement("span");
        countSpan.className = "file-picker-my-tag-count";
        countSpan.textContent = String(rowSummary.count);
        b.appendChild(nameSpan);
        b.appendChild(countSpan);
        const active = filePickerMyTagFilter === rowSummary.tag;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
        b.addEventListener("click", () => {
          filePickerMyTagFilter = filePickerMyTagFilter === rowSummary.tag ? null : rowSummary.tag;
          void renderFilePickerFilters();
          void renderFilePickerList();
        });
        row.appendChild(b);
      }
      wrap.appendChild(row);
      container.appendChild(wrap);
    }

    async function renderFilePickerFilters() {
      filePickerTagFiltersWrap.innerHTML = "";
      const { data: { session } } = await supabase.auth.getSession();
      const readme = await AudioLibrary.getReadmeFilterLists();

      if (filePickerActiveType === "sfx") {
        const group = document.createElement("div");
        group.className = "file-picker-filter-step";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "SFX section");
        const label = document.createElement("p");
        label.className = "file-picker-tag-filters-label";
        label.textContent = "Section";
        group.appendChild(label);
        readme.all_sfx_sections.forEach((sectionName) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "file-picker-tag";
          btn.textContent = sectionName;
          const active = filePickerSelectedSfxSection === sectionName;
          btn.setAttribute("aria-pressed", active ? "true" : "false");
          if (active) {
            btn.classList.add("active");
          }
          btn.addEventListener("click", () => {
            filePickerSelectedSfxSection = active ? null : sectionName;
            void renderFilePickerFilters();
            void renderFilePickerList();
          });
          group.appendChild(btn);
        });
        filePickerTagFiltersWrap.appendChild(group);
        appendFilePickerMyTagsFilterGroup(filePickerTagFiltersWrap, session);
        appendFilePickerClearButton(filePickerTagFiltersWrap);
        return;
      }

      const files = await AudioLibrary.listFiles(filePickerActiveType);
      pruneFilePickerMoodIfStale(files, readme.all_mood_tags);

      if (filePickerActiveType === "music") {
        appendFilePickerFavoritesToggle(filePickerTagFiltersWrap);
      }

      const settingGroup = document.createElement("div");
      settingGroup.className = "file-picker-filter-step";
      settingGroup.setAttribute("role", "group");
      settingGroup.setAttribute("aria-label", "Setting tag");
      const settingLabel = document.createElement("p");
      settingLabel.className = "file-picker-tag-filters-label";
      settingLabel.textContent = "Setting";
      settingGroup.appendChild(settingLabel);
      readme.all_setting_tags.forEach((tag) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "file-picker-tag";
        btn.textContent = tag;
        const active = filePickerSelectedSetting === tag;
        btn.setAttribute("aria-pressed", active ? "true" : "false");
        if (active) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          filePickerSelectedSetting = active ? null : tag;
          void AudioLibrary.listFiles(filePickerActiveType).then((freshFiles) => {
            pruneFilePickerMoodIfStale(freshFiles, readme.all_mood_tags);
            void renderFilePickerFilters();
            void renderFilePickerList();
          });
        });
        settingGroup.appendChild(btn);
      });
      filePickerTagFiltersWrap.appendChild(settingGroup);

      const moodUsedSet = filePickerSelectedSetting
        ? collectMoodTagsUsedWithSetting(files, filePickerSelectedSetting)
        : null;
      const moodTagsForUi = filePickerSelectedSetting
        ? readme.all_mood_tags.filter((m) => moodUsedSet.has(m))
        : readme.all_mood_tags;

      const moodGroup = document.createElement("div");
      moodGroup.className = "file-picker-filter-step";
      moodGroup.setAttribute("role", "group");
      moodGroup.setAttribute("aria-label", "Mood tag");
      const moodLabel = document.createElement("p");
      moodLabel.className = "file-picker-tag-filters-label";
      moodLabel.textContent = "Mood";
      moodGroup.appendChild(moodLabel);
      moodTagsForUi.forEach((tag) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "file-picker-tag";
        btn.textContent = tag;
        const active = filePickerSelectedMood === tag;
        btn.setAttribute("aria-pressed", active ? "true" : "false");
        if (active) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          filePickerSelectedMood = active ? null : tag;
          void renderFilePickerFilters();
          void renderFilePickerList();
        });
        moodGroup.appendChild(btn);
      });
      filePickerTagFiltersWrap.appendChild(moodGroup);

      appendFilePickerMyTagsFilterGroup(filePickerTagFiltersWrap, session);
      appendFilePickerClearButton(filePickerTagFiltersWrap);
    }

    function syncFilePickerMultiFooter() {
      if (!filePickerAddSelectedBtn) {
        return;
      }
      const effectiveType = filePickerLockedToType || filePickerActiveType;
      const show = filePickerMultiSelect && effectiveType === "music";
      filePickerAddSelectedBtn.hidden = !show;
      if (!show) {
        return;
      }
      const n = filePickerMultiSelectedPaths.size;
      filePickerAddSelectedBtn.disabled = n === 0;
      filePickerAddSelectedBtn.textContent =
        n === 0 ? "Add selected tracks" : `Add selected tracks (${n})`;
    }

    /** Paths in current filtered list order (for multi-add). */
    let filePickerMultiOrderPaths = [];

    async function renderFilePickerList() {
      const files = await AudioLibrary.listFiles(filePickerActiveType);
      const query = filePickerSearch.value.trim().toLowerCase();
      const filtered = files.filter((f) => {
        if (!fileEntryMatchesFilePickerFilters(f)) {
          return false;
        }
        return !query || f.name.toLowerCase().includes(query);
      });
      filePickerList.innerHTML = "";

      if (filePickerMultiSelect && filePickerActiveType === "music") {
        const allowed = new Set(filtered.map((f) => f.manifestPath));
        for (const p of [...filePickerMultiSelectedPaths]) {
          if (!allowed.has(p)) {
            filePickerMultiSelectedPaths.delete(p);
          }
        }
        filePickerMultiOrderPaths = filtered.map((f) => f.manifestPath);
      } else {
        filePickerMultiOrderPaths = [];
      }

      if (!filtered.length) {
        const emptyItem = document.createElement("li");
        emptyItem.textContent = "No files found.";
        filePickerList.appendChild(emptyItem);
        syncFilePickerMultiFooter();
        return;
      }

      const useMultiRow =
        filePickerMultiSelect && filePickerActiveType === "music";

      filtered.forEach((file) => {
        const li = document.createElement("li");
        const displayTitle =
          formatAutoLabelFromPath(file.manifestPath) ||
          (file.name && String(file.name).trim()) ||
          AudioLibrary.getPlaylistTrackTitle(file.manifestPath) ||
          getTrackLabel(file.manifestPath);

        const info = document.createElement("div");
        info.className = "file-picker-file-info";

        const titleRow = document.createElement("div");
        titleRow.className = "file-picker-file-title";

        const nameSpan = document.createElement("span");
        nameSpan.className = "file-name";
        nameSpan.textContent = displayTitle;
        titleRow.appendChild(nameSpan);

        info.appendChild(titleRow);

        if (useMultiRow) {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "file-picker-multi-check";
          checkbox.checked = filePickerMultiSelectedPaths.has(file.manifestPath);
          checkbox.setAttribute("aria-label", `Select ${displayTitle}`);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              filePickerMultiSelectedPaths.add(file.manifestPath);
            } else {
              filePickerMultiSelectedPaths.delete(file.manifestPath);
            }
            syncFilePickerMultiFooter();
          });
          li.appendChild(checkbox);
        }

        li.appendChild(info);

        const rowActions = document.createElement("div");
        rowActions.className = "file-picker-row-actions";

        const playButton = document.createElement("button");
        playButton.type = "button";
        playButton.className = "file-picker-preview-btn";
        playButton.textContent = "▶";
        playButton.setAttribute("aria-label", `Preview ${displayTitle}`);
        playButton.title = `Preview ${displayTitle}`;
        playButton.addEventListener("click", () => {
          if (filePickerPreviewAudio && !filePickerPreviewAudio.paused) {
            stopFilePreviewAudio();
          }
          const preview = new Audio(AudioLibrary.resolvePlaybackUrl(file.manifestPath));
          preview.volume = 0.7;
          preview.play().catch(() => {
            stopFilePreviewAudio();
          });
          filePickerPreviewAudio = preview;
        });
        rowActions.appendChild(playButton);

        if (!useMultiRow) {
          const selectButton = document.createElement("button");
          selectButton.type = "button";
          selectButton.textContent = "Select";
          selectButton.addEventListener("click", () => {
            if (typeof filePickerOnSelect === "function") {
              filePickerOnSelect(file.manifestPath);
            }
            closeFilePicker();
          });
          rowActions.appendChild(selectButton);
        }

        if (filePickerActiveType === "music") {
          const starTagWrap = document.createElement("div");
          starTagWrap.className = "file-picker-star-tag-wrap";
          const star = createFavoriteStarButton(
            Favorites.has("music", file.id),
            () => {
              void Favorites.toggle("music", file.id).then(() => {
                star.sync(Favorites.has("music", file.id));
                if (filePickerFavoritesOnly) {
                  void renderFilePickerList();
                }
              });
            },
          );
          star.classList.add("file-picker-row-star");
          const tagBtn = createUserTagButton(file.id);
          starTagWrap.appendChild(star);
          starTagWrap.appendChild(tagBtn);
          rowActions.appendChild(starTagWrap);
        }

        li.appendChild(rowActions);

        filePickerList.appendChild(li);
      });

      syncFilePickerMultiFooter();
    }

    async function setFilePickerTab(audioType) {
      filePickerActiveType = audioType;
      filePickerSelectedSetting = null;
      filePickerSelectedMood = null;
      filePickerSelectedSfxSection = null;
      filePickerFavoritesOnly = false;
      filePickerMyTagFilter = null;
      filePickerTabs.querySelectorAll(".file-picker-tab").forEach((button) => {
        button.classList.toggle("active", button.dataset.audioType === audioType);
      });
      await renderFilePickerFilters();
      await renderFilePickerList();
    }

    function openFilePicker(audioType, onSelect, options) {
      const ae = document.activeElement;
      filePickerReturnFocus = ae instanceof HTMLElement ? ae : null;
      filePickerOnSelect = onSelect;
      filePickerLockedToType = normalizeFilePickerAudioType(audioType);
      filePickerMultiSelect =
        Boolean(options && options.multi) && filePickerLockedToType === "music";
      filePickerMultiSelectedPaths.clear();
      filePickerMultiOrderPaths = [];
      filePickerSearch.value = "";
      syncFilePickerChromeForLockState();
      syncFilePickerMultiFooter();
      filePickerBackdrop.removeAttribute("inert");
      filePickerBackdrop.classList.add("open");
      void setFilePickerTab(filePickerLockedToType).then(() => {
        filePickerSearch.focus();
      });
    }

    function closeFilePicker() {
      const returnEl = filePickerReturnFocus;
      filePickerReturnFocus = null;
      stopFilePreviewAudio();
      filePickerBackdrop.classList.remove("open");
      filePickerBackdrop.setAttribute("inert", "");
      if (returnEl && typeof returnEl.focus === "function" && document.body.contains(returnEl)) {
        try {
          returnEl.focus();
        } catch (_) {
          /* ignore */
        }
      }
      filePickerOnSelect = null;
      filePickerLockedToType = null;
      filePickerMultiSelect = false;
      filePickerMultiSelectedPaths.clear();
      filePickerMultiOrderPaths = [];
      syncFilePickerChromeForLockState();
      syncFilePickerMultiFooter();
    }

    function closeSceneEditor() {
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

    function resetEditorDraftFromSceneObject(scene) {
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
      populateEditorSessionSelect(sessPick || null);
    }

    function openSceneEditorNew() {
      const ae = document.activeElement;
      sceneEditorReturnFocus = ae instanceof HTMLElement ? ae : null;
      sceneEditorBackdrop.removeAttribute("inert");
      document.getElementById("scene-editor-title").textContent = "Create new scene";
      resetEditorDraftFromSceneObject(null);
      sceneEditorBackdrop.classList.add("open");
      void Promise.resolve().then(() => {
        editorSceneName.focus();
      });
    }

    function openSceneEditorForEdit(sceneKey) {
      if (!isCustomSceneKey(sceneKey)) {
        return;
      }
      const scene = getCustomSceneByKey(sceneKey);
      if (!scene) {
        return;
      }
      const ae = document.activeElement;
      sceneEditorReturnFocus = ae instanceof HTMLElement ? ae : null;
      sceneEditorBackdrop.removeAttribute("inert");
      document.getElementById("scene-editor-title").textContent = "Edit scene";
      resetEditorDraftFromSceneObject(scene);
      sceneEditorBackdrop.classList.add("open");
      void Promise.resolve().then(() => {
        editorSceneName.focus();
      });
    }

    async function saveSceneFromEditor() {
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

      let nextSessionId = activeSessionId || sessionsList[0]?.id || null;
      if (
        editorSceneSessionSelect &&
        !editorSceneSessionSelect.disabled &&
        editorSceneSessionSelect.value
      ) {
        nextSessionId = editorSceneSessionSelect.value;
      }

      const sceneObj = {
        id: sceneEditorEditingId || (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
        name,
        tags: editorSceneTags.value.trim(),
        playlist: sceneEditorDraftPlaylist.map((p) => p.trim()).filter(Boolean),
        ambientLayers: ambientLayers.slice(0, 6),
        sessionId: nextSessionId || undefined,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        if (!sceneEditorEditingId && !userHasPaidSessionFeatures(session)) {
          const n = countScenesInSession(activeSessionId || sessionsList[0]?.id);
          if (n >= FREE_SIGNED_IN_SCENE_LIMIT) {
            openSceneLimitModal();
            return;
          }
        }
        const row = appSceneToRow(sceneObj, session.user.id);
        const { error } = await supabase.from("scenes").upsert(row, { onConflict: "id" });
        if (error) {
          window.alert(`Could not save scene: ${error.message}`);
          return;
        }
        await refreshCustomScenesList();
      } else {
        if (!sceneEditorEditingId) {
          const list = loadCustomScenesFromStorage();
          if (list.length >= ANON_CUSTOM_SCENE_LIMIT) {
            openSceneLimitModal();
            return;
          }
        }
        const anonScene = { ...sceneObj };
        delete anonScene.sessionId;
        if (sceneEditorEditingId) {
          list = list.map((s) => (s.id === sceneEditorEditingId ? anonScene : s));
        } else {
          list.push(anonScene);
        }
        saveCustomScenesToStorage(list);
        await refreshCustomScenesList();
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
          loadCurrentTrack();
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
        openSceneEditorForEdit(editBtn.getAttribute("data-edit-scene"));
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        const n = loadCustomScenesFromStorage().length;
        if (n >= ANON_CUSTOM_SCENE_LIMIT) {
          openSceneLimitModal();
          return;
        }
      } else if (!userHasPaidSessionFeatures(session)) {
        const n = countScenesInSession(activeSessionId || sessionsList[0]?.id);
        if (n >= FREE_SIGNED_IN_SCENE_LIMIT) {
          openSceneLimitModal();
          return;
        }
      }
      openSceneEditorNew();
    });

    editorCancelScene.addEventListener("click", () => {
      closeSceneEditor();
    });

    sceneEditorBackdrop.addEventListener("click", (e) => {
      if (e.target === sceneEditorBackdrop) {
        closeSceneEditor();
      }
    });

    filePickerTabs.addEventListener("click", (e) => {
      if (filePickerLockedToType) {
        return;
      }
      const tab = e.target.closest(".file-picker-tab");
      if (!tab) {
        return;
      }
      const audioType = tab.dataset.audioType;
      if (!audioType) {
        return;
      }
      void setFilePickerTab(audioType);
    });

    filePickerSearch.addEventListener("input", () => {
      void renderFilePickerList();
    });

    filePickerClose.addEventListener("click", () => {
      closeFilePicker();
    });

    filePickerAddSelectedBtn.addEventListener("click", () => {
      if (!filePickerMultiSelect || filePickerMultiSelectedPaths.size === 0) {
        return;
      }
      const paths = filePickerMultiOrderPaths.filter((p) =>
        filePickerMultiSelectedPaths.has(p),
      );
      if (!paths.length || typeof filePickerOnSelect !== "function") {
        return;
      }
      filePickerOnSelect(paths);
      closeFilePicker();
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

    filePickerBackdrop.addEventListener("click", (e) => {
      if (e.target === filePickerBackdrop) {
        closeFilePicker();
      }
    });

    editorPlaylistBrowse.addEventListener("click", () => {
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

    editorPlaylistAdd.addEventListener("click", () => {
      const v = editorPlaylistFile.value.trim();
      if (!v) {
        return;
      }
      sceneEditorDraftPlaylist.push(v);
      editorPlaylistFile.value = "";
      editorPlaylistSelectedFile.textContent = "No file selected";
      renderEditorPlaylist();
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

    if (sfxSearchInput) {
      sfxSearchInput.addEventListener("input", () => {
        sfxSearchTerm = sfxSearchInput.value.trim().toLowerCase();
        void renderFxButtons();
      });
    }

    Favorites.subscribe((type) => {
      if (type === "sfx") {
        void renderFxButtons();
      } else if (type === "music") {
        renderMusicPlaylist();
        if (filePickerBackdrop && filePickerBackdrop.classList.contains("open")) {
          void renderFilePickerList();
        }
      }
    });

    UserTags.subscribe(() => {
      const summary = UserTags.getMyTagSummary();
      if (filePickerMyTagFilter && !summary.some((r) => r.tag === filePickerMyTagFilter)) {
        filePickerMyTagFilter = null;
      }
      if (sfxMyTagFilter && !summary.some((r) => r.tag === sfxMyTagFilter)) {
        sfxMyTagFilter = null;
      }
      void buildSfxSectionFilterPills();
      void renderFxButtons();
      if (userTagPopoverWrap && !userTagPopoverWrap.hidden && typeof userTagPopoverWrap._refresh === "function") {
        void userTagPopoverWrap._refresh();
      }
      if (filePickerBackdrop && filePickerBackdrop.classList.contains("open")) {
        void renderFilePickerFilters();
        void renderFilePickerList();
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
        closeAuthModal();
      });
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
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          if (authModalErrorEl) {
            authModalErrorEl.textContent = error.message;
          }
          return;
        }
        closeAuthModal();
      });
    }
    if (sceneLimitDismissBtn) {
      sceneLimitDismissBtn.addEventListener("click", () => closeSceneLimitModal());
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

    async function handleSupabaseAuthChange(event, nextSession) {
      updateAccountUI(nextSession);
      if (event === "SIGNED_IN" && nextSession?.user) {
        closeAuthModal();
        await migrateLocalScenesToCloudIfNeeded(nextSession.user.id);
        await Favorites.migrateLocalToCloud(nextSession.user.id);
        await Favorites.syncFromSupabase(nextSession.user.id);
        await UserTags.syncFromSupabase(nextSession.user.id);
        await refreshCustomScenesList();
        refreshSceneSelectorBar();
        restorePersistedActiveSceneOrDefault();
        void buildSfxSectionFilterPills();
        void renderFxButtons();
        renderMusicPlaylist();
        if (filePickerBackdrop && filePickerBackdrop.classList.contains("open")) {
          void renderFilePickerFilters();
          void renderFilePickerList();
        }
        return;
      }
      if (event === "SIGNED_OUT") {
        closeAuthModal();
        Favorites.loadFromLocalStorage();
        UserTags.clear();
        sfxMyTagFilter = null;
        await refreshCustomScenesList();
        refreshSceneSelectorBar();
        restorePersistedActiveSceneOrDefault();
        void buildSfxSectionFilterPills();
        void renderFxButtons();
        renderMusicPlaylist();
        if (filePickerBackdrop && filePickerBackdrop.classList.contains("open")) {
          void renderFilePickerFilters();
          void renderFilePickerList();
        }
      }
    }

    void (async () => {
      void loadSuggestedTagsOnce();
      supabase.auth.onAuthStateChange((event, nextSession) => {
        void handleSupabaseAuthChange(event, nextSession);
      });

      const { data: { session } } = await supabase.auth.getSession();
      updateAccountUI(session);
      if (session?.user) {
        await migrateLocalScenesToCloudIfNeeded(session.user.id);
        await Favorites.migrateLocalToCloud(session.user.id);
        await Favorites.syncFromSupabase(session.user.id);
        await UserTags.syncFromSupabase(session.user.id);
      } else {
        Favorites.loadFromLocalStorage();
        UserTags.clear();
        sfxMyTagFilter = null;
      }
      await refreshCustomScenesList();
      refreshSceneSelectorBar();
      restorePersistedActiveSceneOrDefault();
      void buildSfxSectionFilterPills();
      void renderFxButtons();
      initializeMusicPlayer();
    })();