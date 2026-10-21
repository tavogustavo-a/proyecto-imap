/**
 * WhatsApp Web (Evolution API) — configuración única, salud, QR y pruebas.
 */

var whatsappActiveConfigId = null;
var whatsappHealthPollTimer = null;
var whatsappHealthSseHandle = null;
var WHATSAPP_HEALTH_SSE_URL_TEMPLATE = '/tienda/admin/whatsapp_configs/__ID__/health/stream';
var WHATSAPP_HEALTH_FALLBACK_POLL_MS = 90000;
var whatsappNotifyDailyLogCache = [];
var whatsappQrModalTrigger = null;
var whatsappNotifyAttemptsModalTrigger = null;
var whatsappUserPhoneModalTrigger = null;
var whatsappUserPhoneModalContext = null;

function whatsappCsrfToken() {
    return document.querySelector('meta[name="csrf_token"]')?.content || '';
}

function showWhatsAppStatus(message, type) {
    var statusDiv = document.getElementById('whatsapp-status');
    if (!statusDiv) return;
    if (!message) {
        statusDiv.textContent = '';
        statusDiv.className = 'whatsapp-status-msg';
        return;
    }
    var cls =
        type === 'success'
            ? 'whatsapp-status-msg--success'
            : type === 'error'
              ? 'whatsapp-status-msg--error'
              : 'whatsapp-status-msg--info';
    statusDiv.className = 'whatsapp-status-msg ' + cls;
    statusDiv.textContent = message;
    if (type === 'success') {
        setTimeout(function () {
            if (statusDiv.textContent === message) {
                statusDiv.textContent = '';
                statusDiv.className = 'whatsapp-status-msg';
            }
        }, 6000);
    }
}

function whatsappHealthUiState(config) {
    var status = String((config && config.connection_status) || '').toLowerCase();
    if (status === 'connected') {
        return { css: 'whatsapp-health-status--conectado', label: 'Conectado' };
    }
    return { css: 'whatsapp-health-status--desconectado', label: 'Desconectado' };
}

function updateTelegramHealthBanner(config) {
    var statusEl = document.getElementById('telegram-health-status');
    var valueEl = document.getElementById('telegram-health-value');
    if (!statusEl || !valueEl) return;
    var connected = !!(config && (config.connected || String(config.connection_status || '').toLowerCase() === 'connected'));
    var label = connected ? 'Conectado' : 'Desconectado';
    var tone = connected ? 'btn-green' : 'btn-red';
    statusEl.classList.remove('btn-blue', 'btn-green', 'btn-red', 'btn-orange', 'whatsapp-health-status--desconectado', 'whatsapp-health-status--conectado');
    statusEl.classList.add('btn-panel', 'whatsapp-mini-btn', 'whatsapp-verify-state-btn', 'whatsapp-health-status', tone, connected ? 'whatsapp-health-status--conectado' : 'whatsapp-health-status--desconectado');
    valueEl.textContent = label;
    statusEl.setAttribute('aria-label', 'Estado Telegram: ' + label);
}

function fillTelegramBotForm(config) {
    var nameInput = document.getElementById('telegram-bot-username');
    var tokenInput = document.getElementById('telegram-bot-token');
    if (nameInput) nameInput.value = (config && config.bot_username) || '';
    if (tokenInput) tokenInput.value = (config && config.bot_token) || '';
}

function setTelegramBotModalStatus(message, ok) {
    var el = document.getElementById('telegram-botfather-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('telegram-botfather-status--ok', 'telegram-botfather-status--bad');
    if (message) el.classList.add(ok ? 'telegram-botfather-status--ok' : 'telegram-botfather-status--bad');
}

async function loadTelegramBot() {
    try {
        var response = await fetch('/tienda/admin/telegram_bot');
        var result = await response.json();
        var config = result.config || null;
        fillTelegramBotForm(config);
        updateTelegramHealthBanner(config);
        var tgEnabled = document.getElementById('telegram-enabled');
        if (tgEnabled) tgEnabled.checked = !!(config && config.is_enabled);
        if (config && config.bot_username && config.bot_token) {
            await refreshTelegramBotHealth(true);
        }
    } catch (error) {
        updateTelegramHealthBanner(null);
    }
}

async function refreshTelegramBotHealth(silent) {
    if (!silent) showWhatsAppStatus('Comprobando Telegram…', 'info');
    try {
        var response = await fetch('/tienda/admin/telegram_bot/health', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': whatsappCsrfToken(),
            },
        });
        var result = await response.json();
        if (result.config) {
            fillTelegramBotForm(result.config);
            updateTelegramHealthBanner(result.config);
        }
        if (!silent) {
            showWhatsAppStatus(result.message || result.error || 'Estado actualizado', result.connected ? 'success' : 'error');
        }
        return result;
    } catch (error) {
        if (!silent) showWhatsAppStatus('No se pudo consultar Telegram', 'error');
        return null;
    }
}

