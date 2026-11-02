import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiKeyController } from '../src/ui/api-key.mjs';
import { createBackupControls } from '../src/ui/backup-controls.mjs';

class Node {
  constructor() { this.handlers = {}; this.value = ''; this.classList = {toggle(){}}; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  dispatch(type, event = {}) { return this.handlers[type]?.(event); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  reportValidity() { this.reported = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  click() { this.clicked = true; this.dispatch('click'); }
}

test('key dialog saves a trimmed key and starts the deferred site once', () => {
  const previous = {document:globalThis.document, requestAnimationFrame:globalThis.requestAnimationFrame};
  const nodes = Object.fromEntries(['api-key-dialog-title', 'api-key-get-started', 'export-include-key'].map(id => [id, new Node()]));
  globalThis.document = {getElementById:id=>nodes[id]}; globalThis.requestAnimationFrame = fn=>fn();
  try {
    const state = {apiKey:'', pollIntervalSec:12};
    const settingsForm = new Node(), apiKeyInput = new Node(), apiKeyDialog = new Node();
    const calls = [];
    const ui = createApiKeyController({state, settingsForm, apiKeyInput, apiKeyDialog,
      apiKeyIntro:new Node(), apiKeyDialogCloseButton:new Node(), skipSetupButton:new Node(),
      clearApiKeyButton:new Node(), saveApiKeyButton:new Node(), openSettingsButton:new Node(),
      apiKeyStatus:new Node(), setupHint:new Node(), FIXED_POLL_INTERVAL_SEC:60,
      persistState:()=>calls.push('persist'), render:()=>calls.push('render'), addTrackerAndStart:url=>calls.push(url)});
    ui.openApiKeyDialog({pendingUrl:'https://example.com/'});
    apiKeyInput.value = '  secret  ';
    settingsForm.dispatch('submit', {preventDefault(){}});
    assert.equal(state.apiKey, 'secret'); assert.equal(state.pollIntervalSec, 60);
    assert.deepEqual(calls, ['persist', 'https://example.com/']);
    assert.equal(apiKeyDialog.open, false);
    assert.equal(ui.ensureApiKeyConfigured(), true);
  } finally { Object.assign(globalThis, previous); }
});

test('backup selection validates before opening the shared confirmation dialog', async () => {
  const previous = globalThis.document;
  const nodes = Object.fromEntries(['export-data','export-include-key','import-file','import-data','data-status','bulk-action-cancel'].map(id=>[id,new Node()]));
  globalThis.document = {getElementById:id=>nodes[id]};
  try {
    const bulkActionDialog = new Node(), title = new Node(), description = new Node(), confirm = new Node();
    let pending = null;
    createBackupControls({state:{}, hasApiKey:()=>false, createBackup:()=>({}), validateBackup:data=>data,
      getOrderedTrackers:()=>[], setPendingImport:data=>{ pending=data; }, bulkActionTitle:title,
      bulkActionDescription:description, bulkActionConfirm:confirm, bulkActionDialog});
    nodes['import-file'].files = [{text:async()=>'{bad'}];
    await nodes['import-file'].dispatch('change');
    assert.equal(nodes['data-status'].textContent, 'Couldn’t read this file as JSON.');
    assert.equal(pending, null); assert.equal(bulkActionDialog.open, undefined);
    nodes['import-file'].files = [{text:async()=>JSON.stringify({sites:[{}]})}];
    await nodes['import-file'].dispatch('change');
    assert.equal(pending.sites.length, 1); assert.equal(bulkActionDialog.open, true);
    assert.match(description.textContent, /1 site/);
    assert.match(description.textContent, /API key will stay the same/);
  } finally { globalThis.document = previous; }
});
