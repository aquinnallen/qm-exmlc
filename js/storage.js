(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};

  var PREFIX = 'qmexmlc:comparison:';
  var LAST_VIEW_KEY = 'qmexmlc:lastView';
  var SHOW_MOVED_KEY = 'qmexmlc:showMoved';
  var SHOW_IGNORED_KEY = 'qmexmlc:showIgnoredHighlight';

  function generateId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function saveComparison(diffResult) {
    var id = generateId();
    try {
      root.sessionStorage.setItem(PREFIX + id, JSON.stringify(diffResult));
    } catch (e) {
      return { id: null, error: 'Could not store the comparison -- it may be too large for the browser to hold in this session (' + e.message + ').' };
    }
    return { id: id, error: null };
  }

  function loadComparison(id) {
    if (!id) return null;
    var raw = root.sessionStorage.getItem(PREFIX + id);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveLastView(view) {
    try { root.sessionStorage.setItem(LAST_VIEW_KEY, view); } catch (e) { /* non-fatal */ }
  }

  function loadLastView() {
    try { return root.sessionStorage.getItem(LAST_VIEW_KEY) || 'sidebyside'; } catch (e) { return 'sidebyside'; }
  }

  function saveShowMoved(show) {
    try { root.sessionStorage.setItem(SHOW_MOVED_KEY, show ? '1' : '0'); } catch (e) { /* non-fatal */ }
  }

  function loadShowMoved() {
    try { return root.sessionStorage.getItem(SHOW_MOVED_KEY) !== '0'; } catch (e) { return true; }
  }

  function saveShowIgnoredHighlight(show) {
    try { root.sessionStorage.setItem(SHOW_IGNORED_KEY, show ? '1' : '0'); } catch (e) { /* non-fatal */ }
  }

  function loadShowIgnoredHighlight() {
    try { return root.sessionStorage.getItem(SHOW_IGNORED_KEY) === '1'; } catch (e) { return false; }
  }

  ns.Storage = {
    saveComparison: saveComparison,
    loadComparison: loadComparison,
    saveLastView: saveLastView,
    loadLastView: loadLastView,
    saveShowMoved: saveShowMoved,
    loadShowMoved: loadShowMoved,
    saveShowIgnoredHighlight: saveShowIgnoredHighlight,
    loadShowIgnoredHighlight: loadShowIgnoredHighlight,
  };
})(typeof window !== 'undefined' ? window : globalThis);