async function saveTelegramBotFromModal() {
    var nameInput = document.getElementById('telegram-bot-username');
    var tokenInput = document.getElementById('telegram-bot-token');
    var saveBtn = document.getElementById('telegram-botfather-save-btn');
    var username = nameInput ? nameInput.value.trim() : '';
    var token = tokenInput ? tokenInput.value.trim() : '';
    if (saveBtn) saveBtn.disabled = true;
    setTelegramBotModalStatus('Comprobando…', true);
    try {
        var response = await fetch('/tienda/admin/telegram_bot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': whatsappCsrfToken(),
            },
            body: JSON.stringify({ bot_username: username, bot_token: token }),
        });
        var result = await response.json();
        if (result.config) {
            fillTelegramBotForm(result.config);
            updateTelegramHealthBanner(result.config);
        }
        var ok = !!result.connected;
        setTelegramBotModalStatus(result.message || result.error || 'No se pudo guardar', ok);
        showWhatsAppStatus(result.message || result.error || 'No se pudo guardar', ok ? 'success' : 'error');
    } catch (error) {
        setTelegramBotModalStatus('No se pudo consultar Telegram', false);
        showWhatsAppStatus('No se pudo consultar Telegram', 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function updateWhatsAppHealthBanner(config) {
    var statusEl = document.getElementById('test-whatsapp-connection');
    var valueEl = document.getElementById('whatsapp-health-value');
    if (!statusEl || !valueEl) return;

    var ui = whatsappHealthUiState(config);
    var tone = ui.css === 'whatsapp-health-status--conectado' ? 'btn-green' : 'btn-red';

    statusEl.classList.remove(
        'btn-blue',
        'btn-green',
        'btn-red',
        'btn-orange',
        'whatsapp-health-status--no-configurado',
        'whatsapp-health-status--desconectado',
        'whatsapp-health-status--conectado'
    );
    statusEl.classList.add('btn-panel', 'whatsapp-mini-btn', 'whatsapp-verify-state-btn', 'whatsapp-health-status', tone, ui.css);
    valueEl.textContent = ui.label;
    statusEl.setAttribute('aria-label', 'Estado: ' + ui.label);

    var parts = [];
    if (config && config.linked_phone) parts.push('Vinculado: ' + config.linked_phone);
    if (config && config.last_health_at) {
        try {
            parts.push('Check: ' + new Date(config.last_health_at).toLocaleString());
        } catch (_e) {
            parts.push('Check: ' + config.last_health_at);
        }
    }
    if (config && config.last_health_error) parts.push(config.last_health_error);
    var baseTitle = 'Comprobar conexión de WhatsApp Web';
    statusEl.title = parts.length ? baseTitle + ' · ' + parts.join(' · ') : baseTitle;
}

function populateWhatsAppForm(config) {
    var timeInp = document.getElementById('whatsapp-notification-time');
    var enabledInp = document.getElementById('whatsapp-enabled');
    if (!config) {
        if (timeInp) timeInp.value = '00:00';
        if (enabledInp) enabledInp.checked = true;
        return;
    }
    if (timeInp) timeInp.value = config.notification_time || '00:00';
    if (enabledInp) enabledInp.checked = config.is_enabled !== false;
}

function whatsappNotifyTriggerLabel(trigger) {
    var t = String(trigger || '').toLowerCase();
    if (t === 'scheduled') return 'Programado';
    if (t === 'reconnect_catchup') return 'Reconexión (+10 min)';
    if (t === 'manual') return 'Manual';
    return trigger || '—';
}

function whatsappNotifyTriggerDisplay(attOrTrigger) {
    if (attOrTrigger && typeof attOrTrigger === 'object' && attOrTrigger.trigger_label) {
        return attOrTrigger.trigger_label;
    }
    return whatsappNotifyTriggerLabel(
        attOrTrigger && typeof attOrTrigger === 'object' ? attOrTrigger.trigger : attOrTrigger
    );
}

var WHATSAPP_REASON_LABELS = {
    whatsapp_desactivado:
        'WhatsApp está desactivado. Activá el uso de WhatsApp para enviar resúmenes.',
    whatsapp_no_conectado:
        'WhatsApp no está conectado. Verificá el estado y escaneá el QR si hace falta.',
    sin_api_key: 'Falta la API Key de Evolution (revisá EVOLUTION_API_KEY en el servidor).',
    nada_pendiente: 'No hay resúmenes pendientes para enviar.',
    fuera_de_ventana_o_ya_ejecutado:
        'Aún no corresponde enviar o el resumen del día ya se procesó.',
};

function whatsappHumanizeReason(raw) {
    var text = String(raw || '').trim();
    if (!text) return '—';
    var key = text.toLowerCase();
    if (WHATSAPP_REASON_LABELS[key]) return WHATSAPP_REASON_LABELS[key];
    if (text.indexOf(' ') >= 0 || /[áéíóúñÁÉÍÓÚÑ]/.test(text)) return text;
    if (text.indexOf('_') >= 0) {
        return text.replace(/_/g, ' ').replace(/^\w/, function (c) {
            return c.toUpperCase();
        });
    }
    return text;
}

function whatsappDeliveryKindLabel(kind) {
    var k = String(kind || '').toLowerCase();
    if (k === 'aviso') return 'Aviso de licencia (registro antiguo)';
    if (k === 'resumen') return 'Resumen diario';
    return kind || '—';
}

function whatsappDeliveryResultText(row) {
    var reason = String((row && row.reason) || '').trim();
    if (reason) return whatsappHumanizeReason(reason);
    return whatsappDeliveryOutcomeLabel(row && row.outcome);
}

function whatsappDeliveryOutcomeLabel(outcome) {
    var o = String(outcome || '').toLowerCase();
    if (o === 'ok') return 'Enviado';
    if (o === 'error') return 'Falló el envío';
    if (o === 'sin_telefono') return 'Sin teléfono en perfil';
    if (o === 'sin_id') return 'Sin ID de Telegram';
    if (o === 'deshabilitado') return 'WhatsApp desactivado para el usuario';
    return outcome || '—';
}

function whatsappDeliveryOutcomeClass(outcome) {
    var o = String(outcome || '').toLowerCase();
    if (o === 'error') return 'text-danger';
    if (o === 'sin_telefono' || o === 'sin_id') return 'text-warning';
    if (o === 'deshabilitado') return 'text-warning';
    if (o === 'ok') return 'text-success';
    return 'text-muted';
}

function collectWhatsAppDeliveryDetailsForDay(attempts, coDate) {
    var rows = [];
    (attempts || []).forEach(function (att) {
        var when = formatWhatsAppColombiaDateTime12(coDate, att.co_time, att.at_utc);
        (att.delivery_details || []).forEach(function (item) {
            rows.push({
                when: when,
                username: item.username || '—',
                phone: item.phone || '—',
                channel: item.channel === 'telegram' ? 'Telegram' : 'WhatsApp',
                kind: item.kind || '',
                kind_label: item.kind_label || '',
                outcome: item.outcome || '',
                reason: item.reason || '',
            });
        });
    });
    return rows;
}

function whatsappNotifyStatusClass(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'success') return 'text-success';
    if (s === 'partial') return 'text-warning';
    if (s === 'failed') return 'text-danger';
    return 'text-muted';
}

function whatsappNotifyStatusLabel(status, row) {
    if (row && row.status_label) return row.status_label;
    var s = String(status || '').toLowerCase();
    if (s === 'success') return 'OK';
    if (s === 'partial') return 'Parcial';
    if (s === 'failed') return 'Falló';
    if (s === 'skipped') return 'Omitido';
    return status || '—';
}

var WHATSAPP_NOTIFY_STATUS_RANK = { success: 4, partial: 3, failed: 2, skipped: 1 };

function whatsappAttemptFromFlat(item) {
    return {
        at_utc: item.at_utc,
        co_time: item.co_time,
        trigger: item.trigger,
        status: item.status,
        sent: item.sent != null ? item.sent : 0,
        errors: item.errors != null ? item.errors : 0,
        skipped_no_phone: item.skipped_no_phone != null ? item.skipped_no_phone : 0,
        daily_sent: item.daily_sent != null ? item.daily_sent : 0,
        daily_errors: item.daily_errors != null ? item.daily_errors : 0,
        reason: item.reason || '',
    };
}

function whatsappRecomputeDailyNotifySummary(daily) {
    var attempts = daily.attempts || [];
    if (!attempts.length) {
        daily.attempt_count = 0;
        return;
    }

    var latest = attempts[0];
    daily.co_time = latest.co_time || '';
    daily.at_utc = latest.at_utc || '';
    daily.trigger = latest.trigger || '';
    daily.reason = latest.reason || '';
    daily.attempt_count = attempts.length;

    var best = attempts[0];
    attempts.forEach(function (att) {
        var rank = WHATSAPP_NOTIFY_STATUS_RANK[String(att.status || '').toLowerCase()] || 0;
        var bestRank = WHATSAPP_NOTIFY_STATUS_RANK[String(best.status || '').toLowerCase()] || 0;
        if (rank > bestRank) best = att;
    });
    daily.status = best.status || 'skipped';

    daily.sent = attempts.reduce(function (sum, att) {
        return sum + Number(att.sent || 0);
    }, 0);
    daily.errors = attempts.reduce(function (sum, att) {
        return sum + Number(att.errors || 0);
    }, 0);
    daily.skipped_no_phone = attempts.reduce(function (sum, att) {
        return sum + Number(att.skipped_no_phone || 0);
    }, 0);
    daily.daily_sent = attempts.reduce(function (sum, att) {
        return sum + Number(att.daily_sent || 0);
    }, 0);
    daily.daily_errors = attempts.reduce(function (sum, att) {
        return sum + Number(att.daily_errors || 0);
    }, 0);
}

function normalizeWhatsAppNotifyDailyLog(log) {
    if (!Array.isArray(log) || !log.length) return [];

    var byDate = {};
    log.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var coDate = String(item.co_date || '').trim();
        if (!coDate) return;

        if (!byDate[coDate]) {
            byDate[coDate] = { co_date: coDate, attempts: [] };
        }
        var daily = byDate[coDate];
        var attempts = item.attempts;

        if (Array.isArray(attempts)) {
            if (attempts.length) {
                attempts.forEach(function (att) {
                    if (att && typeof att === 'object') daily.attempts.push(att);
                });
            } else if (item.co_time || item.at_utc || item.status) {
                daily.attempts.push(whatsappAttemptFromFlat(item));
            }
        } else {
            daily.attempts.push(whatsappAttemptFromFlat(item));
        }
    });

    return Object.keys(byDate)
        .sort(function (a, b) {
            return b.localeCompare(a);
        })
        .map(function (coDate) {
            var daily = byDate[coDate];
            daily.attempts.sort(function (a, b) {
                var aKey = String(a.at_utc || '') + String(a.co_time || '');
                var bKey = String(b.at_utc || '') + String(b.co_time || '');
                return bKey.localeCompare(aKey);
            });
            whatsappRecomputeDailyNotifySummary(daily);
            return daily;
        });
}

function formatWhatsAppColombiaDateTime12(coDate, coTime, atUtc) {
    var parts = formatWhatsAppColombiaDateParts(coDate, coTime, atUtc);
    if (!parts) return '—';
    return parts.dateLine + ', ' + parts.timeLine;
}

function formatWhatsAppColombiaDateParts(coDate, coTime, atUtc) {
    var dt = null;
    if (atUtc) {
        try {
            var fromUtc = new Date(atUtc);
            if (!isNaN(fromUtc.getTime())) {
                dt = fromUtc;
            }
        } catch (_e) {
            /* fallback abajo */
        }
    }
    if (!dt && coDate) {
        var timePart = coTime || '00:00:00';
        if (String(timePart).length === 5) {
            timePart = timePart + ':00';
        }
        try {
            var iso = coDate + 'T' + timePart + '-05:00';
            var parsed = new Date(iso);
            if (!isNaN(parsed.getTime())) {
                dt = parsed;
            }
        } catch (_e2) {
            /* fallback abajo */
        }
    }
    if (!dt) {
        if (!coDate) return null;
        return {
            dateLine: String(coDate),
            timeLine: String(coTime || '').trim() || '—',
        };
    }
    return {
        dateLine: dt.toLocaleDateString('es-CO', {
            timeZone: 'America/Bogota',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }),
        timeLine: dt.toLocaleTimeString('es-CO', {
            timeZone: 'America/Bogota',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }),
    };
}

function renderWhatsAppNotifyRunLog(config) {
    var wrap = document.getElementById('whatsapp-notify-run-log-container');
    if (!wrap) return;
    var log = normalizeWhatsAppNotifyDailyLog((config && config.notify_run_log) || []);
    whatsappNotifyDailyLogCache = log;
    if (!log.length) {
        wrap.innerHTML = '<div class="text-muted small text-center">Sin ejecuciones registradas aún.</div>';
        return;
    }
    wrap.innerHTML =
        '<div class="table-responsive whatsapp-notify-run-log-table">' +
        '<table class="table table-sm table-striped mb-0">' +
        '<thead><tr>' +
        '<th>Fecha y hora (CO)</th><th>Estado</th><th>Resúmenes</th><th>Errores</th><th>Intentos</th><th>Detalle</th>' +
        '</tr></thead><tbody>' +
        log
            .map(function (row, idx) {
                var attemptCount = row.attempt_count != null ? row.attempt_count : (row.attempts || []).length;
                return (
                    '<tr>' +
                    '<td class="whatsapp-notify-datetime-cell">' +
                    formatWhatsAppColombiaDateTime12(row.co_date, row.co_time, row.at_utc) +
                    '</td>' +
                    '<td class="' +
                    whatsappNotifyStatusClass(row.status) +
                    ' fw-bold">' +
                    whatsappNotifyStatusLabel(row.status, row) +
                    '</td>' +
                    '<td>' +
                    (row.daily_sent != null ? row.daily_sent : '0') +
                    '</td>' +
                    '<td>' +
                    (row.errors != null ? row.errors : '0') +
                    '</td>' +
                    '<td>' +
                    attemptCount +
                    '</td>' +
                    '<td class="text-center">' +
                    '<button type="button" class="btn-panel btn-blue whatsapp-notify-day-detail-btn" data-day-index="' +
                    idx +
                    '" title="Ver intentos del día" aria-label="Ver intentos del ' +
                    (row.co_date || 'día') +
                    '">' +
                    '<i class="fas fa-list-ul" aria-hidden="true"></i>' +
                    '</button>' +
                    '</td>' +
                    '</tr>'
                );
            })
            .join('') +
        '</tbody></table></div>';

    wrap.querySelectorAll('.whatsapp-notify-day-detail-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var idx = parseInt(btn.getAttribute('data-day-index'), 10);
            showWhatsAppNotifyAttemptsModal(idx, btn);
        });
    });
}

