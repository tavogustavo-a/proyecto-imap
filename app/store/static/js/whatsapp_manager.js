/**
 * WhatsApp Web (Evolution API) — configuración única, salud, QR y pruebas.
 */

var whatsappActiveConfigId = null;
var whatsappHealthPollTimer = null;
var whatsappNotifyDailyLogCache = [];
var whatsappQrModalTrigger = null;
var whatsappNotifyAttemptsModalTrigger = null;
var whatsappUserPhoneModalTrigger = null;
var whatsappUserPhoneModalContext = null;

var WHATSAPP_LICENSE_TEMPLATE_EXAMPLE =
    'Hola {{customer_name}}, tus licencias vencen pronto ({{days_left}} días): ' +
    '{{product_names}}. Renová en la tienda.';

function syncWhatsAppTemplateExampleField() {
    var field = document.querySelector('.whatsapp-template-field');
    var tplInp = document.getElementById('whatsapp-template-message');
    if (!field || !tplInp) return;
    var hasValue = String(tplInp.value || '').trim().length > 0;
    field.classList.toggle('is-filled', hasValue);
}

function setupWhatsAppTemplateField() {
    var tplInp = document.getElementById('whatsapp-template-message');
    var field = document.querySelector('.whatsapp-template-field');
    if (!tplInp || !field) return;
    tplInp.addEventListener('input', syncWhatsAppTemplateExampleField);
    tplInp.addEventListener('focus', function () {
        field.classList.add('is-focused');
    });
    tplInp.addEventListener('blur', function () {
        field.classList.remove('is-focused');
        syncWhatsAppTemplateExampleField();
    });
    syncWhatsAppTemplateExampleField();
}

function whatsappStoredTemplateForForm(stored) {
    var raw = String(stored || '').trim();
    if (!raw || raw === WHATSAPP_LICENSE_TEMPLATE_EXAMPLE) return '';
    return raw;
}

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
    if (!config) {
        return { css: 'whatsapp-health-status--no-configurado', label: 'No configurado' };
    }
    var status = String(config.connection_status || 'unknown').toLowerCase();
    if (status === 'connected') {
        return { css: 'whatsapp-health-status--conectado', label: 'Conectado' };
    }
    if (!config.last_health_at) {
        return { css: 'whatsapp-health-status--no-configurado', label: 'No configurado' };
    }
    return { css: 'whatsapp-health-status--desconectado', label: 'Desconectado' };
}

function updateWhatsAppHealthBanner(config) {
    var statusEl = document.getElementById('whatsapp-health-status');
    var valueEl = document.getElementById('whatsapp-health-value');
    if (!statusEl || !valueEl) return;

    var ui = whatsappHealthUiState(config);
    statusEl.className = 'whatsapp-health-status ' + ui.css;
    valueEl.textContent = ui.label;

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
    statusEl.title = parts.length ? parts.join(' · ') : '';
}

function populateWhatsAppForm(config) {
    var phoneInp = document.getElementById('whatsapp-phone-number');
    var tplInp = document.getElementById('whatsapp-template-message');
    var timeInp = document.getElementById('whatsapp-notification-time');
    var enabledInp = document.getElementById('whatsapp-enabled');
    if (!config) {
        if (phoneInp) phoneInp.value = '';
        if (tplInp) tplInp.value = '';
        if (timeInp) timeInp.value = '00:00';
        if (enabledInp) enabledInp.checked = true;
        syncWhatsAppTemplateExampleField();
        return;
    }
    if (phoneInp) {
        phoneInp.value =
            config.phone_number && String(config.phone_number) !== '0' ? config.phone_number : '';
    }
    if (tplInp) tplInp.value = whatsappStoredTemplateForForm(config.template_message);
    if (timeInp) timeInp.value = config.notification_time || '00:00';
    if (enabledInp) enabledInp.checked = config.is_enabled !== false;
    syncWhatsAppTemplateExampleField();
}

function whatsappNotifyTriggerLabel(trigger) {
    var t = String(trigger || '').toLowerCase();
    if (t === 'scheduled') return 'Programado';
    if (t === 'reconnect_catchup') return 'Reconexión (+10 min)';
    if (t === 'manual') return 'Manual';
    return trigger || '—';
}

