import test from 'node:test';
import assert from 'node:assert/strict';
import { createSitesView } from '../src/views/sites.mjs';

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.style = {setProperty(){}, removeProperty(){}}; this.handlers = {}; this.classList = {add(){}, remove(){}, toggle(){}}; this.attributes = {}; this.hidden = false; }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.handlers[type] || []) fn(event); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getClientRects() { return []; }
  querySelectorAll(selector) { if (selector === 'small') return this.children.flatMap(child => [ ...(child.tag === 'small' ? [child] : []), ...child.querySelectorAll(selector) ]); return []; }
  querySelector() { return null; }
  getBoundingClientRect() { return {top:0, bottom:100, left:0}; }
}

test('site library renders filtered rows and selection updates through the shared state', () => {
  const old = {document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver};
  const ids = Object.fromEntries(['site-list', 'site-list-rows', 'site-search', 'site-count', 'site-selection'].map(id => [id, new Element()]));
  ids['site-search'].value = '';
  const library = new Element(); const add = new Element(); const main = new Element();
  const document = new Element();
  document.body = new Element(); document.createElement = tag => new Element(tag);
  document.getElementById = id => ids[id];
  document.querySelector = selector => ({'.site-library':library, '.library-add':add, 'main':main})[selector] || null;
  globalThis.document = document; globalThis.window = new Element();
  globalThis.ResizeObserver = class { observe() {} };
  try {
    const a = {url:'https://a.example/', label:'Alpha', running:false};
    const b = {url:'https://b.example/', label:'Beta', running:false};
    const state = {trackers:new Map([[a.url,a],[b.url,b]]), trackerOrder:[a.url,b.url], comparisonBaseUrl:null};
    const selection = {selectedSiteUrl:null, openSiteMenuUrl:null};
    const calls = [];
    const noop = () => {};
    const view = createSitesView({state, selection, getOrderedTrackerUrls:()=>state.trackerOrder, getOrderedTrackers:()=>[a,b], persistState:noop, render:()=>calls.push('render'), hideTooltip:noop, updateConnectedEdgeShadow:noop, createConnectedEdgeShadow:noop, parseUrlSafe:value=>new URL(value), describeTrackerStatus:()=> 'Paused', getSummaryBackgroundColor:noop, addConfidenceRange:noop, formatGoalEstimate:noop, baselineDelta:noop, setBaselineDeltaLabel:noop, closeRunDetailPanel:noop, setWorkspaceView:value=>calls.push(value), beginLabelEditing:noop, openRemoveSiteDialog:noop, stopTracker:noop, startTracker:noop, ensureApiKeyConfigured:()=>true, iconMarkup:x=>x, ellipsisSvg:'', playSvg:'', pauseSvg:'', ICON_BASELINE:''});
    const context = {summariesByUrl:new Map()};
    view.renderSiteLibrary(context);
    assert.equal(selection.selectedSiteUrl, a.url);
    assert.equal(ids['site-count'].textContent, '2 sites · 0 running');
    assert.equal(ids['site-list-rows'].children.length, 2);
    const secondButton = ids['site-list-rows'].children[1].children.find(node => node.className === 'site-item');
    secondButton.dispatch('click');
    assert.equal(selection.selectedSiteUrl, b.url);
    assert.deepEqual(calls, ['sites', 'render']);
    ids['site-search'].value = 'alpha';
    view.renderSiteLibrary(context);
    assert.equal(ids['site-list-rows'].children.length, 1);
    assert.equal(ids['site-list-rows'].children[0].dataset.url, a.url);
  } finally { Object.assign(globalThis, old); }
});