function closeWhatsAppNotifyAttemptsModal() {
    var modal = document.getElementById('whatsapp-notify-attempts-modal');
    if (!modal) return;
    var trigger =
        whatsappNotifyAttemptsModalTrigger && typeof whatsappNotifyAttemptsModalTrigger.focus === 'function'
            ? whatsappNotifyAttemptsModalTrigger
            : null;
    modal.classList.add('d-none');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    whatsappNotifyAttemptsModalTrigger = null;
    if (trigger && typeof trigger.focus === 'function') {
        trigger.focus({ preventScroll: true });
    }
}

function openWhatsAppNotifyAttemptsModal(triggerEl) {
    var modal = document.getElementById('whatsapp-notify-attempts-modal');
    if (!modal) return;
    whatsappNotifyAttemptsModalTrigger = triggerEl || document.activeElement;
    modal.classList.remove('d-none');
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    var closeBtn = document.getElementById('whatsapp-notify-attempts-close-btn');
    if (closeBtn) {
        closeBtn.focus();
    } else {
        modal.focus();
    }
}

function showWhatsAppNotifyAttemptsModal(dayIndex, triggerEl) {
    var modal = document.getElementById('whatsapp-notify-attempts-modal');
    var titleDate = document.getElementById('whatsapp-notify-attempts-modal-date');
    var body = document.getElementById('whatsapp-notify-attempts-modal-body');
    if (!modal || !body) return;

    var day = whatsappNotifyDailyLogCache[dayIndex];
    if (!day) return;

    var attempts = day.attempts || [];
    if (titleDate) {
        titleDate.textContent =
            'Último intento: ' +
            formatWhatsAppColombiaDateTime12(day.co_date, day.co_time, day.at_utc);
    }

    if (!attempts.length) {
        body.innerHTML = '<div class="text-muted small text-center">Sin intentos registrados.</div>';
    } else {
        var clientDetails = collectWhatsAppDeliveryDetailsForDay(attempts, day.co_date);
        var attemptsHtml =
            '<section class="whatsapp-notify-attempts-section">' +
            '<h6 class="whatsapp-notify-attempts-section-title">Intentos registrados</h6>' +
            '<div class="table-responsive whatsapp-notify-attempts-table-wrap">' +
            '<table class="table table-sm whatsapp-notify-attempts-table mb-0">' +
            '<thead><tr>' +
            '<th>Fecha y hora (CO)</th><th>Origen</th><th>Estado</th><th>Resúmenes</th><th>Errores</th><th>Sin tel.</th><th>Motivo</th>' +
            '</tr></thead><tbody>' +
            attempts
                .map(function (att) {
                    var skipped =
                        Number(att.skipped_no_phone || 0) +
                        Number(att.daily_skipped_no_phone || att.daily_skipped || 0);
                    return (
                        '<tr>' +
                        '<td class="whatsapp-notify-datetime-cell">' +
                        formatWhatsAppColombiaDateTime12(
                            day.co_date,
                            att.co_time,
                            att.at_utc
                        ) +
                        '</td>' +
                        '<td class="whatsapp-notify-cell-text">' +
                        whatsappNotifyTriggerDisplay(att) +
                        '</td>' +
                        '<td class="' +
                        whatsappNotifyStatusClass(att.status) +
                        ' fw-bold">' +
                        whatsappNotifyStatusLabel(att.status, att) +
                        '</td>' +
                        '<td>' +
                        (att.daily_sent != null ? att.daily_sent : '0') +
                        '</td>' +
                        '<td>' +
                        (att.errors != null ? att.errors : '0') +
                        '</td>' +
                        '<td>' +
                        skipped +
                        '</td>' +
                        '<td class="whatsapp-notify-cell-text small text-muted">' +
                        whatsappHumanizeReason(att.reason || '') +
                        '</td>' +
                        '</tr>'
                    );
                })
                .join('') +
            '</tbody></table></div></section>';

        var clientsHtml = '';
        if (clientDetails.length) {
            clientsHtml =
                '<section class="whatsapp-notify-attempts-section">' +
                '<h6 class="whatsapp-notify-attempts-section-title">Detalle por cliente</h6>' +
                '<div class="table-responsive whatsapp-notify-attempts-table-wrap">' +
                '<table class="table table-sm whatsapp-notify-attempts-table mb-0">' +
                '<thead><tr>' +
                '<th>Intento</th><th>Usuario</th><th>Canal</th><th>Teléfono / ID</th><th>Tipo</th><th>Resultado</th>' +
                '</tr></thead><tbody>' +
                clientDetails
                    .map(function (row) {
                        return (
                            '<tr>' +
                            '<td class="whatsapp-notify-datetime-cell">' +
                            row.when +
                            '</td>' +
                            '<td class="whatsapp-notify-cell-text">' +
                            row.username +
                            '</td>' +
                            '<td class="whatsapp-notify-cell-text">' +
                            (row.channel || 'WhatsApp') +
                            '</td>' +
                            '<td class="whatsapp-notify-phone-cell whatsapp-notify-cell-text">' +
                            row.phone +
                            '</td>' +
                            '<td class="whatsapp-notify-cell-text">' +
                            whatsappDeliveryKindLabel(row.kind_label || row.kind) +
                            '</td>' +
                            '<td class="whatsapp-notify-cell-text ' +
                            whatsappDeliveryOutcomeClass(row.outcome) +
                            ' fw-bold small">' +
                            whatsappDeliveryResultText(row) +
                            '</td>' +
                            '</tr>'
                        );
                    })
                    .join('') +
                '</tbody></table></div></section>';
        } else {
            clientsHtml =
                '<p class="text-muted small text-center mt-3 mb-0">Sin incidencias por cliente en este día (fallos o teléfonos faltantes).</p>';
        }

        body.innerHTML = attemptsHtml + clientsHtml;
    }

    openWhatsAppNotifyAttemptsModal(triggerEl);
}

async function loadWhatsAppConfig() {
    try {
        var response = await fetch('/tienda/admin/whatsapp_configs');
        var result = await response.json();
        var config = result.configs && result.configs.length ? result.configs[0] : null;

        whatsappActiveConfigId = config ? config.id : null;
        populateWhatsAppForm(config);
        updateWhatsAppHealthBanner(config);
        renderWhatsAppNotifyRunLog(config);
        startWhatsAppHealthRealtime();
    } catch (error) {
        console.error('Error cargando WhatsApp:', error);
        whatsappActiveConfigId = null;
        populateWhatsAppForm(null);
        updateWhatsAppHealthBanner(null);
        renderWhatsAppNotifyRunLog(null);
        stopWhatsAppHealthRealtime();
        showWhatsAppStatus('Error al cargar la configuración', 'error');
    }
}

async function testWhatsAppConnectionFromForm() {
    if (!whatsappActiveConfigId) {
        showWhatsAppStatus('Guardá la configuración primero', 'error');
        return;
    }
    await refreshWhatsAppHealth(whatsappActiveConfigId, false);
}

async function refreshWhatsAppHealth(configId, silent) {
    if (!configId) return;
    if (!silent) showWhatsAppStatus('Verificando salud…', 'info');
    try {
        var response = await fetch('/tienda/admin/whatsapp_configs/' + configId + '/health', {
            method: 'POST',
            headers: { 'X-CSRFToken': whatsappCsrfToken() },
        });
        var result = await response.json();
        if (result.success) {
            if (!silent) showWhatsAppStatus(result.message, 'success');
            if (result.config) {
                updateWhatsAppHealthBanner(result.config);
                renderWhatsAppNotifyRunLog(result.config);
            } else {
                loadWhatsAppConfig();
            }
        } else if (!silent) {
            showWhatsAppStatus(result.error || 'Error', 'error');
        }
    } catch (e) {
        if (!silent) showWhatsAppStatus('Error de red', 'error');
    }
}

function openWhatsAppQrModal(triggerEl) {
    var modal = document.getElementById('whatsapp-qr-modal');
    if (!modal) return;
    whatsappQrModalTrigger = triggerEl || document.activeElement;
    modal.classList.remove('d-none');
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    var closeBtn = document.getElementById('whatsapp-qr-close-btn');
    if (closeBtn) {
        closeBtn.focus();
    } else {
        modal.focus();
    }
}

