(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};
  var doc = root.document;

  function span(text, cls) {
    var s = doc.createElement('span');
    if (cls) s.className = cls;
    if (text) s.appendChild(doc.createTextNode(text));
    return s;
  }

  function lineDiv(cls) {
    var d = doc.createElement('div');
    d.className = cls ? 'line ' + cls : 'line';
    return d;
  }

  function blankLine() {
    return lineDiv('diff-blank');
  }

  // Appends InlineDiffSpan[] to a container for a given side: the 'old' side
  // shows same+del tokens (never add), the 'new' side shows same+add tokens
  // (never del) -- classic split word-diff behavior.
  function appendSpans(container, spans, side) {
    if (!spans) return;
    spans.forEach(function (s) {
      if (side === 'old' && s.kind === 'add') return;
      if (side === 'new' && s.kind === 'del') return;
      if (s.kind === 'same') {
        container.appendChild(doc.createTextNode(s.text));
      } else {
        var cls = s.kind === 'del' ? 'diff-del-inline' : 'diff-ins-inline';
        container.appendChild(span(s.text, cls));
      }
    });
  }

  function appendMovedBadge(line, node) {
    var badge = span('↕ moved', 'diff-moved-badge');
    if (node.oldIndexInParent != null && node.newIndexInParent != null) {
      badge.title = 'Position changed: was position ' + (node.oldIndexInParent + 1) + ', now position ' + (node.newIndexInParent + 1);
    } else {
      badge.title = 'Position changed';
    }
    line.appendChild(badge);
  }

  function rowClassFor(node) {
    if (node.status === 'added') return 'diff-added';
    if (node.status === 'removed') return 'diff-removed';
    if (node.ownChanged) return 'diff-modified';
    if (node.moved) return 'diff-moved';
    return '';
  }

  function isSimpleLeafParent(node) {
    if (node.children.length === 0) return { isEmpty: true, textChild: null };
    if (node.children.length === 1 && (node.children[0].nodeType === 'text' || node.children[0].nodeType === 'cdata')) {
      return { isEmpty: false, textChild: node.children[0] };
    }
    return { isEmpty: false, textChild: null };
  }

  function tagNameFor(node, side) {
    if (side === 'new' && node.newTag) return node.newTag;
    return node.tag;
  }

  // Appends the content of an opening tag (indent, name, attrs, and either
  // "/>", ">text</tag>" for a collapsed leaf, or plain ">") to `line`.
  function appendOpenTagContent(line, node, side, depth, leafInfo) {
    line.appendChild(span('  '.repeat(depth), 'indent'));
    line.appendChild(span('<'));
    line.appendChild(span(tagNameFor(node, side), 'tagname'));

    node.attrs.forEach(function (a) {
      // oldValue/newValue already fully encode per-side presence (null on
      // whichever side the attribute doesn't exist), so this alone decides
      // visibility -- correct for both normal and ignored attributes.
      var value = side === 'old' ? a.oldValue : a.newValue;
      if (value === null) return;
      line.appendChild(doc.createTextNode(' '));
      var nameCls = (a.status === 'added' && side === 'new') ? 'diff-attr-added'
        : (a.status === 'removed' && side === 'old') ? 'diff-attr-removed'
        : (a.status === 'modified') ? 'diff-attr-modified' : null;
      // Ignored attributes keep their real status/diff (computed at diff
      // time) but default to unhighlighted -- 'ignored-attr-diff' is a pure
      // CSS hook the results page toggles live, without recomputing anything.
      if (a.ignored && nameCls) nameCls += ' ignored-attr-diff';
      var wrap = span(null, nameCls);
      wrap.appendChild(doc.createTextNode(a.name + '="'));
      if (a.status === 'modified' && a.valueDiff) {
        appendSpans(wrap, a.valueDiff, side);
      } else {
        wrap.appendChild(doc.createTextNode(value));
      }
      wrap.appendChild(doc.createTextNode('"'));
      line.appendChild(wrap);
    });

    if (leafInfo.isEmpty) {
      line.appendChild(span('/>'));
      return;
    }
    if (leafInfo.textChild) {
      line.appendChild(span('>'));
      var textWrap = span(null, null);
      var tc = leafInfo.textChild;
      if (tc.textDiff) {
        appendSpans(textWrap, tc.textDiff, side);
      } else {
        textWrap.appendChild(doc.createTextNode((side === 'old' ? tc.oldText : tc.newText) || ''));
      }
      line.appendChild(textWrap);
      line.appendChild(span('</'));
      line.appendChild(span(tagNameFor(node, side), 'tagname'));
      line.appendChild(span('>'));
      return;
    }
    line.appendChild(span('>'));
  }

  function appendCloseTagContent(line, node, side, depth) {
    line.appendChild(span('  '.repeat(depth), 'indent'));
    line.appendChild(span('</'));
    line.appendChild(span(tagNameFor(node, side), 'tagname'));
    line.appendChild(span('>'));
  }

  // A whole added/removed SUBTREE has every descendant individually stamped
  // with the same status (see diff-engine's buildAddedRemovedNode), so
  // without ancestor-tracking every line of a multi-line added element would
  // count as its own "addition" for navigation purposes. ancestorStatus is
  // the nearest ancestor's added/removed status (or null); only the
  // outermost node of such a subtree is a nav target -- its descendants
  // still render with add/remove styling, just aren't separately targetable.
  // "modified" and "moved" don't have this problem (each is computed per
  // node, never inherited), so they're always direct targets.
  function navFlags(node, ancestorStatus) {
    var isAdded = node.status === 'added';
    var isRemoved = node.status === 'removed';
    return {
      isAdded: isAdded,
      isRemoved: isRemoved,
      isTopLevelAdded: isAdded && ancestorStatus !== 'added',
      isTopLevelRemoved: isRemoved && ancestorStatus !== 'removed',
      isModified: !isAdded && !isRemoved && !!node.ownChanged,
      isIgnoredOnlyModified: !isAdded && !isRemoved && !!node.ignoredOnlyChanged,
      isMoved: !isAdded && !isRemoved && !!node.moved,
      childAncestorStatus: isAdded ? 'added' : (isRemoved ? 'removed' : ancestorStatus),
    };
  }

  // Assigns a visible running line number to every non-blank row (blank
  // placeholder rows in the side-by-side view get no number). Done as a
  // post-process over the finished row list rather than threaded through
  // the recursive builders, since "is this row blank" is already
  // observable from the row itself.
  function addLineNumbers(rows) {
    var n = 0;
    rows.forEach(function (r) {
      var num = null;
      if (!r.classList.contains('diff-blank')) { n++; num = n; }
      var gutter = span(num != null ? String(num) : '', 'line-number');
      r.insertBefore(gutter, r.firstChild);
    });
  }

  // Unified view has no blank rows -- instead each row's gutter-marker
  // ('+' / '-' / ' ') tells us which side(s) it occupies a line number on.
  function addDualLineNumbers(rows) {
    var oldN = 0, newN = 0;
    rows.forEach(function (r) {
      var marker = r.querySelector('.gutter-marker');
      var markerText = marker ? marker.textContent : ' ';
      var oldNum = null, newNum = null;
      if (markerText !== '+') { oldN++; oldNum = oldN; }
      if (markerText !== '-') { newN++; newNum = newN; }
      var newGutter = span(newNum != null ? String(newNum) : '', 'line-number line-number-new');
      var oldGutter = span(oldNum != null ? String(oldNum) : '', 'line-number line-number-old');
      r.insertBefore(newGutter, r.firstChild);
      r.insertBefore(oldGutter, r.firstChild);
    });
  }

  ns.RenderCommon = {
    span: span,
    lineDiv: lineDiv,
    blankLine: blankLine,
    appendSpans: appendSpans,
    appendMovedBadge: appendMovedBadge,
    rowClassFor: rowClassFor,
    isSimpleLeafParent: isSimpleLeafParent,
    tagNameFor: tagNameFor,
    appendOpenTagContent: appendOpenTagContent,
    appendCloseTagContent: appendCloseTagContent,
    navFlags: navFlags,
    addLineNumbers: addLineNumbers,
    addDualLineNumbers: addDualLineNumbers,
  };
})(typeof window !== 'undefined' ? window : globalThis);
