(function () {
  'use strict';

  function readMeta() {
    var el = document.getElementById('chatbot-rp-meta');
    if (!el) return {};
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
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function voiceRepliesEnabled() {
    var chk = document.getElementById('chatbotRpVoiceRealtime');
    return !chk || chk.checked;
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

  function speakText(text, onDone) {
    if (!voiceRepliesEnabled() || !window.speechSynthesis || !text) {
      if (onDone) onDone();
      return;
    }
    window.speechSynthesis.cancel();
    isSpeaking = true;
    setMicUiState('speaking');
    setMicStatus('Respondiendo en voz…');

    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-CO';
    u.rate = 1;

    function finish() {
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

    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
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
    if (window.speechSynthesis) window.speechSynthesis.cancel();

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
        var t = r[0] ? r[0].transcript : '';
        if (r.isFinal) finalText += t;
        else interim += t;
      }

      if (finalText) utteranceBuffer = (utteranceBuffer + finalText).trim();

      var preview = (utteranceBuffer + ' ' + interim).trim();
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
      if (ev.error === 'no-speech' || ev.error === 'aborted') {
        scheduleListenRestart(400);
        return;
      }
      setMicStatus('No se pudo escuchar. Reintentando…');
      scheduleListenRestart(900);
    };

    recognition.onend = function () {
      isListening = false;
      var text = utteranceBuffer.trim();
      utteranceBuffer = '';

      if (text && voiceSessionActive && !isFetching && !isSpeaking && !sendInFlight) {
        var input = document.getElementById('chatbotRpInput');
        if (input) input.value = '';
        setMicUiState('processing');
        setMicStatus('Procesando…');
        sendInFlight = true;
        sendQuestion(text).finally(function () {
          sendInFlight = false;
        });
        return;
      }

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
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    isSpeaking = false;
    setMicUiState(null);
    setMicStatus('');
    var input = document.getElementById('chatbotRpInput');
    if (input && !input.value.trim()) input.value = '';
  }

  function toggleVoiceSession() {
    if (voiceSessionActive) stopVoiceSession();
    else startVoiceSession();
  }

  function sendQuestion(text) {
    var meta = readMeta();
    if (!meta.askUrl || !text) return Promise.resolve();

    appendMessage('user', text);
    history.push({ role: 'user', content: text });

    var sendBtn = document.getElementById('chatbotRpSendBtn');
    if (sendBtn) sendBtn.disabled = true;
    isFetching = true;
    stopListening();
    setMicUiState('processing');
    setMicStatus('Pensando…');

    return fetch(meta.askUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ message: text, history: history }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (sendBtn) sendBtn.disabled = false;
        isFetching = false;

        if (!data || !data.success) {
          appendMessage('assistant', (data && data.message) || 'Error al obtener respuesta.');
          if (voiceSessionActive) {
            setMicStatus('Error. Sigue hablando o detén el micrófono.');
            scheduleListenRestart(500);
          }
          return;
        }

        var ans = data.answer || '';
        appendMessage('assistant', ans, { engine: data.engine });
        history.push({ role: 'assistant', content: ans });
        if (history.length > 20) history = history.slice(-20);

        if (voiceSessionActive && voiceRepliesEnabled()) {
          speakText(ans);
        } else if (voiceSessionActive) {
          setMicUiState('listening');
          setMicStatus('Te escucho…');
          scheduleListenRestart(300);
        } else if (voiceRepliesEnabled()) {
          speakText(ans);
        }
      })
      .catch(function () {
        if (sendBtn) sendBtn.disabled = false;
        isFetching = false;
        appendMessage('assistant', 'Error de conexión.');
        if (voiceSessionActive) {
          setMicStatus('Sin conexión. Reintentando escucha…');
          scheduleListenRestart(800);
        }
      });
  }

  function bindChat() {
    var form = document.getElementById('chatbotRpForm');
    var input = document.getElementById('chatbotRpInput');
    var mic = document.getElementById('chatbotRpMicBtn');
    var voiceChk = document.getElementById('chatbotRpVoiceRealtime');

    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var t = input ? input.value.trim() : '';
        if (!t) return;
        if (input) input.value = '';
        if (voiceSessionActive) stopVoiceSession();
        sendQuestion(t);
      });
    }

    if (mic) mic.addEventListener('click', toggleVoiceSession);

    if (voiceChk) {
      voiceChk.addEventListener('change', function () {
        if (!voiceChk.checked && voiceSessionActive && isSpeaking) {
          window.speechSynthesis.cancel();
          isSpeaking = false;
          scheduleListenRestart(200);
        }
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
      var body = {
        title: title ? title.value : '',
        youtube_url: yt ? yt.value : '',
        content: content ? content.value : '',
      };
      fetch(meta.knowledgeUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
    setupSpeechRecognition();
    bindChat();
    bindKnowledge();
    setupChatbotTabs();
  });
})();
