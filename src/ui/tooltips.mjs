export function createTooltipController({ uiTooltip, isDragging }) {
  const TOOLTIP_DELAY_MS = 250;
  const TOOLTIP_HIDE_GRACE_MS = 120;
  let tooltipAnchor = null;
  let tooltipShowTimerId = null;
  let tooltipHideTimerId = null;

function hideTooltip() {
  if (tooltipShowTimerId) {
    clearTimeout(tooltipShowTimerId);
    tooltipShowTimerId = null;
  }
  if (tooltipHideTimerId) {
    clearTimeout(tooltipHideTimerId);
    tooltipHideTimerId = null;
  }
  if (!uiTooltip) {
    return;
  }
  uiTooltip.classList.remove("visible");
  uiTooltip.hidden = true;
  tooltipAnchor = null;
}

function isTooltipTarget(node) {
  return Boolean(node instanceof Element && node.closest("[data-tooltip]"));
}

function positionTooltip() {
  if (!uiTooltip || !tooltipAnchor) {
    return;
  }
  if (!tooltipAnchor.isConnected) {
    hideTooltip();
    return;
  }

  const rect = tooltipAnchor.getBoundingClientRect();
  const spacing = 8;
  const width = uiTooltip.offsetWidth;
  const height = uiTooltip.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(6, Math.min(left, viewportWidth - width - 6));

  let top = rect.top - height - spacing;
  if (top < 6) {
    top = rect.bottom + spacing;
  }
  if (top + height > viewportHeight - 6) {
    top = Math.max(6, viewportHeight - height - 6);
  }

  uiTooltip.style.left = `${left}px`;
  uiTooltip.style.top = `${top}px`;
}

function showTooltipNow(text, anchor) {
  if (!uiTooltip || !text || !anchor || !anchor.isConnected) {
    return;
  }
  uiTooltip.textContent = text;
  tooltipAnchor = anchor;
  uiTooltip.hidden = false;
  positionTooltip();
  requestAnimationFrame(() => {
    if (uiTooltip) {
      uiTooltip.classList.add("visible");
    }
  });
}

function showTooltip(text, anchor, instant = false) {
  if (isDragging()) {
    hideTooltip();
    return;
  }
  if (!text || !anchor) {
    return;
  }

  if (tooltipHideTimerId) {
    clearTimeout(tooltipHideTimerId);
    tooltipHideTimerId = null;
  }

  const tooltipAlreadyVisible = Boolean(uiTooltip && !uiTooltip.hidden && uiTooltip.classList.contains("visible"));
  if (instant || tooltipAlreadyVisible) {
    if (tooltipShowTimerId) {
      clearTimeout(tooltipShowTimerId);
      tooltipShowTimerId = null;
    }
    showTooltipNow(text, anchor);
    return;
  }

  if (tooltipShowTimerId) {
    clearTimeout(tooltipShowTimerId);
  }
  tooltipShowTimerId = setTimeout(() => {
    tooltipShowTimerId = null;
    showTooltipNow(text, anchor);
  }, TOOLTIP_DELAY_MS);
}

function scheduleTooltipHide() {
  if (tooltipShowTimerId) {
    clearTimeout(tooltipShowTimerId);
    tooltipShowTimerId = null;
  }
  if (tooltipHideTimerId) {
    clearTimeout(tooltipHideTimerId);
  }
  tooltipHideTimerId = setTimeout(() => {
    tooltipHideTimerId = null;
    hideTooltip();
  }, TOOLTIP_HIDE_GRACE_MS);
}

function attachTooltipHandlers(element) {
  if (!element) {
    return;
  }

  const getText = () => element.dataset.tooltip || "";
  element.addEventListener("mouseenter", () => {
    showTooltip(getText(), element, false);
  });
  element.addEventListener("mouseleave", (event) => {
    if (isTooltipTarget(event.relatedTarget)) {
      return;
    }
    scheduleTooltipHide();
  });
  element.addEventListener("focus", () => {
    showTooltip(getText(), element, true);
  });
  element.addEventListener("blur", () => {
    scheduleTooltipHide();
  });
}


  return { hideTooltip, attachTooltipHandlers };
}
