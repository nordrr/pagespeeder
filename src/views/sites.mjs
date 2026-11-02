// Owns the site library DOM and pointer/touch reordering state.
// selection exposes selectedSiteUrl and openSiteMenuUrl getters/setters shared with the app.
export function createSitesView({
  state, selection, getOrderedTrackerUrls, getOrderedTrackers, persistState, render,
  hideTooltip, updateConnectedEdgeShadow, createConnectedEdgeShadow, parseUrlSafe,
  describeTrackerStatus, getSummaryBackgroundColor, addConfidenceRange, formatGoalEstimate,
  baselineDelta, setBaselineDeltaLabel, closeRunDetailPanel, setWorkspaceView,
  beginLabelEditing, openRemoveSiteDialog, stopTracker, startTracker, ensureApiKeyConfigured,
  iconMarkup, ellipsisSvg, playSvg, pauseSvg, ICON_BASELINE,
}) {
let siteDrag = null;
let siteListNeedsRefresh = false;
let suppressSiteClick = false;
const libraryAdd = document.querySelector(".library-add");
const library = document.querySelector(".site-library");
createConnectedEdgeShadow(library, "site-edge");
new ResizeObserver(() => {
  library.style.setProperty("--add-panel-height", `${libraryAdd.offsetHeight}px`);
  document.querySelector("main").style.setProperty("--add-panel-height", `${libraryAdd.offsetHeight}px`);
}).observe(libraryAdd);
new ResizeObserver(positionSiteSelection).observe(library);
document.getElementById("site-list").addEventListener("scroll", () => {
  syncSiteSeam();
  const menu = document.querySelector(".site-menu[open]");
  if (menu) positionSiteMenu(menu);
}, { passive: true });
window.addEventListener("resize", () => {
  const menu = document.querySelector(".site-menu[open]");
  if (menu) positionSiteMenu(menu);
});
document.getElementById("site-selection").addEventListener("transitionrun", (event) => {
  if (event.propertyName === "transform") followSiteSeam(event.currentTarget);
});

function syncSiteSeam() {
  const selection = document.getElementById("site-selection");
  if (selection.hidden) return;
  const bounds = selection.getBoundingClientRect();
  const libraryBounds = library.getBoundingClientRect();
  updateConnectedEdgeShadow(library, bounds.top - libraryBounds.top, bounds.bottom - libraryBounds.top, bounds.left - libraryBounds.left);
}

function followSiteSeam(selection) {
  syncSiteSeam();
  if (!selection.hidden && selection.getAnimations().some((animation) => animation.playState === "running")) {
    requestAnimationFrame(() => followSiteSeam(selection));
  }
}

function positionSiteSelection() {
  const list = document.getElementById("site-list");
  const selection = document.getElementById("site-selection");
  const selected = list.querySelector(".site-row.is-selected");
  if (!selected || !list.getClientRects().length) {
    selection.hidden = true;
    updateConnectedEdgeShadow(library, 0, 0, 0);
    return;
  }
  const listBounds = list.getBoundingClientRect();
  const rowBounds = selected.getBoundingClientRect();
  selection.style.height = `${rowBounds.height}px`;
  selection.style.transform = `translateY(${rowBounds.top - listBounds.top + list.scrollTop}px)`;
  selection.hidden = false;
  syncSiteSeam();
}

function positionSiteMenu(menu) {
  const trigger = menu.querySelector("summary").getBoundingClientRect();
  const items = menu.querySelector(".site-menu-items");
  const listBounds = document.getElementById("site-list").getBoundingClientRect();
  const bottom = Math.min(listBounds.bottom, libraryAdd.getBoundingClientRect().top, window.innerHeight);
  const availableBelow = bottom - trigger.bottom - 5;
  const availableAbove = trigger.top - Math.max(0, listBounds.top) - 5;
  menu.classList.toggle("opens-up", availableBelow < items.offsetHeight && availableAbove > availableBelow);
}

function moveSiteDrag(event) {
  if (!siteDrag || event.pointerId !== siteDrag.pointerId) return;
  const drag = siteDrag;
  drag.clientY = event.clientY;
  if (!drag.active && Math.abs(event.clientY - drag.startY) < 5) return;
  if (!drag.active) {
    drag.active = true;
    suppressSiteClick = true;
    hideTooltip();
    document.body.classList.add("site-dragging");
    drag.row.classList.add("is-reordering");
    requestAnimationFrame(followSiteDrag);
  }
  event.preventDefault();
  const rows = drag.row.parentElement;
  const desiredTop = event.clientY - drag.pointerOffset;
  const center = desiredTop + drag.row.offsetHeight / 2;
  const others = Array.from(rows.children).filter((row) => row !== drag.row && row.classList.contains("site-row"));
  const rowsTop = rows.getBoundingClientRect().top;
  const next = others.find((row) => center < rowsTop + row.offsetTop + row.offsetHeight / 2) || null;
  if (drag.row.nextElementSibling !== next) {
    const oldPositions = new Map(others.map((row) => [row, row.getBoundingClientRect().top]));
    rows.insertBefore(drag.row, next);
    for (const row of others) {
      row.getAnimations().forEach((animation) => animation.cancel());
      const offset = oldPositions.get(row) - row.getBoundingClientRect().top;
      if (offset && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        row.animate([{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }], { duration: 180, easing: "cubic-bezier(.32,.72,0,1)" });
      }
    }
  }
  drag.row.style.transform = `translateY(${desiredTop - (rows.getBoundingClientRect().top + drag.row.offsetTop)}px)`;
  positionSiteSelection();
}

function followSiteDrag() {
  if (!siteDrag?.active) return;
  const list = document.getElementById("site-list");
  const bounds = list.getBoundingClientRect();
  const bottom = Math.min(bounds.bottom, libraryAdd.getBoundingClientRect().top);
  const edge = 36;
  const speed = siteDrag.clientY < bounds.top + edge ? -12 : siteDrag.clientY > bottom - edge ? 12 : 0;
  if (speed) {
    const previous = list.scrollTop;
    list.scrollTop += speed;
    if (list.scrollTop !== previous) moveSiteDrag({ pointerId: siteDrag.pointerId, clientY: siteDrag.clientY, preventDefault() {} });
  }
  positionSiteSelection();
  requestAnimationFrame(followSiteDrag);
}

function endSiteDrag(event, cancelled = false) {
  if (!siteDrag || (event && event.pointerId !== undefined && event.pointerId !== siteDrag.pointerId)) return;
  const drag = siteDrag;
  clearTimeout(drag.holdTimer);
  siteDrag = null;
  if (!drag.active) return;
  const rows = drag.row.parentElement;
  if (cancelled) {
    for (const url of drag.initialVisibleOrder) {
      const row = Array.from(rows.children).find((item) => item.dataset.url === url);
      if (row) rows.append(row);
    }
  } else {
    const visible = Array.from(rows.querySelectorAll(":scope > .site-row"), (row) => row.dataset.url);
    const visibleSet = new Set(visible);
    let index = 0;
    state.trackerOrder = getOrderedTrackerUrls().map((url) => visibleSet.has(url) ? visible[index++] : url);
    persistState();
  }
  const from = drag.row.style.transform;
  drag.row.style.transform = "";
  drag.row.classList.remove("is-reordering");
  document.body.classList.remove("site-dragging");
  if (from && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const animation = drag.row.animate([{ transform: from }, { transform: "translateY(0)" }], { duration: 180, easing: "cubic-bezier(.32,.72,0,1)" });
    if (drag.row.classList.contains("is-selected")) {
      const selection = document.getElementById("site-selection");
      selection.style.transition = "none";
      const restoreSelectionTransition = () => { selection.style.removeProperty("transition"); positionSiteSelection(); };
      animation.onfinish = restoreSelectionTransition;
      animation.oncancel = restoreSelectionTransition;
      const follow = () => { positionSiteSelection(); if (animation.playState === "running") requestAnimationFrame(follow); };
      requestAnimationFrame(follow);
    }
  }
  positionSiteSelection();
  setTimeout(() => { suppressSiteClick = false; }, 0);
  if (siteListNeedsRefresh) { siteListNeedsRefresh = false; render(); }
}

document.addEventListener("pointermove", moveSiteDrag);
document.addEventListener("pointerup", (event) => endSiteDrag(event));
document.addEventListener("pointercancel", (event) => endSiteDrag(event, true));
document.addEventListener("touchmove", (event) => {
  if (!siteDrag || siteDrag.touchId === undefined) return;
  const touch = Array.from(event.changedTouches).find((item) => item.identifier === siteDrag.touchId);
  if (!touch) return;
  if (!siteDrag.active && Math.abs(touch.clientY - siteDrag.startY) > 8) { endSiteDrag(null, true); return; }
  if (siteDrag.active) moveSiteDrag({ pointerId: siteDrag.pointerId, clientY: touch.clientY, preventDefault: () => event.preventDefault() });
}, { passive: false });
document.addEventListener("touchend", (event) => {
  if (siteDrag?.touchId !== undefined && Array.from(event.changedTouches).some((item) => item.identifier === siteDrag.touchId)) {
    if (siteDrag.active && event.cancelable) event.preventDefault();
    endSiteDrag(null);
  }
}, { passive: false });
document.addEventListener("touchcancel", () => { if (siteDrag?.touchId !== undefined) endSiteDrag(null, true); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && siteDrag?.active) { event.preventDefault(); endSiteDrag(null, true); }
});

