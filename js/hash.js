(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};

  // FNV-1a, 32-bit. Not cryptographic -- only needs identical content to
  // collide and differing content to (almost always) not collide.
  function fnv1a(str) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
  }

  var SEP = String.fromCharCode(1);

  // Attribute local names (lowercased) to leave out of hashing entirely, so
  // a volatile attribute (e.g. a regenerated uuid) can't prevent two
  // otherwise-identical nodes from being recognized as the same node. Set
  // once per diff run via setIgnoredAttrs -- computeHashes memoizes onto
  // each node, so this must be set before any hashing happens for a given
  // parse (true in this app's flow: every Compare re-parses from scratch).
  var ignoredAttrs = new Set();
  function setIgnoredAttrs(set) { ignoredAttrs = set || new Set(); }

  // Every element gets two hashes:
  //  - orderedHash: respects child order; used only as a short-circuit for
  //    "this whole subtree is byte-identical AND in the same order".
  //  - contentHash: child hashes are sorted (multiset) before combining, so
  //    a node whose children are only reordered still hashes equal to its
  //    counterpart. Sibling matching always keys off contentHash, and since
  //    this is computed recursively, a reorder is detected at the deepest
  //    level it actually happened, not misreported as "modified" higher up.
  function computeHashes(node) {
    if (node._hashes) return node._hashes;

    var orderedHash, contentHash;

    if (node.type === 'element') {
      var attrKeys = Object.keys(node.attrs).filter(function (k) {
        return !ignoredAttrs.has(node.attrs[k].localName.toLowerCase());
      }).sort();
      var attrPart = attrKeys.map(function (k) { return k + '=' + node.attrs[k].value; }).join(SEP);
      var childHashPairs = node.children.map(computeHashes);
      var orderedChildStr = childHashPairs.map(function (h) { return h.orderedHash; }).join(',');
      var contentChildStr = childHashPairs.map(function (h) { return h.contentHash; }).slice().sort().join(',');
      var base = 'EL' + SEP + (node.namespaceURI || '') + SEP + node.localName + SEP + attrPart;
      orderedHash = fnv1a(base + SEP + orderedChildStr);
      contentHash = fnv1a(base + SEP + contentChildStr);
    } else if (node.type === 'text' || node.type === 'cdata') {
      orderedHash = contentHash = fnv1a('TEXT' + SEP + node.textContent);
    } else if (node.type === 'comment') {
      orderedHash = contentHash = fnv1a('COMMENT' + SEP + node.textContent);
    } else if (node.type === 'pi') {
      orderedHash = contentHash = fnv1a('PI' + SEP + node.target + SEP + node.textContent);
    } else {
      orderedHash = contentHash = fnv1a('UNKNOWN');
    }

    node._hashes = { orderedHash: orderedHash, contentHash: contentHash };
    return node._hashes;
  }

  ns.Hash = { computeHashes: computeHashes, fnv1a: fnv1a, setIgnoredAttrs: setIgnoredAttrs };
})(typeof window !== 'undefined' ? window : globalThis);
