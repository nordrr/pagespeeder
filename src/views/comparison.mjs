export function createComparisonView({
  state, sortableHeaders, comparisonBody, SORTABLE_KEYS, STRATEGIES, METRICS, ICON_BASELINE, persistState, render, attachTooltipHandlers, runWithViewTransition, createPaneProgress, getSummaryBackgroundColor, formatConfidence, getMetricBackgroundColor, createMetricValueBlock, addMetricProgress, document,
}) {
  function initSortHeaders() {
  for (const header of sortableHeaders) {
    header.tabIndex = 0;
    header.addEventListener("mousedown", (event) => {
      // Prevent sticky focus on click; focused sticky headers can trigger viewport jumps on rerender.
      event.preventDefault();
    });
    header.addEventListener("click", () => {
      toggleSort(header.dataset.sortKey);
      header.blur();
    });
    header.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      toggleSort(header.dataset.sortKey);
    });
  }
  }

  function toggleSort(key) {
    if (!SORTABLE_KEYS.has(key)) {
      return;
    }

    if (state.sort.key !== key) {
      state.sort.key = key;
      state.sort.direction = "asc";
    } else if (state.sort.direction === "asc") {
      state.sort.direction = "desc";
    } else if (state.sort.direction === "desc") {
      state.sort.key = null;
      state.sort.direction = null;
    } else {
      state.sort.direction = "asc";
    }

    persistState();
    render();
  }

  function updateSortHeaderIndicators() {
    for (const header of sortableHeaders) {
      header.classList.remove("sort-asc", "sort-desc");
      if (header.dataset.sortKey === state.sort.key) {
        header.classList.add(state.sort.direction === "desc" ? "sort-desc" : "sort-asc");
      }
    }
  }

  function compareNullableValues(aValue, bValue) {
    const aMissing = aValue === null || aValue === undefined;
    const bMissing = bValue === null || bValue === undefined;
    if (aMissing && bMissing) {
      return 0;
    }
    if (aMissing) {
      return 1;
    }
    if (bMissing) {
      return -1;
    }
    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue);
    }
    return aValue - bValue;
  }

  function sortRows(rowsData) {
    if (!state.sort.key || !state.sort.direction) {
      return rowsData;
    }

    const directionFactor = state.sort.direction === "desc" ? -1 : 1;
    const sorted = [...rowsData];
    sorted.sort((a, b) => {
      const result = compareNullableValues(a.sortValues[state.sort.key], b.sortValues[state.sort.key]);
      return result * directionFactor;
    });
    return sorted;
  }

  function renderComparisonTable(renderContext) {
    updateSortHeaderIndicators();
    comparisonBody.innerHTML = "";

    if (!state.trackers.size) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 10;
      cell.className = "placeholder";
      cell.textContent = "No URLs yet. Add one above to begin tracking.";
      row.append(cell);
      comparisonBody.append(row);
      return;
    }

    const rowsData = [];
    for (const tracker of state.trackers.values()) {
      for (const mode of STRATEGIES) {
        rowsData.push({
          id: `${tracker.url}|${mode}`,
          url: tracker.url,
          label: tracker.label || "",
          mode,
          summary: renderContext.summariesByUrl.get(tracker.url)?.[mode] || null,
          sortValues: {
            url: tracker.url.toLowerCase(),
            mode,
            avgScore: null,
            confidence: null,
            samples: null,
            fcp: null,
            si: null,
            lcp: null,
            tbt: null,
            cls: null,
          },
        });
      }
    }

    for (const rowData of rowsData) {
      if (!rowData.summary) {
        continue;
      }
      rowData.sortValues.avgScore = rowData.summary.avgScore;
      rowData.sortValues.confidence = rowData.summary.ci95HalfWidth;
      rowData.sortValues.samples = rowData.summary.samples;
      for (const metric of METRICS) {
        rowData.sortValues[metric.key] = rowData.summary.metrics[metric.key].avgValue;
      }
    }

    const sortedRows = sortRows(rowsData);

    for (const rowData of sortedRows) {
      const row = document.createElement("tr");

      const urlCell = document.createElement("td");
      urlCell.className = "comparison-url-cell";

      const urlContent = document.createElement("div");
      urlContent.className = "comparison-url-content";

      const urlText = document.createElement("div");
      urlText.className = "comparison-url-text";
      if (rowData.label) {
        const labelBig = document.createElement("span");
        labelBig.className = "comparison-url-label";
        labelBig.textContent = rowData.label;
        const urlSmall = document.createElement("span");
        urlSmall.className = "comparison-url-small";
        urlSmall.textContent = rowData.url;
        urlText.append(labelBig, urlSmall);
      } else {
        const urlOnly = document.createElement("span");
        urlOnly.className = "comparison-url-only";
        urlOnly.textContent = rowData.url;
        urlText.append(urlOnly);
      }

      const isBaseRow = state.comparisonBaseUrl === rowData.url;
      const tableBaselineButton = document.createElement("button");
      tableBaselineButton.type = "button";
      tableBaselineButton.className = "comparison-baseline-btn set-baseline icon-btn secondary";
      tableBaselineButton.innerHTML = ICON_BASELINE;
      tableBaselineButton.classList.toggle("is-active", isBaseRow);
      tableBaselineButton.setAttribute(
        "aria-label",
        isBaseRow ? "Clear comparison baseline" : "Set as comparison baseline",
      );
      tableBaselineButton.dataset.tooltip = isBaseRow
        ? "Clear comparison baseline"
        : "Set as comparison baseline";
      attachTooltipHandlers(tableBaselineButton);
      tableBaselineButton.addEventListener("click", (event) => {
        event.preventDefault();
        runWithViewTransition(() => {
          state.comparisonBaseUrl = isBaseRow ? null : rowData.url;
          persistState();
          render();
        });
      });

      urlContent.append(urlText, tableBaselineButton);
      urlCell.append(urlContent);
      row.append(urlCell);

      const modeCell = document.createElement("td");
      modeCell.textContent = rowData.mode;
      row.append(modeCell);

      if (!rowData.summary) {
        for (let i = 0; i < 8; i += 1) {
          const cell = document.createElement("td");
          cell.textContent = "--";
          row.append(cell);
        }
        comparisonBody.append(row);
        continue;
      }

      const scoreAvgCell = document.createElement("td");
      scoreAvgCell.className = "comparison-color-cell comparison-score-cell";
      scoreAvgCell.textContent = rowData.summary.avgScore.toFixed(1);
      scoreAvgCell.prepend(createPaneProgress(rowData.summary.avgScore, getSummaryBackgroundColor(rowData.mode, rowData.summary.avgScore, renderContext, "bar"), rowData.summary.ci95HalfWidth));
      row.append(scoreAvgCell);

      const confidenceCell = document.createElement("td");
      confidenceCell.textContent = formatConfidence(rowData.summary.ci95HalfWidth);
      row.append(confidenceCell);

      const samplesCell = document.createElement("td");
      samplesCell.textContent = String(rowData.summary.samples);
      row.append(samplesCell);

      for (const metric of METRICS) {
        const metricCell = document.createElement("td");
        metricCell.className = "comparison-color-cell";
        const metricResult = rowData.summary.metrics[metric.key];
        const metricColor = getMetricBackgroundColor(
          rowData.mode,
          metric.key,
          metricResult.avgValue,
          renderContext, "bar",
        );
        const bubble = createMetricValueBlock(
          metric,
          metricResult.avgValue,
          null,
          rowData.mode,
          false,
        );
        addMetricProgress(bubble, metric, metricResult, rowData.mode, metricColor);
        metricCell.append(bubble);
        row.append(metricCell);
      }

      comparisonBody.append(row);
    }
  }

  return { initSortHeaders, toggleSort, updateSortHeaderIndicators, compareNullableValues, sortRows, renderComparisonTable };
}
