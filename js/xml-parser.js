(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};

  var WHITESPACE_ONLY_RE = /^\s*$/;

  function parseXmlDocument(str) {
    var parser = new root.DOMParser();
    var doc = parser.parseFromString(str, 'application/xml');
    var perr = doc.getElementsByTagName('parsererror')[0];
    if (perr) {
      return { doc: null, error: { message: (perr.textContent || 'XML parse error').trim(), raw: perr.textContent || '' } };
    }
    if (!doc.documentElement) {
      return { doc: null, error: { message: 'No root element found.', raw: '' } };
    }
    return { doc: doc, error: null };
  }

  // Node type constants (avoids relying on the global Node in odd environments).
  var ELEMENT_NODE = 1;
  var TEXT_NODE = 3;
  var CDATA_SECTION_NODE = 4;
  var PROCESSING_INSTRUCTION_NODE = 7;
  var COMMENT_NODE = 8;

  function buildCanonicalTree(domNode) {
    var nodeType = domNode.nodeType;

    if (nodeType === ELEMENT_NODE) {
      var attrs = {};
      var rawAttrs = domNode.attributes ? Array.prototype.slice.call(domNode.attributes) : [];
      rawAttrs.forEach(function (attr) {
        if (attr.name === 'xmlns' || attr.name.indexOf('xmlns:') === 0) return;
        var localName = attr.localName || attr.name;
        var key = attr.namespaceURI ? attr.namespaceURI + '|' + localName : localName;
        attrs[key] = { value: attr.value, displayName: attr.name, localName: localName };
      });

      var children = [];
      Array.prototype.slice.call(domNode.childNodes).forEach(function (childDom) {
        var c = buildCanonicalTree(childDom);
        if (c !== null) children.push(c);
      });
      children.forEach(function (c, i) { c.rawIndex = i; });

      return {
        type: 'element',
        tag: domNode.nodeName,
        localName: domNode.localName || domNode.nodeName,
        namespaceURI: domNode.namespaceURI || null,
        attrs: attrs,
        children: children,
        textContent: null,
        target: null,
        rawIndex: 0,
      };
    }

    if (nodeType === TEXT_NODE) {
      var text = domNode.nodeValue;
      if (WHITESPACE_ONLY_RE.test(text)) return null; // insignificant formatting whitespace
      return { type: 'text', tag: null, localName: null, namespaceURI: null, attrs: {}, children: [], textContent: text.trim(), target: null, rawIndex: 0 };
    }

    if (nodeType === CDATA_SECTION_NODE) {
      return { type: 'cdata', tag: null, localName: null, namespaceURI: null, attrs: {}, children: [], textContent: domNode.nodeValue, target: null, rawIndex: 0 };
    }

    if (nodeType === COMMENT_NODE) {
      return { type: 'comment', tag: null, localName: null, namespaceURI: null, attrs: {}, children: [], textContent: domNode.nodeValue, target: null, rawIndex: 0 };
    }

    if (nodeType === PROCESSING_INSTRUCTION_NODE) {
      return { type: 'pi', tag: null, localName: null, namespaceURI: null, attrs: {}, children: [], textContent: domNode.nodeValue, target: domNode.target, rawIndex: 0 };
    }

    return null; // doctype and other node types are not diffed
  }

  function canonicalizeDocument(rawXmlString) {
    var parsed = parseXmlDocument(rawXmlString);
    if (parsed.error) return { root: null, error: parsed.error };
    var root_ = buildCanonicalTree(parsed.doc.documentElement);
    return { root: root_, error: null };
  }

  ns.XmlParser = {
    parseXmlDocument: parseXmlDocument,
    buildCanonicalTree: buildCanonicalTree,
    canonicalizeDocument: canonicalizeDocument,
  };
})(typeof window !== 'undefined' ? window : globalThis);
