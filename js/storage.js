(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};

  var PREFIX = 'qmexmlc:comparison:';
  var COMMENTS_PREFIX = 'qmexmlc:comments:';
  var LAST_VIEW_KEY = 'qmexmlc:lastView';
  var SHOW_MOVED_KEY = 'qmexmlc:showMoved';
  var SHOW_IGNORED_KEY = 'qmexmlc:showIgnoredHighlight';

  function generateId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Removes every stored comparison AND its review comments (but not
  // view/toggle preferences) -- large XML diffs add up fast against
  // sessionStorage's ~5-10MB quota, and nothing ever cleared prior
  // comparisons out on its own. Comments are keyed by the same comparison
  // id, so once the comparison they annotate is gone they're just orphaned
  // garbage -- always clear both together.
  function clearAllComparisons() {
    var keys = [];
    for (var i = 0; i < root.sessionStorage.length; i++) {
      var k = root.sessionStorage.key(i);
      if (k && (k.indexOf(PREFIX) === 0 || k.indexOf(COMMENTS_PREFIX) === 0)) keys.push(k);
    }
    keys.forEach(function (k) { root.sessionStorage.removeItem(k); });
  }

  function saveComparison(diffResult) {
    var id = generateId();
    var json = JSON.stringify(diffResult);
    try {
      root.sessionStorage.setItem(PREFIX + id, json);
    } catch (e) {
      // Most likely QuotaExceededError from earlier comparisons still
      // sitting in this tab's session storage. A new comparison always
      // supersedes whatever was there, so clear them and retry once
      // before actually giving up.
      clearAllComparisons();
      try {
        root.sessionStorage.setItem(PREFIX + id, json);
      } catch (e2) {
        return { id: null, error: 'Could not store the comparison -- it may be too large for the browser to hold in this session (' + e2.message + ').' };
      }
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

  // Review comments for a comparison: an array of
  // { id, side: 'old'|'new', line, text, snippet, createdAt }, stored
  // separately from the (much larger, read-only) comparison payload so
  // saving a comment never re-serializes the whole diff tree.
  function saveComments(id, comments) {
    if (!id) return;
    try { root.sessionStorage.setItem(COMMENTS_PREFIX + id, JSON.stringify(comments)); } catch (e) { /* non-fatal */ }
  }

  function loadComments(id) {
    if (!id) return [];
    try {
      var raw = root.sessionStorage.getItem(COMMENTS_PREFIX + id);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  ns.Storage = {
    saveComparison: saveComparison,
    loadComparison: loadComparison,
    clearAllComparisons: clearAllComparisons,
    saveLastView: saveLastView,
    loadLastView: loadLastView,
    saveShowMoved: saveShowMoved,
    loadShowMoved: loadShowMoved,
    saveShowIgnoredHighlight: saveShowIgnoredHighlight,
    loadShowIgnoredHighlight: loadShowIgnoredHighlight,
    saveComments: saveComments,
    loadComments: loadComments,
  };
})(typeof window !== 'undefined' ? window : globalThis);