function whatsappDeliveryKindLabel(kind) {
    var k = String(kind || '').toLowerCase();
    if (k === 'aviso') return 'Aviso licencia';
    if (k === 'resumen') return 'Resumen diario';
    return kind || '—';
}

function whatsappDeliveryOutcomeLabel(outcome) {
    var o = String(outcome || '').toLowerCase();
    if (o === 'ok') return 'OK';
    if (o === 'error') return 'Falló';
    if (o === 'sin_telefono') return 'Sin teléfono';
    return outcome || '—';
}

function whatsappDeliveryOutcomeClass(outcome) {
    var o = String(outcome || '').toLowerCase();
    if (o === 'error') return 'text-danger';
    if (o === 'sin_telefono') return 'text-warning';
    if (o === 'ok') return 'text-success';
    return 'text-muted';
}

function collectWhatsAppDeliveryDetailsForDay(attempts) {
    var rows = [];
    (attempts || []).forEach(function (att) {
        var when = formatWhatsAppColombiaDateTime12(null, att.co_time, att.at_utc);
        (att.delivery_details || []).forEach(function (item) {
            rows.push({
                when: when,
                username: item.username || '—',
                phone: item.phone || '—',
                kind: item.kind || '',
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

function whatsappNotifyStatusLabel(status) {
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
    if (atUtc) {
        try {
            var fromUtc = new Date(atUtc);
            if (!isNaN(fromUtc.getTime())) {
                return fromUtc.toLocaleString('es-CO', {
                    timeZone: 'America/Bogota',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                });
            }
        } catch (_e) {
            /* fallback abajo */
        }
    }
    if (!coDate) return '—';
    var timePart = coTime || '00:00:00';
    if (String(timePart).length === 5) {
        timePart = timePart + ':00';
    }
    try {
        var iso = coDate + 'T' + timePart + '-05:00';
        var dt = new Date(iso);
        if (!isNaN(dt.getTime())) {
            return dt.toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            });
        }
    } catch (_e2) {
        /* fallback abajo */
    }
    return coDate + ' ' + (coTime || '');
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
        '<th>Fecha y hora (CO)</th><th>Estado</th><th>Avisos</th><th>Resúmenes</th><th>Errores</th><th>Intentos</th><th>Detalle</th>' +
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
                    whatsappNotifyStatusLabel(row.status) +
                    '</td>' +
                    '<td>' +
                    (row.sent != null ? row.sent : '0') +
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
        var clientDetails = collectWhatsAppDeliveryDetailsForDay(attempts);
        var attemptsHtml =
            '<div class="table-responsive">' +
            '<table class="table table-sm table-striped mb-0">' +
            '<thead><tr>' +
            '<th>Fecha y hora (CO)</th><th>Origen</th><th>Estado</th><th>Avisos</th><th>Resúmenes</th><th>Errores</th><th>Sin tel.</th><th>Motivo</th>' +
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
                        '<td>' +
                        whatsappNotifyTriggerLabel(att.trigger) +
                        '</td>' +
                        '<td class="' +
                        whatsappNotifyStatusClass(att.status) +
                        ' fw-bold">' +
                        whatsappNotifyStatusLabel(att.status) +
                        '</td>' +
                        '<td>' +
                        (att.sent != null ? att.sent : '0') +
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
                        '<td class="small text-muted">' +
                        (att.reason || '—') +
                        '</td>' +
                        '</tr>'
                    );
                })
                .join('') +
            '</tbody></table></div>';

        var clientsHtml = '';
        if (clientDetails.length) {
            clientsHtml =
                '<h6 class="text-center mt-3 mb-2">Detalle por cliente</h6>' +
                '<div class="table-responsive">' +
                '<table class="table table-sm table-striped mb-0">' +
                '<thead><tr>' +
                '<th>Intento</th><th>Usuario</th><th>Teléfono</th><th>Tipo</th><th>Resultado</th><th>Motivo</th>' +
                '</tr></thead><tbody>' +
                clientDetails
                    .map(function (row) {
                        return (
                            '<tr>' +
                            '<td class="whatsapp-notify-datetime-cell">' +
                            row.when +
                            '</td>' +
                            '<td>' +
                            row.username +
                            '</td>' +
                            '<td class="whatsapp-notify-phone-cell">' +
                            row.phone +
                            '</td>' +
                            '<td>' +
                            whatsappDeliveryKindLabel(row.kind) +
                            '</td>' +
                            '<td class="' +
                            whatsappDeliveryOutcomeClass(row.outcome) +
                            ' fw-bold">' +
                            whatsappDeliveryOutcomeLabel(row.outcome) +
                            '</td>' +
                            '<td class="small text-muted">' +
                            (row.reason || '—') +
                            '</td>' +
                            '</tr>'
                        );
                    })
                    .join('') +
                '</tbody></table></div>';
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
    } catch (error) {
        console.error('Error cargando WhatsApp:', error);
        whatsappActiveConfigId = null;
        populateWhatsAppForm(null);
        updateWhatsAppHealthBanner(null);
        renderWhatsAppNotifyRunLog(null);
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

async function sendWhatsAppTestMessage(configId) {
    var id = configId || whatsappActiveConfigId;
    if (!id) {
        showWhatsAppStatus('Guardá la configuración primero', 'error');
        return;
    }
    var numInp = document.getElementById('whatsapp-phone-number');
    var toNum = numInp ? String(numInp.value || '').trim() : '';
    if (!toNum) {
        showWhatsAppStatus('Indicá un número para la prueba', 'error');
        return;
    }
    showWhatsAppStatus('Enviando mensaje de prueba…', 'info');
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
            loadWhatsAppConfig();
        } else {
            showWhatsAppStatus(result.error || 'Envío fallido', 'error');
        }
    } catch (e) {
        showWhatsAppStatus('Error de red', 'error');
    }
}

async function runWhatsAppLicenseNotify(configId) {
    var id = configId || whatsappActiveConfigId;
    if (!id) {
        showWhatsAppStatus('Guardá la configuración primero', 'error');
        return;
    }
    if (
        !window.confirm(
            '¿Enviar avisos de licencias por vencer a todos los clientes con teléfono? (ignora la hora programada)'
        )
    ) {
        return;
    }
    showWhatsAppStatus('Ejecutando job de avisos…', 'info');
    try {
        var response = await fetch('/tienda/admin/whatsapp_configs/' + id + '/run-notify', {
            method: 'POST',
            headers: { 'X-CSRFToken': whatsappCsrfToken() },
        });
        var result = await response.json();
        if (result.success) {
            var detail = result.result || {};
            showWhatsAppStatus(
                (result.message || 'Listo') +
                    ' (sin tel: ' +
                    (detail.skipped_no_phone || 0) +
                    ', errores: ' +
                    (detail.errors || 0) +
                    ')',
                'success'
            );
            loadWhatsAppConfig();
        } else {
            showWhatsAppStatus(result.error || 'Job omitido', 'error');
        }
    } catch (e) {
        showWhatsAppStatus('Error de red', 'error');
    }
}

function startWhatsAppHealthPolling() {
    if (whatsappHealthPollTimer) clearInterval(whatsappHealthPollTimer);
    whatsappHealthPollTimer = setInterval(function () {
        if (whatsappActiveConfigId && document.visibilityState === 'visible') {
            refreshWhatsAppHealth(whatsappActiveConfigId, true);
        }
    }, 90000);
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

function openWhatsAppUserPhoneModal(userId, username, currentPhone, rowEl, triggerEl) {
    var modal = document.getElementById('whatsapp-user-phone-modal');
    var userLabel = document.getElementById('whatsapp-user-phone-modal-user');
    var input = document.getElementById('whatsapp-user-phone-modal-input');
    if (!modal || !input || !userId) return;

    whatsappUserPhoneModalTrigger = triggerEl || document.activeElement;
    whatsappUserPhoneModalContext = {
        userId: userId,
        rowEl: rowEl,
        prevPhone: String(currentPhone || '').trim(),
    };
    if (userLabel) {
        userLabel.textContent = username ? 'Usuario: ' + username : '';
    }
    input.value = whatsappUserPhoneModalContext.prevPhone;
    modal.classList.remove('d-none');
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.focus();
    input.select();
}

function saveWhatsAppUserPhoneFromModal() {
    var ctx = whatsappUserPhoneModalContext;
    var input = document.getElementById('whatsapp-user-phone-modal-input');
    var saveBtn = document.getElementById('whatsapp-user-phone-modal-save-btn');
    if (!ctx || !input) return;

    var next = String(input.value || '').trim();
    if (next === ctx.prevPhone) {
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
        body: JSON.stringify({ phone: next }),
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
            whatsappUserPhoneUpdateRowDisplay(ctx.rowEl, saved);
            showWhatsAppStatus('Teléfono guardado.', 'success');
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
            openWhatsAppUserPhoneModal(userId, username, phone, row, btn);
        });
    });
}

