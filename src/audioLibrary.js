import { supabase } from "../supabase.js";

const AudioLibrary = (() => {
      const supabaseBaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").replace(
        /\/$/,
        "",
      );
      const STORAGE_BASE_URL = supabaseBaseUrl
        ? `${supabaseBaseUrl}/storage/v1/object/public`
        : "";
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
        const layer = type === "ambient" && entry.layer ? String(entry.layer).toLowerCase().trim() : "";
        const environment =
          type === "ambient" && entry.environment ? String(entry.environment).toLowerCase().trim() : "";
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
          layer,
          environment,
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

export { AudioLibrary };
