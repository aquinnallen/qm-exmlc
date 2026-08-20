(function () {
  'use strict';
  var ns = window.XmlDiff;

  var params = new URLSearchParams(window.location.search);
  var id = params.get('id');
  var diffResult = ns.Storage.loadComparison(id);

  if (!diffResult) {
    window.location.href = 'index.html?err=no-comparison';
    return;
  }

  var oldFileLabel = diffResult.meta.oldFileName || 'Pasted XML (old)';
  var newFileLabel = diffResult.meta.newFileName || 'Pasted XML (new)';
  document.getElementById('old-filename-header').textContent = oldFileLabel;
  document.getElementById('new-filename-header').textContent = newFileLabel;

  if (diffResult.meta.rootTagMismatch) {
    var banner = document.getElementById('root-mismatch-banner');
    banner.textContent = 'The two documents have different root elements (<' + diffResult.meta.oldRootTag +
      '> vs <' + diffResult.meta.newRootTag + '>) -- this is likely two unrelated documents. Showing a best-effort comparison below.';
    banner.hidden = false;
  }

  var counts = { unchanged: 0, added: 0, removed: 0, modified: 0, moved: 0 };
  (function tally(node) {
    if (node.status === 'added') counts.added++;
    else if (node.status === 'removed') counts.removed++;
    else if (node.ownChanged) counts.modified++;
    else if (node.moved) counts.moved++;
    else counts.unchanged++;
    (node.children || []).forEach(tally);
  })(diffResult.tree);

  document.getElementById('summary-line').textContent =
    counts.unchanged + ' unchanged, ' + counts.modified + ' modified, ' +
    counts.added + ' added, ' + counts.removed + ' removed, ' + counts.moved + ' moved';

  var ignoredAttrs = diffResult.meta.ignoredAttrs || [];
  if (ignoredAttrs.length) {
    var ignoredLine = document.getElementById('ignored-attrs-line');
    ignoredLine.textContent = 'Not matching on attributes: ' + ignoredAttrs.join(', ') + ' (shown; highlighting optional, see tool pane)';
    ignoredLine.hidden = false;
    document.getElementById('show-ignored-toggle-wrap').hidden = false;
  }

  var caseInsensitiveElements = diffResult.meta.caseInsensitiveElements || [];
  if (caseInsensitiveElements.length) {
    var caseInsensitiveLine = document.getElementById('case-insensitive-elements-line');
    caseInsensitiveLine.textContent = 'Case-insensitive text in: ' + caseInsensitiveElements.join(', ') + ' (direct text content only, not subelements)';
    caseInsensitiveLine.hidden = false;
  }

  var oldSideContainer = document.getElementById('view-sidebyside-old');
  var newSideContainer = document.getElementById('view-sidebyside-new');
  var unifiedContainer = document.getElementById('view-unified');
  var sidebysideView = document.getElementById('view-sidebyside');

  ns.RenderSideBySide.render(diffResult.tree, oldSideContainer, newSideContainer);
  ns.RenderUnified.render(diffResult.tree, unifiedContainer);

  var tabSide = document.getElementById('tab-sidebyside');
  var tabUnified = document.getElementById('tab-unified');

  function activateView(view) {
    if (view === 'unified') {
      sidebysideView.hidden = true;
      unifiedContainer.hidden = false;
      tabSide.classList.remove('active');
      tabUnified.classList.add('active');
    } else {
      sidebysideView.hidden = false;
      unifiedContainer.hidden = true;
      tabUnified.classList.remove('active');
      tabSide.classList.add('active');
    }
    ns.Storage.saveLastView(view);
  }

  tabSide.addEventListener('click', function () { activateView('sidebyside'); refreshAllNavCounts(); });
  tabUnified.addEventListener('click', function () { activateView('unified'); refreshAllNavCounts(); });

  activateView(ns.Storage.loadLastView());

  // ---- next/previous navigation for additions, deletions, modifications, moves ----
  // Each category is a CSS marker class applied at render time to exactly
  // one row per logical change (see render-common.js navFlags -- a
  // multi-line added/removed subtree is one nav stop, not one per line).
  // Side-by-side keeps added/modified/moved on the NEW column and removed
  // on the OLD column, since that's the only column guaranteed to have
  // real (non-blank) content for that category.
  var NAV_CATEGORIES = {
    added: { side: 'new', selector: '.nav-target-added' },
    removed: { side: 'old', selector: '.nav-target-removed' },
    modified: { side: 'new', selector: '.nav-target-modified' },
    moved: { side: 'new', selector: '.nav-target-moved' },
  };
  // 'differences' is a consolidated view over the four categories above --
  // not a real diff category of its own, so it lives outside NAV_CATEGORIES
  // (which drives the per-side selector lookup) but still gets a nav row,
  // an index, and count/prev/next wiring like the others.
  var ALL_NAV_ROWS = ['differences', 'added', 'removed', 'modified', 'moved'];
  var navIndex = { added: -1, removed: -1, modified: -1, moved: -1, differences: -1 };

  function getActiveContainer(side) {
    if (!unifiedContainer.hidden) return unifiedContainer;
    return side === 'old' ? oldSideContainer : newSideContainer;
  }

  // Combined nav order across additions/deletions/modifications/(shown)moves.
  // Unified view is one document-order container, so a single multi-part
  // selector already yields the right order. Side-by-side splits old/new
  // into two separate containers, but the renderer keeps every row on both
  // sides index-aligned (blank filler rows stand in for the other side's
  // content -- see render-sidebyside.js), so zipping the two row lists by
  // index reconstructs the same top-to-bottom order the user actually sees.
  function getCombinedNavTargets() {
    var showIgnored = document.body.classList.contains('show-ignored-highlight');
    var includeMoved = !document.body.classList.contains('hide-moved');
    var modifiedSelector = '.nav-target-modified' + (showIgnored ? ', .nav-target-modified-ignored' : '');

    if (!unifiedContainer.hidden) {
      var parts = ['.nav-target-added', '.nav-target-removed', modifiedSelector];
      if (includeMoved) parts.push('.nav-target-moved');
      return Array.prototype.slice.call(unifiedContainer.querySelectorAll(parts.join(', ')));
    }

    var oldRows = Array.prototype.slice.call(oldSideContainer.querySelectorAll('.line'));
    var newRows = Array.prototype.slice.call(newSideContainer.querySelectorAll('.line'));
    var result = [];
    var n = Math.max(oldRows.length, newRows.length);
    for (var i = 0; i < n; i++) {
      var oldRow = oldRows[i], newRow = newRows[i];
      // A removal and an addition/modification/move can legitimately land on
      // the SAME row index (e.g. an entry removed and a differently-named
      // one added at that same list position, with no blank filler between
      // them) -- check both sides independently rather than short-circuiting
      // on the first match, or one of the two real changes gets dropped.
      if (oldRow && oldRow.classList.contains('nav-target-removed')) result.push(oldRow);
      if (newRow) {
        var isModified = newRow.classList.contains('nav-target-modified') ||
          (showIgnored && newRow.classList.contains('nav-target-modified-ignored'));
        var isMoved = includeMoved && newRow.classList.contains('nav-target-moved');
        if (newRow.classList.contains('nav-target-added') || isModified || isMoved) result.push(newRow);
      }
    }
    return result;
  }

  function getNavTargets(category) {
    if (category === 'differences') return getCombinedNavTargets();
    var cfg = NAV_CATEGORIES[category];
    var container = getActiveContainer(cfg.side);
    var selector = cfg.selector;
    // Nodes whose only difference is in an ignored attribute (e.g. uuid)
    // join the Modified category only while their highlighting is turned
    // on -- otherwise there'd be nothing visibly different to jump to.
    if (category === 'modified' && document.body.classList.contains('show-ignored-highlight')) {
      selector += ', .nav-target-modified-ignored';
    }
    // querySelectorAll with a selector list still returns document-order,
    // de-duplicated results, so a node matching both parts (e.g. a real
    // modification that ALSO has an ignored-attr diff) isn't counted twice.
    return Array.prototype.slice.call(container.querySelectorAll(selector));
  }

  function navRowFor(category) {
    return document.querySelector('.nav-row[data-category="' + category + '"]');
  }

  function updateNavCount(category) {
    var row = navRowFor(category);
    var countEl = row.querySelector('.nav-count');
    var prevBtn = row.querySelector('.nav-prev');
    var nextBtn = row.querySelector('.nav-next');
    var movedHidden = category === 'moved' && document.body.classList.contains('hide-moved');

    if (movedHidden) {
      countEl.textContent = 'hidden';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    var targets = getNavTargets(category);
    if (!targets.length) {
      countEl.textContent = '0 / 0';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    var idx = navIndex[category];
    if (idx < 0 || idx >= targets.length) idx = -1;
    countEl.textContent = (idx + 1) + ' / ' + targets.length;
  }

  function flashElement(el) {
    el.classList.remove('nav-flash');
    void el.offsetWidth; // force reflow so a repeat flash on the same element restarts the animation
    el.classList.add('nav-flash');
    // Self-cleaning: without this, a previously-flashed element keeps the
    // class forever (the CSS animation just stops looking active), so
    // .nav-flash can end up matching more than one element at once.
    el.addEventListener('animationend', function handler() {
      el.classList.remove('nav-flash');
      el.removeEventListener('animationend', handler);
    });
  }

  function navigate(category, dir) {
    var targets = getNavTargets(category);
    if (!targets.length) return;
    var idx = navIndex[category];
    if (idx < 0) idx = dir > 0 ? 0 : targets.length - 1;
    else idx = (idx + dir + targets.length) % targets.length;
    navIndex[category] = idx;
    var el = targets[idx];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashElement(el);
    updateNavCount(category);
  }

  ALL_NAV_ROWS.forEach(function (category) {
    var row = navRowFor(category);
    row.querySelector('.nav-prev').addEventListener('click', function () { navigate(category, -1); });
    row.querySelector('.nav-next').addEventListener('click', function () { navigate(category, 1); });
  });

  function refreshAllNavCounts() {
    ALL_NAV_ROWS.forEach(updateNavCount);
  }

  var showMovedCheckbox = document.getElementById('show-moved-checkbox');
  function applyShowMoved(show) {
    document.body.classList.toggle('hide-moved', !show);
    showMovedCheckbox.checked = show;
    ns.Storage.saveShowMoved(show);
    updateNavCount('moved');
    updateNavCount('differences'); // combined count/order includes moves only while shown
  }
  showMovedCheckbox.addEventListener('change', function () { applyShowMoved(showMovedCheckbox.checked); });
  applyShowMoved(ns.Storage.loadShowMoved());

  // Ignored-attribute diffs (e.g. a volatile uuid) are computed regardless
  // of the ignore list -- this just flips whether they're painted, live,
  // with no re-comparison, same mechanism as "Show moved" above.
  var showIgnoredCheckbox = document.getElementById('show-ignored-checkbox');
  function applyShowIgnoredHighlight(show) {
    document.body.classList.toggle('show-ignored-highlight', show);
    showIgnoredCheckbox.checked = show;
    ns.Storage.saveShowIgnoredHighlight(show);
    updateNavCount('modified');
    updateNavCount('differences'); // combined count/order also depends on ignored-attr highlighting
  }
  showIgnoredCheckbox.addEventListener('change', function () { applyShowIgnoredHighlight(showIgnoredCheckbox.checked); });
  applyShowIgnoredHighlight(ns.Storage.loadShowIgnoredHighlight());

  // ---- review comments: pinned to (side, line-in-that-file), independent
  // of which view is currently showing that line -- so a comment added in
  // side-by-side is still found (and still shows its "has-comment" mark) in
  // unified, and vice versa. Persisted per comparison id so a reload keeps
  // them; input-page.js clears them along with the comparison itself when
  // the user starts a new one. ----
  var comments = ns.Storage.loadComments(id);

  function nextCommentId() {
    return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : 'c' + Date.now() + Math.random().toString(36).slice(2, 8);
  }

  function findComment(side, line) {
    return comments.find(function (c) { return c.side === side && c.line === line; }) || null;
  }

  function persistComments() {
    ns.Storage.saveComments(id, comments);
  }

  // Pulls the visible text of a row for export/list context, skipping the
  // gutter chrome (line numbers, +/- markers) that isn't part of the file.
  function getRowSnippet(row) {
    var text = '';
    row.childNodes.forEach(function (n) {
      if (n.nodeType === 1 && (n.classList.contains('line-number') || n.classList.contains('gutter-marker'))) return;
      text += n.textContent;
    });
    return text.trim().slice(0, 200).replace(/`/g, "'");
  }

  // Every gutter anchor for a given (side, line) across BOTH view containers
  // gets marked, not just the one in the currently active view, so the
  // indicator is already correct the instant the user switches views.
  function applyCommentMarks() {
    document.querySelectorAll('.line-number-clickable').forEach(function (g) {
      var has = !!findComment(g.dataset.side, parseInt(g.dataset.line, 10));
      g.classList.toggle('has-comment', has);
    });
  }

  function sortedComments() {
    return comments.slice().sort(function (a, b) {
      if (a.side !== b.side) return a.side === 'old' ? -1 : 1;
      return a.line - b.line;
    });
  }

  var commentsListEl = document.getElementById('comments-list');
  var commentsCountEl = document.getElementById('comments-count');
  var exportBtn = document.getElementById('export-comments-btn');

  function scrollToComment(c) {
    var container = !unifiedContainer.hidden ? unifiedContainer : (c.side === 'old' ? oldSideContainer : newSideContainer);
    var gutter = container.querySelector('.line-number-clickable[data-side="' + c.side + '"][data-line="' + c.line + '"]');
    if (!gutter) return;
    var row = gutter.closest('.line');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashElement(row);
  }

  function renderCommentsList() {
    var sorted = sortedComments();
    commentsCountEl.textContent = String(sorted.length);
    exportBtn.disabled = sorted.length === 0;
    commentsListEl.innerHTML = '';
    sorted.forEach(function (c) {
      var item = document.createElement('div');
      item.className = 'comment-item';

      var meta = document.createElement('div');
      meta.className = 'comment-item-meta';
      meta.textContent = (c.side === 'old' ? oldFileLabel : newFileLabel) + ' · line ' + c.line;

      var text = document.createElement('div');
      text.className = 'comment-item-text';
      text.textContent = c.text;

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'comment-item-delete';
      delBtn.setAttribute('aria-label', 'Delete comment');
      delBtn.textContent = '×';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        comments = comments.filter(function (x) { return x.id !== c.id; });
        persistComments();
        applyCommentMarks();
        renderCommentsList();
      });

      item.appendChild(meta);
      item.appendChild(text);
      item.appendChild(delBtn);
      item.addEventListener('click', function () { scrollToComment(c); });
      commentsListEl.appendChild(item);
    });
  }

  // ---- popover: one shared editor, repositioned per click ----
  var popover = document.getElementById('comment-popover');
  var popoverTitle = document.getElementById('comment-popover-title');
  var popoverText = document.getElementById('comment-popover-text');
  var popoverSave = document.getElementById('comment-popover-save');
  var popoverCancel = document.getElementById('comment-popover-cancel');
  var popoverDelete = document.getElementById('comment-popover-delete');
  var popoverTarget = null; // { side, line, gutterEl }

  function closeCommentPopover() {
    popover.hidden = true;
    popoverTarget = null;
  }

  function positionPopover(gutterEl) {
    var rect = gutterEl.getBoundingClientRect();
    popover.hidden = false; // must be visible to measure its own size
    var popoverRect = popover.getBoundingClientRect();
    var left = Math.min(rect.left, window.innerWidth - popoverRect.width - 12);
    var top = rect.bottom + 6;
    if (top + popoverRect.height > window.innerHeight - 12) top = Math.max(12, rect.top - popoverRect.height - 6);
    popover.style.left = Math.max(12, left) + 'px';
    popover.style.top = top + 'px';
  }

  function openCommentPopover(gutterEl) {
    var side = gutterEl.dataset.side;
    var line = parseInt(gutterEl.dataset.line, 10);
    popoverTarget = { side: side, line: line, gutterEl: gutterEl };
    var existing = findComment(side, line);
    popoverTitle.textContent = (side === 'old' ? oldFileLabel : newFileLabel) + ' — line ' + line;
    popoverText.value = existing ? existing.text : '';
    popoverDelete.hidden = !existing;
    positionPopover(gutterEl);
    popoverText.focus();
  }

  document.body.addEventListener('click', function (e) {
    var gutter = e.target.closest('.line-number-clickable');
    if (gutter) { openCommentPopover(gutter); return; }
    if (!popover.hidden && !popover.contains(e.target)) closeCommentPopover();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !popover.hidden) closeCommentPopover();
  });

  popoverCancel.addEventListener('click', closeCommentPopover);

  popoverSave.addEventListener('click', function () {
    if (!popoverTarget) return;
    var text = popoverText.value.trim();
    if (!text) { closeCommentPopover(); return; }
    var existing = findComment(popoverTarget.side, popoverTarget.line);
    if (existing) {
      existing.text = text;
    } else {
      comments.push({
        id: nextCommentId(),
        side: popoverTarget.side,
        line: popoverTarget.line,
        text: text,
        snippet: getRowSnippet(popoverTarget.gutterEl.closest('.line')),
        createdAt: new Date().toISOString(),
      });
    }
    persistComments();
    applyCommentMarks();
    renderCommentsList();
    closeCommentPopover();
  });

  popoverDelete.addEventListener('click', function () {
    if (!popoverTarget) return;
    comments = comments.filter(function (c) { return !(c.side === popoverTarget.side && c.line === popoverTarget.line); });
    persistComments();
    applyCommentMarks();
    renderCommentsList();
    closeCommentPopover();
  });

  exportBtn.addEventListener('click', function () {
    var sorted = sortedComments();
    if (!sorted.length) return;
    var lines = ['# XML Comparison Review Comments', ''];
    function section(label, list) {
      if (!list.length) return;
      lines.push('## ' + label, '');
      list.forEach(function (c) {
        var snippetPart = c.snippet ? ' — `' + c.snippet + '`' : '';
        lines.push('- Line ' + c.line + snippetPart + ': ' + c.text.replace(/\r?\n/g, ' '));
      });
      lines.push('');
    }
    section(oldFileLabel, sorted.filter(function (c) { return c.side === 'old'; }));
    section(newFileLabel, sorted.filter(function (c) { return c.side === 'new'; }));

    var blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'xml-diff-comments.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  applyCommentMarks();
  renderCommentsList();

  refreshAllNavCounts();
})();
