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

  document.getElementById('old-filename-header').textContent = diffResult.meta.oldFileName || 'Pasted XML (old)';
  document.getElementById('new-filename-header').textContent = diffResult.meta.newFileName || 'Pasted XML (new)';

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
  var navIndex = { added: -1, removed: -1, modified: -1, moved: -1 };

  function getActiveContainer(side) {
    if (!unifiedContainer.hidden) return unifiedContainer;
    return side === 'old' ? oldSideContainer : newSideContainer;
  }

  function getNavTargets(category) {
    var cfg = NAV_CATEGORIES[category];
    var container = getActiveContainer(cfg.side);
    return Array.prototype.slice.call(container.querySelectorAll(cfg.selector));
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

  Object.keys(NAV_CATEGORIES).forEach(function (category) {
    var row = navRowFor(category);
    row.querySelector('.nav-prev').addEventListener('click', function () { navigate(category, -1); });
    row.querySelector('.nav-next').addEventListener('click', function () { navigate(category, 1); });
  });

  function refreshAllNavCounts() {
    Object.keys(NAV_CATEGORIES).forEach(updateNavCount);
  }

  var showMovedCheckbox = document.getElementById('show-moved-checkbox');
  function applyShowMoved(show) {
    document.body.classList.toggle('hide-moved', !show);
    showMovedCheckbox.checked = show;
    ns.Storage.saveShowMoved(show);
    updateNavCount('moved');
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
  }
  showIgnoredCheckbox.addEventListener('change', function () { applyShowIgnoredHighlight(showIgnoredCheckbox.checked); });
  applyShowIgnoredHighlight(ns.Storage.loadShowIgnoredHighlight());

  refreshAllNavCounts();
})();
