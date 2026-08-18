(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};
  var C = ns.RenderCommon;

  // Every render*Rows function returns { oldRows, newRows } with
  // oldRows.length === newRows.length -- added/removed content gets a blank
  // placeholder row on the opposite column so both columns stay
  // height-aligned at every depth, with no JS scroll-sync needed. (This
  // relies on .line using `white-space: pre` rather than wrapping -- a
  // wrapped long line would visually break the row-for-row alignment even
  // though the row COUNT stays balanced.)

  function renderNodeRows(node, depth, ancestorStatus) {
    if (node.nodeType === 'element') return renderElementRows(node, depth, ancestorStatus);
    if (node.nodeType === 'comment') return renderCommentRows(node, depth, ancestorStatus);
    if (node.nodeType === 'pi') return renderPiRows(node, depth, ancestorStatus);
    return renderTextRows(node, depth, ancestorStatus);
  }

  function markNewSide(line, flags) {
    if (flags.isTopLevelAdded) line.classList.add('nav-target-added');
    if (flags.isModified) line.classList.add('nav-target-modified');
    if (flags.isIgnoredOnlyModified) line.classList.add('nav-target-modified-ignored');
    if (flags.isMoved) line.classList.add('nav-target-moved');
  }

  function renderTextRows(node, depth, ancestorStatus) {
    var flags = C.navFlags(node, ancestorStatus);
    var cls = C.rowClassFor(node);
    function build(side) {
      var l = C.lineDiv(cls);
      l.appendChild(C.span('  '.repeat(depth), 'indent'));
      var wrap = C.span(null, null);
      if (node.textDiff) {
        C.appendSpans(wrap, node.textDiff, side);
      } else {
        wrap.appendChild(document.createTextNode((side === 'old' ? node.oldText : node.newText) || ''));
      }
      l.appendChild(wrap);
      return l;
    }
    var oldRow = flags.isAdded ? C.blankLine() : build('old');
    if (!flags.isAdded && flags.isTopLevelRemoved) oldRow.classList.add('nav-target-removed');
    var newRow = flags.isRemoved ? C.blankLine() : build('new');
    if (!flags.isRemoved) {
      if (node.moved) C.appendMovedBadge(newRow, node);
      markNewSide(newRow, flags);
    }
    return { oldRows: [oldRow], newRows: [newRow] };
  }

  function renderCommentRows(node, depth, ancestorStatus) {
    var flags = C.navFlags(node, ancestorStatus);
    var cls = C.rowClassFor(node);
    function build(side) {
      var l = C.lineDiv(cls + ' node-comment');
      l.appendChild(C.span('  '.repeat(depth), 'indent'));
      l.appendChild(C.span('<!--'));
      var wrap = C.span(null, null);
      if (node.textDiff) {
        C.appendSpans(wrap, node.textDiff, side);
      } else {
        wrap.appendChild(document.createTextNode((side === 'old' ? node.oldText : node.newText) || ''));
      }
      l.appendChild(wrap);
      l.appendChild(C.span('-->'));
      return l;
    }
    var oldRow = flags.isAdded ? C.blankLine() : build('old');
    if (!flags.isAdded && flags.isTopLevelRemoved) oldRow.classList.add('nav-target-removed');
    var newRow = flags.isRemoved ? C.blankLine() : build('new');
    if (!flags.isRemoved) {
      if (node.moved) C.appendMovedBadge(newRow, node);
      markNewSide(newRow, flags);
    }
    return { oldRows: [oldRow], newRows: [newRow] };
  }

  function renderPiRows(node, depth, ancestorStatus) {
    var flags = C.navFlags(node, ancestorStatus);
    var cls = C.rowClassFor(node);
    function build(side) {
      var l = C.lineDiv(cls + ' node-pi');
      l.appendChild(C.span('  '.repeat(depth), 'indent'));
      l.appendChild(C.span('<?' + node.tag + ' '));
      var wrap = C.span(null, null);
      if (node.textDiff) {
        C.appendSpans(wrap, node.textDiff, side);
      } else {
        wrap.appendChild(document.createTextNode((side === 'old' ? node.oldText : node.newText) || ''));
      }
      l.appendChild(wrap);
      l.appendChild(C.span('?>'));
      return l;
    }
    var oldRow = flags.isAdded ? C.blankLine() : build('old');
    if (!flags.isAdded && flags.isTopLevelRemoved) oldRow.classList.add('nav-target-removed');
    var newRow = flags.isRemoved ? C.blankLine() : build('new');
    if (!flags.isRemoved) {
      if (node.moved) C.appendMovedBadge(newRow, node);
      markNewSide(newRow, flags);
    }
    return { oldRows: [oldRow], newRows: [newRow] };
  }

  function renderElementRows(node, depth, ancestorStatus) {
    var flags = C.navFlags(node, ancestorStatus);
    var isAdded = flags.isAdded, isRemoved = flags.isRemoved;
    var cls = C.rowClassFor(node);
    var leafInfo = C.isSimpleLeafParent(node);
    var oldRows = [], newRows = [];

    function buildTagLine(side) {
      var l = C.lineDiv(cls);
      C.appendOpenTagContent(l, node, side, depth, leafInfo);
      return l;
    }

    if (leafInfo.textChild || leafInfo.isEmpty) {
      var oldLine = isAdded ? C.blankLine() : buildTagLine('old');
      if (!isAdded && flags.isTopLevelRemoved) oldLine.classList.add('nav-target-removed');
      oldRows.push(oldLine);
      var newLine = isRemoved ? C.blankLine() : buildTagLine('new');
      if (!isRemoved) {
        if (node.moved) C.appendMovedBadge(newLine, node);
        markNewSide(newLine, flags);
        // A change in the collapsed text child (e.g. <author>X</author> ->
        // <author>Y</author>) is a real modification even though the
        // element's own ownChanged only reflects its attributes -- the text
        // child has no row of its own to be marked on, so attribute it here.
        if (!flags.isModified && leafInfo.textChild && leafInfo.textChild.status === 'modified') {
          newLine.classList.add('nav-target-modified');
        }
      }
      newRows.push(newLine);
      return { oldRows: oldRows, newRows: newRows };
    }

    // opening tag row -- the nav-target boundary for this node
    var openOldLine = isAdded ? C.blankLine() : buildTagLine('old');
    if (!isAdded && flags.isTopLevelRemoved) openOldLine.classList.add('nav-target-removed');
    oldRows.push(openOldLine);
    var openNewLine = isRemoved ? C.blankLine() : buildTagLine('new');
    if (!isRemoved) {
      if (node.moved) C.appendMovedBadge(openNewLine, node);
      markNewSide(openNewLine, flags);
    }
    newRows.push(openNewLine);

    // children
    node.children.forEach(function (child) {
      var r = renderNodeRows(child, depth + 1, flags.childAncestorStatus);
      r.oldRows.forEach(function (x) { oldRows.push(x); });
      r.newRows.forEach(function (x) { newRows.push(x); });
    });

    // closing tag row (never a nav target itself -- the opening tag already is)
    function buildCloseLine(side) {
      var l = C.lineDiv(cls);
      C.appendCloseTagContent(l, node, side, depth);
      return l;
    }
    oldRows.push(isAdded ? C.blankLine() : buildCloseLine('old'));
    newRows.push(isRemoved ? C.blankLine() : buildCloseLine('new'));

    return { oldRows: oldRows, newRows: newRows };
  }

  function render(rootDiffNode, oldContainer, newContainer) {
    oldContainer.innerHTML = '';
    newContainer.innerHTML = '';
    var rows = renderNodeRows(rootDiffNode, 0, null);
    C.addLineNumbers(rows.oldRows);
    C.addLineNumbers(rows.newRows);
    var oldPane = document.createElement('div');
    oldPane.className = 'code-pane';
    var newPane = document.createElement('div');
    newPane.className = 'code-pane';
    rows.oldRows.forEach(function (r) { oldPane.appendChild(r); });
    rows.newRows.forEach(function (r) { newPane.appendChild(r); });
    oldContainer.appendChild(oldPane);
    newContainer.appendChild(newPane);
  }

  ns.RenderSideBySide = { render: render };
})(typeof window !== 'undefined' ? window : globalThis);
