(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};
  var C = ns.RenderCommon;

  // Each column is rendered as a faithful walk of ITS OWN document -- old
  // column in old-document order, new column in new-document order -- so a
  // reordered node's row sits at its TRUE position in each file, not a
  // shared "normalized" position. Content that only exists on one side
  // (a real add/remove, not a reorder) still gets a blank filler on the
  // opposite side, sized to match however many rows it actually occupies
  // and anchored next to the nearest sibling that exists on both sides --
  // so straightforward adds/deletes still read as an aligned gap, while a
  // moved node is never displaced from where it actually lives in that file.

  function siblingSide(side) { return side === 'old' ? 'new' : 'old'; }
  function idxFieldFor(side) { return side === 'old' ? 'oldIndexInParent' : 'newIndexInParent'; }

  // Ordered list of { kind:'real', child } for nodes present on this side,
  // interleaved with { kind:'blank', child } for nodes that only exist on
  // the OTHER side, anchored right after the nearest preceding sibling
  // (by the other side's index) that IS present here.
  function buildSideSequence(node, side) {
    var idxField = idxFieldFor(side);
    var otherIdxField = idxFieldFor(siblingSide(side));

    var real = node.children
      .filter(function (c) { return c[idxField] !== null; })
      .sort(function (a, b) { return a[idxField] - b[idxField]; })
      .map(function (c) { return { kind: 'real', child: c }; });

    var missing = node.children.filter(function (c) { return c[idxField] === null; });
    if (!missing.length) return real;

    var byOtherIdx = node.children.slice().sort(function (a, b) { return a[otherIdxField] - b[otherIdxField]; });

    missing.forEach(function (m) {
      var mOtherIdx = m[otherIdxField];
      var anchor = null, bestIdx = -1;
      byOtherIdx.forEach(function (sib) {
        if (sib[otherIdxField] < mOtherIdx && sib[otherIdxField] > bestIdx && sib[idxField] !== null) {
          bestIdx = sib[otherIdxField];
          anchor = sib;
        }
      });
      var item = { kind: 'blank', child: m };
      if (!anchor) {
        real.unshift(item);
      } else {
        var pos = real.findIndex(function (r) { return r.child === anchor; });
        real.splice(pos + 1, 0, item);
      }
    });

    return real;
  }

  function markNav(line, flags, side) {
    if (side === 'old' && flags.isTopLevelRemoved) line.classList.add('nav-target-removed');
    if (side === 'new') {
      if (flags.isTopLevelAdded) line.classList.add('nav-target-added');
      if (flags.isModified) line.classList.add('nav-target-modified');
      if (flags.isIgnoredOnlyModified) line.classList.add('nav-target-modified-ignored');
      if (flags.isMoved) line.classList.add('nav-target-moved');
    }
  }

  function renderSideRows(node, depth, ancestorStatus, side) {
    if (node.nodeType === 'element') return renderElementSideRows(node, depth, ancestorStatus, side);
    if (node.nodeType === 'comment') return renderLeafSideRows(node, depth, ancestorStatus, side, 'comment');
    if (node.nodeType === 'pi') return renderLeafSideRows(node, depth, ancestorStatus, side, 'pi');
    return renderLeafSideRows(node, depth, ancestorStatus, side, 'text');
  }

  // Handles text / comment / pi -- each is a single row wherever it exists.
  function renderLeafSideRows(node, depth, ancestorStatus, side, kind) {
    var flags = C.navFlags(node, ancestorStatus);
    var cls = C.rowClassFor(node) + (kind !== 'text' ? ' node-' + kind : '');
    var l = C.lineDiv(cls);
    l.appendChild(C.span('  '.repeat(depth), 'indent'));
    if (kind === 'comment') l.appendChild(C.span('<!--'));
    if (kind === 'pi') l.appendChild(C.span('<?' + node.tag + ' '));
    var wrap = C.span(null, null);
    if (node.textDiff) {
      C.appendSpans(wrap, node.textDiff, side);
    } else {
      wrap.appendChild(document.createTextNode((side === 'old' ? node.oldText : node.newText) || ''));
    }
    l.appendChild(wrap);
    if (kind === 'comment') l.appendChild(C.span('-->'));
    if (kind === 'pi') l.appendChild(C.span('?>'));

    if (node.moved) C.appendMovedBadge(l, node);
    markNav(l, flags, side);
    return [l];
  }

  function renderElementSideRows(node, depth, ancestorStatus, side) {
    var flags = C.navFlags(node, ancestorStatus);
    var cls = C.rowClassFor(node);
    var leafInfo = C.isSimpleLeafParent(node);
    var rows = [];

    function buildTagLine() {
      var l = C.lineDiv(cls);
      C.appendOpenTagContent(l, node, side, depth, leafInfo);
      return l;
    }
    function buildCloseLine() {
      var l = C.lineDiv(cls);
      C.appendCloseTagContent(l, node, side, depth);
      return l;
    }

    if (leafInfo.textChild || leafInfo.isEmpty) {
      var l = buildTagLine();
      if (node.moved) C.appendMovedBadge(l, node);
      markNav(l, flags, side);
      // A change in the collapsed text child (e.g. <author>X</author> ->
      // <author>Y</author>) is a real modification even though the
      // element's own ownChanged only reflects its attributes -- the text
      // child has no row of its own to be marked on, so attribute it here.
      if (side === 'new' && !flags.isModified && leafInfo.textChild && leafInfo.textChild.status === 'modified') {
        l.classList.add('nav-target-modified');
      }
      rows.push(l);
      return rows;
    }

    // opening tag row -- the nav-target boundary for this node
    var openLine = buildTagLine();
    if (node.moved) C.appendMovedBadge(openLine, node);
    markNav(openLine, flags, side);
    rows.push(openLine);

    buildSideSequence(node, side).forEach(function (item) {
      if (item.kind === 'real') {
        rows.push.apply(rows, renderSideRows(item.child, depth + 1, flags.childAncestorStatus, side));
      } else {
        // Blank filler standing in for content that only exists on the
        // other side -- sized to match however many rows it actually
        // occupies there (a multi-line added/removed subtree needs one
        // blank per line, not just one).
        var actualRows = renderSideRows(item.child, depth + 1, flags.childAncestorStatus, siblingSide(side));
        actualRows.forEach(function () { rows.push(C.blankLine()); });
      }
    });

    rows.push(buildCloseLine());
    return rows;
  }

  function render(rootDiffNode, oldContainer, newContainer) {
    oldContainer.innerHTML = '';
    newContainer.innerHTML = '';
    var oldRows = renderSideRows(rootDiffNode, 0, null, 'old');
    var newRows = renderSideRows(rootDiffNode, 0, null, 'new');
    C.addLineNumbers(oldRows);
    C.addLineNumbers(newRows);
    var oldPane = document.createElement('div');
    oldPane.className = 'code-pane';
    var newPane = document.createElement('div');
    newPane.className = 'code-pane';
    oldRows.forEach(function (r) { oldPane.appendChild(r); });
    newRows.forEach(function (r) { newPane.appendChild(r); });
    oldContainer.appendChild(oldPane);
    newContainer.appendChild(newPane);
  }

  ns.RenderSideBySide = { render: render };
})(typeof window !== 'undefined' ? window : globalThis);
