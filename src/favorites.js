import { supabase } from "../supabase.js";

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

export { Favorites };
