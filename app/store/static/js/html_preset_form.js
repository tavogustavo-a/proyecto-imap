(function() {
  function initHtmlPresetForm(form) {
    if (!form || form.dataset.htmlPresetInit === '1') return;
    form.dataset.htmlPresetInit = '1';

    var presetSelect = form.querySelector('[data-html-preset-select]');
    var titleInput = form.querySelector('[data-html-title]');
    var textArea = form.querySelector('[data-html-text]');
    if (!presetSelect || !textArea) return;

    var titleLabels = {};
    try {
      titleLabels = JSON.parse(presetSelect.getAttribute('data-preset-titles') || '{}');
    } catch (e) {
      titleLabels = {};
    }

    var mdpEditor = form.querySelector('[data-mdp-editor]');
    var mdpSections = mdpEditor ? mdpEditor.querySelector('[data-mdp-sections]') : null;
    var mdpAdd = mdpEditor ? mdpEditor.querySelector('[data-mdp-add]') : null;
    var mdpTemplate = mdpEditor ? mdpEditor.querySelector('#mdp-section-template') : null;

    var tvTitleInfo = document.querySelector('[data-tv-title-info]');
    if (tvTitleInfo && tvTitleInfo.dataset.wired !== '1') {
      tvTitleInfo.dataset.wired = '1';
      var tvInfoBtn = tvTitleInfo.querySelector('.tv-title-info-btn');
      var tvInfoBox = tvTitleInfo.querySelector('.tv-title-info-box');
      if (tvInfoBtn && tvInfoBox) {
        tvInfoBtn.addEventListener('click', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var open = tvInfoBox.hidden;
          tvInfoBox.hidden = !open;
          tvInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        document.addEventListener('click', function(ev) {
          if (!tvTitleInfo.contains(ev.target)) {
            tvInfoBox.hidden = true;
            tvInfoBtn.setAttribute('aria-expanded', 'false');
          }
        });
      }
    }

    function syncHtmlContentRequired() {
      var key = presetSelect.value;
      form.dataset.preset = key || '';
      if (tvTitleInfo) {
        tvTitleInfo.hidden = key !== 'foto_pantallas_perfiles_tv';
        if (tvTitleInfo.hidden) {
          var box = tvTitleInfo.querySelector('.tv-title-info-box');
          var btn = tvTitleInfo.querySelector('.tv-title-info-btn');
          if (box) box.hidden = true;
          if (btn) btn.setAttribute('aria-expanded', 'false');
        }
      }
      var hasPreset = Boolean(key);
      if (hasPreset) {
        textArea.removeAttribute('required');
        textArea.setAttribute('aria-required', 'false');
      } else {
        textArea.setAttribute('required', 'required');
        textArea.setAttribute('aria-required', 'true');
      }
    }

    function renderMdpIconPreview(value, container) {
      if (!container) return;
      container.innerHTML = '';
      if (value && value.indexOf('fa:') === 0) {
        var icon = document.createElement('i');
        icon.className = 'fas fa-' + value.slice(3);
        container.appendChild(icon);
      } else {
        container.textContent = value || '👑';
      }
    }

    function initMdpIconPicker(root) {
      if (!root || root.dataset.mdpIconInit === '1') return;
      root.dataset.mdpIconInit = '1';
      var input = root.querySelector('[data-mdp-icon-input]');
      var trigger = root.querySelector('[data-mdp-icon-trigger]');
      var panel = root.querySelector('[data-mdp-icon-panel]');
      var preview = root.querySelector('[data-mdp-icon-preview]');
      if (!input || !trigger || !panel || !preview) return;

      function closePanel() {
        panel.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }

      function openPanel() {
        panel.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
      }

      function setIcon(value) {
        input.value = value;
        renderMdpIconPreview(value, preview);
        panel.querySelectorAll('[data-mdp-icon-value]').forEach(function(btn) {
          btn.classList.toggle('is-selected', btn.getAttribute('data-mdp-icon-value') === value);
        });
        closePanel();
      }

      trigger.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (panel.classList.contains('hidden')) openPanel();
        else closePanel();
      });

      panel.addEventListener('click', function(ev) {
        var option = ev.target.closest('[data-mdp-icon-value]');
        if (!option || !panel.contains(option)) return;
        setIcon(option.getAttribute('data-mdp-icon-value') || '👑');
      });

      document.addEventListener('click', function(ev) {
        if (!root.contains(ev.target)) closePanel();
      });

      renderMdpIconPreview(input.value || '👑', preview);
    }

    function wireMdpSectionLabels(section) {
      if (!section || section.dataset.mdpA11yInit === '1') return;
      section.dataset.mdpA11yInit = '1';
      var uid = String(Date.now()) + '_' + Math.floor(Math.random() * 100000);
      section.querySelectorAll('[data-mdp-field]').forEach(function(input) {
        var field = input.getAttribute('data-mdp-field');
        if (!field) return;
        var id = 'mdp_' + field + '_' + uid;
        input.id = id;
        var label = section.querySelector('[data-mdp-label="' + field + '"]');
        if (label) label.setAttribute('for', id);
      });
    }

    if (mdpEditor) {
      mdpEditor.querySelectorAll('[data-mdp-icon-picker]').forEach(initMdpIconPicker);
      mdpEditor.querySelectorAll('[data-mdp-section]').forEach(wireMdpSectionLabels);
    }

    var ctEditor = form.querySelector('[data-ct-editor]');
    var ctSections = ctEditor ? ctEditor.querySelector('[data-ct-sections]') : null;
    var ctAdd = ctEditor ? ctEditor.querySelector('[data-ct-add]') : null;
    var ctTemplate = ctEditor ? ctEditor.querySelector('#ct-section-template') : null;

    function wireCtSectionLabels(section) {
      if (!section || section.dataset.ctA11yInit === '1') return;
      section.dataset.ctA11yInit = '1';
      var uid = String(Date.now()) + '_' + Math.floor(Math.random() * 100000);
      section.querySelectorAll('[data-ct-field]').forEach(function(input) {
        var field = input.getAttribute('data-ct-field');
        if (!field) return;
        var id = 'ct_' + field + '_' + uid;
        input.id = id;
        var label = section.querySelector('[data-ct-label="' + field + '"]');
        if (label) label.setAttribute('for', id);
      });
      section.querySelectorAll('[data-mdp-icon-picker]').forEach(initMdpIconPicker);
    }

    if (ctEditor) {
      var ctMainPicker = ctEditor.querySelector('.mdp-main-row [data-mdp-icon-picker]');
      if (ctMainPicker) initMdpIconPicker(ctMainPicker);
      ctEditor.querySelectorAll('[data-ct-section]').forEach(wireCtSectionLabels);
    }

    if (ctEditor && ctSections && ctAdd && ctTemplate) {
      ctAdd.addEventListener('click', function() {
        var node = ctTemplate.content.firstElementChild.cloneNode(true);
        ctSections.appendChild(node);
        wireCtSectionLabels(node);
        var focus = node.querySelector('input[name="ct_title"]');
        if (focus) focus.focus();
      });
      ctEditor.addEventListener('click', function(ev) {
        var btn = ev.target.closest('[data-ct-remove]');
        if (!btn || !ctEditor.contains(btn)) return;
        var section = btn.closest('[data-ct-section]');
        if (!section) return;
        if (!window.confirm('¿Eliminar este título?')) return;
        section.remove();
      });
    }

    if (mdpEditor && mdpSections && mdpAdd && mdpTemplate) {
      mdpAdd.addEventListener('click', function() {
        var node = mdpTemplate.content.firstElementChild.cloneNode(true);
        mdpSections.appendChild(node);
        wireMdpSectionLabels(node);
        var titleInput = node.querySelector('input[name="mdp_title"]');
        if (titleInput) titleInput.focus();
      });
      mdpEditor.addEventListener('click', function(ev) {
        var btn = ev.target.closest('[data-mdp-remove]');
        if (!btn || !mdpEditor.contains(btn)) return;
        var section = btn.closest('[data-mdp-section]');
        if (!section) return;
        if (!window.confirm('¿Eliminar este título?')) return;
        section.remove();
      });
    }

    var tvEditor = form.querySelector('[data-tv-editor]');
    var tvRows = tvEditor ? tvEditor.querySelector('[data-tv-rows]') : null;
    var tvAdd = tvEditor ? tvEditor.querySelector('[data-tv-add]') : null;
    var tvTemplate = tvEditor ? tvEditor.querySelector('#tv-row-template') : null;
    var tvPop = tvEditor ? tvEditor.querySelector('[data-tv-icon-pop]') : null;
    var tvTargetRow = null;

    function wireTvRow(row) {
      if (!row || row.dataset.tvA11yInit === '1') return;
      row.dataset.tvA11yInit = '1';
      var uid = String(Date.now()) + '_' + Math.floor(Math.random() * 100000);
      row.querySelectorAll('[data-tv-field]').forEach(function(input) {
        var field = input.getAttribute('data-tv-field');
        if (!field) return;
        var id = 'tv_' + field + '_' + uid;
        input.id = id;
        var label = row.querySelector('[data-tv-label="' + field + '"]');
        if (label) label.setAttribute('for', id);
      });
      syncTvAddIcon(row);
    }

    function syncTvAddIcon(row) {
      if (!row) return;
      var addBtn = row.querySelector('[data-tv-add-icon]');
      var filled = 0;
      row.querySelectorAll('[data-tv-icon-input]').forEach(function(input) {
        if ((input.value || '').trim()) filled += 1;
      });
      if (addBtn) addBtn.hidden = filled >= 2;
    }

    function paintTvIcon(input, url) {
      var existing = input.closest('.tv-icon-slot');
      if (!url) {
        input.value = '';
        if (existing) {
          existing.parentNode.insertBefore(input, existing);
          existing.remove();
        }
        return;
      }
      var slot = existing;
      if (!slot) {
        slot = document.createElement('span');
        slot.className = 'service-icon-wrapper tv-icon-slot';
        var img = document.createElement('img');
        img.className = 'service-icon-img';
        img.alt = '';
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'delete-service-icon-btn';
        clear.setAttribute('data-tv-icon-clear', '');
        clear.setAttribute('aria-label', 'Quitar icono');
        clear.textContent = '×';
        slot.appendChild(img);
        slot.appendChild(clear);
        var slots = input.closest('[data-tv-row]').querySelector('[data-tv-icon-slots]');
        slots.appendChild(slot);
        slot.appendChild(input);
      }
      var image = slot.querySelector('img');
      if (image) image.src = url;
    }

    if (tvEditor) {
      tvEditor.querySelectorAll('[data-tv-row]').forEach(wireTvRow);
    }

    if (tvEditor && tvRows && tvAdd && tvTemplate) {
      tvAdd.addEventListener('click', function() {
        var node = tvTemplate.content.firstElementChild.cloneNode(true);
        tvRows.appendChild(node);
        wireTvRow(node);
        var focus = node.querySelector('[data-tv-field="pantallas"]');
        if (focus) focus.focus();
      });
      tvEditor.addEventListener('click', function(ev) {
        var addIcon = ev.target.closest('[data-tv-add-icon]');
        if (addIcon && tvEditor.contains(addIcon)) {
          tvTargetRow = addIcon.closest('[data-tv-row]');
          if (tvPop) tvPop.classList.remove('hidden');
          return;
        }
        var clearIcon = ev.target.closest('[data-tv-icon-clear]');
        if (clearIcon && tvEditor.contains(clearIcon)) {
          var slot = clearIcon.closest('.tv-icon-slot');
          var row = clearIcon.closest('[data-tv-row]');
          var input = slot ? slot.querySelector('[data-tv-icon-input]') : null;
          if (input) paintTvIcon(input, '');
          syncTvAddIcon(row);
          return;
        }
        var removeRow = ev.target.closest('[data-tv-remove]');
        if (removeRow && tvEditor.contains(removeRow)) {
          var section = removeRow.closest('[data-tv-row]');
          if (!section) return;
          if (!window.confirm('¿Estás seguro de eliminar fila?')) return;
          if (tvRows.querySelectorAll('[data-tv-row]').length <= 1) {
            section.querySelectorAll('input').forEach(function(input) {
              input.value = '';
            });
            section.querySelectorAll('.tv-icon-slot').forEach(function(slot) {
              var hidden = slot.querySelector('[data-tv-icon-input]');
              if (hidden) paintTvIcon(hidden, '');
            });
            syncTvAddIcon(section);
            return;
          }
          section.remove();
        }
      });
    }

    if (tvPop) {
      tvPop.addEventListener('click', function(ev) {
        if (ev.target === tvPop || ev.target.closest('[data-tv-icon-close]')) {
          tvPop.classList.add('hidden');
          tvTargetRow = null;
          return;
        }
        var choice = ev.target.closest('[data-tv-pick]');
        if (!choice || !tvTargetRow) return;
        var empty = null;
        tvTargetRow.querySelectorAll('[data-tv-icon-input]').forEach(function(input) {
          if (!empty && !(input.value || '').trim()) empty = input;
        });
        if (!empty) return;
        empty.value = choice.getAttribute('data-tv-pick') || '';
        paintTvIcon(empty, choice.getAttribute('data-tv-pick-url') || '');
        syncTvAddIcon(tvTargetRow);
        tvPop.classList.add('hidden');
        tvTargetRow = null;
      });
    }

    presetSelect.addEventListener('change', function() {
      var key = presetSelect.value;
      if (key && titleInput && titleLabels[key]) {
        if (!titleInput.value.trim() || titleInput.dataset.autoFilled === '1') {
          titleInput.value = titleLabels[key];
          titleInput.dataset.autoFilled = '1';
        }
      } else if (titleInput && titleInput.dataset.autoFilled === '1') {
        titleInput.value = '';
        delete titleInput.dataset.autoFilled;
      }
      syncHtmlContentRequired();
    });

    if (titleInput) {
      titleInput.addEventListener('input', function() {
        if (titleInput.value.trim()) {
          delete titleInput.dataset.autoFilled;
        }
      });
    }

    syncHtmlContentRequired();
  }

  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('form[data-html-preset-form]').forEach(initHtmlPresetForm);
  });
})();