async function closeWhatsAppQrModal() {
    var modal = document.getElementById('whatsapp-qr-modal');
    if (!modal) return;
    var trigger =
        whatsappQrModalTrigger && typeof whatsappQrModalTrigger.focus === 'function'
            ? whatsappQrModalTrigger
            : document.getElementById('whatsapp-show-qr-btn');
    modal.classList.add('d-none');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    setWhatsAppQrDisconnectVisible(false);
    whatsappQrModalTrigger = null;
    if (trigger && typeof trigger.focus === 'function') {
        trigger.focus({ preventScroll: true });
    }
}

function setWhatsAppQrDisconnectVisible(visible) {
    var btn = document.getElementById('whatsapp-qr-disconnect-btn');
    if (!btn) return;
    if (visible) {
        btn.classList.remove('d-none');
        btn.hidden = false;
    } else {
        btn.classList.add('d-none');
        btn.hidden = true;
    }
}

async function disconnectWhatsAppInstance(configId) {
    var id = configId || whatsappActiveConfigId;
    if (!id) {
        showWhatsAppStatus('Guardá la configuración primero', 'error');
        return;
    }
    if (
        !window.confirm(
            '¿Desconectar WhatsApp Web de esta instancia? Tendrás que escanear el QR de nuevo para volver a enviar mensajes.'
        )
    ) {
        return;
    }

    var wrap = document.getElementById('whatsapp-qr-image-wrap');
    var disconnectBtn = document.getElementById('whatsapp-qr-disconnect-btn');
    if (disconnectBtn) disconnectBtn.disabled = true;

    showWhatsAppStatus('Desconectando…', 'info');
    try {
        var response = await fetch('/tienda/admin/whatsapp_configs/' + id + '/logout', {
            method: 'POST',
            headers: { 'X-CSRFToken': whatsappCsrfToken() },
        });
        var result = await response.json();
        if (result.success) {
            showWhatsAppStatus(result.message || 'Desconectado', 'success');
            if (result.config) {
                updateWhatsAppHealthBanner(result.config);
                renderWhatsAppNotifyRunLog(result.config);
            } else {
                loadWhatsAppConfig();
            }
            if (wrap) {
                wrap.innerHTML =
                    '<p class="text-muted small mb-0">Sesión cerrada. Cerrá y volvé a abrir el QR para vincular otra línea.</p>';
            }
            setWhatsAppQrDisconnectVisible(false);
        } else {
            showWhatsAppStatus(result.error || 'No se pudo desconectar', 'error');
        }
    } catch (e) {
        showWhatsAppStatus('Error de red', 'error');
    } finally {
        if (disconnectBtn) disconnectBtn.disabled = false;
    }
}

async function showWhatsAppQr(configId) {
    var id = configId || whatsappActiveConfigId;
    if (!id) {
        showWhatsAppStatus('Guardá la configuración primero', 'error');
        return;
    }
    var modal = document.getElementById('whatsapp-qr-modal');
    var wrap = document.getElementById('whatsapp-qr-image-wrap');
    if (!modal || !wrap) return;

    wrap.innerHTML = '<p class="text-muted">Generando QR… puede tardar unos segundos.</p>';
    setWhatsAppQrDisconnectVisible(false);
    openWhatsAppQrModal(document.getElementById('whatsapp-show-qr-btn'));

    try {
        var response = await fetch('/tienda/admin/whatsapp_configs/' + id + '/qr');
        var result = await response.json();
        if (result.success && result.qr_base64) {
            wrap.innerHTML =
                '<img src="' +
                result.qr_base64 +
                '" alt="QR WhatsApp Web" class="whatsapp-qr-image" width="280" height="280" />';
            setWhatsAppQrDisconnectVisible(true);
        } else {
            wrap.innerHTML =
                '<p class="text-danger">' +
                (result.error || 'QR no disponible. Guardá con WhatsApp activo e intentá de nuevo.') +
                '</p>';
            if (whatsappActiveConfigId) {
                try {
                    var healthResp = await fetch(
                        '/tienda/admin/whatsapp_configs/' + id + '/health',
                        {
                            method: 'POST',
                            headers: { 'X-CSRFToken': whatsappCsrfToken() },
                        }
                    );
                    var healthResult = await healthResp.json();
                    if (
                        healthResult.success &&
                        healthResult.config &&
                        String(healthResult.config.connection_status || '').toLowerCase() === 'connected'
                    ) {
                        wrap.innerHTML =
                            '<p class="text-success small mb-0">WhatsApp ya está conectado. Podés desconectar para cambiar de línea.</p>';
                        setWhatsAppQrDisconnectVisible(true);
                        updateWhatsAppHealthBanner(healthResult.config);
                    }
                } catch (_healthErr) {
                    /* ignore */
                }
            }
        }
    } catch (e) {
        wrap.innerHTML = '<p class="text-danger">Error al cargar QR</p>';
    }
}

function isWhatsAppUsageEnabled() {
    var enabledInp = document.getElementById('whatsapp-enabled');
    return !enabledInp || !!enabledInp.checked;
}

