const STORAGE_KEY = "tour-completed";
const TOTAL_STEPS = 7;
const AUTO_START_DELAY_MS = 1000;
const HIGHLIGHT_PAD = 6;

const STEPS = [
  {
    kind: "welcome",
    title: "Welcome to DnD Mood Builder",
    body:
      "Your complete audio soundboard for tabletop RPG sessions. This quick tour shows you the key features — takes about 30 seconds.",
  },
  {
    kind: "spotlight",
    targetId: "tour-target-scenes",
    title: "Sessions and Scenes",
    body:
      "Scenes are your mood presets. Each one loads a complete atmosphere — music playlist and ambient layers in one tap. Build your own scenes with the + New Scene. Sessions are a collection of your scenes. Sign in to save scenes across devices. Free accounts get one session and 5 scenes",
  },
  {
    kind: "spotlight",
    targetId: "tour-target-music",
    title: "Music Playlist",
    body:
      "Each scene has its own playlist of original tracks. Hit play and the music runs continuously, auto-advancing through the queue. Use the volume slider to mix it with your ambience. Tracks can be added when you create a new scene.",
  },
  {
    kind: "spotlight",
    targetId: "tour-target-ambient",
    title: "Ambient Layers",
    body:
      "Layer looping background sounds under your music. Toggle each layer on or off and adjust individual volumes to build the perfect atmosphere. All layers can be started at once for instant ambience. When creating a new scene you can select tracks and set initial volume level.",
  },
  {
    kind: "spotlight",
    targetId: "tour-target-sfx",
    title: "Sound Effects",
    body:
      "Fire one-shot sound effects at any moment — sword clashes, spell blasts, dramatic stings. Filter by type and search by name. They play on top of your music and ambience.",
  },
  {
    kind: "spotlight",
    targetId: "topbar-account",
    title: "Save Your Work",
    body:
      "Sign in to save your custom scenes across devices and sessions. Set personalized filter tags. Free accounts get 5 saved scenes. Your scenes are waiting for you every time you return.",
  },
  {
    kind: "complete",
    title: "You are ready",
    body: "Start by building your own scene. Tap + New Scene, browse tracks, hit play, and set the mood.",
  },
];

function todayStorageValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function markTourCompleted() {
  try {
    localStorage.setItem(STORAGE_KEY, todayStorageValue());
  } catch {
    /* ignore quota / private mode */
  }
}

