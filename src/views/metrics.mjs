export function createMetricsView({
  state, document, METRICS, STRATEGIES, MIN_STAT_SIG_SAMPLES, SCORING_MODEL_VERSION, metricContribution, getPercentile, summarize, attachTooltipHandlers,
}) {
  function formatPointValue(value) {
    if (!Number.isFinite(value)) {
      return "--";
    }
    const nearestInt = Math.round(value);
    if (Math.abs(value - nearestInt) < 0.05) {
      return String(nearestInt);
    }
    return value.toFixed(1);
  }

  function formatSignedNumber(value, fractionDigits = 1) {
    if (!Number.isFinite(value)) {
      return "--";
    }
    const normalized = Math.abs(value) < 0.0005 ? 0 : value;
    const fixed = normalized.toFixed(fractionDigits);
    return normalized > 0 ? `+${fixed}` : fixed;
  }

  function formatDeltaPointsAndPercent(deltaPoints, baselinePoints) {
    if (!Number.isFinite(deltaPoints)) {
      return "";
    }
    const pointsLabel = `${formatSignedNumber(deltaPoints, 1)} pts`;
    if (!Number.isFinite(baselinePoints) || Math.abs(baselinePoints) < 0.000001) {
      return `${pointsLabel} (--%)`;
    }
    const deltaPercent = (deltaPoints / baselinePoints) * 100;
    return `${pointsLabel} (${formatSignedNumber(deltaPercent, 1)}%)`;
  }

  function baselineDelta(deltaPoints, baselinePoints) {
    return {
      label: `${formatSignedNumber(deltaPoints, 1)} pts vs baseline`,
      detail: `${formatDeltaPointsAndPercent(deltaPoints, baselinePoints)} compared to baseline`,
    };
  }

  function setBaselineDeltaLabel(element, delta) {
    element.textContent = typeof delta === "string" ? delta : delta.label;
    if (typeof delta !== "string") element.title = delta.detail;
  }

  function contributionPointsForDisplay(strategy, metricKey, value) {
    const contribution = metricContribution(strategy, metricKey, value);
    if (!contribution) {
      return null;
    }
    const formatted = formatPointValue(contribution.points);
    const parsed = Number.parseFloat(formatted);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatContributionText(strategy, metricKey, value) {
    const contribution = metricContribution(strategy, metricKey, value);
    if (!contribution) {
      return { points: "--", outOf: "/--" };
    }
    return {
      points: formatPointValue(contribution.points),
      outOf: `/${formatPointValue(contribution.maxPoints)}`,
    };
  }

  function createMetricValueBlock(
    metric,
    value,
    percentile,
    strategy,
    withBackground = true,
    explicitTextColor = null,
    deltaText = "",
  ) {
    const block = document.createElement("span");
    block.className = "metric-cell";
    if (withBackground) {
      const background = percentileColor(percentile);
      block.style.backgroundColor = background;
      block.style.color = textColorForBackground(background);
    } else {
      block.classList.add("metric-cell-no-bg");
      if (explicitTextColor) {
        block.style.color = explicitTextColor;
      }
    }

    const contribution = formatContributionText(strategy, metric.key, value);

    const pointsLine = document.createElement("span");
    pointsLine.className = "metric-points-line";
    const contributionTooltip = `${SCORING_MODEL_VERSION} weighted contribution to the 100-point performance score. The measured metric is shown underneath.`;
    pointsLine.dataset.tooltip = contributionTooltip;
    pointsLine.title = contributionTooltip;
    pointsLine.setAttribute(
      "aria-label",
      `${contribution.points} out of ${contribution.outOf.replace("/", "")} weighted points. ${metric.format(value)} measured.`,
    );
    attachTooltipHandlers(pointsLine);

    const pointsBig = document.createElement("span");
    pointsBig.className = "metric-points-big";
    pointsBig.textContent = contribution.points;
    const pointsSmall = document.createElement("span");
    pointsSmall.className = "metric-points-small";
    pointsSmall.textContent = contribution.outOf;

    pointsLine.append(pointsBig, pointsSmall);
    block.append(pointsLine);

    const valueLine = document.createElement("span");
    valueLine.className = "metric-raw-value";
    valueLine.textContent = metric.format(value);
    block.append(valueLine);

    if (deltaText) {
      const deltaLine = document.createElement("span");
      deltaLine.className = "metric-delta-value";
      setBaselineDeltaLabel(deltaLine, deltaText);
      block.append(deltaLine);
    }

    return block;
  }

  function mixColor(from, to, ratio) {
    const t = Math.max(0, Math.min(1, ratio));
    const red = Math.round(from[0] + (to[0] - from[0]) * t);
    const green = Math.round(from[1] + (to[1] - from[1]) * t);
    const blue = Math.round(from[2] + (to[2] - from[2]) * t);
    return `rgb(${red} ${green} ${blue})`;
  }

  function addConfidenceBounds(track, low, high, center) {
    if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(center)) return;
    const lower = Math.max(0, Math.min(100, Math.min(low, high)));
    const upper = Math.max(0, Math.min(100, Math.max(low, high)));
    const range = document.createElement("span");
    range.className = "score-confidence-range";
    range.style.left = `${lower}%`;
    range.style.width = `${Math.max(0, upper - lower)}%`;
    const marker = document.createElement("span");
    marker.className = "score-confidence-center";
    marker.style.left = `${Math.max(0, Math.min(100, center))}%`;
    track.append(range, marker);
  }

  function addConfidenceRange(track, average, halfWidth) {
    if (!Number.isFinite(average) || !Number.isFinite(halfWidth) || halfWidth < 0) return;
    addConfidenceBounds(track, average - halfWidth, average + halfWidth, average);
  }

  function createPaneProgress(value, color, confidence = null) {
    const track = document.createElement("span");
    track.className = "pane-progress";
    track.style.setProperty("--confidence-color", color);
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "pane-progress-fill";
    fill.style.width = `${Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))}%`;
    fill.style.backgroundColor = color;
    track.append(fill);
    addConfidenceRange(track, value, confidence);
    return track;
  }

  function addMetricProgress(block, metric, summary, mode, color) {
    const contribution = metricContribution(mode, metric.key, summary.avgValue);
    const progress = createPaneProgress(contribution ? (contribution.points / contribution.maxPoints) * 100 : 0, color);
    if (contribution && Number.isFinite(summary.ci95Value)) {
      const lowValue = Math.max(0, summary.avgValue - summary.ci95Value);
      const highValue = summary.avgValue + summary.ci95Value;
      const lowScore = metricContribution(mode, metric.key, highValue);
      const highScore = metricContribution(mode, metric.key, lowValue);
      addConfidenceBounds(progress, lowScore.score, highScore.score, contribution.score);
      const pointsLine = block.querySelector(".metric-points-line");
      const explanation = `95% confidence interval for the average measured value: ${metric.format(lowValue)}–${metric.format(highValue)}; approximately ${formatPointValue(lowScore.points)}–${formatPointValue(highScore.points)} weighted points.`;
      pointsLine.dataset.tooltip += ` ${explanation}`;
      pointsLine.title = pointsLine.dataset.tooltip;
      pointsLine.setAttribute("aria-label", `${pointsLine.getAttribute("aria-label")} ${explanation}`);
    }
    block.prepend(progress);
  }

  function getScorePalette(kind = "surface") {
    const isDark = document.documentElement.dataset.theme === "dark";
    const bar = isDark
      ? { low: [239, 133, 130], mid: [243, 189, 96], high: [99, 200, 161], neutral: [154, 164, 178] }
      : { low: [225, 100, 100], mid: [217, 154, 43], high: [50, 166, 124], neutral: [137, 148, 162] };
    if (kind === "bar") return bar;

    // Use the same hues as the site bars, softened against the page surface.
    const canvas = isDark ? [34, 38, 45] : [255, 255, 255];
    const strength = isDark ? 0.4 : 0.36;
    return Object.fromEntries(Object.entries(bar).map(([key, color]) => [
      key,
      color.map((channel, index) => Math.round(canvas[index] + (channel - canvas[index]) * strength)),
    ]));
  }

  function percentileColor(percentile, kind = "surface") {
    if (!Number.isFinite(percentile)) {
      return "";
    }

    const { low, mid, high } = getScorePalette(kind);
    const p = Math.max(0, Math.min(100, percentile));

    if (p <= 50) {
      return mixColor(low, mid, p / 50);
    }
    return mixColor(mid, high, (p - 50) / 50);
  }

  function absoluteScoreColor(score, kind = "surface") {
    if (!Number.isFinite(score)) return "";
    const { low, mid, high } = getScorePalette(kind);
    if (score <= 50) return mixColor(low, low, 0);
    if (score <= 70) return mixColor(low, mid, (score - 50) / 20);
    return mixColor(mid, high, (score - 70) / 20);
  }

  function relativeDeltaColor(delta, maxAbsDelta, kind = "surface") {
    if (!Number.isFinite(delta)) {
      return "";
    }
    const { low, neutral, high } = getScorePalette(kind);
    if (!Number.isFinite(maxAbsDelta) || maxAbsDelta <= 0) {
      return mixColor(neutral, neutral, 0);
    }
    const ratio = Math.max(-1, Math.min(1, delta / maxAbsDelta));
    if (ratio >= 0) {
      return mixColor(neutral, high, ratio);
    }
    return mixColor(neutral, low, Math.abs(ratio));
  }

  function getSummaryBackgroundColor(mode, avgScore, renderContext, kind = "surface") {
    if (state.colorMode === "absolute") return absoluteScoreColor(avgScore, kind);
    const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
    if (baselineSummary && Number.isFinite(avgScore) && Number.isFinite(baselineSummary.avgScore)) {
      return relativeDeltaColor(
        avgScore - baselineSummary.avgScore,
        renderContext.deltaScales.summaryByMode?.[mode] || 0,
        kind,
      );
    }
    const percentile = getPercentile(renderContext.scoreSummaryPopulationByMode[mode], avgScore, true);
    return percentileColor(percentile, kind);
  }

  function getRunBackgroundColor(mode, score, renderContext, kind = "surface") {
    if (state.colorMode === "absolute") return absoluteScoreColor(score, kind);
    const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
    if (baselineSummary && Number.isFinite(score) && Number.isFinite(baselineSummary.avgScore)) {
      return relativeDeltaColor(
        score - baselineSummary.avgScore,
        renderContext.deltaScales.runByMode?.[mode] || 0,
        kind,
      );
    }
    const percentile = getPercentile(renderContext.runScorePopulationByMode[mode], score, true);
    return percentileColor(percentile, kind);
  }

  function getMetricBackgroundColor(mode, metricKey, metricValue, renderContext, kind = "surface") {
    if (state.colorMode === "absolute") {
      const contribution = metricContribution(mode, metricKey, metricValue);
      return absoluteScoreColor(contribution ? (contribution.points / contribution.maxPoints) * 100 : null, kind);
    }
    const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
    const baselineMetric = baselineSummary?.metrics?.[metricKey] || null;
    if (baselineMetric) {
      const currentContribution = metricContribution(mode, metricKey, metricValue);
      const baselineContribution = metricContribution(mode, metricKey, baselineMetric.avgValue);
      if (currentContribution && baselineContribution) {
        return relativeDeltaColor(
          currentContribution.points - baselineContribution.points,
          renderContext.deltaScales.metricByMode?.[mode]?.[metricKey] || 0,
          kind,
        );
      }
    }

    const pointsForColor = contributionPointsForDisplay(mode, metricKey, metricValue);
    const percentile = getPercentile(
      renderContext.metricPopulationsByMode[mode][metricKey],
      pointsForColor,
      true,
    );
    return percentileColor(percentile, kind);
  }

  function parseRgbColor(color) {
    const match = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!match) {
      return null;
    }
    return {
      r: Number.parseInt(match[1], 10),
      g: Number.parseInt(match[2], 10),
      b: Number.parseInt(match[3], 10),
    };
  }

  function textColorForBackground(color) {
    const parsed = parseRgbColor(color);
    if (!parsed) {
      return "#111827";
    }
    const luminance = (0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b) / 255;
    return luminance < 0.58 ? "#f8fafc" : "#111827";
  }

  function formatConfidence(ciValue) {
    if (ciValue === null) {
      return "Need 2+ samples";
    }

    return `±${ciValue.toFixed(1)} pts`;
  }

  function buildRenderContext() {
    const summariesByUrl = new Map();
    const scoreSummaryPopulationByMode = {};
    const runScorePopulationByMode = {};
    const metricPopulationsByMode = {};

    for (const mode of STRATEGIES) {
      scoreSummaryPopulationByMode[mode] = [];
      runScorePopulationByMode[mode] = [];
      metricPopulationsByMode[mode] = {};
      for (const metric of METRICS) {
        metricPopulationsByMode[mode][metric.key] = [];
      }
    }

    for (const tracker of state.trackers.values()) {
      const modeSummaries = {};

      for (const mode of STRATEGIES) {
        const samples = tracker.history[mode];
        const summary = summarize(samples);
        modeSummaries[mode] = summary;

        for (const sample of samples) {
          if (Number.isFinite(sample.performanceScore)) {
            runScorePopulationByMode[mode].push(sample.performanceScore);
            scoreSummaryPopulationByMode[mode].push(sample.performanceScore);
          }
          for (const metric of METRICS) {
            const value = sample.metrics?.[metric.key]?.value;
            if (Number.isFinite(value)) {
              const points = contributionPointsForDisplay(mode, metric.key, value);
              if (Number.isFinite(points)) {
                metricPopulationsByMode[mode][metric.key].push(points);
              }
            }
          }
        }

        if (!summary) {
          continue;
        }
      }

      summariesByUrl.set(tracker.url, modeSummaries);
    }

    const baselineUrl =
      state.comparisonBaseUrl && summariesByUrl.has(state.comparisonBaseUrl) ? state.comparisonBaseUrl : null;
    const baselineSummariesByMode = baselineUrl ? (summariesByUrl.get(baselineUrl) || {}) : {};
    const deltaScales = {
      summaryByMode: {
        mobile: 0,
        desktop: 0,
      },
      runByMode: {
        mobile: 0,
        desktop: 0,
      },
      metricByMode: {
        mobile: {},
        desktop: {},
      },
    };
    for (const mode of STRATEGIES) {
      for (const metric of METRICS) {
        deltaScales.metricByMode[mode][metric.key] = 0;
      }
    }

    if (baselineUrl) {
      for (const tracker of state.trackers.values()) {
        const trackerSummaries = summariesByUrl.get(tracker.url) || {};
        for (const mode of STRATEGIES) {
          const baselineSummary = baselineSummariesByMode[mode];
          if (!baselineSummary || !Number.isFinite(baselineSummary.avgScore)) {
            continue;
          }

          const modeSummary = trackerSummaries[mode] || null;
          if (modeSummary && Number.isFinite(modeSummary.avgScore)) {
            deltaScales.summaryByMode[mode] = Math.max(
              deltaScales.summaryByMode[mode],
              Math.abs(modeSummary.avgScore - baselineSummary.avgScore),
            );
          }

          for (const sample of tracker.history[mode]) {
            if (!Number.isFinite(sample.performanceScore)) {
              continue;
            }
            deltaScales.runByMode[mode] = Math.max(
              deltaScales.runByMode[mode],
              Math.abs(sample.performanceScore - baselineSummary.avgScore),
            );
          }

          if (!modeSummary) {
            continue;
          }
          for (const metric of METRICS) {
            const modeMetric = modeSummary.metrics?.[metric.key];
            const baselineMetric = baselineSummary.metrics?.[metric.key];
            if (!modeMetric || !baselineMetric) {
              continue;
            }
            const currentContribution = metricContribution(mode, metric.key, modeMetric.avgValue);
            const baselineContribution = metricContribution(mode, metric.key, baselineMetric.avgValue);
            if (!currentContribution || !baselineContribution) {
              continue;
            }
            deltaScales.metricByMode[mode][metric.key] = Math.max(
              deltaScales.metricByMode[mode][metric.key],
              Math.abs(currentContribution.points - baselineContribution.points),
            );
          }
        }
      }
    }

    return {
      summariesByUrl,
      scoreSummaryPopulationByMode,
      runScorePopulationByMode,
      metricPopulationsByMode,
      baselineUrl,
      baselineSummariesByMode,
      deltaScales,
    };
  }

  function renderSummaryTile(tile, summary, mode, renderContext, options = {}) {
    const {
      baselineSummary = null,
      isBaselineCard = false,
    } = options;
    const scoreNode = tile.querySelector(".tile-score");
    const metaNode = tile.querySelector(".tile-meta");
    tile.style.backgroundColor = "";
    tile.style.borderColor = "";
    tile.querySelector(".pane-progress")?.remove();

    if (!summary) {
      scoreNode.textContent = "--";
      metaNode.innerHTML = "";
      const main = document.createElement("span");
      main.className = "tile-meta-main";
      main.textContent = "Need runs";
      const sub = document.createElement("span");
      sub.className = "tile-meta-sub";
      sub.textContent = state.autoPauseTarget === null ? "Auto-pause off" : `±${state.autoPauseTarget} in ? runs`;
      metaNode.append(main, sub);
      return;
    }

    scoreNode.textContent = summary.avgScore.toFixed(1);
    let deltaLine = "";
    if (isBaselineCard) {
      deltaLine = "baseline";
    } else if (
      baselineSummary &&
      Number.isFinite(summary.avgScore) &&
      Number.isFinite(baselineSummary.avgScore)
    ) {
      const delta = summary.avgScore - baselineSummary.avgScore;
      deltaLine = baselineDelta(delta, baselineSummary.avgScore);
    }
    const mainLine = `${formatConfidence(summary.ci95HalfWidth)} (${summary.samples} runs)`;
    const subLine = formatGoalEstimate(summary);

    metaNode.innerHTML = "";
    const main = document.createElement("span");
    main.className = "tile-meta-main";
    main.textContent = mainLine;
    const sub = document.createElement("span");
    sub.className = "tile-meta-sub";
    sub.textContent = subLine;
    metaNode.append(main);
    if (deltaLine) {
      const deltaNode = document.createElement("span");
      deltaNode.className = "tile-meta-delta";
      setBaselineDeltaLabel(deltaNode, deltaLine);
      metaNode.append(deltaNode);
    }
    metaNode.append(sub);

    tile.querySelector(".tile-label").after(createPaneProgress(summary.avgScore, getSummaryBackgroundColor(mode, summary.avgScore, renderContext, "bar"), summary.ci95HalfWidth));
  }

  function formatGoalEstimate(summary) {
    const target = state.autoPauseTarget;
    if (target === null) return "Auto-pause off";
    if (!summary || summary.samples < 2) return `±${target} in ? runs`;
    const required = Math.max(MIN_STAT_SIG_SAMPLES, Math.ceil(((1.96 * summary.scoreStdDev) / target) ** 2));
    const remaining = Math.max(0, required - summary.samples);
    return remaining ? `±${target} in ${remaining} ${remaining === 1 ? "run" : "runs"}` : `±${target} reached`;
  }

  function renderMetricSummary(tbody, mobileSummary, desktopSummary, renderContext, options = {}) {
    const {
      baselineMobileSummary = null,
      baselineDesktopSummary = null,
      isBaselineCard = false,
    } = options;
    tbody.innerHTML = "";

    for (const metric of METRICS) {
      const row = document.createElement("tr");
      const labelCell = document.createElement("td");
      labelCell.textContent = metric.label;
      row.append(labelCell);

      const mobileCell = document.createElement("td");
      const mobileMetric = mobileSummary?.metrics?.[metric.key];
      if (!mobileMetric) {
        mobileCell.textContent = "--";
      } else {
        const mobileCellColor = getMetricBackgroundColor(
          "mobile",
          metric.key,
          mobileMetric.avgValue,
          renderContext, "bar",
        );
        let mobileDeltaText = "";
        if (isBaselineCard) {
          mobileDeltaText = "baseline";
        } else {
          const baselineMobileMetric = baselineMobileSummary?.metrics?.[metric.key];
          if (baselineMobileMetric) {
            const mobileContribution = metricContribution("mobile", metric.key, mobileMetric.avgValue);
            const baselineMobileContribution = metricContribution("mobile", metric.key, baselineMobileMetric.avgValue);
            if (mobileContribution && baselineMobileContribution) {
              const deltaPoints = mobileContribution.points - baselineMobileContribution.points;
              mobileDeltaText = baselineDelta(deltaPoints, baselineMobileContribution.points);
            }
          }
        }
        mobileCell.append(
          createMetricValueBlock(
            metric,
            mobileMetric.avgValue,
            null,
            "mobile",
            false,
            null,
            mobileDeltaText,
          ),
        );
        addMetricProgress(mobileCell.querySelector(".metric-cell"), metric, mobileMetric, "mobile", mobileCellColor);
      }
      row.append(mobileCell);

      const desktopCell = document.createElement("td");
      const desktopMetric = desktopSummary?.metrics?.[metric.key];
      if (!desktopMetric) {
        desktopCell.textContent = "--";
      } else {
        const desktopCellColor = getMetricBackgroundColor(
          "desktop",
          metric.key,
          desktopMetric.avgValue,
          renderContext, "bar",
        );
        let desktopDeltaText = "";
        if (isBaselineCard) {
          desktopDeltaText = "baseline";
        } else {
          const baselineDesktopMetric = baselineDesktopSummary?.metrics?.[metric.key];
          if (baselineDesktopMetric) {
            const desktopContribution = metricContribution("desktop", metric.key, desktopMetric.avgValue);
            const baselineDesktopContribution = metricContribution("desktop", metric.key, baselineDesktopMetric.avgValue);
            if (desktopContribution && baselineDesktopContribution) {
              const deltaPoints = desktopContribution.points - baselineDesktopContribution.points;
              desktopDeltaText = baselineDelta(deltaPoints, baselineDesktopContribution.points);
            }
          }
        }
        desktopCell.append(
          createMetricValueBlock(
            metric,
            desktopMetric.avgValue,
            null,
            "desktop",
            false,
            null,
            desktopDeltaText,
          ),
        );
        addMetricProgress(desktopCell.querySelector(".metric-cell"), metric, desktopMetric, "desktop", desktopCellColor);
      }
      row.append(desktopCell);

      tbody.append(row);
    }
  }

  return { formatPointValue, formatSignedNumber, formatDeltaPointsAndPercent, baselineDelta, setBaselineDeltaLabel, contributionPointsForDisplay, formatContributionText, createMetricValueBlock, mixColor, addConfidenceBounds, addConfidenceRange, createPaneProgress, addMetricProgress, getScorePalette, percentileColor, absoluteScoreColor, relativeDeltaColor, getSummaryBackgroundColor, getRunBackgroundColor, getMetricBackgroundColor, parseRgbColor, textColorForBackground, formatConfidence, buildRenderContext, renderSummaryTile, formatGoalEstimate, renderMetricSummary };
}