async function sendWhatsAppTestMessage(configId) {
    var id = configId || whatsappActiveConfigId;
    if (!id) {
        showWhatsAppStatus('Guardá la configuración primero', 'error');
        return;
    }
    var sendBtn = document.getElementById('whatsapp-send-test-btn');
    if (sendBtn && sendBtn.disabled) return;
    var numInp = document.getElementById('whatsapp-phone-number');
    var toNum = numInp ? String(numInp.value || '').trim() : '';
    if (!toNum) {
        showWhatsAppStatus('Indicá un número para la prueba', 'error');
        return;
    }
    if (sendBtn) sendBtn.disabled = true;
    showWhatsAppStatus('Enviando prueba de mensaje…', 'info');
    setPruebasModalStatus('Enviando prueba de mensaje…', true);
    try {
        var response = await fetch('/tienda/admin/whatsapp_configs/' + id + '/send-test', {
            method: 'POST',
            headers: {
                'X-CSRFToken': whatsappCsrfToken(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ to_number: toNum }),
        });
        var result = await response.json();
        if (result.success) {
            showWhatsAppStatus(result.message, 'success');
            setPruebasModalStatus(result.message, true);
            if (numInp) numInp.value = '';
        } else {
            showWhatsAppStatus(result.error || 'Envío fallido', 'error');
            setPruebasModalStatus(result.error || 'Envío fallido', false);
        }
    } catch (e) {
        showWhatsAppStatus('Error de red', 'error');
        setPruebasModalStatus('Error de red', false);
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

async function runWhatsAppLicenseNotify(configId) {
    var id = configId || whatsappActiveConfigId;
    if (!id) {
        showWhatsAppStatus('Guardá la configuración primero', 'error');
        return;
    }
    if (!isWhatsAppUsageEnabled()) {
        showWhatsAppStatus(
            'WhatsApp está desactivado. Activá el uso de WhatsApp y guardá para enviar resúmenes.',
            'error'
        );
        return;
    }
    if (
        !window.confirm(
            '¿Enviar resúmenes de ventas y renovaciones pendientes ahora? (ignora la hora programada)'
        )
    ) {
        return;
    }
    showWhatsAppStatus('Enviando resúmenes…', 'info');
    try {
        var response = await fetch('/tienda/admin/whatsapp_configs/' + id + '/run-notify', {
            method: 'POST',
            headers: { 'X-CSRFToken': whatsappCsrfToken() },
        });
        var result = await response.json();
        if (result.success) {
            showWhatsAppStatus(result.message || 'Listo', 'success');
            loadWhatsAppConfig();
        } else {
            showWhatsAppStatus(result.error || 'No se pudo enviar los resúmenes', 'error');
        }
    } catch (e) {
        showWhatsAppStatus('Error de red', 'error');
    }
}

function whatsappHealthStreamUrl(configId) {
    return WHATSAPP_HEALTH_SSE_URL_TEMPLATE.replace('__ID__', String(configId || ''));
}

function onWhatsAppHealthSseMessage(data) {
    if (!data || data.type !== 'whatsapp_health' || !data.config) return;
    updateWhatsAppHealthBanner(data.config);
    renderWhatsAppNotifyRunLog(data.config);
}

function stopWhatsAppHealthRealtime() {
    if (whatsappHealthSseHandle) {
        whatsappHealthSseHandle.close();
        whatsappHealthSseHandle = null;
    }
    if (whatsappHealthPollTimer) {
        clearInterval(whatsappHealthPollTimer);
        whatsappHealthPollTimer = null;
    }
}

function startWhatsAppHealthPollFallback() {
    if (whatsappHealthPollTimer || !whatsappActiveConfigId) return;
    whatsappHealthPollTimer = setInterval(function () {
        if (whatsappActiveConfigId && document.visibilityState === 'visible') {
            refreshWhatsAppHealth(whatsappActiveConfigId, true);
        }
    }, WHATSAPP_HEALTH_FALLBACK_POLL_MS);
}

function startWhatsAppHealthRealtime() {
    if (!whatsappActiveConfigId || document.visibilityState !== 'visible') {
        stopWhatsAppHealthRealtime();
        return;
    }
    stopWhatsAppHealthRealtime();
    var streamUrl = whatsappHealthStreamUrl(whatsappActiveConfigId);
    if (typeof window.StoreSseRealtime !== 'undefined' && typeof window.StoreSseRealtime.connectOrFallback === 'function') {
        whatsappHealthSseHandle = window.StoreSseRealtime.connectOrFallback(
            streamUrl,
            onWhatsAppHealthSseMessage,
            startWhatsAppHealthPollFallback
        );
    } else {
        startWhatsAppHealthPollFallback();
    }
}

var whatsappInfoTogglePairs = [];

function bindWhatsAppInfoToggle(infoBtn, infoBox) {
    if (!infoBtn || !infoBox) return;
    whatsappInfoTogglePairs.push({ btn: infoBtn, box: infoBox });
    infoBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = infoBox.hidden;
        whatsappInfoTogglePairs.forEach(function (pair) {
            if (pair.box !== infoBox) {
                pair.box.hidden = true;
                pair.btn.setAttribute('aria-expanded', 'false');
            }
        });
        infoBox.hidden = !open;
        infoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
}

var whatsappUserNotifyPageState = {
    currentPage: 1,
    perPage: 999999,
    wired: false,
};

function whatsappUserNotifySearchKey(user) {
    return [
        user && user.username,
        user && user.full_name,
        user && user.phone,
    ]
        .map(function (v) {
            return String(v || '')
                .trim()
                .toLowerCase();
        })
        .join(' ');
}

function whatsappUserNotifyGetRows() {
    var tbody = document.getElementById('whatsapp-user-notify-table-body');
    if (!tbody) return [];
    return Array.prototype.slice.call(tbody.querySelectorAll('tr[data-search]'));
}

function whatsappUserNotifyGetFilteredRows() {
    return whatsappUserNotifyGetRows().filter(function (row) {
        return !row.classList.contains('filtered-out');
    });
}

function whatsappUserNotifyRenderPage() {
    var showSelect = document.getElementById('whatsappUserNotifyShowCount');
    var prevBtn = document.getElementById('whatsappUserNotifyPrevBtn');
    var nextBtn = document.getElementById('whatsappUserNotifyNextBtn');
    var allRows = whatsappUserNotifyGetRows();
    var filteredRows = whatsappUserNotifyGetFilteredRows();
    var showAll = showSelect && showSelect.value === 'all';
    var perPage =
        showSelect && showSelect.value === 'all'
            ? filteredRows.length || 1
            : parseInt(showSelect && showSelect.value, 10) || whatsappUserNotifyPageState.perPage;
    var totalPages = showAll ? 1 : Math.max(1, Math.ceil(filteredRows.length / perPage) || 1);
    if (whatsappUserNotifyPageState.currentPage > totalPages) {
        whatsappUserNotifyPageState.currentPage = totalPages;
    }
    var start = showAll ? 0 : (whatsappUserNotifyPageState.currentPage - 1) * perPage;
    var end = showAll ? filteredRows.length : start + perPage;

    filteredRows.forEach(function (row, i) {
        if (showAll || (i >= start && i < end)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    allRows.forEach(function (row) {
        if (row.classList.contains('filtered-out')) {
            row.style.display = 'none';
        }
    });

    if (prevBtn) prevBtn.disabled = whatsappUserNotifyPageState.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = whatsappUserNotifyPageState.currentPage >= totalPages;
}

function whatsappUserNotifyFilterRows() {
    var searchInput = document.getElementById('whatsappUserNotifySearch');
    var searchTerm = searchInput ? String(searchInput.value || '').trim().toLowerCase() : '';
    whatsappUserNotifyGetRows().forEach(function (row) {
        var key = row.getAttribute('data-search') || '';
        if (!searchTerm || key.indexOf(searchTerm) !== -1) {
            row.classList.remove('filtered-out');
        } else {
            row.classList.add('filtered-out');
        }
    });
    whatsappUserNotifyPageState.currentPage = 1;
    whatsappUserNotifyRenderPage();
}

function setupWhatsAppUserNotifyTableControls() {
    if (whatsappUserNotifyPageState.wired) return;
    var showSelect = document.getElementById('whatsappUserNotifyShowCount');
    var prevBtn = document.getElementById('whatsappUserNotifyPrevBtn');
    var nextBtn = document.getElementById('whatsappUserNotifyNextBtn');
    var searchInput = document.getElementById('whatsappUserNotifySearch');
    if (!showSelect || !prevBtn || !nextBtn || !searchInput) return;

    whatsappUserNotifyPageState.wired = true;
    whatsappUserNotifyPageState.perPage = parseInt(showSelect.value, 10) || 20;

    showSelect.addEventListener('change', function () {
        whatsappUserNotifyPageState.perPage =
            showSelect.value === 'all' ? whatsappUserNotifyGetFilteredRows().length || 1 : parseInt(showSelect.value, 10);
        whatsappUserNotifyPageState.currentPage = 1;
        whatsappUserNotifyRenderPage();
    });
    prevBtn.addEventListener('click', function () {
        if (whatsappUserNotifyPageState.currentPage > 1) {
            whatsappUserNotifyPageState.currentPage -= 1;
            whatsappUserNotifyRenderPage();
        }
    });
    nextBtn.addEventListener('click', function () {
        var showAll = showSelect.value === 'all';
        var perPage = showAll
            ? whatsappUserNotifyGetFilteredRows().length || 1
            : parseInt(showSelect.value, 10) || whatsappUserNotifyPageState.perPage;
        var totalPages = showAll
            ? 1
            : Math.max(1, Math.ceil(whatsappUserNotifyGetFilteredRows().length / perPage) || 1);
        if (whatsappUserNotifyPageState.currentPage < totalPages) {
            whatsappUserNotifyPageState.currentPage += 1;
            whatsappUserNotifyRenderPage();
        }
    });
    searchInput.addEventListener('input', whatsappUserNotifyFilterRows);
    searchInput.addEventListener('search', function () {
        if (this.value === '') {
            whatsappUserNotifyFilterRows();
        }
    });
}

function whatsappEscapeHtmlAttr(value) {
    return String(value != null ? value : '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function whatsappUserNotifyUpdateRowSearch(row) {
    if (!row) return;
    var userCell = row.querySelector('td:first-child');
    var phoneEl = row.querySelector('.whatsapp-user-notify-phone-text');
    var username = userCell ? String(userCell.textContent || '').trim() : '';
    var phone = phoneEl ? String(phoneEl.getAttribute('data-phone') || '').trim() : '';
    row.setAttribute(
        'data-search',
        [username, phone]
            .map(function (v) {
                return String(v || '').toLowerCase();
            })
            .join(' ')
    );
}

function whatsappUserPhoneUpdateRowDisplay(rowEl, phone) {
    if (!rowEl) return;
    var span = rowEl.querySelector('.whatsapp-user-notify-phone-text');
    var btn = rowEl.querySelector('.whatsapp-user-notify-phone-edit-btn');
    var saved = String(phone || '').trim();
    if (span) {
        span.textContent = saved || '—';
        span.setAttribute('data-phone', saved);
        span.classList.toggle('text-muted', !saved);
    }
    if (btn) {
        btn.setAttribute('data-phone', saved);
    }
    whatsappUserNotifyUpdateRowSearch(rowEl);
}

function closeWhatsAppUserPhoneModal() {
    var modal = document.getElementById('whatsapp-user-phone-modal');
    if (!modal) return;
    var trigger =
        whatsappUserPhoneModalTrigger && typeof whatsappUserPhoneModalTrigger.focus === 'function'
            ? whatsappUserPhoneModalTrigger
            : null;
    modal.classList.add('d-none');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    whatsappUserPhoneModalTrigger = null;
    whatsappUserPhoneModalContext = null;
    if (trigger) {
        trigger.focus({ preventScroll: true });
    }
}

function setTelegramUserLinkState(state, message) {
    var btn = document.getElementById('telegram-user-link-btn');
    var status = document.getElementById('telegram-user-link-status');
    if (btn) {
        btn.classList.remove(
            'telegram-link-icon--idle',
            'telegram-link-icon--ok',
            'telegram-link-icon--bad',
            'telegram-link-icon--busy'
        );
        var cls = 'telegram-link-icon--idle';
        if (state === 'ok') cls = 'telegram-link-icon--ok';
        else if (state === 'bad') cls = 'telegram-link-icon--bad';
        else if (state === 'busy') cls = 'telegram-link-icon--busy';
        btn.classList.add(cls);
        btn.disabled = state === 'busy';
    }
    if (status) {
        status.textContent = message || '';
        status.classList.remove('telegram-user-link-status--ok', 'telegram-user-link-status--bad');
        if (message && state === 'ok') status.classList.add('telegram-user-link-status--ok');
        if (message && state === 'bad') status.classList.add('telegram-user-link-status--bad');
    }
}

function setPruebasModalStatus(message, ok) {
    var status = document.getElementById('telegram-prueba-status');
    if (!status) return;
    status.textContent = message || '';
    status.className = 'telegram-user-link-status';
    if (!message) return;
    status.classList.add(ok ? 'telegram-user-link-status--ok' : 'telegram-user-link-status--bad');
}

async function sendTelegramTestMessage() {
    var input = document.getElementById('telegram-test-number');
    var chatId = input ? String(input.value || '').trim() : '';
    setPruebasModalStatus('Enviando prueba de mensaje…', true);
    try {
        var response = await fetch('/tienda/admin/telegram_bot/test', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': whatsappCsrfToken(),
            },
            body: JSON.stringify({ chat_id: chatId }),
        });
        var data = await response.json();
        var message = (data && (data.message || data.error)) || 'No se pudo consultar Telegram.';
        var ok = !!(data && data.connected);
        setPruebasModalStatus(message, ok);
        showWhatsAppStatus(message, ok ? 'success' : 'error');
    } catch (error) {
        setPruebasModalStatus('No se pudo consultar Telegram.', false);
        showWhatsAppStatus('No se pudo consultar Telegram.', 'error');
    }
}

async function checkTelegramUserLink() {
    var input = document.getElementById('whatsapp-user-telegram-modal-input');
    var chatId = input ? String(input.value || '').trim() : '';
    setTelegramUserLinkState('busy', 'Comprobando…');
    try {
        var response = await fetch('/tienda/admin/telegram_bot/probe', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': whatsappCsrfToken(),
            },
            body: JSON.stringify({ chat_id: chatId }),
        });
        var data = await response.json();
        var message = (data && (data.message || data.error)) || 'No se pudo consultar Telegram.';
        setTelegramUserLinkState(data && data.connected ? 'ok' : 'bad', message);
    } catch (error) {
        setTelegramUserLinkState('bad', 'No se pudo consultar Telegram.');
    }
}

function openWhatsAppUserPhoneModal(userId, username, currentPhone, telegramId, rowEl, triggerEl) {
    var modal = document.getElementById('whatsapp-user-phone-modal');
    var title = document.getElementById('whatsappUserPhoneModalTitle');
    var input = document.getElementById('whatsapp-user-phone-modal-input');
    if (!modal || !input || !userId) return;

    whatsappUserPhoneModalTrigger = triggerEl || document.activeElement;
    whatsappUserPhoneModalContext = {
        userId: userId,
        rowEl: rowEl,
        prevPhone: String(currentPhone || '').trim(),
        prevTelegram: String(telegramId || '').trim(),
    };
    if (title) {
        title.textContent = username ? 'Editar teléfono/usuario ' + username : 'Editar teléfono';
    }
    input.value = whatsappUserPhoneModalContext.prevPhone;
    var telegramInput = document.getElementById('whatsapp-user-telegram-modal-input');
    if (telegramInput) telegramInput.value = whatsappUserPhoneModalContext.prevTelegram;
    modal.classList.remove('d-none');
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (whatsappUserPhoneModalContext.prevTelegram) {
        checkTelegramUserLink();
    } else {
        setTelegramUserLinkState('idle', '');
    }
    input.focus();
    input.select();
}

function saveWhatsAppUserPhoneFromModal() {
    var ctx = whatsappUserPhoneModalContext;
    var input = document.getElementById('whatsapp-user-phone-modal-input');
    var saveBtn = document.getElementById('whatsapp-user-phone-modal-save-btn');
    if (!ctx || !input) return;

    var telegramInput = document.getElementById('whatsapp-user-telegram-modal-input');
    var next = String(input.value || '').trim();
    var nextTelegram = telegramInput ? String(telegramInput.value || '').trim() : '';
    if (next === ctx.prevPhone && nextTelegram === String(ctx.prevTelegram || '')) {
        closeWhatsAppUserPhoneModal();
        return;
    }
    if (saveBtn && saveBtn.dataset.saving === '1') return;

    if (saveBtn) {
        saveBtn.dataset.saving = '1';
        saveBtn.disabled = true;
    }
    input.disabled = true;

    fetch('/tienda/admin/whatsapp/user-notify-prefs/' + encodeURIComponent(ctx.userId) + '/phone', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': whatsappCsrfToken(),
        },
        body: JSON.stringify({ phone: next, telegram_chat_id: nextTelegram }),
    })
        .then(function (resp) {
            return resp.json();
        })
        .then(function (data) {
            if (!data || !data.success) {
                showWhatsAppStatus(
                    (data && data.error) || 'No se pudo guardar el teléfono.',
                    'error'
                );
                return;
            }
            var saved = data.phone != null ? String(data.phone) : next;
            var savedTelegram = data.telegram_chat_id != null ? String(data.telegram_chat_id) : nextTelegram;
            whatsappUserPhoneUpdateRowDisplay(ctx.rowEl, saved);
            if (whatsappUserPhoneModalTrigger) {
                whatsappUserPhoneModalTrigger.setAttribute('data-phone', saved);
                whatsappUserPhoneModalTrigger.setAttribute('data-telegram', savedTelegram);
            }
            showWhatsAppStatus('Teléfono e ID guardados.', 'success');
            closeWhatsAppUserPhoneModal();
        })
        .catch(function () {
            showWhatsAppStatus('Error de red al guardar teléfono.', 'error');
        })
        .finally(function () {
            input.disabled = false;
            if (saveBtn) {
                delete saveBtn.dataset.saving;
                saveBtn.disabled = false;
            }
        });
}

