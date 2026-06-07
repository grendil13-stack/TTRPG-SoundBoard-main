import { supabase } from "../supabase.js";

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

    function normalizeSuggestedCategory(raw) {
      const s = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ");
      if (!s) {
        return null;
      }
      if (s.includes("moment")) {
        return "Moment";
      }
      if (s.includes("quality")) {
        return "Quality";
      }
      if (s.includes("campaign")) {
        return "Campaign";
      }
      return null;
    }

    async function loadSuggestedTagsOnce() {
      if (suggestedTagsLoaded) {
        return;
      }
      const { data, error } = await supabase
        .from("suggested_tags")
        .select("tag, category")
        .order("tag");
      if (error) {
        console.error("suggested_tags load error (full)", error);
        try {
          console.error(
            "suggested_tags load error (JSON)",
            JSON.stringify(error, Object.getOwnPropertyNames(error)),
          );
        } catch {
          /* ignore */
        }
        return;
      }
      const buckets = { Moment: [], Quality: [], Campaign: [] };
      for (const row of data || []) {
        const tag = String(row.tag || "").trim();
        if (!tag) {
          continue;
        }
        const cat = normalizeSuggestedCategory(row.category);
        if (cat && buckets[cat]) {
          buckets[cat].push({ tag, category: cat });
        } else if (String(row.category || "").trim()) {
          console.warn(
            "suggested_tags: skipped row (unknown category)",
            { tag, category: row.category },
          );
        }
      }
      suggestedTagsByCategory = buckets;
      suggestedTagsLoaded = true;
    }

    /** Tracks the tag popover instance while open; null when removed from DOM. */
    let userTagPopoverWrap = null;
    /** @type {HTMLElement | null} */
    let userTagPopoverAnchor = null;
    /** @type {string | null} */
    let userTagPopoverAudioId = null;
    let userTagPopoverDocMousedown = null;

    /**
     * POPOVER CREATED ONLY ON USER CLICK — DO NOT MOVE OR CALL ELSEWHERE.
     * Builds a new popover DOM tree; must only be invoked from openUserTagPopover (tag button click).
     */
    function createUserTagPopoverDomForUserClick() {
      const wrap = document.createElement("div");
      wrap.className = "user-tag-popover";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-label", "Personal tags");
      wrap.tabIndex = -1;

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
        userTagPopoverAnchor = null;
        userTagPopoverAudioId = null;
        if (userTagPopoverDocMousedown) {
          document.removeEventListener("mousedown", userTagPopoverDocMousedown, true);
          userTagPopoverDocMousedown = null;
        }
        if (wrap.parentNode) {
          wrap.remove();
        }
        if (userTagPopoverWrap === wrap) {
          userTagPopoverWrap = null;
        }
      };

      const ensurePopoverOnBody = () => {
        if (wrap.parentElement !== document.body) {
          document.body.appendChild(wrap);
        }
      };

      const positionNear = (anchor) => {
        if (!anchor || !wrap.isConnected) {
          return;
        }
        ensurePopoverOnBody();
        wrap.style.position = "fixed";
        const vv = window.visualViewport;
        const margin = 8;
        const gap = 8;
        const r = anchor.getBoundingClientRect();
        const ox = vv ? vv.offsetLeft : 0;
        const oy = vv ? vv.offsetTop : 0;
        const vw = vv ? vv.width : window.innerWidth;
        const vh = vv ? vv.height : window.innerHeight;
        const rightLimit = ox + vw - margin;
        const bottomLimit = oy + vh - margin;
        const leftLimit = ox + margin;
        const topLimit = oy + margin;

        const br = wrap.getBoundingClientRect();
        const pw = Math.max(br.width, wrap.offsetWidth, 200);
        const ph = Math.max(br.height, wrap.offsetHeight, 80);

        let left;
        let top;

        if (r.right + gap + pw <= rightLimit) {
          left = r.right + gap;
          top = r.top;
        } else if (r.left - gap - pw >= leftLimit) {
          left = r.left - gap - pw;
          top = r.top;
        } else {
          left = Math.min(Math.max(r.left, leftLimit), rightLimit - pw);
          top = r.bottom + gap;
          if (top + ph > bottomLimit) {
            top = r.top - gap - ph;
          }
        }

        if (top + ph > bottomLimit) {
          top = bottomLimit - ph;
        }
        if (top < topLimit) {
          top = topLimit;
        }
        if (left + pw > rightLimit) {
          left = rightLimit - pw;
        }
        if (left < leftLimit) {
          left = leftLimit;
        }

        wrap.style.left = `${Math.round(left)}px`;
        wrap.style.top = `${Math.round(top)}px`;
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
        ensurePopoverOnBody();
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
      wrap._ensureOnBody = ensurePopoverOnBody;
      wrap._input = input;
      wrap._refresh = refreshContents;
      return wrap;
    }

    async function openUserTagPopover(anchorEl, audioId) {
      if (!anchorEl || !(anchorEl instanceof Element) || !anchorEl.isConnected) {
        return;
      }
      await loadSuggestedTagsOnce();
      if (userTagPopoverWrap && typeof userTagPopoverWrap._close === "function") {
        userTagPopoverWrap._close();
      }
      const wrap = createUserTagPopoverDomForUserClick();
      if (typeof wrap._ensureOnBody === "function") {
        wrap._ensureOnBody();
      }
      wrap.style.visibility = "hidden";
      wrap.style.pointerEvents = "none";
      userTagPopoverAnchor = anchorEl;
      userTagPopoverAudioId = audioId != null ? String(audioId) : null;
      wrap.style.visibility = "hidden";
      wrap.style.pointerEvents = "none";
      await wrap._refresh();
      wrap._positionNear(anchorEl);
      wrap.style.visibility = "";
      wrap.style.pointerEvents = "";
      window.requestAnimationFrame(() => {
        void supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user && wrap._input && wrap.isConnected) {
            wrap._input.focus();
          }
        });
      });
      if (userTagPopoverDocMousedown) {
        document.removeEventListener("mousedown", userTagPopoverDocMousedown, true);
      }
      userTagPopoverDocMousedown = (e) => {
        if (
          !wrap.isConnected ||
          !e.target ||
          wrap.contains(e.target) ||
          e.target === anchorEl ||
          anchorEl.contains(e.target)
        ) {
          return;
        }
        wrap._close();
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

UserTags.subscribe(() => {
  if (
    userTagPopoverWrap &&
    userTagPopoverWrap.isConnected &&
    typeof userTagPopoverWrap._refresh === "function"
  ) {
    void userTagPopoverWrap._refresh();
  }
});

export { UserTags, loadSuggestedTagsOnce, createUserTagButton, openUserTagPopover };
