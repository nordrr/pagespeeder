// Owns the API-key dialog and deferred add-site flow.
export function createApiKeyController({ state, settingsForm, apiKeyInput, apiKeyDialog,
  apiKeyIntro, apiKeyDialogCloseButton, skipSetupButton, clearApiKeyButton,
  saveApiKeyButton, openSettingsButton, apiKeyStatus, setupHint,
  FIXED_POLL_INTERVAL_SEC, persistState, render, addTrackerAndStart }) {
let pendingAddUrlAfterKey = null;
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (syncConfigFromInputs()) {
    const pendingUrl = pendingAddUrlAfterKey;
    pendingAddUrlAfterKey = null;
    closeApiKeyDialog();
    if (pendingUrl) {
      addTrackerAndStart(pendingUrl);
    } else {
      render();
    }
  }
});

openSettingsButton?.addEventListener("click", () => {
  openApiKeyDialog();
});

apiKeyDialogCloseButton?.addEventListener("click", () => {
  closeApiKeyDialog();
});
skipSetupButton?.addEventListener("click", closeApiKeyDialog);

apiKeyDialog?.addEventListener("click", (event) => {
  if (event.target === apiKeyDialog && apiKeyIntro.hidden) {
    closeApiKeyDialog();
  }
});

apiKeyDialog?.addEventListener("close", () => {
  pendingAddUrlAfterKey = null;
  apiKeyInput.value = state.apiKey;
  updateApiKeyUi();
});

clearApiKeyButton?.addEventListener("click", () => {
  state.apiKey = "";
  apiKeyInput.value = "";
  persistState();
  render();
  apiKeyInput.focus();
});

function syncConfigFromInputs() {
  const key = apiKeyInput.value.trim();

  if (!key) {
    apiKeyInput.focus();
    apiKeyInput.reportValidity();
    return false;
  }

  state.apiKey = key;
  state.pollIntervalSec = FIXED_POLL_INTERVAL_SEC;

  persistState();
  return true;
}

function hasApiKey() {
  return Boolean(state.apiKey.trim());
}

function openApiKeyDialog(options = {}) {
  if (!apiKeyDialog) {
    return;
  }
  pendingAddUrlAfterKey = options.pendingUrl || null;
  const onboarding = options.onboarding === true;
  document.getElementById("api-key-dialog-title").textContent = onboarding ? "Welcome to PageSpeeder" : "Google PageSpeed API key";
  apiKeyIntro.hidden = !onboarding;
  document.getElementById("api-key-get-started").hidden = !onboarding;
  skipSetupButton.hidden = !onboarding;
  clearApiKeyButton.hidden = onboarding;
  apiKeyInput.value = state.apiKey;
  if (saveApiKeyButton) {
    saveApiKeyButton.textContent = pendingAddUrlAfterKey ? "Save Key & Start" : onboarding ? "Save and continue" : "Save Key";
  }
  if (!apiKeyDialog.open) {
    apiKeyDialog.showModal();
  }
  requestAnimationFrame(() => {
    apiKeyInput.focus();
    apiKeyInput.select();
  });
}

function closeApiKeyDialog() {
  if (apiKeyDialog?.open) {
    apiKeyDialog.close();
  }
}

function ensureApiKeyConfigured() {
  if (hasApiKey()) {
    return true;
  }
  openApiKeyDialog();
  return false;
}

function updateApiKeyUi() {
  const configured = hasApiKey();
  const exportIncludeKey = document.getElementById("export-include-key");
  exportIncludeKey.disabled = !configured;
  if (!configured) exportIncludeKey.checked = false;
  if (apiKeyStatus) {
    apiKeyStatus.textContent = configured ? "Saved" : "Not set";
  }
  openSettingsButton?.classList.toggle("is-configured", configured);
  if (setupHint) {
    setupHint.textContent = configured
      ? "Runs use your saved key from this browser."
      : "Add your Google PageSpeed API key before the first run.";
    setupHint.classList.toggle("is-ready", configured);
  }
  if (clearApiKeyButton) {
    clearApiKeyButton.disabled = !configured;
  }
}

return { hasApiKey, openApiKeyDialog, closeApiKeyDialog, ensureApiKeyConfigured, updateApiKeyUi };
}
