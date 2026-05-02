/**
 * ADMIN HTML TOOLS - Constructor de HTML para párrafos y contenido
 * Dos campos: editor visual y salida HTML para copiar
 */
(function() {
  'use strict';

  var metaImg = document.querySelector('meta[name="html-tools-static-images"]');
  if (metaImg && metaImg.content) {
    window.HTML_TOOLS_STATIC_IMAGES = metaImg.content;
  }

  var editor = document.getElementById('htmlEditor');
  var htmlOutput = document.getElementById('htmlOutput');
  var btnCopyHtml = document.getElementById('btnCopyHtml');
  var toastCopy = document.getElementById('toastCopy');
  var modalUrl = document.getElementById('modalUrlInput');
  var modalUrlTitle = document.getElementById('modalUrlTitle');
  var modalUrlField = document.getElementById('modalUrlInputField');
  var modalUrlOk = document.getElementById('modalUrlOk');
  var modalUrlCancel = document.getElementById('modalUrlCancel');
  var modalUrlClose = document.getElementById('modalUrlClose');
  var customFontSizeInput = document.getElementById('customFontSizeInput');
  var inputFontColor = document.getElementById('inputFontColor');

  var savedSelection = null;

  function saveSelection() {
    var sel = window.getSelection();
    if (editor && sel.anchorNode && editor.contains(sel.anchorNode)) {
      try {
        savedSelection = sel.getRangeAt(0).cloneRange();
      } catch (e) {}
    }
  }

  function restoreSelection() {
    if (savedSelection && editor) {
      try {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedSelection);
        editor.focus();
      } catch (e) {}
    }
  }

  function cleanHtmlString(html) {
    if (!html) return '';
    html = html.replace(/\s*style\s*=\s*["'][\s]*["']/g, '');
    html = html.replace(/&amp;nbsp;/g, ' ').replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ');
    html = html.replace(/<p>\s*<\/p>/g, '').replace(/<div>\s*<\/div>/g, '');
    return html.trim();
  }

  function updateHtmlOutput() {
    if (!editor || !htmlOutput) return;
    if (document.activeElement === htmlOutput) return;
    var html = editor.innerHTML.trim();
    if (!html) {
      htmlOutput.value = '';
      return;
    }
    if (!/<[a-zA-Z][\s\S]*>/.test(html)) {
      var escaped = html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html = '<p>' + escaped.replace(/\r?\n/g, '<br>') + '</p>';
    }
    htmlOutput.value = cleanHtmlString(html);
  }

  function showToast(msg) {
    if (!toastCopy) return;
    toastCopy.textContent = msg || '¡Copiado!';
    toastCopy.classList.add('show');
    setTimeout(function() { toastCopy.classList.remove('show'); }, 2000);
  }

  function execCmd(cmd, value) {
    restoreSelection();
    if (editor) editor.focus();
    document.execCommand(cmd, false, value || null);
    updateHtmlOutput();
  }

  function preventFocusLoss(el) {
    if (!el) return;
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      saveSelection();
    });
  }

  function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return url;
    url = url.trim();
    if (/^data:/.test(url)) return url;
    var normalized = url;
    if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/(.+)$/i.test(url)) {
      var m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
      if (m) {
        var path = m[4].split('?')[0];
        normalized = 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3] + '/' + path;
      }
    } else if (/^https?:\/\/drive\.google\.com\/uc\?id=([^&]+)/i.test(url)) {
      normalized = url;
    } else if (/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/i.test(url)) {
      var driveId = url.match(/\/d\/([^/]+)/)[1];
      normalized = 'https://drive.google.com/uc?export=view&id=' + driveId;
    } else if (/^https?:\/\/www\.dropbox\.com\/[^?]+\?raw=0/i.test(url)) {
      normalized = url.replace(/raw=0/, 'raw=1');
    } else if (/^https?:\/\/[^/]*dropbox\.com\/.+(?:\?|$)/i.test(url) && url.indexOf('raw=1') === -1) {
      normalized = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'raw=1';
    }
    return normalized;
  }

  function processHtmlImages(html) {
    return html.replace(/<img\s+([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*)>/gi, function(match, before, src, after) {
      var newSrc = normalizeImageUrl(src);
      var attrs = (before + 'src="' + newSrc.replace(/"/g, '&quot;') + '"' + after).trim();
      if (/referrerpolicy\s*=/i.test(attrs) === false) attrs += ' referrerpolicy="no-referrer"';
      if (/draggable\s*=/i.test(attrs) === false) attrs += ' draggable="true"';
      return '<img ' + attrs + '>';
    });
  }

  function applyHtmlToEditor() {
    if (!editor || !htmlOutput) return;
    var html = htmlOutput.value;
    try {
      editor.innerHTML = processHtmlImages(html) || '';
    } catch (e) {}
  }

  if (editor) {
    editor.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertLineBreak', false, null);
        updateHtmlOutput();
      }
    });
    editor.addEventListener('input', updateHtmlOutput);
    editor.addEventListener('keyup', function() { saveSelection(); updateHtmlOutput(); });
    editor.addEventListener('mouseup', saveSelection);
    editor.addEventListener('paste', function(e) {
      var data = e.clipboardData || window.clipboardData;
      var items = data.items;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          var blob = items[i].getAsFile();
          var reader = new FileReader();
          reader.onload = function(ev) {
            var dataUrl = ev.target.result;
            var imgHtml = '<img src="' + dataUrl + '" draggable="true">';
            document.execCommand('insertHTML', false, imgHtml);
            updateHtmlOutput();
            var imgs = editor.querySelectorAll('img');
            var lastImg = imgs[imgs.length - 1];
            if (lastImg) setTimeout(function() { showImageResizeModal(lastImg); }, 50);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      e.preventDefault();
      var html = data.getData('text/html');
      var plain = data.getData('text/plain') || '';
      if (!html) {
        var text = plain.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        html = '<p>' + escaped.replace(/\n/g, '<br>') + '</p>';
      }
      document.execCommand('insertHTML', false, html || '');
      updateHtmlOutput();
    });
    editor.addEventListener('click', function(e) {
      var target = (e.target.tagName === 'IMG') ? e.target : (e.target.closest && e.target.closest('.html-editor-icon'));
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        showImageResizeHandles(target);
      }
    });
    editor.addEventListener('contextmenu', function(e) {
      if (e.target && e.target.tagName === 'IMG') {
        e.preventDefault();
        showImageResizeModal(e.target);
      }
    });
    document.addEventListener('click', function(e) {
      if (resizeOverlay && !resizeOverlay.classList.contains('hidden') && !editor.contains(e.target) && !(e.target.closest && e.target.closest('#htmlImageResizeOverlay'))) {
        hideImageResizeHandles();
      }
    });

    var resizeOverlay = document.getElementById('htmlImageResizeOverlay');
    var editorWrap = document.getElementById('htmlEditorWrap');
    var selectedResizeImg = null;
    var resizeState = null;

    function isIconEl(el) {
      return el && el.classList && el.classList.contains('html-editor-icon');
    }

    function updateOverlayPosition(img) {
      if (!resizeOverlay || !editorWrap || !img) return;
      var imgRect = img.getBoundingClientRect();
      var wrapRect = editorWrap.getBoundingClientRect();
      if (isIconEl(img)) {
        resizeOverlay.style.top = (imgRect.top - wrapRect.top) + 'px';
        resizeOverlay.style.left = (imgRect.left - wrapRect.left) + 'px';
        resizeOverlay.style.width = Math.max(20, imgRect.width) + 'px';
        resizeOverlay.style.height = Math.max(20, imgRect.height) + 'px';
      } else {
        var crop = parseCrop(img);
        var top = imgRect.top - wrapRect.top + crop.t;
        var left = imgRect.left - wrapRect.left + crop.l;
        var w = Math.max(20, imgRect.width - crop.l - crop.r);
        var h = Math.max(20, imgRect.height - crop.t - crop.b);
        resizeOverlay.style.top = top + 'px';
        resizeOverlay.style.left = left + 'px';
        resizeOverlay.style.width = w + 'px';
        resizeOverlay.style.height = h + 'px';
      }
    }

    function showImageResizeHandles(img) {
      if (!resizeOverlay) return;
      selectedResizeImg = img;
      resizeOverlay.classList.remove('hidden');
      updateOverlayPosition(img);
    }

    function hideImageResizeHandles() {
      if (resizeOverlay) resizeOverlay.classList.add('hidden');
      selectedResizeImg = null;
      resizeState = null;
    }

    function parseCrop(img) {
      var cp = (img.getAttribute('data-crop') || img.style.clipPath || '').toString();
      var m = cp.match(/inset\s*\(\s*([\d.]+)(?:px)?\s+([\d.]+)(?:px)?\s+([\d.]+)(?:px)?\s+([\d.]+)(?:px)?\s*\)/);
      if (m) return { t: parseFloat(m[1]), r: parseFloat(m[2]), b: parseFloat(m[3]), l: parseFloat(m[4]) };
      return { t: 0, r: 0, b: 0, l: 0 };
    }

    function setCrop(img, crop) {
      img.setAttribute('data-crop', 'inset(' + crop.t + 'px ' + crop.r + 'px ' + crop.b + 'px ' + crop.l + 'px)');
      img.style.clipPath = 'inset(' + crop.t + 'px ' + crop.r + 'px ' + crop.b + 'px ' + crop.l + 'px)';
    }

    if (resizeOverlay) {
      resizeOverlay.addEventListener('mousedown', function(e) {
        var handle = e.target.closest && e.target.closest('.html-resize-handle');
        if (!handle || !selectedResizeImg) return;
        e.preventDefault();
        e.stopPropagation();
        var handlePos = handle.getAttribute('data-handle');
        var rect = selectedResizeImg.getBoundingClientRect();
        var iconMode = isIconEl(selectedResizeImg);
        var isCenter = !iconMode && (handlePos.length === 1);
        var startSize = 24;
        if (iconMode) {
          var fs = selectedResizeImg.style.fontSize || '24px';
          startSize = parseInt(fs, 10) || 24;
        }
        resizeState = {
          handle: handlePos,
          isCrop: isCenter,
          isIcon: iconMode,
          startFontSize: startSize,
          startX: e.clientX,
          startY: e.clientY,
          startW: rect.width,
          startH: rect.height,
          startCrop: isCenter ? parseCrop(selectedResizeImg) : null,
          img: selectedResizeImg
        };
      });
    }

    document.addEventListener('mousemove', function(e) {
      if (!resizeState) return;
      var rs = resizeState;
      var dx = e.clientX - rs.startX;
      var dy = e.clientY - rs.startY;

      if (rs.isIcon) {
        var h = rs.handle;
        var delta = (h.indexOf('e') >= 0 ? dx : h.indexOf('w') >= 0 ? -dx : 0) + (h.indexOf('s') >= 0 ? dy : h.indexOf('n') >= 0 ? -dy : 0);
        var scale = 1 + delta / 80;
        var newSize = Math.max(12, Math.min(120, Math.round(rs.startFontSize * scale)));
        rs.img.style.fontSize = newSize + 'px';
      } else if (rs.isCrop) {
        var c = { t: rs.startCrop.t, r: rs.startCrop.r, b: rs.startCrop.b, l: rs.startCrop.l };
        var maxT = rs.startH - 20;
        var maxR = rs.startW - 20;
        var maxB = rs.startH - 20;
        var maxL = rs.startW - 20;
        if (rs.handle === 'n') { c.t = Math.max(0, Math.min(maxT, rs.startCrop.t + dy)); }
        else if (rs.handle === 's') { c.b = Math.max(0, Math.min(maxB, rs.startCrop.b - dy)); }
        else if (rs.handle === 'e') { c.r = Math.max(0, Math.min(maxR, rs.startCrop.r - dx)); }
        else if (rs.handle === 'w') { c.l = Math.max(0, Math.min(maxL, rs.startCrop.l + dx)); }
        if (c.t + c.b < rs.startH && c.l + c.r < rs.startW) {
          setCrop(rs.img, c);
        }
      } else {
        var h = rs.handle;
        var dw = (h.indexOf('e') >= 0 ? dx : h.indexOf('w') >= 0 ? -dx : 0);
        var dh = (h.indexOf('s') >= 0 ? dy : h.indexOf('n') >= 0 ? -dy : 0);
        var newW = Math.max(20, rs.startW + dw);
        var newH = Math.max(20, rs.startH + dh);
        rs.img.style.width = newW + 'px';
        rs.img.style.height = newH + 'px';
        rs.img.removeAttribute('width');
        rs.img.removeAttribute('height');
      }
      updateOverlayPosition(rs.img);
    });

    document.addEventListener('mouseup', function() {
      if (resizeState) {
        updateHtmlOutput();
        resizeState = null;
      }
    });

    var draggedImg = null;
    editor.addEventListener('dragstart', function(e) {
      var el = e.target.tagName === 'IMG' ? e.target : (e.target.closest && e.target.closest('.html-editor-icon'));
      if (el) {
        draggedImg = el;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', el.outerHTML);
      }
    });
    editor.addEventListener('dragend', function() { draggedImg = null; });
    editor.addEventListener('dragover', function(e) {
      if (draggedImg) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    editor.addEventListener('drop', function(e) {
      if (!draggedImg) return;
      e.preventDefault();
      var range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (document.caretPositionFromPoint) {
        var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (!range) {
        var el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && editor.contains(el)) {
          range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(true);
        }
      }
      if (range && editor.contains(range.startContainer)) {
        try {
          var clone = draggedImg.cloneNode(true);
          range.insertNode(clone);
          range.setStartAfter(clone);
          range.collapse(true);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          draggedImg.parentNode.removeChild(draggedImg);
          updateHtmlOutput();
        } catch (err) {}
      }
      draggedImg = null;
    });
  }

  if (htmlOutput) {
    htmlOutput.addEventListener('input', applyHtmlToEditor);
    htmlOutput.addEventListener('keyup', applyHtmlToEditor);
  }

  ['btnBold', 'btnItalic', 'btnUnderline', 'btnAlignLeft', 'btnAlignCenter', 'btnAlignRight', 'btnAlignJustify', 'btnFontSize', 'btnFontColor', 'btnHighlight', 'btnParagraph', 'btnList', 'btnLink', 'btnImage', 'btnIcons'].forEach(function(id) {
    preventFocusLoss(document.getElementById(id));
  });
  var sizeDropdown = document.getElementById('sizeDropdown');
  if (customFontSizeInput) customFontSizeInput.addEventListener('mousedown', function() { saveSelection(); });
  if (inputFontColor) inputFontColor.addEventListener('mousedown', function() { saveSelection(); });
  var inputHighlight = document.getElementById('inputHighlight');
  if (inputHighlight) inputHighlight.addEventListener('mousedown', function() { saveSelection(); });

  if (document.getElementById('btnBold')) {
    document.getElementById('btnBold').addEventListener('click', function() { execCmd('bold'); });
  }
  if (document.getElementById('btnItalic')) {
    document.getElementById('btnItalic').addEventListener('click', function() { execCmd('italic'); });
  }
  if (document.getElementById('btnUnderline')) {
    document.getElementById('btnUnderline').addEventListener('click', function() { execCmd('underline'); });
  }
  if (document.getElementById('btnAlignLeft')) {
    document.getElementById('btnAlignLeft').addEventListener('click', function() { execCmd('justifyLeft'); });
  }
  if (document.getElementById('btnAlignCenter')) {
    document.getElementById('btnAlignCenter').addEventListener('click', function() { execCmd('justifyCenter'); });
  }
  if (document.getElementById('btnAlignRight')) {
    document.getElementById('btnAlignRight').addEventListener('click', function() { execCmd('justifyRight'); });
  }
  if (document.getElementById('btnAlignJustify')) {
    document.getElementById('btnAlignJustify').addEventListener('click', function() { execCmd('justifyFull'); });
  }

  function applyFontSize(v) {
    if (!v) return;
    restoreSelection();
    editor.focus();
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) {
      showToast('Selecciona el texto al que aplicar el tamaño');
      return;
    }
    var val = String(v).trim();
    if (!/^\d+(\.\d+)?(px|em|rem|pt|%)?$/i.test(val)) val = val + 'px';
    if (!/px|em|rem|pt|%$/i.test(val)) val = val + 'px';
    var span = document.createElement('span');
    span.style.fontSize = val;
    try {
      range.surroundContents(span);
    } catch (err) {
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      } catch (e2) {}
    }
    updateHtmlOutput();
  }

  var btnFontSize = document.getElementById('btnFontSize');
  var btnFontColor = document.getElementById('btnFontColor');
  var btnHighlight = document.getElementById('btnHighlight');

  if (btnFontSize && sizeDropdown) {
    btnFontSize.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var isHidden = sizeDropdown.classList.contains('hidden');
      if (isHidden) {
        saveSelection();
        sizeDropdown.classList.remove('hidden');
      } else {
        sizeDropdown.classList.add('hidden');
      }
    });
  }
  document.addEventListener('click', function() {
    if (sizeDropdown && !sizeDropdown.classList.contains('hidden')) {
      sizeDropdown.classList.add('hidden');
      if (customFontSizeInput) customFontSizeInput.value = '';
    }
  });
  if (sizeDropdown) sizeDropdown.addEventListener('click', function(e) { e.stopPropagation(); });

  var sizeButtons = document.querySelectorAll('.html-size-btn');
  sizeButtons.forEach(function(btn) {
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); saveSelection(); });
    btn.addEventListener('click', function() {
      var v = this.getAttribute('data-size');
      if (v) {
        applyFontSize(v);
        if (sizeDropdown) sizeDropdown.classList.add('hidden');
      }
    });
  });

  if (customFontSizeInput) {
    customFontSizeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var v = this.value.trim();
        if (v) {
          applyFontSize(v);
          this.value = '';
          if (sizeDropdown) sizeDropdown.classList.add('hidden');
        }
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        this.value = '';
        if (sizeDropdown) sizeDropdown.classList.add('hidden');
      }
    });
    customFontSizeInput.addEventListener('blur', function() {
      if (this.value.trim()) {
        applyFontSize(this.value.trim());
        this.value = '';
      }
    });
  }

  if (btnFontColor && inputFontColor) {
    btnFontColor.addEventListener('click', function() {
      saveSelection();
      inputFontColor.click();
    });
    inputFontColor.addEventListener('input', function() {
      var v = this.value;
      if (!v) return;
      restoreSelection();
      editor.focus();
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      if (range.collapsed) {
        showToast('Selecciona el texto al que aplicar el color');
        return;
      }
      document.execCommand('foreColor', false, v);
      updateHtmlOutput();
    });
  }

  if (btnHighlight && inputHighlight) {
    btnHighlight.addEventListener('click', function() {
      saveSelection();
      inputHighlight.click();
    });
    inputHighlight.addEventListener('input', function() {
      var v = this.value;
      if (!v) return;
      restoreSelection();
      editor.focus();
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      if (range.collapsed) {
        showToast('Selecciona el texto a resaltar');
        return;
      }
      document.execCommand('backColor', false, v);
      updateHtmlOutput();
    });
  }

  if (document.getElementById('btnParagraph')) {
    document.getElementById('btnParagraph').addEventListener('click', function() { execCmd('formatBlock', 'p'); });
  }
  if (document.getElementById('btnList')) {
    document.getElementById('btnList').addEventListener('click', function() { execCmd('insertUnorderedList'); });
  }

  var modalUrlBox = document.getElementById('modalUrlBox');
  var modalImageSizeWrap = document.getElementById('modalImageSizeWrap');
  var modalImageWidth = document.getElementById('modalImageWidth');
  var modalImageHeight = document.getElementById('modalImageHeight');

  function showUrlModal(title, callback, isImage) {
    if (!modalUrl || !modalUrlTitle || !modalUrlField) return;
    modalUrlTitle.textContent = title;
    modalUrlField.value = 'https://';
    if (modalImageSizeWrap) modalImageSizeWrap.classList.add('hidden');
    if (modalImageWidth) modalImageWidth.value = '';
    if (modalImageHeight) modalImageHeight.value = '';
    if (isImage && modalImageSizeWrap) modalImageSizeWrap.classList.remove('hidden');
    modalUrl.classList.remove('hidden');
    setTimeout(function() { modalUrlField.focus(); }, 50);
    var resolved = false;
    function closeModal() {
      if (resolved) return;
      resolved = true;
      modalUrl.classList.add('hidden');
      modalUrlField.onkeydown = null;
      if (editor) editor.focus();
    }
    if (modalUrlBox) {
      modalUrlBox.onclick = function(e) { e.stopPropagation(); };
    }
    modalUrlField.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var url = modalUrlField.value.trim();
        if (!url) return;
        if (isImage) {
          var w = (modalImageWidth && modalImageWidth.value.trim()) ? parseInt(modalImageWidth.value, 10) : null;
          var h = (modalImageHeight && modalImageHeight.value.trim()) ? parseInt(modalImageHeight.value, 10) : null;
          callback(url, w, h);
        } else {
          callback(url);
        }
        closeModal();
      }
      if (e.key === 'Escape') closeModal();
    };
    if (modalUrlOk) {
      modalUrlOk.onclick = function() {
        var url = modalUrlField.value.trim();
        if (!url) return;
        if (isImage) {
          var w = (modalImageWidth && modalImageWidth.value.trim()) ? parseInt(modalImageWidth.value, 10) : null;
          var h = (modalImageHeight && modalImageHeight.value.trim()) ? parseInt(modalImageHeight.value, 10) : null;
          callback(url, w, h);
        } else {
          callback(url);
        }
        closeModal();
      };
    }
    if (modalUrlCancel) modalUrlCancel.onclick = closeModal;
    if (modalUrlClose) modalUrlClose.onclick = closeModal;
    modalUrl.onclick = function(e) {
      if (e.target === modalUrl) closeModal();
    };
  }

  function insertImageWithSize(url, width, height) {
    if (!editor) return;
    restoreSelection();
    editor.focus();
    url = normalizeImageUrl(url);
    var style = '';
    if (width || height) {
      var parts = [];
      if (width && width > 0) parts.push('width:' + width + 'px');
      if (height && height > 0) parts.push('height:' + height + 'px');
      if (parts.length) style = ' style="' + parts.join(';') + '"';
    }
    var html = '<img src="' + url.replace(/"/g, '&quot;') + '" referrerpolicy="no-referrer" draggable="true"' + style + '>';
    document.execCommand('insertHTML', false, html);
    updateHtmlOutput();
  }

  var modalImageResize = document.getElementById('modalImageResize');
  var modalResizeWidth = document.getElementById('modalResizeWidth');
  var modalResizeHeight = document.getElementById('modalResizeHeight');
  var modalResizeConstrain = document.getElementById('modalResizeConstrain');
  var currentResizeImg = null;

  function getImgDimensions(img) {
    var w = img.getAttribute('width') || (img.style.width ? parseInt(img.style.width, 10) : null);
    var h = img.getAttribute('height') || (img.style.height ? parseInt(img.style.height, 10) : null);
    if (!w && img.naturalWidth) w = img.naturalWidth;
    if (!h && img.naturalHeight) h = img.naturalHeight;
    if (!w) w = img.offsetWidth || 200;
    if (!h) h = img.offsetHeight || 150;
    return { w: w, h: h };
  }

  function showImageResizeModal(img) {
    if (!modalImageResize || !img) return;
    currentResizeImg = img;
    var d = getImgDimensions(img);
    modalResizeWidth.value = d.w;
    modalResizeHeight.value = d.h;
    modalImageResize.classList.remove('hidden');
    if (modalResizeWidth) modalResizeWidth.focus();
  }

  function applyImageResize() {
    if (!currentResizeImg || !modalResizeWidth || !modalResizeHeight) return;
    var w = parseInt(modalResizeWidth.value, 10);
    var h = parseInt(modalResizeHeight.value, 10);
    if (w > 0 && h > 0) {
      currentResizeImg.style.width = w + 'px';
      currentResizeImg.style.height = h + 'px';
      currentResizeImg.removeAttribute('width');
      currentResizeImg.removeAttribute('height');
      updateHtmlOutput();
      showToast('Tamaño aplicado');
    }
  }

  if (modalImageResize) {
    if (modalResizeWidth && modalResizeConstrain) {
      modalResizeWidth.addEventListener('input', function() {
        if (!modalResizeConstrain.checked || !currentResizeImg) return;
        var w = parseInt(this.value, 10);
        var nw = currentResizeImg.naturalWidth;
        var nh = currentResizeImg.naturalHeight;
        if (w > 0 && nw > 0 && nh > 0) {
          modalResizeHeight.value = Math.round(w * nh / nw);
        }
      });
    }
    if (modalResizeHeight && modalResizeConstrain) {
      modalResizeHeight.addEventListener('input', function() {
        if (!modalResizeConstrain.checked || !currentResizeImg) return;
        var h = parseInt(this.value, 10);
        var nw = currentResizeImg.naturalWidth;
        var nh = currentResizeImg.naturalHeight;
        if (h > 0 && nw > 0 && nh > 0) {
          modalResizeWidth.value = Math.round(h * nw / nh);
        }
      });
    }
    var modalResizeApply = document.getElementById('modalResizeApply');
    var modalResizeCancel = document.getElementById('modalResizeCancel');
    var modalImageResizeClose = document.getElementById('modalImageResizeClose');
    if (modalResizeApply) modalResizeApply.onclick = function() { applyImageResize(); modalImageResize.classList.add('hidden'); currentResizeImg = null; };
    if (modalResizeCancel) modalResizeCancel.onclick = function() { modalImageResize.classList.add('hidden'); currentResizeImg = null; };
    if (modalImageResizeClose) modalImageResizeClose.onclick = function() { modalImageResize.classList.add('hidden'); currentResizeImg = null; };
    modalImageResize.onclick = function(e) { if (e.target === modalImageResize) { modalImageResize.classList.add('hidden'); currentResizeImg = null; } };
  }

  if (document.getElementById('btnLink')) {
    document.getElementById('btnLink').addEventListener('click', function() {
      showUrlModal('URL del enlace', function(url) {
        execCmd('createLink', url);
      });
    });
  }

  if (document.getElementById('btnImage')) {
    document.getElementById('btnImage').addEventListener('click', function() {
      showUrlModal('URL de la imagen', function(url, width, height) {
        insertImageWithSize(url, width, height);
      }, true);
    });
  }

  var ICONS_FA = ['a','ad','add','address-book','address-card','adjust','air-freshener','align-center','align-justify','align-left','align-right','allergies','ambulance','american-sign-language-interpreting','anchor','anchor-circle-check','anchor-circle-exclamation','anchor-circle-xmark','anchor-lock','angle-double-down','angle-double-left','angle-double-right','angle-double-up','angle-down','angle-left','angle-right','angle-up','angles-down','angles-left','angles-right','angles-up','angry','ankh','apple-alt','apple-whole','archive','archway','area-chart','arrow-alt-circle-down','arrow-alt-circle-left','arrow-alt-circle-right','arrow-alt-circle-up','arrow-circle-down','arrow-circle-left','arrow-circle-right','arrow-circle-up','arrow-down','arrow-down-1-9','arrow-down-9-1','arrow-down-a-z','arrow-down-long','arrow-down-short-wide','arrow-down-up-across-line','arrow-down-up-lock','arrow-down-wide-short','arrow-down-z-a','arrow-left','arrow-left-long','arrow-left-rotate','arrow-pointer','arrow-right','arrow-right-arrow-left','arrow-right-from-bracket','arrow-right-from-file','arrow-right-long','arrow-right-rotate','arrow-right-to-bracket','arrow-right-to-city','arrow-right-to-file','arrow-rotate-back','arrow-rotate-backward','arrow-rotate-forward','arrow-rotate-left','arrow-rotate-right','arrow-trend-down','arrow-trend-up','arrow-turn-down','arrow-turn-up','arrow-up','arrow-up-1-9','arrow-up-9-1','arrow-up-a-z','arrow-up-from-bracket','arrow-up-from-ground-water','arrow-up-from-water-pump','arrow-up-long','arrow-up-right-dots','arrow-up-right-from-square','arrow-up-short-wide','arrow-up-wide-short','arrow-up-z-a','arrows','arrows-alt','arrows-alt-h','arrows-alt-v','arrows-down-to-line','arrows-down-to-people','arrows-h','arrows-left-right','arrows-left-right-to-line','arrows-rotate','arrows-spin','arrows-split-up-and-left','arrows-to-circle','arrows-to-dot','arrows-to-eye','arrows-turn-right','arrows-turn-to-dots','arrows-up-down','arrows-up-down-left-right','arrows-up-to-line','arrows-v','asl-interpreting','assistive-listening-systems','asterisk','at','atlas','atom','audio-description','austral-sign','automobile','award','b','baby','baby-carriage','backspace','backward','backward-fast','backward-step','bacon','bacteria','bacterium','bag-shopping','bahai','baht-sign','balance-scale','balance-scale-left','balance-scale-right','ban','ban-smoking','band-aid','bandage','bangladeshi-taka-sign','bank','bar-chart','barcode','bars','bars-progress','bars-staggered','baseball','baseball-ball','baseball-bat-ball','basket-shopping','basketball','basketball-ball','bath','bathtub','battery','battery-0','battery-2','battery-3','battery-4','battery-5','battery-car','battery-empty','battery-full','battery-half','battery-quarter','battery-three-quarters','bed','bed-pulse','beer','beer-mug-empty','bell','bell-concierge','bell-slash','bezier-curve','bible','bicycle','biking','binoculars','biohazard','birthday-cake','bitcoin-sign','blackboard','blender','blender-phone','blind','blog','bold','bolt','bolt-lightning','bomb','bone','bong','book','book-atlas','book-bible','book-bookmark','book-dead','book-journal-whills','book-medical','book-open','book-open-reader','book-quran','book-reader','book-skull','book-tanakh','bookmark','border-all','border-none','border-style','border-top-left','bore-hole','bottle-droplet','bottle-water','bowl-food','bowl-rice','bowling-ball','box','box-archive','box-open','box-tissue','boxes','boxes-alt','boxes-packing','boxes-stacked','braille','brain','brazilian-real-sign','bread-slice','bridge','bridge-circle-check','bridge-circle-exclamation','bridge-circle-xmark','bridge-lock','bridge-water','briefcase','briefcase-clock','briefcase-medical','broadcast-tower','broom','broom-ball','brush','bucket','bug','bug-slash','bugs','building','building-circle-arrow-right','building-circle-check','building-circle-exclamation','building-circle-xmark','building-columns','building-flag','building-lock','building-ngo','building-shield','building-un','building-user','building-wheat','bullhorn','bullseye','burger','burn','burst','bus','bus-alt','bus-simple','business-time','c','cab','cable-car','cake','cake-candles','calculator','calendar','calendar-alt','calendar-check','calendar-day','calendar-days','calendar-minus','calendar-plus','calendar-times','calendar-week','calendar-xmark','camera','camera-alt','camera-retro','camera-rotate','campground','cancel','candy-cane','cannabis','capsules','car','car-alt','car-battery','car-burst','car-crash','car-on','car-rear','car-side','car-tunnel','caravan','caret-down','caret-left','caret-right','caret-square-down','caret-square-left','caret-square-right','caret-square-up','caret-up','carriage-baby','carrot','cart-arrow-down','cart-flatbed','cart-flatbed-suitcase','cart-plus','cart-shopping','cash-register','cat','cedi-sign','cent-sign','certificate','chain','chain-broken','chain-slash','chair','chalkboard','chalkboard-teacher','chalkboard-user','champagne-glasses','charging-station','chart-area','chart-bar','chart-column','chart-diagram','chart-gantt','chart-line','chart-pie','chart-simple','check','check-circle','check-double','check-square','check-to-slot','cheese','chess','chess-bishop','chess-board','chess-king','chess-knight','chess-pawn','chess-queen','chess-rook','chevron-circle-down','chevron-circle-left','chevron-circle-right','chevron-circle-up','chevron-down','chevron-left','chevron-right','chevron-up','child','child-combatant','child-dress','child-reaching','child-rifle','children','church','circle','circle-arrow-down','circle-arrow-left','circle-arrow-right','circle-arrow-up','circle-check','circle-chevron-down','circle-chevron-left','circle-chevron-right','circle-chevron-up','circle-dollar-to-slot','circle-dot','circle-down','circle-exclamation','circle-h','circle-half-stroke','circle-info','circle-left','circle-minus','circle-nodes','circle-notch','circle-pause','circle-play','circle-plus','circle-question','circle-radiation','circle-right','circle-stop','circle-up','circle-user','circle-xmark','city','clapperboard','clinic-medical','clipboard','clipboard-check','clipboard-list','clipboard-question','clipboard-user','clock','clock-four','clock-rotate-left','clone','close','closed-captioning','cloud','cloud-arrow-down','cloud-arrow-up','cloud-bolt','cloud-download','cloud-download-alt','cloud-meatball','cloud-moon','cloud-moon-rain','cloud-rain','cloud-showers-heavy','cloud-showers-water','cloud-sun','cloud-sun-rain','cloud-upload','cloud-upload-alt','clover','cny','cocktail','code','code-branch','code-commit','code-compare','code-fork','code-merge','code-pull-request','coffee','cog','cogs','coins','colon-sign','columns','comment','comment-alt','comment-dollar','comment-dots','comment-medical','comment-nodes','comment-slash','comment-sms','commenting','comments','comments-dollar','compact-disc','compass','compass-drafting','compress','compress-alt','compress-arrows-alt','computer','computer-mouse','concierge-bell','contact-book','contact-card','cookie','cookie-bite','copy','copyright','couch','cow','credit-card','credit-card-alt','crop','crop-alt','crop-simple','cross','crosshairs','crow','crown','crutch','cruzeiro-sign','cube','cubes','cubes-stacked','cut','cutlery','d','dashboard','database','deaf','deafness','dedent','delete-left','democrat','desktop','desktop-alt','dharmachakra','diagnoses','diagram-next','diagram-predecessor','diagram-project','diagram-successor','diamond','diamond-turn-right','dice','dice-d20','dice-d6','dice-five','dice-four','dice-one','dice-six','dice-three','dice-two','digging','digital-tachograph','directions','disease','display','divide','dizzy','dna','dog','dollar','dollar-sign','dolly','dolly-box','dolly-flatbed','donate','dong-sign','door-closed','door-open','dot-circle','dove','down-left-and-up-right-to-center','down-long','download','drafting-compass','dragon','draw-polygon','drivers-license','droplet','droplet-slash','drum','drum-steelpan','drumstick-bite','dumbbell','dumpster','dumpster-fire','dungeon','e','ear-deaf','ear-listen','earth','earth-africa','earth-america','earth-americas','earth-asia','earth-europe','earth-oceania','edit','egg','eject','elevator','ellipsis','ellipsis-h','ellipsis-v','ellipsis-vertical','envelope','envelope-circle-check','envelope-open','envelope-open-text','envelope-square','envelopes-bulk','equals','eraser','ethernet','eur','euro','euro-sign','exchange','exchange-alt','exclamation','exclamation-circle','exclamation-triangle','expand','expand-alt','expand-arrows-alt','explosion','external-link','external-link-alt','external-link-square','external-link-square-alt','eye','eye-dropper','eye-dropper-empty','eye-low-vision','eye-slash','eyedropper','f','face-angry','face-dizzy','face-flushed','face-frown','face-frown-open','face-grimace','face-grin','face-grin-beam','face-grin-beam-sweat','face-grin-hearts','face-grin-squint','face-grin-squint-tears','face-grin-stars','face-grin-tears','face-grin-tongue','face-grin-tongue-squint','face-grin-tongue-wink','face-grin-wide','face-grin-wink','face-kiss','face-kiss-beam','face-kiss-wink-heart','face-laugh','face-laugh-beam','face-laugh-squint','face-laugh-wink','face-meh','face-meh-blank','face-rolling-eyes','face-sad-cry','face-sad-tear','face-smile','face-smile-beam','face-smile-wink','face-surprise','face-tired','fan','fast-backward','fast-forward','faucet','faucet-drip','fax','feather','feather-alt','feather-pointed','feed','female','ferry','fighter-jet','file','file-alt','file-archive','file-arrow-down','file-arrow-up','file-audio','file-circle-check','file-circle-exclamation','file-circle-minus','file-circle-plus','file-circle-question','file-circle-xmark','file-clipboard','file-code','file-contract','file-csv','file-download','file-edit','file-excel','file-export','file-fragment','file-half-dashed','file-image','file-import','file-invoice','file-invoice-dollar','file-lines','file-medical','file-medical-alt','file-pdf','file-pen','file-powerpoint','file-prescription','file-shield','file-signature','file-text','file-upload','file-video','file-waveform','file-word','file-zipper','fill','fill-drip','film','filter','filter-circle-dollar','filter-circle-xmark','fingerprint','fire','fire-alt','fire-burner','fire-extinguisher','fire-flame-curved','fire-flame-simple','first-aid','fish','fish-fins','fist-raised','flag','flag-checkered','flag-usa','flask','flask-vial','floppy-disk','florin-sign','flushed','folder','folder-blank','folder-closed','folder-minus','folder-open','folder-plus','folder-tree','font','football','football-ball','forward','forward-fast','forward-step','franc-sign','frog','frown','frown-open','funnel-dollar','futbol','futbol-ball','g','gamepad','gas-pump','gauge','gauge-high','gauge-med','gauge-simple','gauge-simple-high','gauge-simple-med','gavel','gbp','gear','gears','gem','genderless','ghost','gift','gifts','glass-cheers','glass-martini','glass-martini-alt','glass-water','glass-water-droplet','glass-whiskey','glasses','globe','globe-africa','globe-americas','globe-asia','globe-europe','globe-oceania','golf-ball','golf-ball-tee','gopuram','graduation-cap','greater-than','greater-than-equal','grimace','grin','grin-alt','grin-beam','grin-beam-sweat','grin-hearts','grin-squint','grin-squint-tears','grin-stars','grin-tears','grin-tongue','grin-tongue-squint','grin-tongue-wink','grin-wink','grip','grip-horizontal','grip-lines','grip-lines-vertical','grip-vertical','group-arrows-rotate','guarani-sign','guitar','gun','h','h-square','hamburger','hammer','hamsa','hand','hand-back-fist','hand-dots','hand-fist','hand-holding','hand-holding-dollar','hand-holding-droplet','hand-holding-hand','hand-holding-heart','hand-holding-medical','hand-holding-usd','hand-holding-water','hand-lizard','hand-middle-finger','hand-paper','hand-peace','hand-point-down','hand-point-left','hand-point-right','hand-point-up','hand-pointer','hand-rock','hand-scissors','hand-sparkles','hand-spock','handcuffs','hands','hands-american-sign-language-interpreting','hands-asl-interpreting','hands-bound','hands-bubbles','hands-clapping','hands-helping','hands-holding','hands-holding-child','hands-holding-circle','hands-praying','hands-wash','handshake','handshake-alt','handshake-alt-slash','handshake-angle','handshake-simple','handshake-simple-slash','handshake-slash','hanukiah','hard-drive','hard-hat','hard-of-hearing','hashtag','hat-cowboy','hat-cowboy-side','hat-hard','hat-wizard','haykal','hdd','head-side-cough','head-side-cough-slash','head-side-mask','head-side-virus','header','heading','headphones','headphones-alt','headphones-simple','headset','heart','heart-broken','heart-circle-bolt','heart-circle-check','heart-circle-exclamation','heart-circle-minus','heart-circle-plus','heart-circle-xmark','heart-crack','heart-music-camera-bolt','heart-pulse','heartbeat','helicopter','helicopter-symbol','helmet-safety','helmet-un','hexagon-nodes','hexagon-nodes-bolt','highlighter','hiking','hill-avalanche','hill-rockslide','hippo','history','hockey-puck','holly-berry','home','home-alt','home-lg','home-lg-alt','home-user','horse','horse-head','hospital','hospital-alt','hospital-symbol','hospital-user','hospital-wide','hot-tub','hot-tub-person','hotdog','hotel','hourglass','hourglass-1','hourglass-2','hourglass-3','hourglass-empty','hourglass-end','hourglass-half','hourglass-start','house','house-chimney','house-chimney-crack','house-chimney-medical','house-chimney-user','house-chimney-window','house-circle-check','house-circle-exclamation','house-circle-xmark','house-crack','house-damage','house-fire','house-flag','house-flood-water','house-flood-water-circle-arrow-right','house-laptop','house-lock','house-medical','house-medical-circle-check','house-medical-circle-exclamation','house-medical-circle-xmark','house-medical-flag','house-signal','house-tsunami','house-user','hryvnia','hryvnia-sign','hurricane','i','i-cursor','ice-cream','icicles','icons','id-badge','id-card','id-card-alt','id-card-clip','igloo','ils','image','image-portrait','images','inbox','indent','indian-rupee','indian-rupee-sign','industry','infinity','info','info-circle','inr','institution','italic','j','jar','jar-wheat','jedi','jet-fighter','jet-fighter-up','joint','journal-whills','jpy','jug-detergent','k','kaaba','key','keyboard','khanda','kip-sign','kiss','kiss-beam','kiss-wink-heart','kit-medical','kitchen-set','kiwi-bird','krw','l','ladder-water','land-mine-on','landmark','landmark-alt','landmark-dome','landmark-flag','language','laptop','laptop-code','laptop-file','laptop-house','laptop-medical','lari-sign','laugh','laugh-beam','laugh-squint','laugh-wink','layer-group','leaf','left-long','left-right','legal','lemon','less-than','less-than-equal','level-down','level-down-alt','level-up','level-up-alt','life-ring','lightbulb','line-chart','lines-leaning','link','link-slash','lira-sign','list','list-1-2','list-alt','list-check','list-dots','list-numeric','list-ol','list-squares','list-ul','litecoin-sign','location','location-arrow','location-crosshairs','location-dot','location-pin','location-pin-lock','lock','lock-open','locust','long-arrow-alt-down','long-arrow-alt-left','long-arrow-alt-right','long-arrow-alt-up','long-arrow-down','long-arrow-left','long-arrow-right','long-arrow-up','low-vision','luggage-cart','lungs','lungs-virus','m','magic','magic-wand-sparkles','magnet','magnifying-glass','magnifying-glass-arrow-right','magnifying-glass-chart','magnifying-glass-dollar','magnifying-glass-location','magnifying-glass-minus','magnifying-glass-plus','mail-bulk','mail-forward','mail-reply','mail-reply-all','male','manat-sign','map','map-location','map-location-dot','map-marked','map-marked-alt','map-marker','map-marker-alt','map-pin','map-signs','marker','mars','mars-and-venus','mars-and-venus-burst','mars-double','mars-stroke','mars-stroke-h','mars-stroke-right','mars-stroke-up','mars-stroke-v','martini-glass','martini-glass-citrus','martini-glass-empty','mask','mask-face','mask-ventilator','masks-theater','mattress-pillow','maximize','medal','medkit','meh','meh-blank','meh-rolling-eyes','memory','menorah','mercury','message','meteor','microchip','microphone','microphone-alt','microphone-alt-slash','microphone-lines','microphone-lines-slash','microphone-slash','microscope','mill-sign','minimize','minus','minus-circle','minus-square','mitten','mobile','mobile-alt','mobile-android','mobile-android-alt','mobile-button','mobile-phone','mobile-retro','mobile-screen','mobile-screen-button','money-bill','money-bill-1','money-bill-1-wave','money-bill-alt','money-bill-transfer','money-bill-trend-up','money-bill-wave','money-bill-wave-alt','money-bill-wheat','money-bills','money-check','money-check-alt','money-check-dollar','monument','moon','mortar-board','mortar-pestle','mosque','mosquito','mosquito-net','motorcycle','mound','mountain','mountain-city','mountain-sun','mouse','mouse-pointer','mug-hot','mug-saucer','multiply','museum','music','n','naira-sign','navicon','network-wired','neuter','newspaper','not-equal','notdef','note-sticky','notes-medical','o','object-group','object-ungroup','oil-can','oil-well','om','otter','outdent','p','pager','paint-brush','paint-roller','paintbrush','palette','pallet','panorama','paper-plane','paperclip','parachute-box','paragraph','parking','passport','pastafarianism','paste','pause','pause-circle','paw','peace','pen','pen-alt','pen-clip','pen-fancy','pen-nib','pen-ruler','pen-square','pen-to-square','pencil','pencil-alt','pencil-ruler','pencil-square','people-arrows','people-arrows-left-right','people-carry','people-carry-box','people-group','people-line','people-pulling','people-robbery','people-roof','pepper-hot','percent','percentage','person','person-arrow-down-to-line','person-arrow-up-from-line','person-biking','person-booth','person-breastfeeding','person-burst','person-cane','person-chalkboard','person-circle-check','person-circle-exclamation','person-circle-minus','person-circle-plus','person-circle-question','person-circle-xmark','person-digging','person-dots-from-line','person-dress','person-dress-burst','person-drowning','person-falling','person-falling-burst','person-half-dress','person-harassing','person-hiking','person-military-pointing','person-military-rifle','person-military-to-person','person-praying','person-pregnant','person-rays','person-rifle','person-running','person-shelter','person-skating','person-skiing','person-skiing-nordic','person-snowboarding','person-swimming','person-through-window','person-walking','person-walking-arrow-loop-left','person-walking-arrow-right','person-walking-dashed-line-arrow-right','person-walking-luggage','person-walking-with-cane','peseta-sign','peso-sign','phone','phone-alt','phone-flip','phone-slash','phone-square','phone-square-alt','phone-volume','photo-film','photo-video','pie-chart','piggy-bank','pills','ping-pong-paddle-ball','pizza-slice','place-of-worship','plane','plane-arrival','plane-circle-check','plane-circle-exclamation','plane-circle-xmark','plane-departure','plane-lock','plane-slash','plane-up','plant-wilt','plate-wheat','play','play-circle','plug','plug-circle-bolt','plug-circle-check','plug-circle-exclamation','plug-circle-minus','plug-circle-plus','plug-circle-xmark','plus','plus-circle','plus-minus','plus-square','podcast','poll','poll-h','poo','poo-bolt','poo-storm','poop','portrait','pound-sign','power-off','pray','praying-hands','prescription','prescription-bottle','prescription-bottle-alt','prescription-bottle-medical','print','procedures','project-diagram','pump-medical','pump-soap','puzzle-piece','q','qrcode','question','question-circle','quidditch','quidditch-broom-ball','quote-left','quote-left-alt','quote-right','quote-right-alt','quran','r','radiation','radiation-alt','radio','rainbow','random','ranking-star','receipt','record-vinyl','rectangle-ad','rectangle-list','rectangle-times','rectangle-xmark','recycle','redo','redo-alt','refresh','registered','remove','remove-format','reorder','repeat','reply','reply-all','republican','restroom','retweet','ribbon','right-from-bracket','right-left','right-long','right-to-bracket','ring','rmb','road','road-barrier','road-bridge','road-circle-check','road-circle-exclamation','road-circle-xmark','road-lock','road-spikes','robot','rocket','rod-asclepius','rod-snake','rotate','rotate-back','rotate-backward','rotate-forward','rotate-left','rotate-right','rouble','route','rss','rss-square','rub','ruble','ruble-sign','rug','ruler','ruler-combined','ruler-horizontal','ruler-vertical','running','rupee','rupee-sign','rupiah-sign','s','sack-dollar','sack-xmark','sad-cry','sad-tear','sailboat','satellite','satellite-dish','save','scale-balanced','scale-unbalanced','scale-unbalanced-flip','school','school-circle-check','school-circle-exclamation','school-circle-xmark','school-flag','school-lock','scissors','screwdriver','screwdriver-wrench','scroll','scroll-torah','sd-card','search','search-dollar','search-location','search-minus','search-plus','section','seedling','server','shapes','share','share-alt','share-alt-square','share-from-square','share-nodes','share-square','sheet-plastic','shekel','shekel-sign','sheqel','sheqel-sign','shield','shield-alt','shield-blank','shield-cat','shield-dog','shield-halved','shield-heart','shield-virus','ship','shipping-fast','shirt','shoe-prints','shop','shop-lock','shop-slash','shopping-bag','shopping-basket','shopping-cart','shower','shrimp','shuffle','shuttle-space','shuttle-van','sign','sign-hanging','sign-in','sign-in-alt','sign-language','sign-out','sign-out-alt','signal','signal-5','signal-perfect','signature','signing','signs-post','sim-card','sink','sitemap','skating','skiing','skiing-nordic','skull','skull-crossbones','slash','sleigh','sliders','sliders-h','smile','smile-beam','smile-wink','smog','smoking','smoking-ban','sms','snowboarding','snowflake','snowman','snowplow','soap','soccer-ball','socks','solar-panel','sort','sort-alpha-asc','sort-alpha-desc','sort-alpha-down','sort-alpha-down-alt','sort-alpha-up','sort-alpha-up-alt','sort-amount-asc','sort-amount-desc','sort-amount-down','sort-amount-down-alt','sort-amount-up','sort-amount-up-alt','sort-asc','sort-desc','sort-down','sort-numeric-asc','sort-numeric-desc','sort-numeric-down','sort-numeric-down-alt','sort-numeric-up','sort-numeric-up-alt','sort-up','spa','space-shuttle','spaghetti-monster-flying','spell-check','spider','spinner','splotch','spoon','spray-can','spray-can-sparkles','sprout','square','square-arrow-up-right','square-binary','square-caret-down','square-caret-left','square-caret-right','square-caret-up','square-check','square-envelope','square-full','square-h','square-minus','square-nfi','square-parking','square-pen','square-person-confined','square-phone','square-phone-flip','square-plus','square-poll-horizontal','square-poll-vertical','square-root-alt','square-root-variable','square-rss','square-share-nodes','square-up-right','square-virus','square-xmark','staff-aesculapius','staff-snake','stairs','stamp','stapler','star','star-and-crescent','star-half','star-half-alt','star-half-stroke','star-of-david','star-of-life','step-backward','step-forward','sterling-sign','stethoscope','sticky-note','stop','stop-circle','stopwatch','stopwatch-20','store','store-alt','store-alt-slash','store-slash','stream','street-view','strikethrough','stroopwafel','subscript','subtract','subway','suitcase','suitcase-medical','suitcase-rolling','sun','sun-plant-wilt','superscript','surprise','swatchbook','swimmer','swimming-pool','synagogue','sync','sync-alt','syringe','t','t-shirt','table','table-cells','table-cells-column-lock','table-cells-large','table-cells-row-lock','table-cells-row-unlock','table-columns','table-list','table-tennis','table-tennis-paddle-ball','tablet','tablet-alt','tablet-android','tablet-button','tablet-screen-button','tablets','tachograph-digital','tachometer','tachometer-alt','tachometer-alt-average','tachometer-alt-fast','tachometer-average','tachometer-fast','tag','tags','tanakh','tape','tarp','tarp-droplet','tasks','tasks-alt','taxi','teeth','teeth-open','teletype','television','temperature-0','temperature-1','temperature-2','temperature-3','temperature-4','temperature-arrow-down','temperature-arrow-up','temperature-down','temperature-empty','temperature-full','temperature-half','temperature-high','temperature-low','temperature-quarter','temperature-three-quarters','temperature-up','tenge','tenge-sign','tent','tent-arrow-down-to-line','tent-arrow-left-right','tent-arrow-turn-left','tent-arrows-down','tents','terminal','text-height','text-slash','text-width','th','th-large','th-list','theater-masks','thermometer','thermometer-0','thermometer-1','thermometer-2','thermometer-3','thermometer-4','thermometer-empty','thermometer-full','thermometer-half','thermometer-quarter','thermometer-three-quarters','thumb-tack','thumb-tack-slash','thumbs-down','thumbs-up','thumbtack','thumbtack-slash','thunderstorm','ticket','ticket-alt','ticket-simple','timeline','times','times-circle','times-rectangle','times-square','tint','tint-slash','tired','toggle-off','toggle-on','toilet','toilet-paper','toilet-paper-slash','toilet-portable','toilets-portable','toolbox','tools','tooth','torah','torii-gate','tornado','tower-broadcast','tower-cell','tower-observation','tractor','trademark','traffic-light','trailer','train','train-subway','train-tram','tram','transgender','transgender-alt','trash','trash-alt','trash-arrow-up','trash-can','trash-can-arrow-up','trash-restore','trash-restore-alt','tree','tree-city','triangle-circle-square','triangle-exclamation','trophy','trowel','trowel-bricks','truck','truck-arrow-right','truck-droplet','truck-fast','truck-field','truck-field-un','truck-front','truck-loading','truck-medical','truck-monster','truck-moving','truck-pickup','truck-plane','truck-ramp-box','try','tshirt','tty','turkish-lira','turkish-lira-sign','turn-down','turn-up','tv','tv-alt','u','umbrella','umbrella-beach','underline','undo','undo-alt','universal-access','university','unlink','unlock','unlock-alt','unlock-keyhole','unsorted','up-down','up-down-left-right','up-long','up-right-and-down-left-from-center','up-right-from-square','upload','usd','user','user-alt','user-alt-slash','user-astronaut','user-check','user-circle','user-clock','user-cog','user-doctor','user-edit','user-friends','user-gear','user-graduate','user-group','user-injured','user-large','user-large-slash','user-lock','user-md','user-minus','user-ninja','user-nurse','user-pen','user-plus','user-secret','user-shield','user-slash','user-tag','user-tie','user-times','user-xmark','users','users-between-lines','users-cog','users-gear','users-line','users-rays','users-rectangle','users-slash','users-viewfinder','utensil-spoon','utensils','v','van-shuttle','vault','vcard','vector-square','venus','venus-double','venus-mars','vest','vest-patches','vial','vial-circle-check','vial-virus','vials','video','video-camera','video-slash','vihara','virus','virus-covid','virus-covid-slash','virus-slash','viruses','voicemail','volcano','volleyball','volleyball-ball','volume-control-phone','volume-down','volume-high','volume-low','volume-mute','volume-off','volume-times','volume-up','volume-xmark','vote-yea','vr-cardboard','w','walkie-talkie','walking','wallet','wand-magic','wand-magic-sparkles','wand-sparkles','warehouse','warning','water','water-ladder','wave-square','weight','weight-hanging','weight-scale','wheat-alt','wheat-awn','wheat-awn-circle-exclamation','wheelchair','wheelchair-alt','wheelchair-move','whiskey-glass','wifi','wifi-3','wifi-strong','wind','window-close','window-maximize','window-minimize','window-restore','wine-bottle','wine-glass','wine-glass-alt','wine-glass-empty','won','won-sign','worm','wrench','x','x-ray','xmark','xmark-circle','xmark-square','xmarks-lines','y','yen','yen-sign','yin-yang','z','zap'];
  var ICONS_CCN = ['search','filter','key','code','copy','paste','qrcode','barcode','link','envelope','phone','hashtag','list','table','th-large','book','file-alt','folder','database','server','sitemap','project-diagram','plug','bolt','microchip','calculator','address-book','id-card','credit-card','wallet','lock','unlock','shield-alt','check','check-double','times','exclamation-triangle','info-circle','question-circle','paper-plane','share-alt','at','asterisk'];
  var ICONS_WHATSAPP = [
    { class: 'fab fa-whatsapp', label: 'WhatsApp' },
    { class: 'fas fa-comment', label: 'Comentario' },
    { class: 'fas fa-comments', label: 'Comentarios' },
    { class: 'fas fa-paper-plane', label: 'Enviar' },
    { class: 'fas fa-phone', label: 'Llamada' },
    { class: 'fas fa-video', label: 'Video' },
    { class: 'fas fa-camera', label: 'Cámara' },
    { class: 'fas fa-smile', label: 'Sonrisa' },
    { class: 'fas fa-grin', label: 'Grin' },
    { class: 'fas fa-laugh', label: 'Risa' },
    { class: 'fas fa-grin-beam', label: 'Grin beam' },
    { class: 'fas fa-grin-stars', label: 'Estrellas' },
    { class: 'fas fa-heart', label: 'Corazón' },
    { class: 'fas fa-thumbs-up', label: 'Me gusta' },
    { class: 'fas fa-thumbs-down', label: 'No me gusta' },
    { class: 'fas fa-check', label: 'Check' },
    { class: 'fas fa-check-double', label: 'Check doble' },
    { class: 'fas fa-reply', label: 'Responder' },
    { class: 'fas fa-share-alt', label: 'Compartir' },
    { class: 'fas fa-at', label: 'Mencionar' },
    { class: 'fas fa-image', label: 'Imagen' },
    { class: 'fas fa-microphone', label: 'Micrófono' }
  ];
  var ICONIFY_API = 'https://api.iconify.design/';
  var ICONS_ICONIFY = ['mdi:heart','mdi:heart-outline','mdi:star','mdi:home','mdi:account','mdi:account-circle','mdi:email','mdi:email-outline','mdi:phone','mdi:camera','mdi:image','mdi:file','mdi:folder','mdi:folder-outline','mdi:download','mdi:upload','mdi:share-variant','mdi:link','mdi:lock','mdi:lock-open','mdi:magnify','mdi:menu','mdi:close','mdi:check','mdi:delete','mdi:pencil','mdi:plus','mdi:minus','mdi:cog','mdi:settings','mdi:bell','mdi:calendar','mdi:clock','mdi:eye','mdi:eye-off','mdi:thumb-up','mdi:thumb-down','mdi:comment','mdi:cart','mdi:cart-outline','mdi:credit-card','mdi:wallet','mdi:cash','mdi:gift','mdi:tag','mdi:bookmark','mdi:bookmark-outline','mdi:music','mdi:video','mdi:play','mdi:pause','mdi:stop','mdi:volume-high','mdi:volume-off','mdi:microphone','mdi:camera-video','mdi:image-multiple','mdi:cloud','mdi:weather-sunny','mdi:weather-night','mdi:flash','mdi:battery','mdi:wifi','mdi:bluetooth','mdi:map-marker','mdi:compass','mdi:car','mdi:bus','mdi:airplane','mdi:train','mdi:food','mdi:coffee','mdi:beer','mdi:glass-wine','mdi:shopping','mdi:store','mdi:office-building','mdi:school','mdi:hospital','mdi:bank','mdi:briefcase','mdi:chart-line','mdi:chart-bar','mdi:chart-pie','mdi:calculator','mdi:code-tags','mdi:laptop','mdi:cellphone','mdi:tablet','mdi:monitor','mdi:desktop-mac','mdi:keyboard','mdi:mouse','mdi:gamepad-variant','mdi:controller-classic','mdi:headphones','mdi:television','mdi:radio','mdi:camera-enhance','mdi:palette','mdi:brush','mdi:format-paint','mdi:format-bold','mdi:format-italic','mdi:format-underline','mdi:format-list-bulleted','mdi:format-list-numbered','mdi:format-align-left','mdi:format-align-center','mdi:format-align-right','mdi:message','mdi:message-outline','mdi:send','mdi:inbox','mdi:archive','mdi:trash-can','mdi:content-save','mdi:content-copy','mdi:content-paste','mdi:clipboard','mdi:filter','mdi:sort','mdi:magnify-plus','mdi:magnify-minus','mdi:qrcode','mdi:barcode','mdi:facebook','mdi:twitter','mdi:instagram','mdi:linkedin','mdi:youtube','mdi:github','mdi:google','mdi:apple','mdi:android','mdi:whatsapp','mdi:telegram','mdi:discord','mdi:spotify','mdi:netflix','mdi:amazon','mdi:google-play','mdi:microsoft','mdi:language-javascript','mdi:language-python','mdi:language-html5','mdi:language-css3','mdi:flag','mdi:earth','mdi:shield','mdi:security','mdi:key','mdi:printer','mdi:scanner','mdi:fax','mdi:lightbulb','mdi:lightbulb-outline','mdi:puzzle','mdi:rocket-launch','mdi:crown','mdi:trophy','mdi:medal','mdi:star-circle','mdi:emoticon','mdi:emoticon-happy','mdi:emoticon-sad','mdi:hand-peace','mdi:thumb-up-outline','mdi:thumb-down-outline','mdi:book','mdi:book-open','mdi:newspaper','mdi:movie','mdi:music-note','mdi:piano','mdi:guitar-electric'];
  var HEROICONS_CDN = 'https://cdn.jsdelivr.net/npm/heroicons@2.2.0/24/outline/';
  var ICONS_HEROICONS = ['academic-cap','adjustments-horizontal','adjustments-vertical','archive-box','archive-box-arrow-down','archive-box-x-mark','arrow-down','arrow-down-circle','arrow-down-left','arrow-down-on-square','arrow-down-on-square-stack','arrow-down-right','arrow-down-tray','arrow-left','arrow-left-circle','arrow-left-end-on-rectangle','arrow-left-on-rectangle','arrow-left-start-on-rectangle','arrow-long-down','arrow-long-left','arrow-long-right','arrow-long-up','arrow-path','arrow-path-rounded-square','arrow-right','arrow-right-circle','arrow-right-end-on-rectangle','arrow-right-on-rectangle','arrow-right-start-on-rectangle','arrow-small-down','arrow-small-left','arrow-small-right','arrow-small-up','arrow-top-right-on-square','arrow-trending-down','arrow-trending-up','arrow-turn-down-left','arrow-turn-down-right','arrow-turn-left-down','arrow-turn-left-up','arrow-turn-right-down','arrow-turn-right-up','arrow-turn-up-left','arrow-turn-up-right','arrow-up','arrow-up-circle','arrow-up-left','arrow-up-on-square','arrow-up-on-square-stack','arrow-up-right','arrow-up-tray','arrow-uturn-down','arrow-uturn-left','arrow-uturn-right','arrow-uturn-up','arrows-pointing-in','arrows-pointing-out','arrows-right-left','arrows-up-down','at-symbol','backspace','backward','banknotes','bars-2','bars-3','bars-3-bottom-left','bars-3-bottom-right','bars-3-center-left','bars-4','bars-arrow-down','bars-arrow-up','battery-0','battery-100','battery-50','beaker','bell','bell-alert','bell-slash','bell-snooze','bold','bolt','bolt-slash','book-open','bookmark','bookmark-slash','bookmark-square','briefcase','bug-ant','building-library','building-office','building-office-2','building-storefront','cake','calculator','calendar','calendar-date-range','calendar-days','camera','chart-bar','chart-bar-square','chart-pie','chat-bubble-bottom-center','chat-bubble-bottom-center-text','chat-bubble-left','chat-bubble-left-ellipsis','chat-bubble-left-right','chat-bubble-oval-left','chat-bubble-oval-left-ellipsis','check','check-badge','check-circle','chevron-double-down','chevron-double-left','chevron-double-right','chevron-double-up','chevron-down','chevron-left','chevron-right','chevron-up','chevron-up-down','circle-stack','clipboard','clipboard-document','clipboard-document-check','clipboard-document-list','clock','cloud','cloud-arrow-down','cloud-arrow-up','code-bracket','code-bracket-square','cog','cog-6-tooth','cog-8-tooth','command-line','computer-desktop','cpu-chip','credit-card','cube','cube-transparent','currency-bangladeshi','currency-dollar','currency-euro','currency-pound','currency-rupee','currency-yen','cursor-arrow-rays','cursor-arrow-ripple','device-phone-mobile','device-tablet','divide','document','document-arrow-down','document-arrow-up','document-chart-bar','document-check','document-currency-bangladeshi','document-currency-dollar','document-currency-euro','document-currency-pound','document-currency-rupee','document-currency-yen','document-duplicate','document-magnifying-glass','document-minus','document-plus','document-text','ellipsis-horizontal','ellipsis-horizontal-circle','ellipsis-vertical','envelope','envelope-open','equals','exclamation-circle','exclamation-triangle','eye','eye-dropper','eye-slash','face-frown','face-smile','film','finger-print','fire','flag','folder','folder-arrow-down','folder-minus','folder-open','folder-plus','forward','funnel','gif','gift','gift-top','globe-alt','globe-americas','globe-asia-australia','globe-europe-africa','h1','h2','h3','hand-raised','hand-thumb-down','hand-thumb-up','hashtag','heart','home','home-modern','identification','inbox','inbox-arrow-down','inbox-stack','information-circle','italic','key','language','lifebuoy','light-bulb','link','link-slash','list-bullet','lock-closed','lock-open','magnifying-glass','magnifying-glass-circle','magnifying-glass-minus','magnifying-glass-plus','map','map-pin','megaphone','microphone','minus','minus-circle','minus-small','moon','musical-note','newspaper','no-symbol','numbered-list','paint-brush','paper-airplane','paper-clip','pause','pause-circle','pencil','pencil-square','percent-badge','phone','phone-arrow-down-left','phone-arrow-up-right','phone-x-mark','photo','play','play-circle','play-pause','plus','plus-circle','plus-small','power','presentation-chart-bar','presentation-chart-line','printer','puzzle-piece','qr-code','question-mark-circle','queue-list','radio','receipt-percent','receipt-refund','rectangle-group','rectangle-stack','rocket-launch','rss','scale','scissors','server','server-stack','share','shield-check','shield-exclamation','shopping-bag','shopping-cart','signal','signal-slash','slash','sparkles','speaker-wave','speaker-x-mark','square-2-stack','square-3-stack-3d','squares-2x2','squares-plus','star','stop','stop-circle','strikethrough','sun','swatch','table-cells','tag','ticket','trash','trophy','truck','tv','underline','user','user-circle','user-group','user-minus','user-plus','users','variable','video-camera','video-camera-slash','view-columns','viewfinder-circle','wallet','wifi','window','wrench','wrench-screwdriver','x-circle','x-mark'];
  var ICONS_STREAMING = [
    { file: 'stream1.png', label: 'Netflix' },
    { file: 'stream2.png', label: 'Apple TV' },
    { file: 'stream3.png', label: 'Youtube Premium' },
    { file: 'stream4.png', label: 'Stream 4' },
    { file: 'stream5.png', label: 'Stream 5' },
    { file: 'stream6.png', label: 'Stream 6' },
    { file: 'stream7.png', label: 'Plex' },
    { file: 'stream8.png', label: 'IPTV' },
    { file: 'stream9.png', label: 'ViKi Rakuten' },
    { file: 'stream10.png', label: 'Canva' },
    { file: 'stream11.png', label: 'Amazon Prime' },
    { file: 'stream12.png', label: 'Spotify' },
    { file: 'stream13.png', label: 'Max' },
    { file: 'stream14.png', label: 'Paramount' },
    { file: 'stream15.png', label: 'Vix+' },
    { file: 'stream16.png', label: 'Crunchyroll' },
    { file: 'stream17.png', label: 'Disney' },
    { file: 'stream18.png', label: 'Stream 18' },
    { file: 'stream19.png', label: 'Stream 19' },
    { file: 'stream20.png', label: 'Deezer' },
    { file: 'stream21.png', label: 'Stream 21' },
    { file: 'stream22.png', label: 'Mubi' },
    { file: 'stream23.png', label: 'Office 365' },
    { file: 'stream24.png', label: 'Game Pass' },
    { file: 'stream25.png', label: 'Win Sport' },
    { file: 'stream26.png', label: 'Hulu' },
    { file: 'stream27.png', label: 'Directv Go' },
    { file: 'stream28.png', label: 'Universal' },
    { file: 'stream29.png', label: 'Pornhub' },
    { file: 'stream30.png', label: 'Stream 30' },
    { file: 'stream31.png', label: 'Stream 31' },
    { file: 'stream32.png', label: 'Stream 32' },
    { file: 'stream33.png', label: 'Stream 33' },
    { file: 'stream34.png', label: 'Stream 34' },
    { file: 'stream35.png', label: 'Stream 35' },
    { file: 'stream36.png', label: 'Stream 36' },
    { file: 'stream37.png', label: 'Stream 37' }
  ];
  var iconsDropdown = document.getElementById('iconsDropdown');
  var iconsGrid = document.getElementById('iconsGrid');
  var iconsSearch = document.getElementById('iconsSearch');
  var iconsColor = document.getElementById('iconsColor');
  var iconsColorHex = document.getElementById('iconsColorHex');
  var iconsTabs = document.getElementById('iconsTabs');
  var btnIcons = document.getElementById('btnIcons');
  var staticImagesBase = (typeof window !== 'undefined' && window.HTML_TOOLS_STATIC_IMAGES) ? window.HTML_TOOLS_STATIC_IMAGES : '/static/images/';
  if (staticImagesBase && !/\/$/.test(staticImagesBase)) staticImagesBase += '/';
  var currentIconsTab = 'general';

  function getIconColor() {
    var hex = (iconsColorHex && iconsColorHex.value.trim()) || (iconsColor && iconsColor.value) || '#333333';
    hex = hex.replace(/^#/, '');
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) return '#' + hex;
    if (/^[0-9A-Fa-f]{3}$/.test(hex)) return '#' + hex[0]+hex[0] + hex[1]+hex[1] + hex[2]+hex[2];
    return '#333333';
  }

  if (iconsColor && iconsColorHex) {
    iconsColor.addEventListener('input', function() { iconsColorHex.value = this.value; });
    iconsColorHex.addEventListener('input', function() {
      var v = this.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(v) || /^[0-9A-Fa-f]{6}$/.test(v)) {
        iconsColor.value = v.indexOf('#') === 0 ? v : '#' + v;
      }
    });
  }

  function buildIconsGrid(filter, tab) {
    if (!iconsGrid) return;
    var t = tab || currentIconsTab;
    currentIconsTab = t;
    iconsGrid.innerHTML = '';
    var term = (filter || '').toLowerCase().trim();

    function addSection(title, items, renderBtn) {
      if (items.length === 0) return;
      var section = document.createElement('div');
      section.className = 'html-icons-section';
      var titleEl = document.createElement('div');
      titleEl.className = 'html-icons-section-title';
      titleEl.textContent = title;
      section.appendChild(titleEl);
      var grid = document.createElement('div');
      grid.className = 'html-icons-grid';
      items.forEach(function(item) {
        var btn = renderBtn(item);
        if (btn) grid.appendChild(btn);
      });
      section.appendChild(grid);
      iconsGrid.appendChild(section);
    }

    if (t === 'general') {
      var faFiltered = term ? ICONS_FA.filter(function(n){return n.indexOf(term)>=0;}) : ICONS_FA;
      addSection('General (Font Awesome)', faFiltered, function(name) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = name;
        btn.innerHTML = '<i class="fas fa-' + name + '"></i>';
        btn.onclick = function() {
          insertIcon('fas fa-' + name);
          if (iconsDropdown) iconsDropdown.classList.add('hidden');
        };
        return btn;
      });
    }

    if (t === 'heroicons') {
      var heroFiltered = term ? ICONS_HEROICONS.filter(function(n){return n.indexOf(term)>=0;}) : ICONS_HEROICONS;
      addSection('Heroicons (Outline 24)', heroFiltered, function(name) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = name;
        var img = document.createElement('img');
        img.src = HEROICONS_CDN + name + '.svg';
        img.alt = name;
        img.onerror = function() { btn.innerHTML = '<span style="font-size:10px">' + name.substring(0,2) + '</span>'; };
        btn.appendChild(img);
        btn.onclick = function() {
          insertStreamingIcon(HEROICONS_CDN + name + '.svg', name);
          if (iconsDropdown) iconsDropdown.classList.add('hidden');
        };
        return btn;
      });
    }

    if (t === 'iconify') {
      var iconifyFiltered = term ? ICONS_ICONIFY.filter(function(s){return s.toLowerCase().indexOf(term)>=0;}) : ICONS_ICONIFY;
      addSection('Iconify (Material Design Icons)', iconifyFiltered, function(iconId) {
        var parts = iconId.split(':');
        var prefix = parts[0] || 'mdi';
        var icon = parts[1] || parts[0] || '';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = iconId;
        var img = document.createElement('img');
        img.src = ICONIFY_API + prefix + '/' + icon + '.svg';
        img.alt = iconId;
        img.onerror = function() { btn.innerHTML = '<span style="font-size:10px">' + icon.substring(0,2) + '</span>'; };
        btn.appendChild(img);
        btn.onclick = function() {
          insertIconifyIcon(iconId);
          if (iconsDropdown) iconsDropdown.classList.add('hidden');
        };
        return btn;
      });
    }

    if (t === 'streaming') {
      var streamFiltered = term ? ICONS_STREAMING.filter(function(s){return s.label.toLowerCase().indexOf(term)>=0;}) : ICONS_STREAMING;
      addSection('Streaming', streamFiltered, function(s) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = s.label;
        var img = document.createElement('img');
        img.src = staticImagesBase + s.file;
        img.alt = s.label;
        img.onerror = function() { btn.innerHTML = '<span style="font-size:10px">' + s.label.substring(0,2) + '</span>'; };
        btn.appendChild(img);
        btn.onclick = function() {
          insertStreamingIcon(staticImagesBase + s.file, s.label);
          if (iconsDropdown) iconsDropdown.classList.add('hidden');
        };
        return btn;
      });
    }

    if (t === 'ccn') {
      var ccnFiltered = term ? ICONS_CCN.filter(function(n){return n.indexOf(term)>=0;}) : ICONS_CCN;
      addSection('CCN (Consulta de Códigos)', ccnFiltered, function(name) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = name;
        btn.innerHTML = '<i class="fas fa-' + name + '"></i>';
        btn.onclick = function() {
          insertIcon('fas fa-' + name);
          if (iconsDropdown) iconsDropdown.classList.add('hidden');
        };
        return btn;
      });
    }

    if (t === 'whatsapp') {
      var waFiltered = term ? ICONS_WHATSAPP.filter(function(s){return (s.label || s.class).toLowerCase().indexOf(term)>=0;}) : ICONS_WHATSAPP;
      addSection('WhatsApp', waFiltered, function(s) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = s.label;
        btn.innerHTML = '<i class="' + s.class + '"></i>';
        btn.onclick = function() {
          insertIcon(s.class);
          if (iconsDropdown) iconsDropdown.classList.add('hidden');
        };
        return btn;
      });
    }

    if (iconsTabs) {
      iconsTabs.querySelectorAll('.html-icons-tab').forEach(function(tabBtn) {
        tabBtn.classList.toggle('active', tabBtn.getAttribute('data-tab') === t);
      });
    }
  }

  function insertIcon(iconClass) {
    if (!editor) return;
    restoreSelection();
    editor.focus();
    var color = getIconColor();
    var style = 'font-size: 24px; color: ' + color.replace(/"/g, '&quot;') + ';';
    var html = '<span class="html-editor-icon" contenteditable="false" draggable="true" style="' + style + '"><i class="' + iconClass.replace(/"/g, '&quot;') + '"></i></span>';
    document.execCommand('insertHTML', false, html);
    updateHtmlOutput();
  }

  function insertIconifyIcon(iconId) {
    if (!editor) return;
    restoreSelection();
    editor.focus();
    var color = getIconColor();
    var html = '<span class="html-editor-icon" contenteditable="false" draggable="true" style="font-size: 24px; color: ' + color.replace(/"/g, '&quot;') + ';"><iconify-icon icon="' + iconId.replace(/"/g, '&quot;') + '"></iconify-icon></span>';
    document.execCommand('insertHTML', false, html);
    updateHtmlOutput();
  }

  function insertStreamingIcon(src, alt) {
    if (!editor) return;
    restoreSelection();
    editor.focus();
    var html = '<img src="' + src.replace(/"/g, '&quot;') + '" alt="' + (alt || '').replace(/"/g, '&quot;') + '" referrerpolicy="no-referrer" draggable="true" style="width: 32px; height: 32px;">';
    document.execCommand('insertHTML', false, html);
    updateHtmlOutput();
  }

  if (btnIcons && iconsDropdown) {
    btnIcons.addEventListener('click', function(e) {
      e.stopPropagation();
      var isHidden = iconsDropdown.classList.contains('hidden');
      if (isHidden) { buildIconsGrid(iconsSearch ? iconsSearch.value : '', currentIconsTab); iconsDropdown.classList.remove('hidden'); }
      else iconsDropdown.classList.add('hidden');
    });
  }
  if (iconsDropdown) iconsDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
  if (iconsSearch) {
    iconsSearch.addEventListener('input', function() { buildIconsGrid(this.value, currentIconsTab); });
    iconsSearch.addEventListener('keydown', function(e) { if (e.key === 'Escape') { iconsDropdown.classList.add('hidden'); } });
  }
  if (iconsTabs) {
    iconsTabs.querySelectorAll('.html-icons-tab').forEach(function(tabBtn) {
      tabBtn.addEventListener('click', function() {
        var tab = this.getAttribute('data-tab');
        if (tab) buildIconsGrid(iconsSearch ? iconsSearch.value : '', tab);
      });
    });
  }
  document.addEventListener('click', function() {
    if (iconsDropdown && !iconsDropdown.classList.contains('hidden')) iconsDropdown.classList.add('hidden');
  });

  if (btnCopyHtml) {
    btnCopyHtml.addEventListener('click', function() {
      if (!htmlOutput || !htmlOutput.value) {
        showToast('No hay contenido para copiar');
        return;
      }
      navigator.clipboard.writeText(htmlOutput.value).then(function() {
        showToast('¡HTML copiado al portapapeles!');
      }).catch(function() {
        showToast('No se pudo copiar');
      });
    });
  }

  var btnCleanHtml = document.getElementById('btnCleanHtml');
  if (btnCleanHtml) {
    btnCleanHtml.addEventListener('click', function() {
      if (!htmlOutput) return;
      var html = htmlOutput.value;
      html = cleanHtmlString(html);
      html = html.replace(/<(\w+)[^>]*>\s*<\/\1>/g, '');
      htmlOutput.value = html;
      showToast('HTML limpiado');
    });
  }
})();