function wireWhatsAppUserNotifyPhoneEditButtons(root) {
    var scope = root || document;
    scope.querySelectorAll('.whatsapp-user-notify-phone-edit-btn').forEach(function (btn) {
        if (btn.dataset.phoneWired === '1') return;
        btn.dataset.phoneWired = '1';
        btn.addEventListener('click', function () {
            var row = btn.closest('tr');
            var userId = btn.getAttribute('data-user-id');
            if (!userId) return;
            var username = '';
            if (row) {
                var userCell = row.querySelector('td:first-child');
                username = userCell ? String(userCell.textContent || '').trim() : '';
            }
            var phone = btn.getAttribute('data-phone') || '';
            var telegramId = btn.getAttribute('data-telegram') || '';
            openWhatsAppUserPhoneModal(userId, username, phone, telegramId, row, btn);
        });
    });
}

function setupWhatsAppUserPhoneModal() {
    if (setupWhatsAppUserPhoneModal._wired) return;
    setupWhatsAppUserPhoneModal._wired = true;

    var modal = document.getElementById('whatsapp-user-phone-modal');
    var saveBtn = document.getElementById('whatsapp-user-phone-modal-save-btn');
    var input = document.getElementById('whatsapp-user-phone-modal-input');
    var telegramInput = document.getElementById('whatsapp-user-telegram-modal-input');

    if (saveBtn) {
        saveBtn.addEventListener('click', saveWhatsAppUserPhoneFromModal);
    }
    function onPhoneModalKeydown(ev) {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            saveWhatsAppUserPhoneFromModal();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeWhatsAppUserPhoneModal();
        }
    }
    if (input) input.addEventListener('keydown', onPhoneModalKeydown);
    if (telegramInput) {
        telegramInput.addEventListener('keydown', onPhoneModalKeydown);
        telegramInput.addEventListener('input', function () {
            setTelegramUserLinkState('idle', '');
        });
    }
    var telegramLinkBtn = document.getElementById('telegram-user-link-btn');
    if (telegramLinkBtn) {
        telegramLinkBtn.addEventListener('click', function () {
            checkTelegramUserLink();
        });
    }
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeWhatsAppUserPhoneModal();
        });
    }
}

function loadWhatsAppUserNotifyPrefs() {
    var tbody = document.getElementById('whatsapp-user-notify-table-body');
    if (!tbody) return Promise.resolve();
    setupWhatsAppUserNotifyTableControls();
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Cargando usuarios…</td></tr>';
    return fetch('/tienda/admin/whatsapp/user-notify-prefs', {
        credentials: 'same-origin',
        headers: { 'X-CSRFToken': whatsappCsrfToken() },
    })
        .then(function (resp) {
            return resp.json();
        })
        .then(function (data) {
            if (!data || !data.success) {
                tbody.innerHTML =
                    '<tr><td colspan="4" class="text-center text-danger">' +
                    (data && data.error ? data.error : 'No se pudo cargar usuarios.') +
                    '</td></tr>';
                return;
            }
            renderWhatsAppUserNotifyTable(data.users || []);
        })
        .catch(function () {
            tbody.innerHTML =
                '<tr><td colspan="4" class="text-center text-danger">Error de red al cargar usuarios.</td></tr>';
        });
}

