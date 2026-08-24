(function () {
  'use strict';

  function readMeta() {
    var el = document.getElementById('chatbot-rp-meta');
    if (!el) return {};
    /* Primero atributos planos (fiables). Compat con JSON embebido antiguo. */
    var askUrl = el.getAttribute('data-ask-url') || '';
    var knowledgeUrl = el.getAttribute('data-knowledge-url') || '';
    var isAdminAttr = el.getAttribute('data-is-admin');
    if (askUrl || knowledgeUrl || isAdminAttr != null) {
      return {
        askUrl: askUrl,
        knowledgeUrl: knowledgeUrl,
        isAdmin: isAdminAttr === '1' || isAdminAttr === 'true',
      };
    }
    var raw = el.getAttribute('data-chatbot-rp-meta');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var history = [];
  var recognition = null;
  var voiceSessionActive = false;
  var isListening = false;
  var isFetching = false;
  var isSpeaking = false;
  var listenRestartTimer = null;
  var utteranceBuffer = '';
  var sendInFlight = false;
  var spanishVoices = [];
  var speechRunId = 0;

  function appendMessage(role, text, meta) {
    var box = document.getElementById('chatbotRpMessages');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'chatbot-rp-msg chatbot-rp-msg--' + role;
    var engine = meta && meta.engine ? '<span class="chatbot-rp-msg-engine">' + escHtml(meta.engine) + '</span>' : '';
    div.innerHTML =
      '<div class="chatbot-rp-msg-role">' +
      (role === 'user' ? 'Tú' : 'Asistente') +
      engine +
      '</div><div class="chatbot-rp-msg-body">' +
      escHtml(text).replace(/\n/g, '<br>') +
      '</div>';
    if (role === 'assistant' && text) {
      var actions = document.createElement('div');
      actions.className = 'chatbot-rp-msg-actions';
      var replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'chatbot-rp-msg-speak';
      replay.setAttribute('aria-label', 'Escuchar esta respuesta');
      replay.innerHTML = '<i class="fas fa-volume-up" aria-hidden="true"></i> Escuchar';
      replay.addEventListener('click', function () {
        speakText(text, null, true);
      });
      actions.appendChild(replay);
      div.appendChild(actions);
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf_token"]');
    if (meta) {
      var fromMeta = meta.getAttribute('content') || '';
      if (fromMeta) return fromMeta;
    }
    try {
      var match = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
      if (match && match[1]) return decodeURIComponent(match[1]);
    } catch (_e) {
      /* ignore */
    }
    return '';
  }

  function setMicUiState(state) {
    var mic = document.getElementById('chatbotRpMicBtn');
    if (!mic) return;
    mic.classList.remove('listening', 'processing', 'speaking');
    if (state) mic.classList.add(state);
    mic.setAttribute(
      'aria-pressed',
      voiceSessionActive || state === 'listening' ? 'true' : 'false'
    );
  }

  function setMicStatus(msg) {
    var el = document.getElementById('chatbotRpMicStatus');
    if (el) el.textContent = msg || '';
  }

  function clearListenRestartTimer() {
    if (listenRestartTimer) {
      clearTimeout(listenRestartTimer);
      listenRestartTimer = null;
    }
  }

  function scheduleListenRestart(delayMs) {
    if (!voiceSessionActive || isFetching || isSpeaking) return;
    clearListenRestartTimer();
    listenRestartTimer = setTimeout(function () {
      listenRestartTimer = null;
      startListening();
    }, delayMs || 280);
  }

  function voiceScore(voice) {
    var lang = String((voice && voice.lang) || '').toLowerCase();
    var name = String((voice && voice.name) || '').toLowerCase();
    var score = 0;
    if (lang === 'es-co') score += 100;
    else if (lang === 'es-mx') score += 85;
    else if (lang === 'es-us') score += 75;
    else if (lang === 'es-es') score += 70;
    else if (lang.indexOf('es') === 0) score += 55;
    if (/natural|neural|online/.test(name)) score += 35;
    if (/google|microsoft|helena|sabina|paulina|elvira|dalia/.test(name)) score += 20;
    if (voice && !voice.localService) score += 5;
    return score;
  }

  function loadSpanishVoices() {
    var select = document.getElementById('chatbotRpVoiceSelect');
    if (!window.speechSynthesis || !select) return;
    spanishVoices = window.speechSynthesis
      .getVoices()
      .filter(function (voice) {
        return String(voice.lang || '').toLowerCase().indexOf('es') === 0;
      })
      .sort(function (a, b) {
        return voiceScore(b) - voiceScore(a);
      });

    select.innerHTML = '';
    if (!spanishVoices.length) {
      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'Español del navegador';
      select.appendChild(none);
      return;
    }
    var saved = '';
    try {
      saved = localStorage.getItem('chatbotRpVoiceName') || '';
    } catch (_e) {
      saved = '';
    }
    spanishVoices.forEach(function (voice, idx) {
      var option = document.createElement('option');
      option.value = voice.name;
      option.textContent = voice.name + ' (' + voice.lang + ')';
      if ((saved && saved === voice.name) || (!saved && idx === 0)) option.selected = true;
      select.appendChild(option);
    });
  }

  function selectedSpanishVoice() {
    var select = document.getElementById('chatbotRpVoiceSelect');
    var selectedName = select ? select.value : '';
    return (
      spanishVoices.find(function (voice) {
        return voice.name === selectedName;
      }) ||
      spanishVoices[0] ||
      null
    );
  }

  function selectedVoiceRate() {
    var select = document.getElementById('chatbotRpVoiceRate');
    var rate = select ? Number(select.value) : 0.96;
    return Number.isFinite(rate) ? Math.max(0.75, Math.min(1.25, rate)) : 0.96;
  }

  function splitSpeechText(text) {
    var clean = String(text || '')
      .replace(/https?:\/\/\S+/gi, ' enlace ')
      .replace(/[*_#`•]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return [];
    var sentences = clean.match(/[^.!?;:]+[.!?;:]?|[^.!?;:]+$/g) || [clean];
    var chunks = [];
    var current = '';
    sentences.forEach(function (sentence) {
      var part = sentence.trim();
      if (!part) return;
      if ((current + ' ' + part).trim().length <= 220) {
        current = (current + ' ' + part).trim();
        return;
      }
      if (current) chunks.push(current);
      while (part.length > 220) {
        var cut = part.lastIndexOf(' ', 220);
        if (cut < 80) cut = 220;
        chunks.push(part.slice(0, cut).trim());
        part = part.slice(cut).trim();
      }
      current = part;
    });
    if (current) chunks.push(current);
    return chunks;
  }

  function finishSpeaking(runId, onDone) {
    if (runId !== speechRunId) return;
    isSpeaking = false;
    if (voiceSessionActive) {
      setMicUiState('listening');
      setMicStatus('Te escucho… habla cuando quieras.');
      scheduleListenRestart(400);
    } else {
      setMicUiState(null);
      setMicStatus('');
    }
    if (onDone) onDone();
  }

  function stopSpeaking(restartListening) {
    speechRunId += 1;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    isSpeaking = false;
    if (voiceSessionActive && restartListening !== false) {
      setMicUiState('listening');
      setMicStatus('Te escucho…');
      scheduleListenRestart(250);
    } else if (!voiceSessionActive) {
      setMicUiState(null);
      setMicStatus('');
    }
  }

  function speakText(text, onDone, force) {
    /* Solo se reproduce con el botón Escuchar de cada respuesta (force). */
    if (!force || !window.speechSynthesis || !text) {
      if (onDone) onDone();
      return;
    }
    stopListening();
    stopSpeaking(false);
    var chunks = splitSpeechText(text);
    if (!chunks.length) {
      if (onDone) onDone();
      return;
    }
    var runId = ++speechRunId;
    var voice = selectedSpanishVoice();
    var rate = selectedVoiceRate();
    var index = 0;
    isSpeaking = true;
    setMicUiState('speaking');
    setMicStatus('Respondiendo en voz…');

    function next() {
      if (runId !== speechRunId) return;
      if (index >= chunks.length) {
        finishSpeaking(runId, onDone);
        return;
      }
      var utterance = new SpeechSynthesisUtterance(chunks[index++]);
      utterance.lang = voice ? voice.lang : 'es-CO';
      utterance.rate = rate;
      utterance.pitch = 1;
      if (voice) utterance.voice = voice;
      utterance.onend = next;
      utterance.onerror = function () {
        finishSpeaking(runId, onDone);
      };
      window.speechSynthesis.speak(utterance);
    }
    next();
  }

  function stopListening() {
    if (!recognition || !isListening) return;
    try {
      recognition.stop();
    } catch (e) {
      /* ignore */
    }
    isListening = false;
  }

  function startListening() {
    if (!recognition || !voiceSessionActive || isFetching || isSpeaking) return;
    if (isListening) return;
    if (isSpeaking) stopSpeaking(false);

    try {
      recognition.start();
      isListening = true;
      setMicUiState('listening');
      setMicStatus('Te escucho… habla cuando quieras.');
    } catch (e) {
      isListening = false;
      scheduleListenRestart(600);
    }
  }

  function setupSpeechRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicStatus('Micrófono no disponible en este navegador.');
      return;
    }

    recognition = new SR();
    recognition.lang = 'es-CO';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = function (ev) {
      if (!voiceSessionActive || isFetching || isSpeaking || sendInFlight) return;

      var interim = '';
      var finalText = '';
      var i;
      for (i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        var t = r[0] ? String(r[0].transcript || '') : '';
        if (!t) continue;
        if (r.isFinal) finalText += t;
        else interim += t;
      }

      if (finalText) utteranceBuffer = (utteranceBuffer + ' ' + finalText).replace(/\s+/g, ' ').trim();

      var preview = (utteranceBuffer + (interim ? ' ' + interim : '')).replace(/\s+/g, ' ').trim();
      var input = document.getElementById('chatbotRpInput');
      if (preview) {
        setMicStatus(preview);
        if (input) input.value = preview;
      }
    };

    recognition.onerror = function (ev) {
      isListening = false;
      if (!voiceSessionActive) {
        setMicUiState(null);
        setMicStatus('');
        return;
      }
      if (ev.error === 'aborted') {
        return;
      }
      if (ev.error === 'no-speech') {
        scheduleListenRestart(400);
        return;
      }
      setMicStatus('No se pudo escuchar. Reintentando…');
      scheduleListenRestart(900);
    };

    recognition.onend = function () {
      isListening = false;
      var input = document.getElementById('chatbotRpInput');
      var fromInput = input ? String(input.value || '').trim() : '';
      /* Chrome a veces cierra la sesión antes de marcar el resultado como final. */
      var text = utteranceBuffer.trim() || fromInput;
      utteranceBuffer = '';

      if (text && voiceSessionActive && !isFetching && !isSpeaking && !sendInFlight) {
        if (input) input.value = text;
        setMicUiState('processing');
        setMicStatus('Procesando…');
        sendInFlight = true;
        sendQuestion(text)
          .catch(function () {
            /* sendQuestion ya muestra error en el chat */
          })
          .finally(function () {
            sendInFlight = false;
          });
        return;
      }

      if (fromInput && input) input.value = fromInput;

      if (voiceSessionActive && !isFetching && !isSpeaking && !sendInFlight) {
        scheduleListenRestart(350);
      }
    };
  }

  function startVoiceSession() {
    if (!recognition) {
      setMicStatus('Reconocimiento de voz no soportado.');
      return;
    }
    voiceSessionActive = true;
    setMicUiState('listening');
    setMicStatus('Te escucho… habla cuando quieras.');
    startListening();
  }

  function stopVoiceSession() {
    voiceSessionActive = false;
    utteranceBuffer = '';
    clearListenRestartTimer();
    stopListening();
    stopSpeaking(false);
    setMicUiState(null);
    setMicStatus('');
    var input = document.getElementById('chatbotRpInput');
    if (input && !input.value.trim()) input.value = '';
  }

  function toggleVoiceSession() {
    /* Un solo botón: inicia micrófono o detiene micrófono / respuesta hablada. */
    if (isSpeaking || voiceSessionActive || isListening || sendInFlight) {
      stopVoiceSession();
      setMicStatus('Voz detenida.');
      return;
    }
    startVoiceSession();
  }

  function sendQuestion(text) {
    var meta = readMeta();
    var input = document.getElementById('chatbotRpInput');
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!meta.askUrl || !clean) {
      var errMsg = !meta.askUrl
        ? 'Error de configuración del chat. Recarga la página (Ctrl+F5).'
        : 'Escribe una pregunta.';
      if (!meta.askUrl) appendMessage('assistant', errMsg);
      setMicStatus(errMsg);
      if (voiceSessionActive) {
        setMicUiState('listening');
        scheduleListenRestart(500);
      } else {
        setMicUiState(null);
      }
      return Promise.resolve();
    }

    appendMessage('user', clean);
    history.push({ role: 'user', content: clean });
    /* Solo borrar el input cuando el mensaje ya quedó en el chat. */
    if (input) input.value = '';

    var sendBtn = document.getElementById('chatbotRpSendBtn');
    if (sendBtn) sendBtn.disabled = true;
    isFetching = true;
    stopListening();
    setMicUiState('processing');
    setMicStatus('Pensando…');

    return fetch(meta.askUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRFToken': csrfToken(),
      },
      body: JSON.stringify({ message: clean, history: history }),
    })
      .then(function (r) {
        return r.json().then(
          function (data) {
            return { ok: r.ok, data: data };
          },
          function () {
            return { ok: false, data: null };
          }
        );
      })
      .then(function (res) {
        if (sendBtn) sendBtn.disabled = false;
        isFetching = false;
        var data = res && res.data;

        if (!res || !res.ok || !data || !data.success) {
          appendMessage('assistant', (data && data.message) || 'Error al obtener respuesta.');
          if (voiceSessionActive) {
            setMicStatus('Error. Sigue hablando o detén el micrófono.');
            scheduleListenRestart(500);
          } else {
            setMicUiState(null);
            setMicStatus('');
          }
          return;
        }

        var ans = data.answer || '';
        appendMessage('assistant', ans, { engine: data.engine });
        history.push({ role: 'assistant', content: ans });
        if (history.length > 20) history = history.slice(-20);

        if (voiceSessionActive) {
          setMicUiState('listening');
          setMicStatus('Te escucho… Pulsa Escuchar si quieres oír la respuesta.');
          scheduleListenRestart(300);
        } else {
          setMicUiState(null);
          setMicStatus('');
        }
      })
      .catch(function () {
        if (sendBtn) sendBtn.disabled = false;
        isFetching = false;
        appendMessage('assistant', 'Error de conexión.');
        if (voiceSessionActive) {
          setMicStatus('Sin conexión. Reintentando escucha…');
          scheduleListenRestart(800);
        } else {
          setMicUiState(null);
          setMicStatus('');
        }
      });
  }

  function bindChat() {
    var form = document.getElementById('chatbotRpForm');
    var input = document.getElementById('chatbotRpInput');
    var mic = document.getElementById('chatbotRpMicBtn');
    var voiceSelect = document.getElementById('chatbotRpVoiceSelect');
    var voiceRate = document.getElementById('chatbotRpVoiceRate');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var t = input ? input.value.trim() : '';
        if (!t || isFetching || sendInFlight) return;
        if (voiceSessionActive) stopVoiceSession();
        /* sendQuestion limpia el input solo cuando el mensaje ya quedó en el chat. */
        sendQuestion(t);
      });
    }

    if (mic) mic.addEventListener('click', toggleVoiceSession);
    if (voiceSelect) {
      voiceSelect.addEventListener('change', function () {
        try {
          localStorage.setItem('chatbotRpVoiceName', voiceSelect.value || '');
        } catch (_e) {
          /* ignore */
        }
        if (isSpeaking) stopSpeaking(true);
      });
    }
    if (voiceRate) {
      try {
        var savedRate = localStorage.getItem('chatbotRpVoiceRate');
        if (savedRate && voiceRate.querySelector('option[value="' + savedRate + '"]')) {
          voiceRate.value = savedRate;
        }
      } catch (_eRate) {
        /* ignore */
      }
      voiceRate.addEventListener('change', function () {
        try {
          localStorage.setItem('chatbotRpVoiceRate', voiceRate.value);
        } catch (_e) {
          /* ignore */
        }
        if (isSpeaking) stopSpeaking(true);
      });
    }

  }

  function bindKnowledge() {
    var meta = readMeta();
    if (!meta.isAdmin || !meta.knowledgeUrl) return;
    var form = document.getElementById('chatbotRpKnowledgeForm');
    if (!form) return;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var title = document.getElementById('chatbotRpKnowTitle');
      var yt = document.getElementById('chatbotRpKnowYoutube');
      var content = document.getElementById('chatbotRpKnowContent');
      var visibility = document.getElementById('chatbotRpKnowVisibility');
      var body = {
        title: title ? title.value : '',
        youtube_url: yt ? yt.value : '',
        content: content ? content.value : '',
        visibility: visibility ? visibility.value : 'admin',
      };
      fetch(meta.knowledgeUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRFToken': csrfToken(),
        },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.success) {
            alert((data && data.message) || 'No se pudo guardar');
            return;
          }
          if (content) content.value = '';
          if (title) title.value = '';
          if (yt) yt.value = '';
          var list = document.getElementById('chatbotRpSourcesList');
          if (list && data.source) {
            var li = document.createElement('li');
            li.innerHTML =
              '<span class="chatbot-rp-src-type">' +
              escHtml(data.source.type) +
              '</span><span class="chatbot-rp-src-scope">' +
              escHtml(data.source.visibility || 'admin') +
              '</span> ' +
              escHtml(data.source.title);
            list.insertBefore(li, list.firstChild);
          }
          appendMessage('assistant', 'Base de conocimiento actualizada. Ya puedes preguntar sobre «' + (data.source.title || 'nuevo contenido') + '».');
        })
        .catch(function () {
          alert('Error de conexión');
        });
    });
  }

  function activateChatbotTab(tabId) {
    var tabs = document.querySelectorAll('[data-chatbot-tab]');
    var panels = {
      asistente: document.getElementById('chatbotRpPanelAsistente'),
      integraciones: document.getElementById('chatbotRpPanelIntegraciones'),
    };
    tabs.forEach(function (btn) {
      var active = btn.getAttribute('data-chatbot-tab') === tabId;
      btn.classList.toggle('chatbot-rp-tab--active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.keys(panels).forEach(function (key) {
      var panel = panels[key];
      if (!panel) return;
      var show = key === tabId;
      panel.hidden = !show;
      panel.classList.toggle('chatbot-rp-panel--hidden', !show);
    });
    if (tabId !== 'asistente' && voiceSessionActive) stopVoiceSession();
  }

  function setupChatbotTabs() {
    var tabs = document.querySelectorAll('[data-chatbot-tab]');
    if (!tabs.length) return;
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activateChatbotTab(btn.getAttribute('data-chatbot-tab'));
      });
    });
    document.querySelectorAll('.chatbot-rp-hub-card[href^="#"]').forEach(function (card) {
      card.addEventListener('click', function (ev) {
        var target = card.getAttribute('href');
        if (!target || target.charAt(0) !== '#') return;
        ev.preventDefault();
        activateChatbotTab('integraciones');
        var el = document.querySelector(target);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    var params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'integraciones' || window.location.hash === '#integraciones') {
      activateChatbotTab('integraciones');
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && voiceSessionActive) {
      stopVoiceSession();
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    loadSpanishVoices();
    if (window.speechSynthesis) {
      if (typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', loadSpanishVoices);
      } else {
        window.speechSynthesis.onvoiceschanged = loadSpanishVoices;
      }
    }
    setupSpeechRecognition();
    bindChat();
    bindKnowledge();
    setupChatbotTabs();
  });
})();