function renderSiteLibrary(renderContext) {
  if (siteDrag?.active) { siteListNeedsRefresh = true; return; }
  if (siteDrag) { clearTimeout(siteDrag.holdTimer); siteDrag = null; }
  const list = document.getElementById("site-list");
  const rows = document.getElementById("site-list-rows");
  const query = document.getElementById("site-search").value.trim().toLowerCase();
  if (!state.trackers.has(selection.selectedSiteUrl)) selection.selectedSiteUrl = getOrderedTrackerUrls()[0] || null;
  document.getElementById("site-count").textContent = `${state.trackers.size} ${state.trackers.size === 1 ? "site" : "sites"} · ${Array.from(state.trackers.values()).filter((tracker) => tracker.running).length} running`;
  rows.replaceChildren();
  const matches = getOrderedTrackers().filter((tracker) => `${tracker.label} ${tracker.url}`.toLowerCase().includes(query));
  for (const tracker of matches) {
    const row = document.createElement("div");
    row.className = "site-row";
    row.dataset.url = tracker.url;
    row.classList.toggle("is-selected", tracker.url === selection.selectedSiteUrl);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "site-item";
    button.title = "Drag to reorder; touch and hold, or use Alt + arrow keys";
    button.setAttribute("aria-description", "Drag to reorder, touch and hold, or use Alt plus the up and down arrow keys.");
    if (tracker.url === selection.selectedSiteUrl) button.setAttribute("aria-current", "page");
    const copy = document.createElement("span");
    copy.className = "site-item-copy";
    const name = document.createElement("strong");
    name.textContent = tracker.label || (parseUrlSafe(tracker.url)?.hostname ?? tracker.url);
    const status = document.createElement("small");
    const summaries = renderContext.summariesByUrl.get(tracker.url) || {};
    const mobile = summaries.mobile?.avgScore;
    const desktop = summaries.desktop?.avgScore;
    status.className = `site-status${tracker.running ? " is-running" : ""}`;
    if (tracker.running) {
      const spinner = document.createElement("span");
      spinner.className = "run-spinner";
      spinner.setAttribute("aria-hidden", "true");
      status.append(spinner);
    }
    const statusText = document.createElement("span");
    statusText.className = "site-status-text";
    statusText.textContent = `${tracker.running ? "" : "● "}${describeTrackerStatus(tracker)}${state.comparisonBaseUrl === tracker.url ? " · Baseline" : ""}`;
    status.append(statusText);
    copy.append(name, status);
    const scores = document.createElement("span");
    scores.className = "site-item-scores";
    for (const [mode, score] of [["Mobile", mobile], ["Desktop", desktop]]) {
      const summary = summaries[mode.toLowerCase()];
      const value = document.createElement("span");
      const bar = document.createElement("span");
      bar.className = "site-score-track";
      const fill = document.createElement("span");
      fill.className = "site-score-fill";
      if (Number.isFinite(score)) {
        fill.style.width = `${Math.max(0, Math.min(100, score))}%`;
        fill.style.backgroundColor = getSummaryBackgroundColor(mode.toLowerCase(), score, renderContext, "bar");
        bar.style.setProperty("--confidence-color", fill.style.backgroundColor);
      }
      bar.append(fill);
      if (summary) addConfidenceRange(bar, score, summary.ci95HalfWidth);
      const scoreLine = document.createElement("span");
      scoreLine.className = "site-score-line";
      const number = document.createElement("strong");
      number.textContent = Number.isFinite(score) ? score.toFixed(1) : "–";
      const confidence = document.createElement("small");
      confidence.textContent = summary && summary.ci95HalfWidth !== null ? `±${summary.ci95HalfWidth.toFixed(1)}` : "";
      scoreLine.append(number, confidence);
      const info = document.createElement("small");
      info.textContent = summary ? `${summary.samples} ${summary.samples === 1 ? "run" : "runs"}` : "No runs";
      value.append(bar, scoreLine, info);
      if (summary) {
        const estimate = document.createElement("small");
        estimate.textContent = formatGoalEstimate(summary);
        value.append(estimate);
      }
      const baselineScore = renderContext.summariesByUrl.get(state.comparisonBaseUrl)?.[mode.toLowerCase()]?.avgScore;
      let delta = null;
      if (tracker.url !== state.comparisonBaseUrl && Number.isFinite(score) && Number.isFinite(baselineScore)) {
        delta = baselineDelta(score - baselineScore, baselineScore);
        const deltaPill = document.createElement("span");
        deltaPill.className = "site-score-delta";
        setBaselineDeltaLabel(deltaPill, delta);
        value.append(deltaPill);
      }
      value.setAttribute("aria-label", `${mode} average ${Number.isFinite(score) ? score.toFixed(1) : "not available"}; ${Array.from(value.querySelectorAll("small"), (item) => item.textContent).join("; ")}${delta ? `; ${delta.detail}` : ""}`);
      scores.append(value);
    }
    button.append(copy, scores);
    button.addEventListener("click", () => {
      if (suppressSiteClick) return;
      if (state.runDetail && state.runDetail.url !== tracker.url) closeRunDetailPanel();
      selection.selectedSiteUrl = tracker.url;
      selection.openSiteMenuUrl = null;
      setWorkspaceView("sites");
      render();
      document.querySelector('.site-item[aria-current="page"]')?.focus({ preventScroll: true });
    });
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      siteDrag = { row, pointerId: event.pointerId, startY: event.clientY, pointerOffset: event.clientY - row.getBoundingClientRect().top, initialVisibleOrder: Array.from(rows.querySelectorAll(":scope > .site-row"), (item) => item.dataset.url), active: false };
    });
    button.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1) return;
      const touch = event.changedTouches[0];
      const drag = { row, pointerId: -touch.identifier - 1, touchId: touch.identifier, startY: touch.clientY, clientY: touch.clientY, pointerOffset: touch.clientY - row.getBoundingClientRect().top, initialVisibleOrder: Array.from(rows.querySelectorAll(":scope > .site-row"), (item) => item.dataset.url), active: false };
      siteDrag = drag;
      drag.holdTimer = setTimeout(() => {
        if (siteDrag !== drag) return;
        drag.startY = drag.clientY - 6;
        moveSiteDrag({ pointerId: drag.pointerId, clientY: drag.clientY, preventDefault() {} });
      }, 350);
    }, { passive: true });
    button.addEventListener("keydown", (event) => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      const other = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
      if (!other?.dataset.url) return;
      event.preventDefault();
      const order = getOrderedTrackerUrls();
      const from = order.indexOf(tracker.url);
      const to = order.indexOf(other.dataset.url);
      [order[from], order[to]] = [order[to], order[from]];
      state.trackerOrder = order;
      persistState();
      render();
      requestAnimationFrame(() => Array.from(document.querySelectorAll(".site-row")).find((item) => item.dataset.url === tracker.url)?.querySelector(".site-item")?.focus({ preventScroll: true }));
    });
    const actions = document.createElement("div");
    actions.className = "site-row-actions";
    const menu = document.createElement("details");
    menu.className = "site-menu";
    menu.open = selection.openSiteMenuUrl === tracker.url;
    const menuTrigger = document.createElement("summary");
    menuTrigger.innerHTML = iconMarkup(ellipsisSvg);
    menuTrigger.setAttribute("aria-label", `More actions: ${tracker.label || tracker.url}`);
    menu.append(menuTrigger);
    const menuItems = document.createElement("div");
    menuItems.className = "site-menu-items";
    menu.append(menuItems);
    menu.addEventListener("toggle", () => {
      if (!menu.isConnected) return;
      if (menu.open) {
        document.querySelectorAll(".site-menu[open]").forEach((other) => {
          if (other !== menu) other.open = false;
        });
        selection.openSiteMenuUrl = tracker.url;
        positionSiteMenu(menu);
      }
      else if (selection.openSiteMenuUrl === tracker.url) selection.openSiteMenuUrl = null;
    });
    const addAction = (label, handler, options = {}) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = `site-action${options.className ? ` ${options.className}` : ""}`;
      if (options.icon) action.innerHTML = options.icon;
      else action.textContent = label;
      action.setAttribute("aria-label", `${label}: ${tracker.label || tracker.url}`);
      if (typeof options.pressed === "boolean") action.setAttribute("aria-pressed", String(options.pressed));
      action.title = label;
      action.disabled = Boolean(options.disabled);
      action.addEventListener("click", handler);
      (options.leading ? row : options.menu ? menuItems : actions).append(action);
    };
    const playIcon = iconMarkup(playSvg);
    const pauseIcon = iconMarkup(pauseSvg);
    addAction(tracker.running ? "Pause" : "Start", () => {
      if (tracker.running) stopTracker(tracker);
      else if (ensureApiKeyConfigured()) startTracker(tracker, true);
      render();
    }, { icon: tracker.running ? pauseIcon : playIcon, className: "site-run-toggle", leading: true });
    addAction(state.comparisonBaseUrl === tracker.url ? "Clear baseline" : "Set baseline", () => {
      state.comparisonBaseUrl = state.comparisonBaseUrl === tracker.url ? null : tracker.url;
      selection.openSiteMenuUrl = null;
      persistState();
      render();
    }, { icon: ICON_BASELINE, className: state.comparisonBaseUrl === tracker.url ? "is-baseline" : "", pressed: state.comparisonBaseUrl === tracker.url });
    addAction("Edit label", () => {
      if (state.runDetail && state.runDetail.url !== tracker.url) closeRunDetailPanel();
      selection.selectedSiteUrl = tracker.url;
      selection.openSiteMenuUrl = null;
      setWorkspaceView("sites");
      render();
      beginLabelEditing(tracker.url);
    }, { menu: true });
    addAction("Remove", () => {
      menu.open = false;
      selection.openSiteMenuUrl = null;
      openRemoveSiteDialog(tracker);
    }, { menu: true, className: "remove" });
    actions.append(menu);
    row.append(button, actions);
    if (tracker.lastError) {
      const error = document.createElement("p");
      error.className = "site-row-error";
      error.textContent = tracker.lastError;
      row.append(error);
    }
    rows.append(row);
  }
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = query ? "No sites found." : "Your tracked sites will appear here.";
    rows.append(empty);
  }
  positionSiteSelection();
}

return { renderSiteLibrary, positionSiteSelection };
}
