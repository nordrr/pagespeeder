import { METRICS } from "../metrics.mjs";
import { describeMetricScenario, formatDisplayedReduction, rankMetricOpportunities } from "./metric-opportunity.mjs";

// Renders the selected site's card and keeps its header height in sync.
// shared supplies getters/setters for mutable state also owned by the app.
export function createSiteDetailsView({
  state, shared, urlCardsContainer, urlCardTemplate, urlInput, isDev,
  hasApiKey, openApiKeyDialog, loadDemoSites, getOrderedTrackers,
  viewTransitionNameForUrl, parseUrlSafe, attachTooltipHandlers, beginLabelEditing,
  hideTooltip, setGlobalDraggingCursor, getTransparentDragImage, createDragPreview,
  clearDropTargets, clearDragCardClasses, clearDragPreview, fadeOutDragPreview,
  reorderTracker, persistState, render, describeTrackerStatus, iconMarkup,
  playSvg, pauseSvg, zapSvg, trashSvg, ICON_BASELINE, stopTracker,
  ensureApiKeyConfigured, startTracker, triggerImmediateCycle, runWithViewTransition,
  openRemoveSiteDialog, renderSummaryTile, renderMetricSummary, renderScoreHistory,
  createConnectedEdgeShadow, positionRunSelection, followRunSeam, mountImprovementControls,
}) {
let headerSyncRafId = null;
let unmountImprovementControls = null;

function syncUrlCardHeaderHeights() {
  const headers = Array.from(urlCardsContainer.querySelectorAll(".url-card > header"));
  const identities = Array.from(urlCardsContainer.querySelectorAll(".url-identity"));
  const cards = Array.from(urlCardsContainer.querySelectorAll(".url-card[data-url]"));
  if (!identities.length) {
    return;
  }

  // Clear legacy header equalization first.
  for (const header of headers) {
    header.style.minHeight = "";
  }
  for (const identity of identities) {
    identity.style.minHeight = "";
  }

  const isMobileLayout = window.matchMedia("(max-width: 720px)").matches;
  if (isMobileLayout) {
    return;
  }

  const visibleCards = cards.filter((card) => card.offsetParent !== null);
  if (visibleCards.length < 2) {
    return;
  }
  const firstRowTop = Math.round(visibleCards[0].getBoundingClientRect().top);
  const hasMultiColumnRow = visibleCards
    .slice(1)
    .some((card) => Math.abs(Math.round(card.getBoundingClientRect().top) - firstRowTop) <= 1);
  if (!hasMultiColumnRow) {
    return;
  }

  const visibleIdentities = identities.filter((identity) => identity.offsetParent !== null);
  if (!visibleIdentities.length) {
    return;
  }

  const maxHeight = Math.max(
    ...visibleIdentities.map((identity) => Math.ceil(identity.getBoundingClientRect().height)),
  );

  for (const identity of visibleIdentities) {
    identity.style.minHeight = `${maxHeight}px`;
  }
}

function scheduleHeaderHeightSync() {
  if (headerSyncRafId !== null) {
    cancelAnimationFrame(headerSyncRafId);
  }
  headerSyncRafId = requestAnimationFrame(() => {
    headerSyncRafId = null;
    syncUrlCardHeaderHeights();
  });
}

function renderCards(renderContext) {
  unmountImprovementControls?.();
  unmountImprovementControls = null;
  const scrollByUrl = new Map();
  const historySlot = document.getElementById("score-history-slot");
  const existingScroller = historySlot.querySelector(".score-history-scroll");
  if (existingScroller && historySlot.dataset.url) scrollByUrl.set(historySlot.dataset.url, existingScroller.scrollTop);
  historySlot.replaceChildren();
  historySlot.dataset.url = "";

  urlCardsContainer.innerHTML = "";

  if (!state.trackers.size) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("h3");
    title.textContent = "No sites yet";
    const copy = document.createElement("p");
    copy.textContent = hasApiKey()
      ? "Add a URL below to start collecting mobile and desktop results."
      : "Add your API key, then enter a URL below to start tracking performance.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = hasApiKey() ? "secondary" : "";
    button.textContent = hasApiKey() ? "Focus URL Field" : "Add API Key";
    button.addEventListener("click", () => {
      if (hasApiKey()) {
        urlInput.focus();
        return;
      }
      openApiKeyDialog();
    });
    empty.append(title, copy, button);
    if (isDev) {
      const demoButton = document.createElement("button");
      demoButton.type = "button";
      demoButton.className = "secondary demo-button";
      demoButton.textContent = "Load demo sites";
      demoButton.addEventListener("click", loadDemoSites);
      empty.append(demoButton);
    }
    urlCardsContainer.append(empty);
    return;
  }

  const baseUrl = state.comparisonBaseUrl;
  const baseSummaries = baseUrl ? (renderContext.summariesByUrl.get(baseUrl) || null) : null;

  for (const tracker of getOrderedTrackers()) {
    if (tracker.url !== shared.selectedSiteUrl) continue;
    const card = urlCardTemplate.content.firstElementChild.cloneNode(true);
    const isBaseCard = state.comparisonBaseUrl === tracker.url;
    card.dataset.url = tracker.url;
    card.style.viewTransitionName = viewTransitionNameForUrl(tracker.url);
    card.classList.toggle("comparison-base", isBaseCard);

    const title = card.querySelector(".url-card-title");
    const dragHandle = card.querySelector(".drag-handle");
    const labelLine = card.querySelector(".url-label-line");
    const urlLine = card.querySelector(".url-title-url");
    const labelInput = card.querySelector(".url-label-input");
    const meta = card.querySelector(".url-card-meta");
    const toggleButton = card.querySelector(".toggle-run");
    const runNowButton = card.querySelector(".run-now");
    const setBaselineButton = card.querySelector(".set-baseline");
    const removeButton = card.querySelector(".remove");
    const scoreHistoryScroll = card.querySelector(".score-history-scroll");
    const scoreHistoryBody = card.querySelector(".score-history-body");
    const metricSummaryBody = card.querySelector(".metric-summary-body");
    const metricSummaryTable = card.querySelector(".metric-summary-table");
    const scoreHistorySection = card.querySelector(".score-history-section");
    const mobileTile = card.querySelector(".summary-tile[data-mode='mobile']");
    const desktopTile = card.querySelector(".summary-tile[data-mode='desktop']");
    const errorText = card.querySelector(".error-text");

    const hasLabel = Boolean(tracker.label && tracker.label.trim());
    labelLine.textContent = hasLabel ? tracker.label : (parseUrlSafe(tracker.url)?.hostname ?? tracker.url);
    if (isBaseCard) {
      const baselineBadge = document.createElement("span");
      baselineBadge.className = "baseline-badge";
      baselineBadge.textContent = "Baseline";
      labelLine.append(baselineBadge);
    }
    urlLine.textContent = tracker.url;
    title.classList.toggle("no-label", !hasLabel);
    title.setAttribute("aria-label", `Edit label for ${tracker.label || tracker.url}`);
    title.dataset.tooltip = hasLabel ? "Edit label" : "Add label";
    attachTooltipHandlers(title);

    title.addEventListener("pointerdown", () => {
      shared.pendingLabelEditUrl = tracker.url;
    });
    title.addEventListener("click", (event) => {
      event.preventDefault();
      shared.pendingLabelEditUrl = null;
      beginLabelEditing(tracker.url);
    });

    if (dragHandle) {
      dragHandle.dataset.tooltip = "Drag to reorder";
      attachTooltipHandlers(dragHandle);
      dragHandle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      dragHandle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
      });
      dragHandle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      });
      dragHandle.addEventListener("dragstart", (event) => {
        if (shared.dragEndCleanupTimerId) {
          clearTimeout(shared.dragEndCleanupTimerId);
          shared.dragEndCleanupTimerId = null;
        }
        hideTooltip();
        shared.dragDidDrop = false;
        shared.draggedTrackerUrl = tracker.url;
        setGlobalDraggingCursor(true);
        card.classList.add("is-dragging", "dragging-active");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", tracker.url);
          event.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
        }
        createDragPreview(card, event.clientX, event.clientY);
      });
      dragHandle.addEventListener("dragend", () => {
        hideTooltip();
        setGlobalDraggingCursor(false);
        shared.draggedTrackerUrl = null;
        if (shared.dragDidDrop || shared.dragPreviewAnimating) {
          clearDropTargets();
          return;
        }
        if (shared.dragEndCleanupTimerId) {
          clearTimeout(shared.dragEndCleanupTimerId);
        }
        // Some browsers fire dragend before drop; allow drop to win first.
        shared.dragEndCleanupTimerId = setTimeout(() => {
          shared.dragEndCleanupTimerId = null;
          if (shared.dragDidDrop || shared.dragPreviewAnimating) {
            return;
          }
          clearDragCardClasses();
          clearDragPreview();
        }, 60);
      });
    }

    let didCancelLabelEdit = false;
    const commitLabel = () => {
      if (didCancelLabelEdit) {
        return;
      }
      const resumeEditUrl = shared.pendingLabelEditUrl;
      shared.pendingLabelEditUrl = null;
      tracker.label = labelInput.value.trim();
      shared.skipLabelEditRestoreOnNextRender = true;
      persistState();
      render();
      if (resumeEditUrl && resumeEditUrl !== tracker.url) {
        requestAnimationFrame(() => {
          beginLabelEditing(resumeEditUrl);
        });
      }
    };
    const cancelLabel = () => {
      didCancelLabelEdit = true;
      const resumeEditUrl = shared.pendingLabelEditUrl;
      shared.pendingLabelEditUrl = null;
      card.classList.remove("is-editing-label");
      shared.skipLabelEditRestoreOnNextRender = true;
      render();
      if (resumeEditUrl && resumeEditUrl !== tracker.url) {
        requestAnimationFrame(() => {
          beginLabelEditing(resumeEditUrl);
        });
      }
    };

    labelInput.addEventListener("keydown", (event) => {
      if (event.isComposing) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commitLabel();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelLabel();
      }
    });
    labelInput.addEventListener("blur", () => {
      if (shared.suppressLabelBlurCommit) {
        return;
      }
      commitLabel();
    });

    meta.textContent = `Status: ${describeTrackerStatus(tracker)}`;

    const iconPlay = iconMarkup(playSvg);
    const iconPause = iconMarkup(pauseSvg);
    const iconRunNow = iconMarkup(zapSvg);
    const iconTrash = iconMarkup(trashSvg);

    toggleButton.classList.toggle("is-running", tracker.running);
    toggleButton.classList.toggle("is-paused", !tracker.running);
    toggleButton.innerHTML = `${tracker.running ? iconPause : iconPlay}<span>${tracker.running ? "Pause" : "Start"}</span>`;
    toggleButton.setAttribute("aria-label", tracker.running ? "Pause" : "Start");
    toggleButton.dataset.tooltip = tracker.running ? "Pause" : "Start";
    attachTooltipHandlers(toggleButton);
    toggleButton.addEventListener("click", () => {
      if (tracker.running) {
        stopTracker(tracker);
      } else if (ensureApiKeyConfigured()) {
        startTracker(tracker, true);
      }
      render();
    });

    runNowButton.disabled = tracker.inFlight;
    runNowButton.innerHTML = `${iconRunNow}<span>${tracker.running ? "Run now" : "Run once"}</span>`;
    runNowButton.setAttribute("aria-label", tracker.running ? "Run now" : "Run once");
    runNowButton.dataset.tooltip = tracker.running ? "Run now" : "Run once";
    attachTooltipHandlers(runNowButton);
    runNowButton.addEventListener("click", () => {
      if (!ensureApiKeyConfigured()) {
        return;
      }
      triggerImmediateCycle(tracker);
    });

    if (setBaselineButton) {
      setBaselineButton.innerHTML = `${ICON_BASELINE}<span>${isBaseCard ? "Clear baseline" : "Set baseline"}</span>`;
      setBaselineButton.classList.toggle("is-active", isBaseCard);
      setBaselineButton.setAttribute("aria-label", isBaseCard ? "Clear comparison baseline" : "Set as comparison baseline");
      setBaselineButton.dataset.tooltip = isBaseCard ? "Clear comparison baseline" : "Set as comparison baseline";
      attachTooltipHandlers(setBaselineButton);
      setBaselineButton.addEventListener("click", () => {
        runWithViewTransition(() => {
          state.comparisonBaseUrl = isBaseCard ? null : tracker.url;
          persistState();
          render();
        });
      });
    }

    removeButton.innerHTML = iconTrash;
    removeButton.dataset.tooltip = "Remove site";
    removeButton.setAttribute("aria-label", `Remove site: ${tracker.label || tracker.url}`);
    attachTooltipHandlers(removeButton);
    removeButton.addEventListener("click", () => {
      openRemoveSiteDialog(tracker);
    });

    card.addEventListener("dragover", (event) => {
      if (!shared.draggedTrackerUrl || shared.draggedTrackerUrl === tracker.url) {
        return;
      }
      event.preventDefault();
      clearDropTargets();
      card.classList.add("drop-target");
    });

    card.addEventListener("dragenter", (event) => {
      if (!shared.draggedTrackerUrl || shared.draggedTrackerUrl === tracker.url) {
        return;
      }
      event.preventDefault();
      clearDropTargets();
      card.classList.add("drop-target");
    });

    card.addEventListener("dragleave", (event) => {
      if (!(event.relatedTarget instanceof Node) || !card.contains(event.relatedTarget)) {
        card.classList.remove("drop-target");
      }
    });

    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const draggedUrl = shared.draggedTrackerUrl || event.dataTransfer?.getData("text/plain");
      if (!draggedUrl || draggedUrl === tracker.url) {
        clearDragCardClasses();
        clearDragPreview();
        shared.dragDidDrop = false;
        return;
      }

      shared.dragDidDrop = true;
      if (shared.dragEndCleanupTimerId) {
        clearTimeout(shared.dragEndCleanupTimerId);
        shared.dragEndCleanupTimerId = null;
      }
      shared.draggedTrackerUrl = null;
      clearDropTargets();
      fadeOutDragPreview();
      reorderTracker(draggedUrl, tracker.url);
    });

    const summaries = renderContext.summariesByUrl.get(tracker.url) || {};
    const mobileSummary = summaries.mobile || null;
    const desktopSummary = summaries.desktop || null;
    renderSummaryTile(mobileTile, mobileSummary, "mobile", renderContext, {
      baselineSummary: baseSummaries?.mobile || null,
      isBaselineCard: isBaseCard,
    });
    renderSummaryTile(desktopTile, desktopSummary, "desktop", renderContext, {
      baselineSummary: baseSummaries?.desktop || null,
      isBaselineCard: isBaseCard,
    });
    if (metricSummaryTable) {
      metricSummaryTable.hidden = !state.showDetails;
    }
    if (scoreHistorySection) {
      scoreHistorySection.hidden = !state.showDetails;
    }
    if (state.showDetails) {
      renderMetricSummary(metricSummaryBody, mobileSummary, desktopSummary, renderContext, {
        baselineMobileSummary: baseSummaries?.mobile || null,
        baselineDesktopSummary: baseSummaries?.desktop || null,
        isBaselineCard: isBaseCard,
      });
      renderScoreHistory(scoreHistoryBody, tracker, renderContext);
    }
    const priorities = card.querySelector(".metric-priorities");
    priorities.hidden = !state.showDetails || (!mobileSummary && !desktopSummary);
    const updatePriorities = () => {
      if (priorities.hidden) return;
      const percentages = state.improvementPercentages || [25, 50];
      priorities.querySelector(".metric-priorities-description").textContent = "Calculate which metrics would have the biggest impact on your performance score if improved.";
      const columns = priorities.querySelector(".metric-priority-columns");
      columns.replaceChildren();
      for (const [mode, summary] of [["mobile", mobileSummary], ["desktop", desktopSummary]]) {
        const column = document.createElement("div");
        column.className = "metric-priority-column";
        const heading = document.createElement("h5");
        heading.textContent = mode === "mobile" ? "Mobile" : "Desktop";
        column.append(heading);
        const shell = document.createElement("div");
        shell.className = "metric-priority-shell";
        column.append(shell);
        const items = rankMetricOpportunities(METRICS, mode, summary, percentages);
        if (!items.length) {
          const empty = document.createElement("p");
          empty.className = "metric-priority-empty";
          empty.textContent = summary ? "Little score gain from a 25% improvement." : "No runs yet.";
          shell.append(empty);
        } else {
          const table = document.createElement("table");
          table.className = "metric-priority-table";
          table.setAttribute("aria-label", `${heading.textContent} score opportunities, ranked by ${percentages[0]}% improvement`);
          const head = document.createElement("thead");
          const headerRow = document.createElement("tr");
          for (const label of ["Metric", "Target (reduction)", "Gain"]) {
            const th = document.createElement("th");
            th.scope = "col";
            th.textContent = label;
            headerRow.append(th);
          }
          head.append(headerRow);
          table.append(head);
          for (const item of items) {
            const body = document.createElement("tbody");
            if (item.status !== "available") {
              const line = document.createElement("tr");
              const name = document.createElement("th");
              name.scope = "rowgroup";
              const metricName = document.createElement("span");
              metricName.textContent = item.metric.label;
              name.append(metricName);
              if (item.status === "maximum" || item.status === "near-maximum") {
                const current = document.createElement("small");
                current.textContent = item.metric.format(item.value);
                name.append(current);
              }
              const message = document.createElement("td");
              message.colSpan = 2;
              message.className = "metric-priority-status";
              message.textContent = item.status === "maximum" ? "Already at maximum points" : item.status === "near-maximum" ? "Less than 0.05 points remain" : "No data yet";
              line.append(name, message);
              body.append(line);
            }
            for (const [index, scenario] of item.scenarios.entries()) {
              const line = document.createElement("tr");
              line.dataset.tooltip = describeMetricScenario(item.metric, item.value, scenario, summary?.avgScore, mode);
              line.dataset.tooltipWide = "true";
              line.setAttribute("aria-label", line.dataset.tooltip);
              line.tabIndex = 0;
              attachTooltipHandlers(line);
              if (index === 0) {
                const name = document.createElement("th");
                name.scope = "rowgroup";
                name.rowSpan = item.scenarios.length;
                const metricName = document.createElement("span");
                metricName.textContent = item.metric.label;
                const current = document.createElement("small");
                current.textContent = item.metric.format(item.value);
                name.append(metricName, current);
                line.append(name);
              }
              const change = document.createElement("td");
              const percentage = document.createElement("span");
              percentage.className = "metric-priority-percentage";
              percentage.textContent = `${Math.round(scenario.fraction * 100)}%`;
              change.append(percentage, document.createTextNode(` ${item.metric.format(scenario.target)} `));
              const reduction = document.createElement("strong");
              reduction.className = "metric-priority-reduction";
              reduction.textContent = `(−${formatDisplayedReduction(item.metric, item.value, scenario.target)})`;
              change.append(reduction);
              change.setAttribute("aria-label", `From ${item.metric.format(item.value)} to ${item.metric.format(scenario.target)}, ${formatDisplayedReduction(item.metric, item.value, scenario.target)} lower`);
              const gain = document.createElement("td");
              gain.className = "metric-priority-gain";
              gain.textContent = scenario.gain < 0.05 ? "<0.1 pt" : `+${scenario.gain.toFixed(1)} pts`;
              line.append(change, gain);
              body.append(line);
            }
            table.append(body);
          }
          shell.append(table);
        }
        columns.append(column);
      }
    };
    if (!priorities.hidden) {
      unmountImprovementControls = mountImprovementControls(priorities.querySelector(".metric-priority-controls"));
      updatePriorities();
      card.addEventListener("improvement-settings-change", updatePriorities);
    }
    errorText.textContent = tracker.lastError;

    urlCardsContainer.append(card);
    if (scoreHistorySection && !scoreHistorySection.hidden) {
      historySlot.dataset.url = tracker.url;
      historySlot.append(scoreHistorySection);
      createConnectedEdgeShadow(historySlot, "run-edge");
      scoreHistoryScroll?.addEventListener("scroll", positionRunSelection, { passive: true });
      scoreHistoryScroll?.querySelector(".run-selection")?.addEventListener("transitionrun", (event) => {
        if (event.propertyName === "transform") followRunSeam(event.currentTarget);
      });
    }
    if (scoreHistoryScroll && scrollByUrl.has(tracker.url)) {
      scoreHistoryScroll.scrollTop = scrollByUrl.get(tracker.url);
    }
    requestAnimationFrame(positionRunSelection);
  }
}

return { renderCards, scheduleHeaderHeightSync };
}
