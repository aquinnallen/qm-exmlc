(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};
  var Hash = ns.Hash;
  var TextDiff = ns.TextDiff;

  var ID_ATTR_CANDIDATES = ['id', 'key', 'name', 'code', 'ref'];
  var MIN_SIMILARITY_THRESHOLD = 0.3;

  var idCounter = 0;
  function nextId() { return 'n' + (idCounter++); }

  // Attribute local names (lowercased) to exclude from matching/highlighting
  // for this diff run, while still showing their real per-side values. Set
  // once at the top of diffDocuments.
  var ignoredAttrs = new Set();

  // ---- bucketing: nodes only ever match within same (type, ns, tag) ----
  function bucketKey(n) {
    if (n.type === 'element') return 'el|' + (n.namespaceURI || '') + '|' + n.localName;
    if (n.type === 'text' || n.type === 'cdata') return 'text';
    if (n.type === 'comment') return 'comment';
    if (n.type === 'pi') return 'pi|' + n.target;
    return 'other';
  }

  function groupByBucket(kids) {
    var map = new Map();
    kids.forEach(function (node, i) {
      var key = bucketKey(node);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ node: node, origIndex: i });
    });
    return map;
  }

  function removeFromArray(arr, item) {
    var idx = arr.indexOf(item);
    if (idx !== -1) arr.splice(idx, 1);
  }

  function getAttrByLocalName(node, localNameLower) {
    for (var k in node.attrs) {
      if (node.attrs[k].localName.toLowerCase() === localNameLower) return node.attrs[k].value;
    }
    return undefined;
  }

  function pickIdAttributeKey(oldEntries, newEntries) {
    var allNodes = oldEntries.concat(newEntries).map(function (e) { return e.node; }).filter(function (n) { return n.type === 'element'; });
    if (!allNodes.length) return null;
    for (var i = 0; i < ID_ATTR_CANDIDATES.length; i++) {
      var cand = ID_ATTR_CANDIDATES[i];
      if (ignoredAttrs.has(cand)) continue; // an ignored attr is presumed unreliable for identity too
      var withAttr = allNodes.filter(function (n) { return getAttrByLocalName(n, cand) !== undefined; });
      if (withAttr.length > 0 && withAttr.length >= Math.ceil(allNodes.length / 2)) return cand;
    }
    return null;
  }

  function groupByIdValue(entries, idAttrLower) {
    var map = new Map();
    entries.forEach(function (e) {
      if (e.node.type !== 'element') return;
      var v = getAttrByLocalName(e.node, idAttrLower);
      if (v === undefined) return;
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(e);
    });
    return map;
  }

  function groupByHash(entries, field) {
    var map = new Map();
    entries.forEach(function (e) {
      var h = Hash.computeHashes(e.node)[field];
      if (!map.has(h)) map.set(h, []);
      map.get(h).push(e);
    });
    return map;
  }

  // ---- similarity scoring (fallback matching for likely-edited nodes) ----
  function getOwnText(node) {
    if (node.type === 'text' || node.type === 'cdata' || node.type === 'comment') return node.textContent || '';
    if (node.type === 'element') {
      return node.children.filter(function (c) { return c.type === 'text' || c.type === 'cdata'; })
        .map(function (c) { return c.textContent; }).join(' ');
    }
    return '';
  }

  function bigrams(str) {
    var s = str.toLowerCase();
    var set = new Set();
    if (s.length < 2) { if (s.length === 1) set.add(s); return set; }
    for (var i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  function jaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    var inter = 0;
    setA.forEach(function (x) { if (setB.has(x)) inter++; });
    var union = setA.size + setB.size - inter;
    return union === 0 ? 1 : inter / union;
  }

  function attrSimilarity(a, b) {
    var aKeys = Object.keys(a.attrs || {}).filter(function (k) { return !ignoredAttrs.has(a.attrs[k].localName.toLowerCase()); });
    var bKeys = Object.keys(b.attrs || {}).filter(function (k) { return !ignoredAttrs.has(b.attrs[k].localName.toLowerCase()); });
    if (!aKeys.length && !bKeys.length) return 1;
    var union = new Set(aKeys.concat(bKeys));
    var shared = 0;
    union.forEach(function (k) {
      if (a.attrs[k] && b.attrs[k] && a.attrs[k].value === b.attrs[k].value) shared++;
    });
    return shared / union.size;
  }

  function structSimilarity(a, b) {
    if (a.type !== 'element' || b.type !== 'element') return 1;
    var aCount = {}, bCount = {};
    a.children.filter(function (c) { return c.type === 'element'; }).forEach(function (c) { aCount[c.localName] = (aCount[c.localName] || 0) + 1; });
    b.children.filter(function (c) { return c.type === 'element'; }).forEach(function (c) { bCount[c.localName] = (bCount[c.localName] || 0) + 1; });
    var allTags = new Set(Object.keys(aCount).concat(Object.keys(bCount)));
    if (allTags.size === 0) return 1;
    var shared = 0, total = 0;
    allTags.forEach(function (t) {
      shared += Math.min(aCount[t] || 0, bCount[t] || 0);
      total += Math.max(aCount[t] || 0, bCount[t] || 0);
    });
    return total === 0 ? 1 : shared / total;
  }

  function similarityScore(a, b) {
    var attrSim = attrSimilarity(a, b);
    var textSim = jaccard(bigrams(getOwnText(a)), bigrams(getOwnText(b)));
    var structSim = structSimilarity(a, b);
    return 0.4 * attrSim + 0.4 * textSim + 0.2 * structSim;
  }

  // ---- per-bucket matching: id-attr -> content-hash -> similarity -> leftovers ----
  function matchBucket(oldEntries, newEntries) {
    var oldRemaining = oldEntries.slice();
    var newRemaining = newEntries.slice();
    var pairs = [];

    // Step B: id-attribute matching (primary, elements only)
    // Nodes that carry a value for the bucket's chosen id attribute but
    // found no match declared their identity explicitly and failed to pair
    // -- e.g. book id="6" vs book id="4" are different books by definition,
    // however textually similar. They must NOT fall through to Steps C/D,
    // which would otherwise happily "match" two unrelated same-tag nodes
    // that just look alike (same child tags, similar text) and misreport a
    // clean add+remove as a single false "modified". Only nodes with no
    // value for that attribute at all (or when the bucket has no reliable
    // id attribute) are still eligible for hash/similarity fallback.
    var oldHadId = [], newHadId = [];
    if (oldRemaining.length && newRemaining.length && oldRemaining[0].node.type === 'element') {
      var idAttrKey = pickIdAttributeKey(oldRemaining, newRemaining);
      if (idAttrKey) {
        var oldById = groupByIdValue(oldRemaining, idAttrKey);
        var newById = groupByIdValue(newRemaining, idAttrKey);
        oldById.forEach(function (oldList, idVal) {
          var newList = newById.get(idVal);
          if (!newList) return;
          var n = Math.min(oldList.length, newList.length);
          for (var i = 0; i < n; i++) {
            pairs.push({ old: oldList[i], new: newList[i] });
            removeFromArray(oldRemaining, oldList[i]);
            removeFromArray(newRemaining, newList[i]);
          }
        });
        oldRemaining = oldRemaining.filter(function (e) {
          var hasId = getAttrByLocalName(e.node, idAttrKey) !== undefined;
          if (hasId) oldHadId.push(e);
          return !hasId;
        });
        newRemaining = newRemaining.filter(function (e) {
          var hasId = getAttrByLocalName(e.node, idAttrKey) !== undefined;
          if (hasId) newHadId.push(e);
          return !hasId;
        });
      }
    }

    // Step C: exact content-hash matching (fallback)
    if (oldRemaining.length && newRemaining.length) {
      var oldByHash = groupByHash(oldRemaining, 'contentHash');
      var newByHash = groupByHash(newRemaining, 'contentHash');
      oldByHash.forEach(function (oldList, hash) {
        var newList = newByHash.get(hash);
        if (!newList) return;
        var n = Math.min(oldList.length, newList.length);
        for (var i = 0; i < n; i++) {
          pairs.push({ old: oldList[i], new: newList[i] });
          removeFromArray(oldRemaining, oldList[i]);
          removeFromArray(newRemaining, newList[i]);
        }
      });
    }

    // Step D: similarity matching (fallback for likely-edited nodes)
    if (oldRemaining.length && newRemaining.length) {
      var candidates = [];
      oldRemaining.forEach(function (o) {
        newRemaining.forEach(function (n) {
          var score = similarityScore(o.node, n.node);
          if (score >= MIN_SIMILARITY_THRESHOLD) candidates.push({ o: o, n: n, score: score });
        });
      });
      candidates.sort(function (a, b) { return b.score - a.score; });
      var usedOld = new Set(), usedNew = new Set();
      candidates.forEach(function (c) {
        if (usedOld.has(c.o) || usedNew.has(c.n)) return;
        pairs.push({ old: c.o, new: c.n });
        usedOld.add(c.o); usedNew.add(c.n);
      });
      oldRemaining = oldRemaining.filter(function (o) { return !usedOld.has(o); });
      newRemaining = newRemaining.filter(function (n) { return !usedNew.has(n); });
    }

    // Step F: leftovers are genuine adds/removes (including id-bearing nodes
    // that were excluded from Steps C/D above)
    oldRemaining.concat(oldHadId).forEach(function (o) { pairs.push({ old: o, new: null }); });
    newRemaining.concat(newHadId).forEach(function (n) { pairs.push({ old: null, new: n }); });

    return pairs;
  }

  // ---- LCS (by object identity) over the matched-pair sequence ----
  function lcsStableSet(byOld, byNew) {
    var n = byOld.length, m = byNew.length;
    if (n === 0 || m === 0) return new Set();
    var dp = [];
    for (var i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = byOld[i] === byNew[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var stable = new Set();
    i = 0; var jj = 0;
    while (i < n && jj < m) {
      if (byOld[i] === byNew[jj]) { stable.add(byOld[i]); i++; jj++; }
      else if (dp[i + 1][jj] >= dp[i][jj + 1]) i++;
      else jj++;
    }
    return stable;
  }

  // ---- Step G: final display order, interleaving matched/added/removed ----
  function buildFinalOrder(pairs) {
    var matched = pairs.filter(function (p) { return p.old && p.new; });
    var removedOnly = pairs.filter(function (p) { return p.old && !p.new; });
    var addedOnly = pairs.filter(function (p) { return !p.old && p.new; });

    var byOld = matched.slice().sort(function (a, b) { return a.old.origIndex - b.old.origIndex; });
    var byNew = matched.slice().sort(function (a, b) { return a.new.origIndex - b.new.origIndex; });
    var stableSet = lcsStableSet(byOld, byNew);

    var result = matched.concat(addedOnly)
      .sort(function (a, b) { return a.new.origIndex - b.new.origIndex; })
      .map(function (p) {
        var isMatched = !!p.old && !!p.new;
        return { pair: p, kind: isMatched ? 'matched' : 'added', moved: isMatched ? !stableSet.has(p) : false };
      });

    removedOnly.forEach(function (rp) {
      var anchorPair = null, bestOldIdx = -1;
      matched.forEach(function (mp) {
        if (mp.old.origIndex < rp.old.origIndex && mp.old.origIndex > bestOldIdx) {
          bestOldIdx = mp.old.origIndex;
          anchorPair = mp;
        }
      });
      var item = { pair: rp, kind: 'removed', moved: false };
      if (!anchorPair) {
        result.unshift(item);
      } else {
        var idx = result.findIndex(function (r) { return r.pair === anchorPair; });
        result.splice(idx + 1, 0, item);
      }
    });

    return result;
  }

  // ---- attribute diffing (set/map semantics -- attribute order is not semantic) ----
  function diffAttrs(oldAttrs, newAttrs) {
    var allKeys = new Set(Object.keys(oldAttrs).concat(Object.keys(newAttrs)));
    var result = [];
    var sortedKeys = Array.from(allKeys).sort(function (a, b) {
      var an = (oldAttrs[a] || newAttrs[a]).displayName;
      var bn = (oldAttrs[b] || newAttrs[b]).displayName;
      return an.localeCompare(bn);
    });
    sortedKeys.forEach(function (k) {
      var o = oldAttrs[k], n = newAttrs[k];
      var name = (o || n).displayName;
      var localName = (o || n).localName.toLowerCase();
      var isIgnored = ignoredAttrs.has(localName);

      // Ignored attributes still get their REAL status/diff computed --
      // they just never affect matching (handled elsewhere, via hash.js /
      // pickIdAttributeKey) or the element's own "changed" status (see
      // diffNode below), and default to unhighlighted display. The `ignored`
      // flag lets the results page toggle their highlighting on/off live,
      // without recomputing anything, the same way "Show moved" works.
      var entry;
      if (o && !n) entry = { name: name, status: 'removed', oldValue: o.value, newValue: null, valueDiff: null };
      else if (!o && n) entry = { name: name, status: 'added', oldValue: null, newValue: n.value, valueDiff: null };
      else if (o.value === n.value) entry = { name: name, status: 'unchanged', oldValue: o.value, newValue: n.value, valueDiff: null };
      else entry = { name: name, status: 'modified', oldValue: o.value, newValue: n.value, valueDiff: TextDiff.diffWords(o.value, n.value) };
      entry.ignored = isIgnored;
      result.push(entry);
    });
    return result;
  }

  // ---- recursive diff of a matched (old, new) pair ----
  function diffNode(oldNode, newNode) {
    var id = nextId();

    if (oldNode.type === 'element') {
      var attrs = diffAttrs(oldNode.attrs, newNode.attrs);
      var children = diffChildren(oldNode, newNode);
      var ownChanged = attrs.some(function (a) { return !a.ignored && a.status !== 'unchanged'; });
      // True when the ONLY attribute difference(s) on this node are on
      // ignored attributes -- lets the results page opt these into the
      // "Modified" nav category on demand (only when their highlighting is
      // turned on), without it ever affecting ownChanged/status/counts,
      // which stay fixed at diff time regardless of that live toggle.
      var ignoredOnlyChanged = !ownChanged && attrs.some(function (a) { return a.ignored && a.status !== 'unchanged'; });
      var childrenChanged = children.some(function (c) { return c.status !== 'unchanged' || c.moved; });
      var status = (ownChanged || childrenChanged) ? 'modified' : 'unchanged';
      return {
        id: id, status: status, ownChanged: ownChanged, ignoredOnlyChanged: ignoredOnlyChanged, moved: false,
        nodeType: 'element', tag: oldNode.tag, newTag: newNode.tag, namespaceURI: oldNode.namespaceURI,
        oldIndexInParent: null, newIndexInParent: null,
        attrs: attrs, textDiff: null, oldText: null, newText: null, children: children,
      };
    }

    // leaf types: text / cdata / comment / pi
    var oldText = oldNode.textContent, newText = newNode.textContent;
    var same = oldText === newText && (oldNode.type !== 'pi' || oldNode.target === newNode.target);
    var textDiff = same ? null : TextDiff.diffWords(oldText, newText);
    return {
      id: id, status: same ? 'unchanged' : 'modified', ownChanged: !same, moved: false,
      nodeType: oldNode.type, tag: oldNode.type === 'pi' ? oldNode.target : null, newTag: null, namespaceURI: null,
      oldIndexInParent: null, newIndexInParent: null,
      attrs: [], textDiff: textDiff, oldText: oldText, newText: newText, children: [],
    };
  }

  function buildAddedRemovedNode(node, status, origIndex) {
    var id = nextId();
    if (node.type === 'element') {
      var attrs = Object.keys(node.attrs).map(function (k) {
        var a = node.attrs[k];
        return { name: a.displayName, status: status, oldValue: status === 'removed' ? a.value : null, newValue: status === 'added' ? a.value : null, valueDiff: null, ignored: ignoredAttrs.has(a.localName.toLowerCase()) };
      });
      var children = node.children.map(function (c) { return buildAddedRemovedNode(c, status, c.rawIndex); });
      return {
        id: id, status: status, ownChanged: true, moved: false,
        nodeType: 'element', tag: node.tag, newTag: node.tag, namespaceURI: node.namespaceURI,
        oldIndexInParent: status === 'removed' ? origIndex : null, newIndexInParent: status === 'added' ? origIndex : null,
        attrs: attrs, textDiff: null, oldText: null, newText: null, children: children,
      };
    }
    return {
      id: id, status: status, ownChanged: true, moved: false,
      nodeType: node.type, tag: node.type === 'pi' ? node.target : null, newTag: null, namespaceURI: null,
      oldIndexInParent: status === 'removed' ? origIndex : null, newIndexInParent: status === 'added' ? origIndex : null,
      attrs: [], textDiff: null,
      oldText: status === 'removed' ? node.textContent : null, newText: status === 'added' ? node.textContent : null,
      children: [],
    };
  }

  function pairToDiffNode(entry) {
    if (entry.kind === 'added') return buildAddedRemovedNode(entry.pair.new.node, 'added', entry.pair.new.origIndex);
    if (entry.kind === 'removed') return buildAddedRemovedNode(entry.pair.old.node, 'removed', entry.pair.old.origIndex);
    var dn = diffNode(entry.pair.old.node, entry.pair.new.node);
    dn.moved = entry.moved;
    dn.oldIndexInParent = entry.pair.old.origIndex;
    dn.newIndexInParent = entry.pair.new.origIndex;
    return dn;
  }

  function diffChildren(oldParentNode, newParentNode) {
    var oldKids = oldParentNode ? oldParentNode.children : [];
    var newKids = newParentNode ? newParentNode.children : [];

    var oldGroups = groupByBucket(oldKids);
    var newGroups = groupByBucket(newKids);
    var allKeys = new Set(Array.from(oldGroups.keys()).concat(Array.from(newGroups.keys())));

    var allPairs = [];
    allKeys.forEach(function (key) {
      allPairs = allPairs.concat(matchBucket(oldGroups.get(key) || [], newGroups.get(key) || []));
    });

    return buildFinalOrder(allPairs).map(pairToDiffNode);
  }

  function diffDocuments(oldRoot, newRoot, meta, ignoredAttrsSet) {
    idCounter = 0;
    ignoredAttrs = ignoredAttrsSet || new Set();
    Hash.setIgnoredAttrs(ignoredAttrs);
    var rootTagMismatch = oldRoot.tag !== newRoot.tag || oldRoot.namespaceURI !== newRoot.namespaceURI;
    var tree = diffNode(oldRoot, newRoot);
    return {
      meta: Object.assign({}, meta, {
        rootTagMismatch: rootTagMismatch,
        oldRootTag: oldRoot.tag,
        newRootTag: newRoot.tag,
      }),
      tree: tree,
    };
  }

  ns.DiffEngine = {
    diffDocuments: diffDocuments,
    diffNode: diffNode,
    diffChildren: diffChildren,
    diffAttrs: diffAttrs,
    // exposed for testing
    _internal: { matchBucket: matchBucket, groupByBucket: groupByBucket, similarityScore: similarityScore, lcsStableSet: lcsStableSet },
  };
})(typeof window !== 'undefined' ? window : globalThis);
