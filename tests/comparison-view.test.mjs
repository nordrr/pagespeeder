import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparisonView } from '../src/views/comparison.mjs';

function setup() {
  const handlers = {};
  const classes = new Set();
  const header = {
    dataset: { sortKey: 'avgScore' },
    classList: { add: (...values) => values.forEach((value) => classes.add(value)), remove: (...values) => values.forEach((value) => classes.delete(value)) },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    blur: () => { header.blurred = true; },
  };
  const state = { sort: { key: null, direction: null }, trackers: new Map() };
  let saves = 0;
  let renders = 0;
  const body = { innerHTML: 'old', children: [], append(node) { this.children.push(node); } };
  const document = { createElement(tag) { return { tag, children: [], append(node) { this.children.push(node); } }; } };
  const view = createComparisonView({ state, sortableHeaders: [header], comparisonBody: body, SORTABLE_KEYS: new Set(['avgScore']), persistState: () => saves++, render: () => renders++, document });
  return { state, view, header, handlers, classes, body, counts: () => [saves, renders] };
}

test('header interactions cycle sorting and persist each change', () => {
  const { state, view, header, handlers, classes, counts } = setup();
  view.initSortHeaders();
  assert.equal(header.tabIndex, 0);
  let prevented = false;
  handlers.mousedown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  handlers.click();
  assert.deepEqual(state.sort, { key: 'avgScore', direction: 'asc' });
  assert.equal(header.blurred, true);
  view.updateSortHeaderIndicators();
  assert.ok(classes.has('sort-asc'));
  handlers.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(state.sort.direction, 'desc');
  handlers.keydown({ key: ' ', preventDefault() {} });
  assert.deepEqual(state.sort, { key: null, direction: null });
  view.toggleSort('unsupported');
  assert.deepEqual(counts(), [3, 3]);
});

test('sorting preserves original rows and current null ordering, including descending', () => {
  const { state, view } = setup();
  const rows = [{ sortValues: { avgScore: 2 } }, { sortValues: { avgScore: null } }, { sortValues: { avgScore: 1 } }];
  assert.equal(view.sortRows(rows), rows);
  state.sort = { key: 'avgScore', direction: 'asc' };
  assert.deepEqual(view.sortRows(rows).map((r) => r.sortValues.avgScore), [1, 2, null]);
  state.sort.direction = 'desc';
  assert.deepEqual(view.sortRows(rows).map((r) => r.sortValues.avgScore), [null, 2, 1]);
  assert.deepEqual(rows.map((r) => r.sortValues.avgScore), [2, null, 1]);
});

test('empty comparison renders the existing placeholder', () => {
  const { view, body } = setup();
  view.renderComparisonTable({});
  assert.equal(body.innerHTML, '');
  const cell = body.children[0].children[0];
  assert.equal(cell.colSpan, 10);
  assert.equal(cell.textContent, 'No URLs yet. Add one above to begin tracking.');
});
