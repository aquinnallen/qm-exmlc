(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};
  var C = ns.RenderCommon;

  function markerLine(marker, extraCls) {
    var l = C.lineDiv(extraCls);
    l.appendChild(C.span(marker, 'gutter-marker'));
    return l;
  }

  function renderNodeRows(node, depth, ancestorStatus) {
    if (node.nodeType === 'element') return renderElementRows(node, depth, ancestorStatus);
    return renderLeafRows(node, depth, ancestorStatus);
  }

  // Handles text / comment / pi -- each is a single conceptual line.
  function renderLeafRows(node, depth, ancestorStatus) {
    var flags = C.navFlags(node, ancestorStatus);
    var rows = [];

    function buildContent(l, side) {
      l.appendChild(C.span('  '.repeat(depth), 'indent'));
      if (node.nodeType === 'comment') l.appendChild(C.span('<!--'));
      if (node.nodeType === 'pi') l.appendChild(C.span('<?' + node.tag + ' '));
      var wrap = C.span(null, null);
      if (node.textDiff && side !== 'plain') {
        C.appendSpans(wrap, node.textDiff, side);
      } else {
        wrap.appendChild(document.createTextNode((side === 'new' ? node.newText : node.oldText) || ''));
      }
      l.appendChild(wrap);
      if (node.nodeType === 'comment') l.appendChild(C.span('-->'));
      if (node.nodeType === 'pi') l.appendChild(C.span('?>'));
    }

    if (node.status === 'added') {
      var la = markerLine('+', 'diff-added');
      buildContent(la, 'new');
      if (flags.isTopLevelAdded) la.classList.add('nav-target-added');
      rows.push(la);
    } else if (node.status === 'removed') {
      var lr = markerLine('-', 'diff-removed');
      buildContent(lr, 'old');
      if (flags.isTopLevelRemoved) lr.classList.add('nav-target-removed');
      rows.push(lr);
    } else if (node.status === 'modified') {
      var ld = markerLine('-', 'diff-removed');
      buildContent(ld, 'old');
      rows.push(ld);
      var li = markerLine('+', 'diff-added');
      buildContent(li, 'new');
      if (node.moved) C.appendMovedBadge(li, node);
      li.classList.add('nav-target-modified');
      if (flags.isMoved) li.classList.add('nav-target-moved');
      rows.push(li);
    } else if (node.moved) {
      var lm = markerLine(' ', 'diff-moved');
      buildContent(lm, 'plain');
      C.appendMovedBadge(lm, node);
      lm.classList.add('nav-target-moved');
      rows.push(lm);
    } else {
      var lc = markerLine(' ', '');
      buildContent(lc, 'plain');
      rows.push(lc);
    }
    return rows;
  }

  function buildTagLine(node, side, depth, leafInfo, marker, cls) {
    var l = markerLine(marker, cls);
    C.appendOpenTagContent(l, node, side, depth, leafInfo);
    return l;
  }

  function buildCloseLine(node, depth, marker, cls) {
    var l = markerLine(marker, cls);
    C.appendCloseTagContent(l, node, 'new', depth);
    return l;
  }

  function renderElementRows(node, depth, ancestorStatus) {
    var flags = C.navFlags(node, ancestorStatus);
    var rows = [];
    var leafInfo = C.isSimpleLeafParent(node);

    if (flags.isAdded) {
      var lOpen = buildTagLine(node, 'new', depth, leafInfo, '+', 'diff-added');
      if (flags.isTopLevelAdded) lOpen.classList.add('nav-target-added');
      rows.push(lOpen);
      if (!leafInfo.isEmpty && !leafInfo.textChild) {
        node.children.forEach(function (c) { rows.push.apply(rows, renderNodeRows(c, depth + 1, flags.childAncestorStatus)); });
        rows.push(buildCloseLine(node, depth, '+', 'diff-added'));
      }
      return rows;
    }
    if (flags.isRemoved) {
      var lOpenR = buildTagLine(node, 'old', depth, leafInfo, '-', 'diff-removed');
      if (flags.isTopLevelRemoved) lOpenR.classList.add('nav-target-removed');
      rows.push(lOpenR);
      if (!leafInfo.isEmpty && !leafInfo.textChild) {
        node.children.forEach(function (c) { rows.push.apply(rows, renderNodeRows(c, depth + 1, flags.childAncestorStatus)); });
        rows.push(buildCloseLine(node, depth, '-', 'diff-removed'));
      }
      return rows;
    }

    // matched pair: unchanged / modified / moved
    var ownLineChanged = node.ownChanged || (leafInfo.textChild && leafInfo.textChild.status === 'modified');

    if (leafInfo.textChild || leafInfo.isEmpty) {
      if (ownLineChanged) {
        rows.push(buildTagLine(node, 'old', depth, leafInfo, '-', 'diff-removed'));
        var lNew = buildTagLine(node, 'new', depth, leafInfo, '+', 'diff-added');
        if (node.moved) C.appendMovedBadge(lNew, node);
        lNew.classList.add('nav-target-modified');
        if (flags.isMoved) lNew.classList.add('nav-target-moved');
        rows.push(lNew);
      } else if (flags.isMoved) {
        var lMoved = buildTagLine(node, 'new', depth, leafInfo, ' ', 'diff-moved');
        C.appendMovedBadge(lMoved, node);
        lMoved.classList.add('nav-target-moved');
        if (flags.isIgnoredOnlyModified) lMoved.classList.add('nav-target-modified-ignored');
        rows.push(lMoved);
      } else {
        var lPlain = buildTagLine(node, 'new', depth, leafInfo, ' ', '');
        if (flags.isIgnoredOnlyModified) lPlain.classList.add('nav-target-modified-ignored');
        rows.push(lPlain);
      }
      return rows;
    }

    if (ownLineChanged) {
      rows.push(buildTagLine(node, 'old', depth, leafInfo, '-', 'diff-removed'));
      var lOpenNew = buildTagLine(node, 'new', depth, leafInfo, '+', 'diff-added');
      if (node.moved) C.appendMovedBadge(lOpenNew, node);
      lOpenNew.classList.add('nav-target-modified');
      if (flags.isMoved) lOpenNew.classList.add('nav-target-moved');
      rows.push(lOpenNew);
    } else if (flags.isMoved) {
      var lOpenMoved = buildTagLine(node, 'new', depth, leafInfo, ' ', 'diff-moved');
      C.appendMovedBadge(lOpenMoved, node);
      lOpenMoved.classList.add('nav-target-moved');
      if (flags.isIgnoredOnlyModified) lOpenMoved.classList.add('nav-target-modified-ignored');
      rows.push(lOpenMoved);
    } else {
      var lOpenPlain = buildTagLine(node, 'new', depth, leafInfo, ' ', '');
      if (flags.isIgnoredOnlyModified) lOpenPlain.classList.add('nav-target-modified-ignored');
      rows.push(lOpenPlain);
    }

    node.children.forEach(function (c) { rows.push.apply(rows, renderNodeRows(c, depth + 1, flags.childAncestorStatus)); });

    rows.push(buildCloseLine(node, depth, ' ', ''));
    return rows;
  }

  function render(rootDiffNode, container) {
    container.innerHTML = '';
    var pane = document.createElement('div');
    pane.className = 'code-pane';
    var rows = renderNodeRows(rootDiffNode, 0, null);
    C.addDualLineNumbers(rows);
    rows.forEach(function (r) { pane.appendChild(r); });
    container.appendChild(pane);
  }

  ns.RenderUnified = { render: render };
})(typeof window !== 'undefined' ? window : globalThis);
