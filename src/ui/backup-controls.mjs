// Handles backup file selection and download; the app owns the bulk-confirm action.
export function createBackupControls({ state, hasApiKey, createBackup, validateBackup,
  getOrderedTrackers, setPendingImport, bulkActionTitle, bulkActionDescription,
  bulkActionConfirm, bulkActionDialog }) {
document.getElementById("export-data").addEventListener("click", () => {
  const includeKey = document.getElementById("export-include-key").checked && hasApiKey();
  const backup = createBackup(state, getOrderedTrackers(), includeKey);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `pagespeeder-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.getElementById("data-status").textContent = includeKey ? "Backup downloaded with your API key." : "Backup downloaded. Your API key is not included.";
});

const importFile = document.getElementById("import-file");
document.getElementById("import-data").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  try {
    const backup = validateBackup(JSON.parse(await file.text()));
    setPendingImport(backup);
    bulkActionTitle.textContent = "Import backup?";
    bulkActionDescription.textContent = `Replace your current sites and run history with ${backup.sites.length} ${backup.sites.length === 1 ? "site" : "sites"} from this backup? Imported sites will be paused. ${backup.apiKey !== undefined ? "The API key in the backup will replace your current key." : "Your API key will stay the same."} Your settings will stay the same.`;
    bulkActionConfirm.textContent = "Import data";
    document.getElementById("data-status").textContent = "";
    bulkActionDialog.showModal();
    document.getElementById("bulk-action-cancel").focus();
  } catch (error) {
    document.getElementById("data-status").textContent = error instanceof SyntaxError ? "Couldn’t read this file as JSON." : error.message;
  }
});

}