function renderWhatsAppUserNotifyTable(users) {
    var tbody = document.getElementById('whatsapp-user-notify-table-body');
    var prevBtn = document.getElementById('whatsappUserNotifyPrevBtn');
    var nextBtn = document.getElementById('whatsappUserNotifyNextBtn');
    if (!tbody) return;
    if (!users || !users.length) {
        tbody.innerHTML =
            '<tr><td colspan="4" class="text-center text-muted">No hay usuarios principales para configurar.</td></tr>';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }
    tbody.innerHTML = users
        .map(function (u) {
            var checked = u.whatsapp_notify_enabled !== false ? ' checked' : '';
            var phoneRaw = String(u.phone || '').trim();
            var phoneVal = whatsappEscapeHtmlAttr(phoneRaw);
            var phoneDisplay = phoneRaw ? phoneVal : '—';
            var phoneMutedClass = phoneRaw ? '' : ' text-muted';
            var usernameLabel = whatsappEscapeHtmlAttr(u.username || 'usuario');
            var searchKey = whatsappUserNotifySearchKey(u);
            return (
                '<tr data-user-id="' +
                u.id +
                '" data-search="' +
                searchKey.replace(/"/g, '&quot;') +
                '">' +
                '<td>' +
                (u.username || '—') +
                '</td>' +
                '<td class="whatsapp-notify-phone-cell">' +
                '<div class="whatsapp-user-notify-phone-row">' +
                '<span class="whatsapp-user-notify-phone-text' +
                phoneMutedClass +
                '" data-phone="' +
                phoneVal +
                '">' +
                phoneDisplay +
                '</span>' +
                '<button type="button" class="whatsapp-user-notify-phone-edit-btn"' +
                ' data-user-id="' +
                u.id +
                '" data-phone="' +
                phoneVal +
                '" data-telegram="' +
                whatsappEscapeHtmlAttr(String(u.telegram_chat_id || '').trim()) +
                '" title="Editar teléfono"' +
                ' aria-label="Editar teléfono de ' +
                usernameLabel +
                '">' +
                '<i class="fas fa-pen" aria-hidden="true"></i>' +
                '</button>' +
                '</div>' +
                '</td>' +
                '<td class="text-center whatsapp-user-notify-check-cell">' +
                '<input type="checkbox" class="form-check-input whatsapp-user-notify-checkbox"' +
                ' id="whatsapp-notify-user-' +
                u.id +
                '"' +
                ' data-user-id="' +
                u.id +
                '"' +
                checked +
                ' aria-label="Enviar WhatsApp a ' +
                (u.username || 'usuario') +
                '">' +
                '</td>' +
                '<td class="text-center whatsapp-user-notify-check-cell">' +
                '<input type="checkbox" class="form-check-input whatsapp-user-notify-telegram-checkbox"' +
                ' id="telegram-notify-user-' +
                u.id +
                '"' +
                ' data-user-id="' +
                u.id +
                '"' +
                ' aria-label="Telegram de ' +
                (u.username || 'usuario') +
                '"' +
                (u.telegram_notify_enabled ? ' checked' : '') +
                '>' +
                '</td>' +
                '</tr>'
            );
        })
        .join('');

    tbody.querySelectorAll('.whatsapp-user-notify-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
            saveWhatsAppUserNotifyPref(cb, 'whatsapp');
        });
    });
    tbody.querySelectorAll('.whatsapp-user-notify-telegram-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
            saveWhatsAppUserNotifyPref(cb, 'telegram');
        });
    });
    wireWhatsAppUserNotifyPhoneEditButtons(tbody);

    whatsappUserNotifyPageState.currentPage = 1;
    whatsappUserNotifyFilterRows();
}

function saveWhatsAppUserNotifyPref(checkbox, channel) {
    if (!checkbox) return;
    var userId = checkbox.getAttribute('data-user-id');
    if (!userId) return;
    var enabled = !!checkbox.checked;
    var payload = channel === 'telegram'
        ? { telegram_notify_enabled: enabled }
        : { enabled: enabled };
    checkbox.disabled = true;
    fetch('/tienda/admin/whatsapp/user-notify-prefs/' + encodeURIComponent(userId), {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': whatsappCsrfToken(),
        },
        body: JSON.stringify(payload),
    })
        .then(function (resp) {
            return resp.json();
        })
        .then(function (data) {
            if (!data || !data.success) {
                checkbox.checked = !enabled;
                showWhatsAppStatus(
                    (data && data.error) || 'No se pudo guardar la preferencia.',
                    'error'
                );
                return;
            }
            showWhatsAppStatus('Preferencia guardada.', 'success');
        })
        .catch(function () {
            checkbox.checked = !enabled;
            showWhatsAppStatus('Error de red al guardar.', 'error');
        })
        .finally(function () {
            checkbox.disabled = false;
        });
}

