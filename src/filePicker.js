import { supabase } from "../supabase.js";
import { AudioLibrary } from "./audioLibrary.js";
import { Favorites } from "./favorites.js";
import { UserTags, createUserTagButton } from "./userTags.js";

const USER_UPLOAD_PREFIX = "user-upload:";
const USER_UPLOAD_BUCKET = "user-uploads";
const USER_LIBRARY_QUOTA_BYTES = 500 * 1024 * 1024;
const USER_UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** @type {null | {
 *   getLastAuthSession: () => object | null,
 *   openAuthModal: () => void,
 *   resolveAudioPlaybackUrl: (rawPath: string) => Promise<string>,
 *   userUploadSignedUrlCache: Map<string, { url: string, expiresAt: number }>,
 * }} */
let filePickerAppBridge = null;


    const filePickerBackdrop = document.getElementById("file-picker-backdrop");
    const filePickerTabs = document.getElementById("file-picker-tabs");
    const filePickerTitleEl = document.getElementById("file-picker-title");
    const filePickerSearch = document.getElementById("file-picker-search");
    const filePickerTagFiltersWrap = document.getElementById("file-picker-tag-filters-wrap");
    const filePickerList = document.getElementById("file-picker-list");
    const filePickerClose = document.getElementById("file-picker-close");
    const filePickerAddSelectedBtn = document.getElementById("file-picker-add-selected");
    let filePickerActiveType = "music";
    /** When set, the picker is limited to this audio type (only matching tab shown). */
    let filePickerLockedToType = null;
    /** @type {HTMLElement | null} */
    let filePickerReturnFocus = null;
    let filePickerOnSelect = null;
    /** When true (music scene browse), rows use checkboxes and Add selected adds many paths. */
    let filePickerMultiSelect = false;
    const filePickerMultiSelectedPaths = new Set();
    let filePickerPreviewAudio = null;
    let filePickerSelectedSetting = null;
    let filePickerSelectedMood = null;
    let filePickerSelectedSfxSection = null;
    let filePickerSelectedAmbientLayer = null;
    let filePickerFavoritesOnly = false;
    let filePickerLyricsFilter = null; // null = All, "hide" = no lyrics, "only" = lyrics only
    /** @type {string | null} */
    let filePickerMyTagFilter = null;
    let myLibraryUploadSelectedFile = null;
    const myLibraryUploadMoodTags = new Set();
    const nowPlayingTitle = document.querySelector(".track-title");
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
        library: "My Library",
      };
      filePickerTabs.hidden = false;
      const tabButtons = filePickerTabs.querySelectorAll(".file-picker-tab");
      const showLibraryTab = Boolean(filePickerAppBridge.getLastAuthSession()?.user);

      const applyTabVisibility = () => {
        tabButtons.forEach((btn) => {
          const t = btn.dataset.audioType;
          if (t === "library") {
            btn.hidden = !showLibraryTab;
            return;
          }
          if (filePickerLockedToType) {
            btn.hidden = t !== filePickerLockedToType;
          } else {
            btn.hidden = false;
          }
        });
      };

      if (filePickerLockedToType) {
        filePickerTitleEl.textContent =
          titles[filePickerLockedToType] || "Choose audio file";
        applyTabVisibility();
        return;
      }
      filePickerTitleEl.textContent = "Choose audio file";
      applyTabVisibility();
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
      if (t === "music" && filePickerLyricsFilter === "hide" && file.hasLyrics) return false;
      if (t === "music" && filePickerLyricsFilter === "only" && !file.hasLyrics) return false;
      if (t === "sfx") {
        if (!filePickerSelectedSfxSection) {
          return true;
        }
        return file.section === filePickerSelectedSfxSection;
      }
      if (t === "ambient") {
        if (!filePickerSelectedAmbientLayer) {
          return true;
        }
        return file.layer === filePickerSelectedAmbientLayer;
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
        filePickerSelectedAmbientLayer = null;
        filePickerFavoritesOnly = false;
        filePickerLyricsFilter = null;
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

    function formatBytesShort(n) {
      const x = Number(n) || 0;
      if (x >= 1048576) {
        return `${(x / 1048576).toFixed(2)} MB`;
      }
      if (x >= 1024) {
        return `${(x / 1024).toFixed(1)} KB`;
      }
      return `${x} B`;
    }

    function userAudioRowStoragePath(row) {
      if (!row || typeof row !== "object") {
        return "";
      }
      const p =
        row.storage_path ??
        row.storagePath ??
        row.path ??
        row.object_path ??
        row.objectPath;
      return p != null ? String(p).trim() : "";
    }

    function userAudioRowFileSizeBytes(row) {
      if (!row || typeof row !== "object") {
        return 0;
      }
      const n = Number(
        row.file_size_bytes ?? row.file_size ?? row.size_bytes ?? row.size ?? 0,
      );
      return Number.isFinite(n) ? n : 0;
    }

    function userAudioRowPk(row) {
      if (!row || typeof row !== "object") {
        return null;
      }
      const v = row.id ?? row.uuid ?? row.audio_id;
      return v != null ? v : null;
    }

    function userAudioRowAudioTypeKey(row) {
      if (!row || typeof row !== "object") {
        return "";
      }
      const t = row.audio_type ?? row.audioType ?? row.type;
      return String(t || "").toLowerCase();
    }

    async function sumUserAudioBytesFromTable(userId) {
      const { data, error } = await supabase
        .from("user_audio")
        .select("*")
        .eq("user_id", userId);
      if (error) {
        console.error("user_audio storage sum", error);
        return null;
      }
      if (!Array.isArray(data)) {
        return null;
      }
      let sum = 0;
      for (const row of data) {
        sum += userAudioRowFileSizeBytes(row);
      }
      return sum;
    }

    function syncFilePickerLibraryChrome() {
      const chrome = document.getElementById("file-picker-library-chrome");
      const isLib = filePickerActiveType === "library";
      if (chrome) {
        chrome.hidden = !isLib;
      }
      if (filePickerTagFiltersWrap && filePickerSearch) {
        filePickerTagFiltersWrap.hidden = isLib;
        filePickerSearch.placeholder = isLib ? "Search My Library…" : "Search title…";
      }
      if (isLib) {
        void refreshMyLibraryStorageBar();
      }
    }

    async function fetchUserStorageUsedBytes(userId) {
      if (!userId) {
        return 0;
      }
      const { data, error } = await supabase
        .from("user_storage_summary")
        .select("*")
        .eq("user_id", userId)
        .limit(1);
      if (error) {
        console.error("user_storage_summary", error);
      }
      const row = Array.isArray(data) && data.length ? data[0] : null;
      if (row && typeof row === "object") {
        const raw =
          row.used_bytes ??
          row.used_bytes_total ??
          row.total_bytes ??
          row.bytes_used ??
          row.sum_file_size ??
          row.storage_used_bytes ??
          row.storage_used ??
          row.used ??
          row.total_used;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) {
          return n;
        }
      }
      const summed = await sumUserAudioBytesFromTable(userId);
      return summed !== null ? summed : 0;
    }

    async function fetchUserAudioRowsForLibrary(userId) {
      if (!userId) {
        return [];
      }
      const { data, error } = await supabase
        .from("user_audio")
        .select("*")
        .eq("user_id", userId)
        .order("title");
      if (error) {
        console.error("user_audio", error);
        return [];
      }
      return Array.isArray(data) ? data : [];
    }

    async function refreshMyLibraryStorageBar() {
      const fillEl = document.getElementById("file-picker-storage-bar-fill");
      const textEl = document.getElementById("file-picker-storage-text");
      const limitMsg = document.getElementById("file-picker-storage-limit-msg");
      const uploadBtn = document.getElementById("file-picker-my-library-upload-btn");
      const storageRow =
        (fillEl && fillEl.closest(".library-storage-row")) ||
        document.querySelector("#file-picker-library-chrome .library-storage-row");
      const uid = filePickerAppBridge.getLastAuthSession()?.user?.id;
      if (!uid) {
        if (storageRow) {
          storageRow.hidden = false;
        }
        if (fillEl) {
          fillEl.style.width = "0%";
        }
        if (textEl) {
          textEl.textContent = "—";
        }
        if (limitMsg) {
          limitMsg.hidden = true;
        }
        if (uploadBtn) {
          uploadBtn.disabled = true;
        }
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tier")
        .eq("id", uid)
        .maybeSingle();
      if (profileError) {
        console.error("profiles tier", profileError);
      }
      const tier = profile?.tier ? String(profile.tier).toLowerCase() : "free";
      if (tier !== "pro") {
        if (storageRow) {
          storageRow.hidden = true;
        }
        if (fillEl) {
          fillEl.style.width = "0%";
        }
        if (textEl) {
          textEl.textContent = "—";
        }
        if (limitMsg) {
          limitMsg.hidden = false;
          limitMsg.textContent =
            "Uploading your own audio is a Pro feature. Upgrade to unlock unlimited storage and custom uploads.";
        }
        if (uploadBtn) {
          uploadBtn.disabled = true;
        }
        return;
      }

      if (storageRow) {
        storageRow.hidden = false;
      }
      const used = await fetchUserStorageUsedBytes(uid);
      const pct = Math.min(100, (used / USER_LIBRARY_QUOTA_BYTES) * 100);
      if (fillEl) {
        fillEl.style.width = `${pct}%`;
      }
      if (textEl) {
        const left = Math.max(0, USER_LIBRARY_QUOTA_BYTES - used);
        textEl.textContent = `${formatBytesShort(used)} used · ${formatBytesShort(left)} free · ${formatBytesShort(USER_LIBRARY_QUOTA_BYTES)} max`;
      }
      const atLimit = used >= USER_LIBRARY_QUOTA_BYTES;
      if (limitMsg) {
        limitMsg.hidden = !atLimit;
        if (atLimit) {
          limitMsg.textContent =
            "Storage limit reached (500 MB). Delete files to upload more.";
        }
      }
      if (uploadBtn) {
        uploadBtn.disabled = atLimit;
      }
    }

    function userUploadRefFromRow(row) {
      const p = userAudioRowStoragePath(row);
      return p ? `${USER_UPLOAD_PREFIX}${p}` : "";
    }

    function parseMoodTagsFromRow(row) {
      const raw = row && (row.mood_tags ?? row.moods ?? row.tags);
      if (Array.isArray(raw)) {
        return raw.map(String);
      }
      if (raw && typeof raw === "object" && raw !== null) {
        try {
          return Object.values(raw).map(String);
        } catch {
          return [];
        }
      }
      if (typeof raw === "string" && raw.trim()) {
        try {
          const j = JSON.parse(raw);
          if (Array.isArray(j)) {
            return j.map(String);
          }
        } catch {
          return raw.split(",").map((s) => s.trim()).filter(Boolean);
        }
      }
      return [];
    }

    function appendMyLibraryFilePickerRow(row) {
      const ref = userUploadRefFromRow(row);
      const useMultiRow = filePickerMultiSelect && filePickerLockedToType === "music";
      const li = document.createElement("li");
      const title = String(row.title || row.filename || "Untitled").trim() || "Untitled";
      const info = document.createElement("div");
      info.className = "file-picker-file-info";
      const titleRow = document.createElement("div");
      titleRow.className = "file-picker-file-title";
      const nameSpan = document.createElement("span");
      nameSpan.className = "file-name";
      nameSpan.textContent = title;
      titleRow.appendChild(nameSpan);
      info.appendChild(titleRow);
      const meta = document.createElement("div");
      meta.className = "file-picker-row-meta";
      meta.textContent = `${String(userAudioRowAudioTypeKey(row) || row.audio_type || "")} · ${formatBytesShort(userAudioRowFileSizeBytes(row))}`;
      const moods = parseMoodTagsFromRow(row);
      if (moods.length) {
        meta.textContent += ` · ${moods.join(", ")}`;
      }
      info.appendChild(meta);

      if (useMultiRow && ref) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "file-picker-multi-check";
        checkbox.checked = filePickerMultiSelectedPaths.has(ref);
        checkbox.setAttribute("aria-label", `Select ${title}`);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            filePickerMultiSelectedPaths.add(ref);
          } else {
            filePickerMultiSelectedPaths.delete(ref);
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
      playButton.setAttribute("aria-label", `Preview ${title}`);
      buildPreviewMyLib(playButton, ref);
      rowActions.appendChild(playButton);

      if (!useMultiRow) {
        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.textContent = "Select";
        selectButton.addEventListener("click", () => {
          if (typeof filePickerOnSelect === "function") {
            filePickerOnSelect(ref);
          }
          closeFilePicker();
        });
        rowActions.appendChild(selectButton);
      }

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "my-library-delete-btn";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => {
        void deleteUserAudioRow(row);
      });
      rowActions.appendChild(delBtn);

      li.appendChild(rowActions);
      filePickerList.appendChild(li);
    }

    async function renderMyLibraryFilePickerList() {
      const query = filePickerSearch.value.trim().toLowerCase();
      filePickerList.innerHTML = "";
      const uid = filePickerAppBridge.getLastAuthSession()?.user?.id;
      if (!uid) {
        const li = document.createElement("li");
        li.textContent = "Sign in to view My Library.";
        filePickerList.appendChild(li);
        syncFilePickerMultiFooter();
        return;
      }
      const rows = await fetchUserAudioRowsForLibrary(uid);
      const filtered = rows.filter((r) => {
        const title = String(r.title || "").toLowerCase();
        return !query || title.includes(query);
      });
      const useMultiRow = filePickerMultiSelect && filePickerLockedToType === "music";
      if (useMultiRow) {
        const refs = filtered.map((r) => userUploadRefFromRow(r)).filter(Boolean);
        filePickerMultiOrderPathsLibrary = refs;
        const allowedLib = new Set(refs);
        for (const p of [...filePickerMultiSelectedPaths]) {
          if (String(p).startsWith(USER_UPLOAD_PREFIX) && !allowedLib.has(p)) {
            filePickerMultiSelectedPaths.delete(p);
          }
        }
      } else if (!filePickerMultiSelect) {
        filePickerMultiOrderPathsLibrary = [];
      }
      const order = ["music", "ambient", "sfx"];
      if (!filtered.length) {
        const emptyItem = document.createElement("li");
        emptyItem.textContent = "No uploaded files yet. Use Upload to add audio.";
        filePickerList.appendChild(emptyItem);
        syncFilePickerMultiFooter();
        return;
      }
      const rendered = new WeakSet();
      for (const audioType of order) {
        const group = filtered.filter((r) => userAudioRowAudioTypeKey(r) === audioType);
        if (!group.length) {
          continue;
        }
        const heading = document.createElement("h4");
        heading.className = "file-picker-library-section";
        heading.textContent =
          audioType === "music" ? "Music" : audioType === "ambient" ? "Ambient" : "SFX";
        filePickerList.appendChild(heading);

        group.forEach((row) => {
          rendered.add(row);
          appendMyLibraryFilePickerRow(row);
        });
      }
      const orphans = filtered.filter((r) => !rendered.has(r));
      if (orphans.length) {
        const heading = document.createElement("h4");
        heading.className = "file-picker-library-section";
        heading.textContent = "Other";
        filePickerList.appendChild(heading);
        orphans.forEach((row) => {
          appendMyLibraryFilePickerRow(row);
        });
      }
      syncFilePickerMultiFooter();
    }

    function buildPreviewMyLib(playButton, ref) {
      playButton.addEventListener("click", () => {
        if (filePickerPreviewAudio && !filePickerPreviewAudio.paused) {
          stopFilePreviewAudio();
        }
        void filePickerAppBridge.resolveAudioPlaybackUrl(ref).then((url) => {
          if (!url) {
            return;
          }
          const preview = new Audio(url);
          preview.volume = 0.7;
          preview.play().catch(() => {
            stopFilePreviewAudio();
          });
          filePickerPreviewAudio = preview;
        });
      });
    }

    async function deleteUserAudioRow(row) {
      const uid = filePickerAppBridge.getLastAuthSession()?.user?.id;
      const rowId = userAudioRowPk(row);
      if (!uid || rowId == null) {
        return;
      }
      const path = userAudioRowStoragePath(row);
      if (
        !window.confirm(
          `Delete "${String(row.title || row.filename || "this file")}"? This cannot be undone.`,
        )
      ) {
        return;
      }
      if (path) {
        const { error: rmErr } = await supabase.storage.from(USER_UPLOAD_BUCKET).remove([path]);
        if (rmErr) {
          console.error("storage remove", rmErr);
          window.alert(`Could not delete file from storage: ${rmErr.message}`);
          return;
        }
        filePickerAppBridge.userUploadSignedUrlCache.delete(path);
      }
      const { error: delErr } = await supabase
        .from("user_audio")
        .delete()
        .eq("id", rowId)
        .eq("user_id", uid);
      if (delErr) {
        window.alert(`Could not delete record: ${delErr.message}`);
        return;
      }
      if (filePickerActiveType === "library") {
        void renderFilePickerList();
        void refreshMyLibraryStorageBar();
      }
    }

    function clearMyLibraryUploadForm() {
      myLibraryUploadSelectedFile = null;
      const errEl = document.getElementById("my-library-upload-error");
      const okEl = document.getElementById("my-library-upload-success");
      const titleIn = document.getElementById("my-library-title-input");
      const fileIn = document.getElementById("my-library-file-input");
      const nameLbl = document.getElementById("my-library-selected-filename");
      const prog = document.getElementById("my-library-upload-progress-wrap");
      if (errEl) {
        errEl.textContent = "";
      }
      if (okEl) {
        okEl.hidden = true;
      }
      if (titleIn) {
        titleIn.value = "";
      }
      if (fileIn) {
        fileIn.value = "";
      }
      if (nameLbl) {
        nameLbl.textContent = "";
      }
      if (prog) {
        prog.hidden = true;
      }
      setMyLibraryUploadProgress(0);
      myLibraryUploadMoodTags.clear();
      renderMyLibraryUploadMoodPills();
    }

    function renderMyLibraryUploadMoodPills() {
      const wrap = document.getElementById("my-library-mood-pills");
      if (!wrap) {
        return;
      }
      wrap.innerHTML = "";
      void AudioLibrary.getReadmeFilterLists().then((readme) => {
        const moods = Array.isArray(readme.all_mood_tags) ? readme.all_mood_tags : [];
        moods.forEach((tag) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "file-picker-tag";
          const on = myLibraryUploadMoodTags.has(tag);
          btn.classList.toggle("active", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
          btn.textContent = tag;
          btn.addEventListener("click", () => {
            if (myLibraryUploadMoodTags.has(tag)) {
              myLibraryUploadMoodTags.delete(tag);
            } else {
              myLibraryUploadMoodTags.add(tag);
            }
            renderMyLibraryUploadMoodPills();
          });
          wrap.appendChild(btn);
        });
      });
    }

    function openMyLibraryUploadPanel() {
      const panel = document.getElementById("my-library-upload-panel");
      if (!panel) {
        return;
      }
      const uid = filePickerAppBridge.getLastAuthSession()?.user?.id;
      if (!uid) {
        filePickerAppBridge.openAuthModal();
        return;
      }
      void fetchUserStorageUsedBytes(uid).then((used) => {
        if (used >= USER_LIBRARY_QUOTA_BYTES) {
          window.alert("Storage limit reached (500 MB). Delete files to upload more.");
          return;
        }
        clearMyLibraryUploadForm();
        panel.hidden = false;
        renderMyLibraryUploadMoodPills();
        document.getElementById("my-library-title-input")?.focus();
      });
    }

    function closeMyLibraryUploadPanel() {
      const panel = document.getElementById("my-library-upload-panel");
      if (panel) {
        panel.hidden = true;
      }
      clearMyLibraryUploadForm();
    }

    function validateMyLibraryFileForUpload(file) {
      if (!file) {
        return "Choose an audio file.";
      }
      if (file.size > USER_UPLOAD_MAX_FILE_BYTES) {
        return "Each file must be 50 MB or smaller.";
      }
      const name = file.name.toLowerCase();
      const extOk =
        name.endsWith(".mp3") || name.endsWith(".ogg") || name.endsWith(".wav");
      if (!extOk) {
        return "Only MP3, OGG, and WAV files are supported.";
      }
      return "";
    }

    function sanitizeUploadStorageFilename(originalName) {
      const base = originalName.replace(/\\/g, "/").split("/").pop() || "audio";
      const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
      return cleaned || "audio";
    }

    function setMyLibraryUploadProgress(pct) {
      const bar = document.getElementById("my-library-upload-progress-bar");
      const label = document.getElementById("my-library-upload-progress-label");
      const n = Math.max(0, Math.min(100, Number(pct) || 0));
      if (bar) {
        bar.style.width = `${n}%`;
      }
      if (label) {
        label.textContent =
          n >= 100 ? "Finishing…" : n > 0 ? `Uploading… ${n}%` : "Uploading…";
      }
    }

    function uploadUserAudioToStorage(objectPath, file, contentType, onProgress) {
      const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
      const apiKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "");
      if (!baseUrl || !apiKey) {
        return Promise.resolve({ error: { message: "Storage is not configured." } });
      }
      return supabase.auth.getSession().then(({ data: { session } }) => {
        const token = session?.access_token;
        if (!token) {
          return { error: { message: "Sign in required." } };
        }
        const pathEncoded = objectPath
          .split("/")
          .map((seg) => encodeURIComponent(seg))
          .join("/");
        const url = `${baseUrl}/storage/v1/object/${USER_UPLOAD_BUCKET}/${pathEncoded}`;
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", url);
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.setRequestHeader("apikey", apiKey);
          xhr.setRequestHeader("Content-Type", contentType);
          xhr.setRequestHeader("Cache-Control", "3600");
          xhr.setRequestHeader("x-upsert", "false");
          xhr.upload.addEventListener("progress", (ev) => {
            if (ev.lengthComputable && onProgress) {
              onProgress(Math.round((ev.loaded / ev.total) * 100));
            }
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              if (onProgress) {
                onProgress(100);
              }
              resolve({ error: null });
              return;
            }
            let message = "Upload failed.";
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed && (parsed.message || parsed.error)) {
                message = String(parsed.message || parsed.error);
              }
            } catch (_) {
              /* ignore */
            }
            resolve({ error: { message } });
          });
          xhr.addEventListener("error", () => {
            resolve({ error: { message: "Upload failed (network error)." } });
          });
          xhr.send(file);
        });
      });
    }

    async function submitMyLibraryUpload() {
      const errEl = document.getElementById("my-library-upload-error");
      const titleIn = document.getElementById("my-library-title-input");
      const typeSel = document.getElementById("my-library-type-select");
      const prog = document.getElementById("my-library-upload-progress-wrap");
      const submitBtn = document.getElementById("my-library-upload-submit");
      const uid = filePickerAppBridge.getLastAuthSession()?.user?.id;
      if (!uid) {
        filePickerAppBridge.openAuthModal();
        return;
      }
      const used = await fetchUserStorageUsedBytes(uid);
      if (used >= USER_LIBRARY_QUOTA_BYTES) {
        if (errEl) {
          errEl.textContent = "Storage limit reached (500 MB).";
        }
        return;
      }
      const file = myLibraryUploadSelectedFile;
      const v = validateMyLibraryFileForUpload(file);
      if (v) {
        if (errEl) {
          errEl.textContent = v;
        }
        return;
      }
      if (errEl) {
        errEl.textContent = "";
      }
      const audioType = normalizeFilePickerAudioType(
        typeSel && typeSel.value ? typeSel.value : "music",
      );
      let title = titleIn && titleIn.value.trim() ? titleIn.value.trim() : "";
      if (!title) {
        title =
          formatAutoLabelFromPath(file.name.replace(/\.[^.]+$/, "")) ||
          file.name;
      }
      const unique = `${Date.now()}_${sanitizeUploadStorageFilename(file.name)}`;
      const objectPath = `${uid}/${audioType}/${unique}`;
      if (used + file.size > USER_LIBRARY_QUOTA_BYTES) {
        if (errEl) {
          errEl.textContent = "Not enough storage space remaining (500 MB quota).";
        }
        return;
      }
      if (prog) {
        prog.hidden = false;
      }
      setMyLibraryUploadProgress(0);
      if (submitBtn) {
        submitBtn.disabled = true;
      }
      const lower = file.name.toLowerCase();
      const contentType =
        file.type && String(file.type).trim()
          ? file.type
          : lower.endsWith(".ogg")
            ? "audio/ogg"
            : lower.endsWith(".wav")
              ? "audio/wav"
              : "audio/mpeg";
      const { error: upErr } = await uploadUserAudioToStorage(
        objectPath,
        file,
        contentType,
        setMyLibraryUploadProgress,
      );
      if (upErr) {
        if (prog) {
          prog.hidden = true;
        }
        if (submitBtn) {
          submitBtn.disabled = false;
        }
        if (errEl) {
          errEl.textContent = upErr.message || "Upload failed.";
        }
        return;
      }
      const moodTagsArr = [...myLibraryUploadMoodTags];
      const { error: insErr } = await supabase.from("user_audio").insert({
        user_id: uid,
        title,
        filename: file.name,
        storage_path: objectPath,
        file_size_bytes: file.size,
        audio_type: audioType,
        mood_tags: moodTagsArr,
      });
      if (insErr) {
        await supabase.storage.from(USER_UPLOAD_BUCKET).remove([objectPath]);
        if (prog) {
          prog.hidden = true;
        }
        if (submitBtn) {
          submitBtn.disabled = false;
        }
        if (errEl) {
          errEl.textContent = insErr.message || "Could not save upload metadata.";
        }
        return;
      }
      if (prog) {
        prog.hidden = true;
      }
      if (submitBtn) {
        submitBtn.disabled = false;
      }
      closeMyLibraryUploadPanel();
      void renderFilePickerList();
      void refreshMyLibraryStorageBar();
    }

    function wireMyLibraryUploadUi() {
      const panel = document.getElementById("my-library-upload-panel");
      const drop = document.getElementById("my-library-drop-zone");
      const fileIn = document.getElementById("my-library-file-input");
      const browse = document.getElementById("my-library-browse-btn");
      const cancel = document.getElementById("my-library-upload-cancel");
      const submit = document.getElementById("my-library-upload-submit");
      const uploadOpen = document.getElementById("file-picker-my-library-upload-btn");
      const titleIn = document.getElementById("my-library-title-input");

      const assignFile = (f) => {
        myLibraryUploadSelectedFile = f;
        const errEl = document.getElementById("my-library-upload-error");
        if (errEl) {
          errEl.textContent = "";
        }
        const nameLbl = document.getElementById("my-library-selected-filename");
        if (nameLbl) {
          nameLbl.textContent = f ? `${f.name} (${formatBytesShort(f.size)})` : "";
        }
        if (f && titleIn && !titleIn.value.trim()) {
          titleIn.value = formatAutoLabelFromPath(f.name.replace(/\.[^.]+$/, "")) || f.name;
        }
      };

      if (browse && fileIn) {
        browse.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          fileIn.click();
        });
      }
      if (fileIn) {
        fileIn.addEventListener("change", () => {
          const f = fileIn.files && fileIn.files[0] ? fileIn.files[0] : null;
          assignFile(f);
        });
      }
      if (drop && fileIn) {
        drop.addEventListener("click", (e) => {
          if (e.target === browse || e.target.closest("#my-library-browse-btn")) {
            return;
          }
          fileIn.click();
        });
        drop.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileIn.click();
          }
        });
        ["dragenter", "dragover"].forEach((ev) => {
          drop.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            drop.classList.add("my-library-drop-zone--active");
          });
        });
        drop.addEventListener("dragleave", (e) => {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.remove("my-library-drop-zone--active");
        });
        drop.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.remove("my-library-drop-zone--active");
          const f =
            e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
              ? e.dataTransfer.files[0]
              : null;
          assignFile(f || null);
        });
      }
      if (cancel) {
        cancel.addEventListener("click", () => {
          closeMyLibraryUploadPanel();
        });
      }
      if (submit) {
        submit.addEventListener("click", () => {
          void submitMyLibraryUpload();
        });
      }
      if (uploadOpen) {
        uploadOpen.addEventListener("click", () => {
          const uid = filePickerAppBridge.getLastAuthSession()?.user?.id;
          if (!uid) {
            filePickerAppBridge.openAuthModal();
            return;
          }
          openMyLibraryUploadPanel();
        });
      }
      if (panel) {
        panel.addEventListener("click", (e) => {
          const t = e.target;
          if (t === panel || (t instanceof Element && t.classList.contains("my-library-upload-panel-backdrop"))) {
            closeMyLibraryUploadPanel();
          }
        });
      }
    }

    async function renderFilePickerFilters() {
      filePickerTagFiltersWrap.innerHTML = "";
      syncFilePickerLibraryChrome();

      if (filePickerActiveType === "library") {
        return;
      }

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

      if (filePickerActiveType === "ambient") {
        const ambientLayerTooltips = {
          base: "The acoustic character of the space itself. What kind of place are we in.",
          texture: "Movement and detail within the space. Wind, water, fire, weather.",
          foreground: "The closest most identifiable sounds. Creatures, crowds, specific activity.",
        };
        const group = document.createElement("div");
        group.className = "file-picker-filter-step";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "Ambient layer");
        const label = document.createElement("p");
        label.className = "file-picker-tag-filters-label";
        label.textContent = "Layer";
        group.appendChild(label);
        ["base", "texture", "foreground"].forEach((layerKey) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "file-picker-tag";
          btn.textContent = layerKey.charAt(0).toUpperCase() + layerKey.slice(1);
          btn.title = ambientLayerTooltips[layerKey];
          const active = filePickerSelectedAmbientLayer === layerKey;
          btn.setAttribute("aria-pressed", active ? "true" : "false");
          if (active) {
            btn.classList.add("active");
          }
          btn.addEventListener("click", () => {
            filePickerSelectedAmbientLayer = active ? null : layerKey;
            void renderFilePickerFilters();
            void renderFilePickerList();
          });
          group.appendChild(btn);
        });
        filePickerTagFiltersWrap.appendChild(group);
        appendFilePickerClearButton(filePickerTagFiltersWrap);
        return;
      }

      const files = await AudioLibrary.listFiles(filePickerActiveType);
      pruneFilePickerMoodIfStale(files, readme.all_mood_tags);

      if (filePickerActiveType === "music") {
        appendFilePickerFavoritesToggle(filePickerTagFiltersWrap);
        const lyricsGroup = document.createElement("div");
        lyricsGroup.className = "file-picker-filter-step";
        lyricsGroup.setAttribute("role", "group");
        lyricsGroup.setAttribute("aria-label", "Lyrics filter");
        const lyricsLabel = document.createElement("p");
        lyricsLabel.className = "file-picker-tag-filters-label";
        lyricsLabel.textContent = "Lyrics";
        lyricsGroup.appendChild(lyricsLabel);
        const lyricsBtn = document.createElement("button");
        lyricsBtn.type = "button";
        lyricsBtn.className = "file-picker-lyrics-toggle";
        const lyricsStates = [
          { value: null,   label: "All" },
          { value: "only", label: "Lyrics" },
          { value: "hide", label: "No Lyrics" },
        ];
        const syncLyricsBtn = () => {
          const state = lyricsStates.find(s => s.value === filePickerLyricsFilter) || lyricsStates[0];
          lyricsBtn.textContent = state.label;
          lyricsBtn.classList.toggle("active", filePickerLyricsFilter !== null);
          lyricsBtn.setAttribute("aria-pressed", filePickerLyricsFilter !== null ? "true" : "false");
        };
        syncLyricsBtn();
        lyricsBtn.addEventListener("click", () => {
          const idx = lyricsStates.findIndex(s => s.value === filePickerLyricsFilter);
          filePickerLyricsFilter = lyricsStates[(idx + 1) % lyricsStates.length].value;
          syncLyricsBtn();
          void renderFilePickerList();
        });
        lyricsGroup.appendChild(lyricsBtn);
        filePickerTagFiltersWrap.appendChild(lyricsGroup);
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

    /** Paths in current filtered list order (for multi-add), per tab. */
    let filePickerMultiOrderPathsMusic = [];
    let filePickerMultiOrderPathsLibrary = [];

    async function renderFilePickerList() {
      if (filePickerActiveType === "library") {
        await renderMyLibraryFilePickerList();
        return;
      }
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
          if (String(p).startsWith(USER_UPLOAD_PREFIX)) {
            continue;
          }
          if (!allowed.has(p)) {
            filePickerMultiSelectedPaths.delete(p);
          }
        }
        filePickerMultiOrderPathsMusic = filtered.map((f) => f.manifestPath);
      } else if (!filePickerMultiSelect) {
        filePickerMultiOrderPathsMusic = [];
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
      const next = audioType === "library" ? "library" : normalizeFilePickerAudioType(audioType);
      filePickerActiveType = next;
      if (next !== "library") {
        filePickerSelectedSetting = null;
        filePickerSelectedMood = null;
        filePickerSelectedSfxSection = null;
        filePickerSelectedAmbientLayer = null;
        filePickerFavoritesOnly = false;
        filePickerLyricsFilter = null;
        filePickerMyTagFilter = null;
      }
      filePickerTabs.querySelectorAll(".file-picker-tab").forEach((button) => {
        button.classList.toggle("active", button.dataset.audioType === next);
      });
      syncFilePickerChromeForLockState();
      syncFilePickerLibraryChrome();
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
      filePickerMultiOrderPathsMusic = [];
      filePickerMultiOrderPathsLibrary = [];
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
      closeMyLibraryUploadPanel();
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
      filePickerMultiOrderPathsMusic = [];
      filePickerMultiOrderPathsLibrary = [];
      syncFilePickerChromeForLockState();
      syncFilePickerMultiFooter();
    }
    filePickerTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".file-picker-tab");
      if (!tab) {
        return;
      }
      const audioType = tab.dataset.audioType;
      if (!audioType) {
        return;
      }
      if (filePickerLockedToType) {
        if (audioType !== "library" && audioType !== filePickerLockedToType) {
          return;
        }
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
      const set = filePickerMultiSelectedPaths;
      const paths = [
        ...filePickerMultiOrderPathsMusic.filter((p) => set.has(p)),
        ...filePickerMultiOrderPathsLibrary.filter((p) => set.has(p)),
      ];
      if (!paths.length || typeof filePickerOnSelect !== "function") {
        return;
      }
      filePickerOnSelect(paths);
      closeFilePicker();
    });

    filePickerBackdrop.addEventListener("click", (e) => {
      if (e.target === filePickerBackdrop) {
        closeFilePicker();
      }
    });

Favorites.subscribe((type) => {
  if (type === "music") {
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
  if (filePickerBackdrop && filePickerBackdrop.classList.contains("open")) {
    syncFilePickerChromeForLockState();
    void renderFilePickerFilters();
    void renderFilePickerList();
  }
});

openFilePicker.configure = (bridge) => {
  filePickerAppBridge = bridge;
  wireMyLibraryUploadUi();
};

openFilePicker.refreshIfOpen = () => {
  if (filePickerBackdrop && filePickerBackdrop.classList.contains("open")) {
    syncFilePickerChromeForLockState();
    void renderFilePickerFilters();
    void renderFilePickerList();
  }
};

openFilePicker.onSignedOut = () => {
  if (filePickerActiveType === "library") {
    filePickerActiveType = "music";
  }
  openFilePicker.refreshIfOpen();
};

export { openFilePicker, closeFilePicker, renderFilePickerList };