function isTourCompleted() {
  try {
    return localStorage.getItem(STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function buildTourDom() {
  const root = document.createElement("div");
  root.id = "product-tour-root";
  root.className = "product-tour";
  root.setAttribute("role", "presentation");
  root.hidden = true;

  root.innerHTML = `
    <div class="product-tour-dim-full" aria-hidden="true"></div>
    <div class="product-tour-dim-panels" aria-hidden="true">
      <div class="product-tour-dim product-tour-dim-top"></div>
      <div class="product-tour-dim product-tour-dim-left"></div>
      <div class="product-tour-dim product-tour-dim-right"></div>
      <div class="product-tour-dim product-tour-dim-bottom"></div>
    </div>
    <div class="product-tour-highlight-ring" aria-hidden="true" hidden></div>
    <div class="product-tour-modal" hidden role="dialog" aria-modal="true" aria-labelledby="product-tour-modal-title">
      <div class="product-tour-modal-panel">
        <h2 id="product-tour-modal-title" class="product-tour-modal-title"></h2>
        <p class="product-tour-modal-body"></p>
        <div class="product-tour-modal-actions">
          <button type="button" class="product-tour-btn product-tour-btn-secondary" id="product-tour-modal-secondary"></button>
          <button type="button" class="product-tour-btn product-tour-btn-primary" id="product-tour-modal-primary"></button>
        </div>
        <button type="button" class="product-tour-skip-link" id="product-tour-modal-skip">Skip tour</button>
      </div>
    </div>
    <div class="product-tour-tooltip" hidden role="dialog" aria-modal="true" aria-labelledby="product-tour-tooltip-title">
      <div class="product-tour-tooltip-box">
        <div class="product-tour-tooltip-arrow" aria-hidden="true"></div>
        <h2 id="product-tour-tooltip-title" class="product-tour-tooltip-title"></h2>
        <p class="product-tour-tooltip-body"></p>
        <div class="product-tour-tooltip-meta">
          <span class="product-tour-step-label"></span>
          <button type="button" class="product-tour-skip-link" id="product-tour-tooltip-skip">Skip tour</button>
        </div>
        <div class="product-tour-tooltip-nav">
          <button type="button" class="product-tour-btn product-tour-btn-secondary" id="product-tour-back">Back</button>
          <button type="button" class="product-tour-btn product-tour-btn-primary" id="product-tour-next">Next</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  return {
    root,
    dimFull: root.querySelector(".product-tour-dim-full"),
    dimPanels: root.querySelector(".product-tour-dim-panels"),
    dims: {
      top: root.querySelector(".product-tour-dim-top"),
      left: root.querySelector(".product-tour-dim-left"),
      right: root.querySelector(".product-tour-dim-right"),
      bottom: root.querySelector(".product-tour-dim-bottom"),
    },
    highlightRing: root.querySelector(".product-tour-highlight-ring"),
    modal: root.querySelector(".product-tour-modal"),
    modalActions: root.querySelector(".product-tour-modal-actions"),
    modalTitle: root.querySelector(".product-tour-modal-title"),
    modalBody: root.querySelector(".product-tour-modal-body"),
    modalPrimary: root.querySelector("#product-tour-modal-primary"),
    modalSecondary: root.querySelector("#product-tour-modal-secondary"),
    modalSkip: root.querySelector("#product-tour-modal-skip"),
    tooltip: root.querySelector(".product-tour-tooltip"),
    tooltipTitle: root.querySelector(".product-tour-tooltip-title"),
    tooltipBody: root.querySelector(".product-tour-tooltip-body"),
    stepLabel: root.querySelector(".product-tour-step-label"),
    tooltipSkip: root.querySelector("#product-tour-tooltip-skip"),
    backBtn: root.querySelector("#product-tour-back"),
    nextBtn: root.querySelector("#product-tour-next"),
  };
}

function setAppInert(on) {
  const shell = document.querySelector(".app-shell");
  if (!shell) {
    return;
  }
  if (on) {
    shell.setAttribute("inert", "");
  } else {
    shell.removeAttribute("inert");
  }
}

/**
 * @param {{ helpButton: HTMLButtonElement | null }} opts
 */
export function initProductTour(opts) {
  const helpButton = opts && opts.helpButton ? opts.helpButton : null;
  const ui = buildTourDom();
  const { root, dimFull, dimPanels, dims, highlightRing, modal, tooltip } = ui;

  let stepIndex = 0;
  let autoTimer = null;
  let layoutRaf = 0;

  function cancelAutoTimer() {
    if (autoTimer != null) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  function closeTour() {
    cancelAutoTimer();
    if (layoutRaf) {
      cancelAnimationFrame(layoutRaf);
      layoutRaf = 0;
    }
    root.hidden = true;
    root.classList.remove("product-tour--open");
    setAppInert(false);
    helpButton?.removeAttribute("aria-expanded");
  }

  function applyDimPanels(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const t = Math.max(0, rect.top);
    const l = Math.max(0, rect.left);
    const r = Math.min(vw, rect.right);
    const b = Math.min(vh, rect.bottom);
    const topH = t;
    const leftW = l;
    const rightW = vw - r;
    const bottomH = vh - b;

    Object.assign(dims.top.style, {
      height: `${topH}px`,
      top: "0",
      left: "0",
      width: "100%",
    });
    Object.assign(dims.left.style, {
      top: `${topH}px`,
      left: "0",
      width: `${leftW}px`,
      height: `${b - topH}px`,
    });
    Object.assign(dims.right.style, {
      top: `${topH}px`,
      left: `${r}px`,
      width: `${rightW}px`,
      height: `${b - topH}px`,
    });
    Object.assign(dims.bottom.style, {
      top: `${b}px`,
      left: "0",
      width: "100%",
      height: `${bottomH}px`,
    });
  }

  function positionHighlightRing(rect) {
    const pad = HIGHLIGHT_PAD;
    Object.assign(highlightRing.style, {
      top: `${rect.top - pad}px`,
      left: `${rect.left - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
  }

  function positionTooltip(targetRect) {
    const margin = 12;
    const gap = 10;
    const tip = tooltip.querySelector(".product-tour-tooltip-box");
    if (!tip) {
      return;
    }
    tip.classList.remove(
      "product-tour-tooltip-box--arrow-top",
      "product-tour-tooltip-box--arrow-bottom",
      "product-tour-tooltip-box--arrow-left",
      "product-tour-tooltip-box--arrow-right"
    );

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isMobile = isMobileLayout();

    tip.style.maxWidth = isMobile ? `calc(100vw - ${margin * 2}px)` : "min(380px, calc(100vw - 24px))";
    tip.style.width = isMobile ? `calc(100vw - ${margin * 2}px)` : "";

    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    let top;
    let left;
    let arrowClass;

    if (isMobile) {
      const spaceBelow = vh - targetRect.bottom - margin;
      const placeBelow = spaceBelow >= th + gap || targetRect.top < vh / 2;
      if (placeBelow) {
        top = Math.min(vh - th - margin, targetRect.bottom + gap);
        arrowClass = "product-tour-tooltip-box--arrow-top";
      } else {
        top = Math.max(margin, targetRect.top - th - gap);
        arrowClass = "product-tour-tooltip-box--arrow-bottom";
      }
      left = Math.max(margin, Math.min(vw - tw - margin, targetRect.left + targetRect.width / 2 - tw / 2));
    } else {
      const preferRight = targetRect.right + gap + tw + margin <= vw;
      const preferLeft = targetRect.left - gap - tw - margin >= 0;
      if (preferRight) {
        left = targetRect.right + gap;
        top = Math.max(margin, Math.min(vh - th - margin, targetRect.top + targetRect.height / 2 - th / 2));
        arrowClass = "product-tour-tooltip-box--arrow-left";
      } else if (preferLeft) {
        left = targetRect.left - gap - tw;
        top = Math.max(margin, Math.min(vh - th - margin, targetRect.top + targetRect.height / 2 - th / 2));
        arrowClass = "product-tour-tooltip-box--arrow-right";
      } else {
        const spaceBelow = vh - targetRect.bottom - margin;
        const placeBelow = spaceBelow >= th + gap;
        if (placeBelow) {
          top = Math.min(vh - th - margin, targetRect.bottom + gap);
          arrowClass = "product-tour-tooltip-box--arrow-top";
        } else {
          top = Math.max(margin, targetRect.top - th - gap);
          arrowClass = "product-tour-tooltip-box--arrow-bottom";
        }
        left = Math.max(margin, Math.min(vw - tw - margin, targetRect.left + targetRect.width / 2 - tw / 2));
      }
    }

    tip.classList.add(arrowClass);
    tip.style.position = "fixed";
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  function layoutSpotlight() {
    const step = STEPS[stepIndex];
    if (step.kind !== "spotlight") {
      return;
    }
    const el = document.getElementById(step.targetId);
    if (!el) {
      return;
    }
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) {
      return;
    }
    const padded = {
      top: rect.top - HIGHLIGHT_PAD,
      left: rect.left - HIGHLIGHT_PAD,
      right: rect.right + HIGHLIGHT_PAD,
      bottom: rect.bottom + HIGHLIGHT_PAD,
      width: rect.width + HIGHLIGHT_PAD * 2,
      height: rect.height + HIGHLIGHT_PAD * 2,
    };
    applyDimPanels(padded);
    positionHighlightRing(rect);
    positionTooltip(rect);
  }

  function scheduleLayout() {
    if (layoutRaf) {
      cancelAnimationFrame(layoutRaf);
    }
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        layoutSpotlight();
      });
    });
  }

  function render() {
    const step = STEPS[stepIndex];
    dimFull.style.display = "none";
    dimPanels.style.display = "none";
    highlightRing.hidden = true;
    modal.hidden = true;
    tooltip.hidden = true;

    if (step.kind === "welcome" || step.kind === "complete") {
      dimFull.style.display = "block";
      modal.hidden = false;
      ui.modalTitle.textContent = step.title;
      ui.modalBody.textContent = step.body;
      ui.modalSkip.hidden = false;
      ui.modalActions.classList.toggle("product-tour-modal-actions--single", step.kind === "complete");
      if (step.kind === "welcome") {
        ui.modalPrimary.textContent = "Start Tour";
        ui.modalSecondary.textContent = "Skip";
        ui.modalSecondary.hidden = false;
      } else {
        ui.modalPrimary.textContent = "Let's go";
        ui.modalSecondary.hidden = true;
      }
      return;
    }

    dimPanels.style.display = "block";
    highlightRing.hidden = false;
    tooltip.hidden = false;
    ui.tooltipTitle.textContent = step.title;
    ui.tooltipBody.textContent = step.body;
    ui.stepLabel.textContent = `Step ${stepIndex + 1} of ${TOTAL_STEPS}`;

    scheduleLayout();
  }

  function openTourAt(startStep) {
    cancelAutoTimer();
    stepIndex = Math.max(0, Math.min(TOTAL_STEPS - 1, startStep));
    root.hidden = false;
    root.classList.add("product-tour--open");
    setAppInert(true);
    helpButton?.setAttribute("aria-expanded", "true");
    render();
    if (STEPS[stepIndex].kind === "spotlight") {
      scheduleLayout();
    }
    window.setTimeout(() => {
      const step = STEPS[stepIndex];
      if (step.kind === "welcome" || step.kind === "complete") {
        ui.modalPrimary.focus();
      } else {
        ui.nextBtn.focus();
      }
    }, 0);
  }

  function finishTour() {
    markTourCompleted();
    closeTour();
  }

  function goNext() {
    if (stepIndex >= TOTAL_STEPS - 1) {
      finishTour();
      return;
    }
    stepIndex += 1;
    render();
    if (STEPS[stepIndex].kind === "spotlight") {
      scheduleLayout();
    } else if (STEPS[stepIndex].kind === "complete") {
      ui.modalPrimary.focus();
    }
  }

  function goBack() {
    if (stepIndex <= 0) {
      return;
    }
    stepIndex -= 1;
    render();
    if (STEPS[stepIndex].kind === "spotlight") {
      scheduleLayout();
    } else if (STEPS[stepIndex].kind === "welcome") {
      ui.modalPrimary.focus();
    }
  }

  ui.modalPrimary.addEventListener("click", () => {
    const step = STEPS[stepIndex];
    if (step.kind === "welcome") {
      stepIndex = 1;
      render();
      scheduleLayout();
      ui.nextBtn.focus();
      return;
    }
    if (step.kind === "complete") {
      finishTour();
    }
  });

  ui.modalSecondary.addEventListener("click", () => {
    const step = STEPS[stepIndex];
    if (step.kind === "welcome") {
      finishTour();
    }
  });

  ui.modalSkip.addEventListener("click", () => {
    finishTour();
  });

  ui.nextBtn.addEventListener("click", () => {
    goNext();
  });

  ui.backBtn.addEventListener("click", () => {
    goBack();
  });

  ui.tooltipSkip.addEventListener("click", () => {
    finishTour();
  });

  function onResizeOrScroll() {
    if (!root.classList.contains("product-tour--open")) {
      return;
    }
    if (STEPS[stepIndex].kind === "spotlight") {
      scheduleLayout();
    }
  }

  window.addEventListener("resize", onResizeOrScroll);
  document.addEventListener("scroll", onResizeOrScroll, true);

  if (helpButton) {
    helpButton.addEventListener("click", () => {
      openTourAt(0);
    });
  }

  if (!isTourCompleted()) {
    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      if (!root.classList.contains("product-tour--open")) {
        openTourAt(0);
      }
    }, AUTO_START_DELAY_MS);
  }

  return { openTour: () => openTourAt(0), closeTour };
}
