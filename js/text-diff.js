(function (root) {
  'use strict';
  var ns = root.XmlDiff = root.XmlDiff || {};

  // Word-ish tokenizer: runs of word characters, runs of whitespace, and
  // runs of punctuation each become their own token, so word-level diffing
  // highlights whole words/punctuation, not individual letters.
  function tokenize(str) {
    if (str == null) return [];
    return str.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+/g) || [];
  }

  // Classic Myers O(ND) diff over token arrays. Returns an edit script of
  // {type:'same'|'add'|'del', token} in order.
  function diffTokens(oldTokens, newTokens) {
    var n = oldTokens.length;
    var m = newTokens.length;
    if (n === 0 && m === 0) return [];

    var max = n + m;
    var offset = max;
    var v = new Array(2 * max + 1).fill(0);
    var trace = [];
    var dFound = -1;

    outer:
    for (var d = 0; d <= max; d++) {
      trace.push(v.slice());
      for (var k = -d; k <= d; k += 2) {
        var x;
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
          x = v[offset + k + 1];
        } else {
          x = v[offset + k - 1] + 1;
        }
        var y = x - k;
        while (x < n && y < m && oldTokens[x] === newTokens[y]) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          dFound = d;
          break outer;
        }
      }
    }

    // Backtrack through the trace to build the edit script.
    var ops = [];
    var x = n, y = m;
    for (var d2 = dFound; d2 > 0; d2--) {
      var vPrev = trace[d2];
      var k2 = x - y;
      var prevK;
      if (k2 === -d2 || (k2 !== d2 && vPrev[offset + k2 - 1] < vPrev[offset + k2 + 1])) {
        prevK = k2 + 1;
      } else {
        prevK = k2 - 1;
      }
      var prevX = vPrev[offset + prevK];
      var prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        ops.push({ type: 'same', token: oldTokens[x - 1] });
        x--; y--;
      }
      if (x === prevX) {
        ops.push({ type: 'add', token: newTokens[y - 1] });
        y--;
      } else {
        ops.push({ type: 'del', token: oldTokens[x - 1] });
        x--;
      }
    }
    while (x > 0 && y > 0) {
      ops.push({ type: 'same', token: oldTokens[x - 1] });
      x--; y--;
    }
    while (x > 0) {
      ops.push({ type: 'del', token: oldTokens[x - 1] });
      x--;
    }
    while (y > 0) {
      ops.push({ type: 'add', token: newTokens[y - 1] });
      y--;
    }
    ops.reverse();
    return ops;
  }

  function coalesce(ops) {
    var spans = [];
    ops.forEach(function (op) {
      var kind = op.type === 'same' ? 'same' : (op.type === 'add' ? 'add' : 'del');
      var last = spans[spans.length - 1];
      if (last && last.kind === kind) {
        last.text += op.token;
      } else {
        spans.push({ text: op.token, kind: kind });
      }
    });
    return spans;
  }

  function diffWords(oldStr, newStr) {
    oldStr = oldStr == null ? '' : oldStr;
    newStr = newStr == null ? '' : newStr;
    if (oldStr === newStr) return [{ text: oldStr, kind: 'same' }];
    var ops = diffTokens(tokenize(oldStr), tokenize(newStr));
    return coalesce(ops);
  }

  ns.TextDiff = { diffWords: diffWords, tokenize: tokenize, diffTokens: diffTokens };
})(typeof window !== 'undefined' ? window : globalThis);