function setupWhatsAppInfoToggle() {
    whatsappInfoTogglePairs = [];
    bindWhatsAppInfoToggle(
        document.getElementById('whatsappWebInfoBtn'),
        document.getElementById('whatsappWebInfoBox')
    );
    bindWhatsAppInfoToggle(
        document.getElementById('whatsappUserNotifyInfoBtn'),
        document.getElementById('whatsappUserNotifyInfoBox')
    );
    bindWhatsAppInfoToggle(
        document.getElementById('whatsappPhoneHintBtn'),
        document.getElementById('whatsappPhoneHintBox')
    );
    bindWhatsAppInfoToggle(
        document.getElementById('telegramLinkHintBtn'),
        document.getElementById('telegramLinkHintBox')
    );
    bindWhatsAppInfoToggle(
        document.getElementById('telegramGroupExtractInfoBtn'),
        document.getElementById('telegramGroupExtractInfoBox')
    );

    document.addEventListener('click', function (e) {
        whatsappInfoTogglePairs.forEach(function (pair) {
            if (pair.box.hidden) return;
            if (pair.btn.contains(e.target) || pair.box.contains(e.target)) return;
            pair.box.hidden = true;
            pair.btn.setAttribute('aria-expanded', 'false');
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    var whatsappForm = document.getElementById('whatsapp-config-form');
    if (!whatsappForm) return;

    var telegramEnabledBox = document.getElementById('telegram-enabled');
    if (telegramEnabledBox) {
        telegramEnabledBox.addEventListener('change', async function () {
            try {
                var tgResponse = await fetch('/tienda/admin/telegram_bot/enabled', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': whatsappCsrfToken(),
                    },
                    body: JSON.stringify({ enabled: !!telegramEnabledBox.checked }),
                });
                var tgResult = await tgResponse.json();
                if (!tgResult.success) {
                    telegramEnabledBox.checked = !telegramEnabledBox.checked;
                    showWhatsAppStatus(tgResult.error || 'No se pudo guardar Activar Telegram', 'error');
                }
            } catch (err) {
                telegramEnabledBox.checked = !telegramEnabledBox.checked;
                showWhatsAppStatus('No se pudo guardar Activar Telegram', 'error');
            }
        });
    }

    whatsappForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var fd = new FormData(whatsappForm);
        fd.append('whatsapp_enabled', document.getElementById('whatsapp-enabled').checked ? 'on' : 'off');
        try {
            showWhatsAppStatus('Guardando…', 'info');
            var response = await fetch('/tienda/admin/whatsapp_configs', {
                method: 'POST',
                headers: { 'X-CSRFToken': whatsappCsrfToken() },
                body: fd,
            });
            var result = await response.json();
            var tgBox = document.getElementById('telegram-enabled');
            var tgResponse = await fetch('/tienda/admin/telegram_bot/enabled', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': whatsappCsrfToken(),
                },
                body: JSON.stringify({ enabled: !!(tgBox && tgBox.checked) }),
            });
            var tgResult = await tgResponse.json();
            if (result.success) {
                var msg = result.message || 'Guardado.';
                if (!tgResult.success) msg += ' No se pudo guardar Activar Telegram.';
                showWhatsAppStatus(msg, tgResult.success ? 'success' : 'error');
                if (result.id) whatsappActiveConfigId = result.id;
                loadWhatsAppConfig();
                loadTelegramBot();
            } else {
                showWhatsAppStatus(result.error || 'Error', 'error');
            }
        } catch (err) {
            showWhatsAppStatus('Error de red', 'error');
        }
    });

    var pruebasOpen = document.getElementById('whatsapp-pruebas-open-btn');
    var pruebasModal = document.getElementById('whatsapp-pruebas-modal');
    var pruebasClose = document.getElementById('whatsapp-pruebas-close-btn');
    function closeWhatsAppPruebasModal() {
        if (!pruebasModal) return;
        pruebasModal.classList.add('d-none');
        pruebasModal.setAttribute('hidden', '');
        pruebasModal.setAttribute('aria-hidden', 'true');
        if (pruebasOpen) pruebasOpen.focus({ preventScroll: true });
    }
    function openWhatsAppPruebasModal() {
        if (!pruebasModal) return;
        pruebasModal.classList.remove('d-none');
        pruebasModal.removeAttribute('hidden');
        pruebasModal.setAttribute('aria-hidden', 'false');
        var pruebaStatus = document.getElementById('telegram-prueba-status');
        if (pruebaStatus) {
            pruebaStatus.textContent = '';
            pruebaStatus.className = 'telegram-user-link-status';
        }
        var firstInput = document.getElementById('whatsapp-phone-number');
        if (firstInput) firstInput.focus();
    }
    if (pruebasOpen) pruebasOpen.addEventListener('click', openWhatsAppPruebasModal);
    if (pruebasClose) pruebasClose.addEventListener('click', closeWhatsAppPruebasModal);
    if (pruebasModal) {
        pruebasModal.addEventListener('click', function (e) {
            if (e.target === pruebasModal) closeWhatsAppPruebasModal();
        });
        pruebasModal.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                closeWhatsAppPruebasModal();
            }
        });
    }

    var testBtn = document.getElementById('test-whatsapp-connection');
    if (testBtn) testBtn.addEventListener('click', testWhatsAppConnectionFromForm);

    var qrBtn = document.getElementById('whatsapp-show-qr-btn');
    if (qrBtn) {
        qrBtn.addEventListener('click', function () {
            showWhatsAppQr(whatsappActiveConfigId);
        });
    }
    var telegramBotOpen = document.getElementById('telegram-botfather-open-btn');
    var telegramBotModal = document.getElementById('telegram-botfather-modal');
    var telegramBotClose = document.getElementById('telegram-botfather-close-btn');
    var telegramBotSave = document.getElementById('telegram-botfather-save-btn');
    function closeTelegramBotModal() {
        if (!telegramBotModal) return;
        telegramBotModal.classList.add('d-none');
        telegramBotModal.setAttribute('hidden', '');
        telegramBotModal.setAttribute('aria-hidden', 'true');
        if (telegramBotOpen) telegramBotOpen.focus({ preventScroll: true });
    }
    function setTelegramGroupExtractStatus(message) {
        var el = document.getElementById('telegram-group-extract-status');
        if (!el) return;
        el.textContent = message || '';
    }
    function copyTelegramExtractId(id, kind) {
        var text = String(id || '');
        function done() {
            setTelegramGroupExtractStatus(kind === 'tema'
                ? ('ID del tema copiado: ' + text)
                : ('ID copiado: ' + text));
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () {
                copyTelegramExtractIdFallback(text, done);
            });
            return;
        }
        copyTelegramExtractIdFallback(text, done);
    }
    function copyTelegramExtractIdFallback(text, done) {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
        } catch (e) { /* el ID igual queda visible en la fila */ }
        document.body.removeChild(area);
        done();
    }
    function telegramTopicLabel(index, item) {
        var title = String((item && item.title) || '').trim();
        var label = 'tema' + index;
        if (title) label += '-' + title;
        return label;
    }
    function appendTelegramTopics(body, topics) {
        var list = (topics || []).slice().sort(function (a, b) {
            return (Number(a.topic_id) || 0) - (Number(b.topic_id) || 0);
        });
        list.forEach(function (topic, index) {
            appendTelegramExtractRow(body, topic, true, index + 1);
        });
    }
    function memberCountText(item) {
        if (item.topic_id) return '—';
        if (item.member_count === null || item.member_count === undefined) return '—';
        return String(item.member_count);
    }
    function appendTelegramCopyButton(idText, kind) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'telegram-group-copy-btn';
        button.setAttribute('aria-label', 'Copiar ID ' + idText);
        button.innerHTML = '<i class="fas fa-copy" aria-hidden="true"></i>';
        button.addEventListener('click', function () {
            copyTelegramExtractId(idText, kind);
        });
        return button;
    }
    function appendTelegramExtractRow(body, item, child, topicIndex) {
        var row = document.createElement('tr');
        if (child) row.className = 'telegram-group-extract-child';
        if (topicIndex) row.classList.add('telegram-group-topic-row');
        var idText = item.topic_id ? item.topic_id : item.chat_id;
        var nameCell = document.createElement('td');
        var title = item.title || 'Sin nombre';
        if (topicIndex) {
            nameCell.textContent = telegramTopicLabel(topicIndex, item);
        } else if (item.chat_type === 'channel') {
            nameCell.textContent = 'Canal: ' + title;
        } else {
            nameCell.textContent = title;
        }
        var membersCell = document.createElement('td');
        membersCell.textContent = memberCountText(item);
        var idCell = document.createElement('td');
        var idWrap = document.createElement('span');
        idWrap.className = 'telegram-group-id-cell';
        var idValue = document.createElement('span');
        idValue.textContent = idText;
        idWrap.appendChild(idValue);
        idWrap.appendChild(appendTelegramCopyButton(idText, item.topic_id ? 'tema' : 'chat'));
        idCell.appendChild(idWrap);
        row.appendChild(nameCell);
        row.appendChild(membersCell);
        row.appendChild(idCell);
        body.appendChild(row);
        return row;
    }
    function resetTelegramGroupTable() {
        var wrap = document.getElementById('telegram-group-extract-table-wrap');
        var body = document.getElementById('telegram-group-extract-body');
        if (body) body.innerHTML = '';
        if (wrap) wrap.hidden = true;
        setTelegramGroupExtractStatus('');
    }
    function renderTelegramGroupCatalog(groups, message) {
        var wrap = document.getElementById('telegram-group-extract-table-wrap');
        var body = document.getElementById('telegram-group-extract-body');
        if (!wrap || !body) return;
        body.innerHTML = '';
        if (!groups || !groups.length) {
            wrap.hidden = true;
            setTelegramGroupExtractStatus(message || 'Todavía no aparece ninguno. Agregá el bot al grupo o canal. Si ya estaba, escribí un mensaje ahí o volvé a agregarlo.');
            return;
        }
        groups.forEach(function (group) {
            appendTelegramExtractRow(body, group, false);
            appendTelegramTopics(body, group.topics);
            if (group.linked) {
                appendTelegramExtractRow(body, group.linked, true);
                appendTelegramTopics(body, group.linked.topics);
            }
        });
        wrap.hidden = false;
        setTelegramGroupExtractStatus('');
    }
    function loadTelegramBotGroups() {
        var loadBtn = document.getElementById('telegram-group-extract-load-btn');
        if (loadBtn) loadBtn.disabled = true;
        resetTelegramGroupTable();
        fetch('/tienda/admin/telegram_bot/groups', { credentials: 'same-origin' })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                renderTelegramGroupCatalog(
                    (data && data.groups) || [],
                    (data && (data.message || data.error)) || ''
                );
            })
            .catch(function () {
                renderTelegramGroupCatalog([], 'No se pudieron leer los grupos.');
            })
            .finally(function () {
                if (loadBtn) loadBtn.disabled = false;
            });
    }
    function openTelegramBotModal() {
        if (!telegramBotModal) return;
        telegramBotModal.classList.remove('d-none');
        telegramBotModal.removeAttribute('hidden');
        telegramBotModal.setAttribute('aria-hidden', 'false');
        setTelegramBotModalStatus('', true);
        resetTelegramGroupTable();
        var infoBox = document.getElementById('telegramGroupExtractInfoBox');
        var infoBtn = document.getElementById('telegramGroupExtractInfoBtn');
        if (infoBox) infoBox.hidden = true;
        if (infoBtn) infoBtn.setAttribute('aria-expanded', 'false');
        var nameInput = document.getElementById('telegram-bot-username');
        if (nameInput) nameInput.focus();
    }
    if (telegramBotOpen) telegramBotOpen.addEventListener('click', openTelegramBotModal);
    var telegramGroupLoad = document.getElementById('telegram-group-extract-load-btn');
    if (telegramGroupLoad) telegramGroupLoad.addEventListener('click', loadTelegramBotGroups);
    if (telegramBotClose) telegramBotClose.addEventListener('click', closeTelegramBotModal);
    if (telegramBotSave) telegramBotSave.addEventListener('click', saveTelegramBotFromModal);
    if (telegramBotModal) {
        telegramBotModal.addEventListener('click', function (e) {
            if (e.target === telegramBotModal) closeTelegramBotModal();
        });
        telegramBotModal.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                closeTelegramBotModal();
            }
        });
    }
    var telegramHealthBtn = document.getElementById('telegram-health-status');
    if (telegramHealthBtn) {
        telegramHealthBtn.addEventListener('click', function () {
            refreshTelegramBotHealth(false);
        });
    }
    var sendBtn = document.getElementById('whatsapp-send-test-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', function () {
            sendWhatsAppTestMessage(whatsappActiveConfigId);
        });
    }
    var telegramTestBtn = document.getElementById('telegram-send-test-btn');
    if (telegramTestBtn) {
        telegramTestBtn.addEventListener('click', sendTelegramTestMessage);
    }
    var notifyBtn = document.getElementById('whatsapp-run-notify-btn');
    if (notifyBtn) {
        notifyBtn.addEventListener('click', function () {
            runWhatsAppLicenseNotify(whatsappActiveConfigId);
        });
    }
    var qrClose = document.getElementById('whatsapp-qr-close-btn');
    var qrDisconnect = document.getElementById('whatsapp-qr-disconnect-btn');
    var qrModal = document.getElementById('whatsapp-qr-modal');
    if (qrClose) {
        qrClose.addEventListener('click', closeWhatsAppQrModal);
    }
    if (qrDisconnect) {
        qrDisconnect.addEventListener('click', function () {
            disconnectWhatsAppInstance(whatsappActiveConfigId);
        });
    }
    if (qrModal) {
        qrModal.addEventListener('click', function (e) {
            if (e.target === qrModal) closeWhatsAppQrModal();
        });
    }

    var notifyAttemptsClose = document.getElementById('whatsapp-notify-attempts-close-btn');
    var notifyAttemptsModal = document.getElementById('whatsapp-notify-attempts-modal');
    if (notifyAttemptsClose) {
        notifyAttemptsClose.addEventListener('click', closeWhatsAppNotifyAttemptsModal);
    }
    if (notifyAttemptsModal) {
        notifyAttemptsModal.addEventListener('click', function (e) {
            if (e.target === notifyAttemptsModal) closeWhatsAppNotifyAttemptsModal();
        });
    }

    setupWhatsAppUserPhoneModal();

    loadWhatsAppConfig();
    loadTelegramBot();
    loadWhatsAppUserNotifyPrefs();
    setupWhatsAppInfoToggle();
    document.addEventListener('visibilitychange', function whatsappHealthVisibility() {
        if (document.visibilityState === 'visible') {
            startWhatsAppHealthRealtime();
        } else {
            stopWhatsAppHealthRealtime();
        }
    });
});

window.testWhatsAppConnection = testWhatsAppConnectionFromForm;