function setupWhatsAppUserPhoneModal() {
    if (setupWhatsAppUserPhoneModal._wired) return;
    setupWhatsAppUserPhoneModal._wired = true;

    var modal = document.getElementById('whatsapp-user-phone-modal');
    var cancelBtn = document.getElementById('whatsapp-user-phone-modal-cancel-btn');
    var saveBtn = document.getElementById('whatsapp-user-phone-modal-save-btn');
    var input = document.getElementById('whatsapp-user-phone-modal-input');

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeWhatsAppUserPhoneModal);
    }
    if (saveBtn) {
        saveBtn.addEventListener('click', saveWhatsAppUserPhoneFromModal);
    }
    if (input) {
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                saveWhatsAppUserPhoneFromModal();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                closeWhatsAppUserPhoneModal();
            }
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
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Cargando usuarios…</td></tr>';
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
                    '<tr><td colspan="3" class="text-center text-danger">' +
                    (data && data.error ? data.error : 'No se pudo cargar usuarios.') +
                    '</td></tr>';
                return;
            }
            renderWhatsAppUserNotifyTable(data.users || []);
        })
        .catch(function () {
            tbody.innerHTML =
                '<tr><td colspan="3" class="text-center text-danger">Error de red al cargar usuarios.</td></tr>';
        });
}

