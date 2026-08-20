(function () {
  'use strict';
  var ns = window.XmlDiff;

  var oldTextarea = document.getElementById('old-input');
  var newTextarea = document.getElementById('new-input');
  var oldFileInput = document.getElementById('old-file');
  var newFileInput = document.getElementById('new-file');
  var oldDropzone = document.getElementById('old-dropzone');
  var newDropzone = document.getElementById('new-dropzone');
  var oldFilenameLabel = document.getElementById('old-filename');
  var newFilenameLabel = document.getElementById('new-filename');
  var compareBtn = document.getElementById('compare-btn');
  var errorBanner = document.getElementById('error-banner');
  var noticeBanner = document.getElementById('notice-banner');
  var ignoreAttrsInput = document.getElementById('ignore-attrs-input');
  var caseInsensitiveElementsInput = document.getElementById('case-insensitive-elements-input');

  var state = { oldFileName: null, newFileName: null };

  // Free up whatever the last comparison(s) were holding in sessionStorage
  // as soon as we're back here -- large XML diffs add up fast against the
  // ~5-10MB per-origin quota, and there's never a reason to keep an old
  // comparison once you're starting a new one. `pageshow` (rather than
  // just running this at load) also covers browsers restoring this page
  // from bfcache on a back/forward navigation, where page scripts don't
  // necessarily re-run.
  ns.Storage.clearAllComparisons();
  window.addEventListener('pageshow', function () { ns.Storage.clearAllComparisons(); });

  var IGNORE_ATTRS_STORAGE_KEY = 'qmexmlc:ignoreAttrs';
  (function restoreIgnoreAttrs() {
    try {
      var saved = window.localStorage.getItem(IGNORE_ATTRS_STORAGE_KEY);
      if (saved) ignoreAttrsInput.value = saved;
    } catch (e) { /* localStorage unavailable -- non-fatal */ }
  })();
  ignoreAttrsInput.addEventListener('input', function () {
    try { window.localStorage.setItem(IGNORE_ATTRS_STORAGE_KEY, ignoreAttrsInput.value); } catch (e) { /* non-fatal */ }
  });

  function parseIgnoreAttrs() {
    var names = ignoreAttrsInput.value.split(',')
      .map(function (s) { return s.trim().toLowerCase(); })
      .filter(function (s) { return s.length > 0; });
    return { set: new Set(names), list: names };
  }

  var CASE_INSENSITIVE_ELEMENTS_STORAGE_KEY = 'qmexmlc:caseInsensitiveElements';
  (function restoreCaseInsensitiveElements() {
    try {
      var saved = window.localStorage.getItem(CASE_INSENSITIVE_ELEMENTS_STORAGE_KEY);
      if (saved) caseInsensitiveElementsInput.value = saved;
    } catch (e) { /* localStorage unavailable -- non-fatal */ }
  })();
  caseInsensitiveElementsInput.addEventListener('input', function () {
    try { window.localStorage.setItem(CASE_INSENSITIVE_ELEMENTS_STORAGE_KEY, caseInsensitiveElementsInput.value); } catch (e) { /* non-fatal */ }
  });

  function parseCaseInsensitiveElements() {
    var names = caseInsensitiveElementsInput.value.split(',')
      .map(function (s) { return s.trim().toLowerCase(); })
      .filter(function (s) { return s.length > 0; });
    return { set: new Set(names), list: names };
  }

  function updateFilenameLabel(side) {
    var label = side === 'old' ? oldFilenameLabel : newFilenameLabel;
    var name = state[side + 'FileName'];
    label.textContent = name || '';
  }

  function readFileInto(file, textarea, side) {
    var reader = new FileReader();
    reader.onload = function () {
      textarea.value = reader.result;
      state[side + 'FileName'] = file.name;
      updateFilenameLabel(side);
      clearError();
    };
    reader.onerror = function () {
      showError('Could not read file "' + file.name + '".');
    };
    reader.readAsText(file);
  }

  function setupDropzone(zone, textarea, side) {
    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', function (e) {
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readFileInto(file, textarea, side);
    });
  }

  oldFileInput.addEventListener('change', function () {
    var file = oldFileInput.files[0];
    if (file) readFileInto(file, oldTextarea, 'old');
  });
  newFileInput.addEventListener('change', function () {
    var file = newFileInput.files[0];
    if (file) readFileInto(file, newTextarea, 'new');
  });

  setupDropzone(oldDropzone, oldTextarea, 'old');
  setupDropzone(newDropzone, newTextarea, 'new');

  oldTextarea.addEventListener('input', function () { state.oldFileName = null; updateFilenameLabel('old'); });
  newTextarea.addEventListener('input', function () { state.newFileName = null; updateFilenameLabel('new'); });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.hidden = false;
  }
  function clearError() {
    errorBanner.hidden = true;
    errorBanner.textContent = '';
  }

  (function showNoticeFromQuery() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('err') === 'no-comparison') {
      noticeBanner.textContent = 'No comparison data found for that link -- please run a new comparison.';
      noticeBanner.hidden = false;
    }
  })();

  compareBtn.addEventListener('click', function () {
    clearError();
    var oldXml = oldTextarea.value;
    var newXml = newTextarea.value;
    if (!oldXml.trim() || !newXml.trim()) {
      showError('Please provide both an old and a new XML document.');
      return;
    }

    var ignoreAttrs = parseIgnoreAttrs();
    var caseInsensitiveElements = parseCaseInsensitiveElements();

    var oldParsed = ns.XmlParser.canonicalizeDocument(oldXml);
    if (oldParsed.error) {
      showError('Could not parse the OLD document: ' + oldParsed.error.message);
      return;
    }
    var newParsed = ns.XmlParser.canonicalizeDocument(newXml);
    if (newParsed.error) {
      showError('Could not parse the NEW document: ' + newParsed.error.message);
      return;
    }

    var diffResult;
    try {
      diffResult = ns.DiffEngine.diffDocuments(oldParsed.root, newParsed.root, {
        oldFileName: state.oldFileName,
        newFileName: state.newFileName,
        ignoredAttrs: ignoreAttrs.list,
        caseInsensitiveElements: caseInsensitiveElements.list,
      }, ignoreAttrs.set, caseInsensitiveElements.set);
    } catch (e) {
      showError('Something went wrong while comparing these documents: ' + e.message);
      return;
    }

    var saveResult = ns.Storage.saveComparison(diffResult);
    if (saveResult.error) {
      showError(saveResult.error);
      return;
    }
    window.location.href = 'results.html?id=' + encodeURIComponent(saveResult.id);
  });
})();
