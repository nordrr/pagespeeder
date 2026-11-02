export function createWorkspaceNavigation({ state, closeRunDetailPanel, positionSiteSelection, positionSettingsThemeIndicator }) {
let currentWorkspaceView = "sites";
function setWorkspaceView(view) {
  currentWorkspaceView = view;
  if (view !== "sites" && state.runDetail) closeRunDetailPanel();
  document.getElementById("sites-view").hidden = view !== "sites";
  document.getElementById("comparison-view").hidden = view !== "comparison";
  document.getElementById("settings-view").hidden = view !== "settings";
  document.body.classList.toggle("comparison-active", view !== "sites");
  const library = document.querySelector(".site-library");
  const addPanel = document.querySelector(".library-add");
  const comparisonAddSlot = document.getElementById("comparison-add-slot");
  (view === "comparison" ? comparisonAddSlot : library).append(addPanel);
  comparisonAddSlot.hidden = view !== "comparison";
  library.inert = view !== "sites";
  library.setAttribute("aria-hidden", view === "sites" ? "false" : "true");
  document.querySelectorAll(".workspace-tab[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("selected", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "sites") requestAnimationFrame(positionSiteSelection);
  if (view === "settings") requestAnimationFrame(positionSettingsThemeIndicator);
}

let workspaceTransition = null;
function switchWorkspaceView(view) {
  const currentView = currentWorkspaceView;
  if (view === currentView) {
    if (view === "sites" && state.runDetail) closeRunDetailPanel({ restoreFocus: false });
    return;
  }
  if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("keyboard-input")) {
    setWorkspaceView(view);
    return;
  }
  document.body.classList.add("moving-add-panel");
  const transition = document.startViewTransition(() => setWorkspaceView(view));
  workspaceTransition = transition;
  transition.finished.finally(() => {
    if (workspaceTransition === transition) {
      workspaceTransition = null;
      document.body.classList.remove("moving-add-panel");
    }
  }).catch(() => {});
}


  return { switchWorkspaceView, setWorkspaceView };
}