function renderWhatsAppUserNotifyTable(users) {
    var tbody = document.getElementById('whatsapp-user-notify-table-body');
    var prevBtn = document.getElementById('whatsappUserNotifyPrevBtn');
    var nextBtn = document.getElementById('whatsappUserNotifyNextBtn');
    if (!tbody) return;
    if (!users || !users.length) {
        tbody.innerHTML =
            '<tr><td colspan="3" class="text-center text-muted">No hay usuarios principales para configurar.</td></tr>';
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
                '</tr>'
            );
        })
        .join('');

    tbody.querySelectorAll('.whatsapp-user-notify-checkbox').forEach(function (cb) {
        cb.addEventListener('change', function () {
            saveWhatsAppUserNotifyPref(cb);
        });
    });
    wireWhatsAppUserNotifyPhoneEditButtons(tbody);

    whatsappUserNotifyPageState.currentPage = 1;
    whatsappUserNotifyFilterRows();
}

function saveWhatsAppUserNotifyPref(checkbox) {
    if (!checkbox) return;
    var userId = checkbox.getAttribute('data-user-id');
    if (!userId) return;
    var enabled = !!checkbox.checked;
    checkbox.disabled = true;
    fetch('/tienda/admin/whatsapp/user-notify-prefs/' + encodeURIComponent(userId), {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': whatsappCsrfToken(),
        },
        body: JSON.stringify({ enabled: enabled }),
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
        document.getElementById('whatsappPhoneInfoBtn'),
        document.getElementById('whatsappPhoneInfoBox')
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
            if (result.success) {
                showWhatsAppStatus(result.message, 'success');
                if (result.id) whatsappActiveConfigId = result.id;
                loadWhatsAppConfig();
            } else {
                showWhatsAppStatus(result.error || 'Error', 'error');
            }
        } catch (err) {
            showWhatsAppStatus('Error de red', 'error');
        }
    });

    var testBtn = document.getElementById('test-whatsapp-connection');
    if (testBtn) testBtn.addEventListener('click', testWhatsAppConnectionFromForm);

    var qrBtn = document.getElementById('whatsapp-show-qr-btn');
    if (qrBtn) {
        qrBtn.addEventListener('click', function () {
            showWhatsAppQr(whatsappActiveConfigId);
        });
    }
    var sendBtn = document.getElementById('whatsapp-send-test-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', function () {
            sendWhatsAppTestMessage(whatsappActiveConfigId);
        });
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
    loadWhatsAppUserNotifyPrefs();
    setupWhatsAppInfoToggle();
    setupWhatsAppTemplateField();
    startWhatsAppHealthPolling();
});

window.testWhatsAppConnection = testWhatsAppConnectionFromForm;
