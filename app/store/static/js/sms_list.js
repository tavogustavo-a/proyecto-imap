/**
 * SMS List Manager - JavaScript para consulta de mensajes SMS
 * Maneja: selección de números, consulta de mensajes, filtros y búsqueda
 */

document.addEventListener('DOMContentLoaded', function() {
    let currentConfigId = null;
    let currentSearch = '';
    const STORAGE_KEY = 'sms_selected_config_id';

    // Función para obtener CSRF token
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf_token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    // Cargar números disponibles al inicio
    loadSMSNumbers();

    // Event listeners
    const smsNumberSelect = document.getElementById('sms-number-select');
    if (smsNumberSelect) {
        smsNumberSelect.addEventListener('change', function() {
            const configId = this.value;
            if (configId) {
                currentConfigId = parseInt(configId);
                // Guardar el estado seleccionado en localStorage
                localStorage.setItem(STORAGE_KEY, configId);
                // Guardar también en la sesión del servidor
                fetch('/tienda/admin/sms/set-selected-number', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken ? getCsrfToken() : ''
                    },
                    body: JSON.stringify({ sms_config_id: currentConfigId })
                })
                .then(() => {
                    // Notificar a sms_numbers.js que actualice el estado
                    if (typeof window.checkSMSConfigsAndToggleForm === 'function') {
                        window.checkSMSConfigsAndToggleForm();
                    }
                })
                .catch(err => console.error("Error guardando número seleccionado:", err));
                loadMessages(currentConfigId);
            } else {
                // Si se deselecciona, limpiar el estado guardado
                localStorage.removeItem(STORAGE_KEY);
                currentConfigId = null;
                // Limpiar también en la sesión del servidor
                fetch('/tienda/admin/sms/set-selected-number', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken ? getCsrfToken() : ''
                    },
                    body: JSON.stringify({ sms_config_id: null })
                })
                .then(() => {
                    // Notificar a sms_numbers.js que actualice el estado
                    if (typeof window.checkSMSConfigsAndToggleForm === 'function') {
                        window.checkSMSConfigsAndToggleForm();
                    }
                })
                .catch(err => console.error("Error limpiando selección:", err));
                clearMessages();
            }
        });
    }

    document.getElementById('btn-consult-number').addEventListener('click', function() {
        // Consultar todos los mensajes de todos los números
        currentConfigId = null;
        // Limpiar el estado guardado cuando se consultan todos
        localStorage.removeItem(STORAGE_KEY);
        // Limpiar el selector
        document.getElementById('sms-number-select').value = '';
        loadAllMessages();
    });

    document.getElementById('sms-search-input').addEventListener('input', function() {
        currentSearch = this.value.trim();
        if (currentConfigId) {
            loadMessages(currentConfigId);
        } else {
            loadAllMessages();
        }
    });

    document.getElementById('btn-refresh-messages').addEventListener('click', function() {
        // Verificar configuraciones SMS antes de buscar (si la función está disponible)
        if (typeof window.checkSMSConfigsAndToggleForm === 'function') {
            window.checkSMSConfigsAndToggleForm();
        }
        
        if (currentConfigId) {
            loadMessages(currentConfigId);
        } else {
            loadAllMessages();
        }
    });

    // Modal
    document.getElementById('close-sms-modal')?.addEventListener('click', closeModal);
    document.getElementById('close-sms-modal-btn')?.addEventListener('click', closeModal);

    // Botón volver
    const btnVolver = document.getElementById('btnVolverPanel');
    if (btnVolver) {
        btnVolver.addEventListener('click', function() {
            const url = this.getAttribute('data-url');
            if (url) {
                window.location.href = url;
            }
        });
    }

    // ==================== FUNCIONES ====================

    async function loadSMSNumbers() {
        try {
            const response = await fetch('/tienda/admin/sms_configs');
            const result = await response.json();

            const select = document.getElementById('sms-number-select');
            select.innerHTML = '<option value="">-- Selecciona un número --</option>';

            if (result.success && result.configs && result.configs.length > 0) {
                // Todos los números siempre están habilitados, mostrar todos
                result.configs.forEach(config => {
                    const option = document.createElement('option');
                    option.value = config.id;
                    option.textContent = `${config.phone_number} - ${config.name} (${config.messages_count || 0} mensajes)`;
                    select.appendChild(option);
                });
                
                // Restaurar el estado guardado
                const savedConfigId = localStorage.getItem(STORAGE_KEY);
                if (savedConfigId) {
                    // Verificar que el número guardado aún existe
                    const configExists = result.configs.some(c => c.id.toString() === savedConfigId);
                    if (configExists) {
                        select.value = savedConfigId;
                        currentConfigId = parseInt(savedConfigId);
                        // Guardar también en la sesión del servidor
                        fetch('/tienda/admin/sms/set-selected-number', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRFToken': getCsrfToken()
                            },
                            body: JSON.stringify({ sms_config_id: currentConfigId })
                        })
                        .then(() => {
                            // Notificar a sms_numbers.js que actualice el estado
                            if (typeof window.checkSMSConfigsAndToggleForm === 'function') {
                                window.checkSMSConfigsAndToggleForm();
                            }
                        })
                        .catch(err => console.error("Error guardando número seleccionado:", err));
                        // Cargar los mensajes automáticamente
                        loadMessages(currentConfigId);
                    } else {
                        // Si el número guardado ya no existe, limpiar el estado
                        localStorage.removeItem(STORAGE_KEY);
                    }
                } else {
                    // Si no hay número guardado, notificar a sms_numbers.js para deshabilitar formulario
                    if (typeof window.checkSMSConfigsAndToggleForm === 'function') {
                        window.checkSMSConfigsAndToggleForm();
                    }
                }
            }
        } catch (error) {
            console.error('Error cargando números SMS:', error);
        }
    }

    async function consultByPhoneNumber(phoneNumber) {
        try {
            const response = await fetch('/tienda/admin/sms_configs');
            const result = await response.json();

            if (result.success && result.configs) {
                const fullNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
                const config = result.configs.find(c => c.phone_number === fullNumber || c.phone_number.replace(/\s/g, '') === fullNumber.replace(/\s/g, ''));

                if (config) {
                    currentConfigId = config.id;
                    currentPage = 1;
                    document.getElementById('sms-number-select').value = config.id;
                    loadMessages(config.id);
                } else {
                    alert(`No se encontró configuración para el número ${fullNumber}`);
                }
            }
        } catch (error) {
            console.error('Error consultando número:', error);
            alert('Error al consultar el número');
        }
    }

    async function loadAllMessages() {
        try {
            const params = new URLSearchParams({
                page: 1,
                per_page: -1
            });

            const response = await fetch(`/tienda/admin/sms/all-messages?${params}`);
            const result = await response.json();

            if (result.success) {
                displayAllMessages(result.messages, result.total);
            } else {
                showError('Error cargando mensajes: ' + (result.error || 'Desconocido'));
            }
        } catch (error) {
            console.error('Error cargando mensajes:', error);
            showError('Error de conexión al cargar mensajes');
        }
    }

    async function loadMessages(configId) {
        if (!configId) return;

        try {
            const params = new URLSearchParams({
                page: 1,
                per_page: -1
            });

            const response = await fetch(`/tienda/admin/sms_configs/${configId}/messages?${params}`);
            const result = await response.json();

            if (result.success) {
                displayMessages(result.messages, result.total);
            } else {
                showError('Error cargando mensajes: ' + (result.error || 'Desconocido'));
            }
        } catch (error) {
            console.error('Error cargando mensajes:', error);
            showError('Error de conexión al cargar mensajes');
        }
    }

    function displayAllMessages(messages, total, totalPages) {
        const container = document.getElementById('sms-messages-container');
        
        // Aplicar filtros locales (búsqueda)
        let filteredMessages = messages;
        if (currentSearch) {
            const searchLower = currentSearch.toLowerCase();
            filteredMessages = messages.filter(msg => 
                msg.message_body.toLowerCase().includes(searchLower) ||
                msg.from_number.includes(currentSearch) ||
                (msg.to_number && msg.to_number.includes(currentSearch))
            );
        }

        if (filteredMessages.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-inbox fa-3x text-muted mb-3"></i>
                </div>
            `;
            return;
        }

        let tableHTML = `
            <div class="table-responsive">
                <table class="table table-striped table-hover">
                    <thead>
                        <tr>
                            <th class="sms-table-th-date">Fecha/Hora</th>
                            <th class="sms-table-th-number">Número</th>
                            <th class="sms-table-th-from">De</th>
                            <th>Código/Mensaje</th>
                            <th class="sms-table-th-status">Estado</th>
                            <th class="sms-table-th-actions">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        filteredMessages.forEach(msg => {
            const date = msg.created_at || 'N/A';
            const isUnread = !msg.processed;
            const rowClass = isUnread ? 'sms-message-unread' : 'sms-message-read';
            
            tableHTML += `
                <tr class="sms-message-row ${rowClass}" data-message-id="${msg.id}" data-config-id="${msg.sms_config_id || ''}">
                    <td><small>${date}</small></td>
                    <td><code>${escapeHtml(msg.to_number || 'N/A')}</code></td>
                    <td><code>${escapeHtml(msg.from_number)}</code></td>
                    <td class="message-preview" title="${escapeHtml(msg.message_body)}">
                        <strong>${escapeHtml(msg.message_body)}</strong>
                    </td>
                    <td>
                        <span class="badge ${msg.processed ? 'badge-success' : 'badge-warning'}">
                            ${msg.processed ? 'Procesado' : 'Pendiente'}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-info btn-view-message" data-message-id="${msg.id}" data-config-id="${msg.sms_config_id || ''}" title="Ver detalles">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = tableHTML;

        // Agregar event listeners a los botones de ver detalles
        container.querySelectorAll('.btn-view-message').forEach(btn => {
            btn.addEventListener('click', function() {
                const messageId = this.getAttribute('data-message-id');
                const configId = this.getAttribute('data-config-id');
                viewMessageDetails(messageId, configId);
            });
        });
    }

    function displayMessages(messages, total, totalPages) {
        const container = document.getElementById('sms-messages-container');
        
        // Aplicar filtros locales (búsqueda)
        let filteredMessages = messages;
        if (currentSearch) {
            const searchLower = currentSearch.toLowerCase();
            filteredMessages = messages.filter(msg => 
                msg.message_body.toLowerCase().includes(searchLower) ||
                msg.from_number.includes(currentSearch)
            );
        }

        if (filteredMessages.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-inbox fa-3x text-muted mb-3"></i>
                </div>
            `;
            return;
        }

        let tableHTML = `
            <div class="table-responsive">
                <table class="table table-striped table-hover">
                    <thead>
                        <tr>
                            <th class="sms-table-th-date">Fecha/Hora</th>
                            <th class="sms-table-th-from">De</th>
                            <th>Código/Mensaje</th>
                            <th class="sms-table-th-status">Estado</th>
                            <th class="sms-table-th-actions">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        filteredMessages.forEach(msg => {
            const date = msg.created_at || 'N/A';
            const isUnread = !msg.processed;
            const rowClass = isUnread ? 'sms-message-unread' : 'sms-message-read';
            
            tableHTML += `
                <tr class="sms-message-row ${rowClass}" data-message-id="${msg.id}" data-config-id="${currentConfigId}">
                    <td><small>${date}</small></td>
                    <td><code>${escapeHtml(msg.from_number)}</code></td>
                    <td class="message-preview" title="${escapeHtml(msg.message_body)}">
                        <strong>${escapeHtml(msg.message_body)}</strong>
                    </td>
                    <td>
                        <span class="badge ${msg.processed ? 'badge-success' : 'badge-warning'}">
                            ${msg.processed ? 'Procesado' : 'Pendiente'}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-info btn-view-message" data-message-id="${msg.id}" data-config-id="${currentConfigId}" title="Ver detalles">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = tableHTML;

        // Agregar event listeners a los botones de ver detalles
        container.querySelectorAll('.btn-view-message').forEach(btn => {
            btn.addEventListener('click', function() {
                const messageId = this.getAttribute('data-message-id');
                const configId = this.getAttribute('data-config-id');
                viewMessageDetails(messageId, configId);
            });
        });
    }

    function clearMessages() {
        document.getElementById('sms-messages-container').innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-inbox fa-3x text-muted mb-3"></i>
            </div>
        `;
    }

    function showError(message) {
        const container = document.getElementById('sms-messages-container');
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle"></i> ${escapeHtml(message)}
            </div>
        `;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Función para ver detalles del mensaje (ya no es global, se llama desde event listeners)
    async function viewMessageDetails(messageId, configId) {
        try {
            let response;
            if (configId && configId !== 'null') {
                response = await fetch(`/tienda/admin/sms_configs/${configId}/messages/${messageId}`);
            } else {
                // Si no hay configId, buscar el mensaje directamente
                response = await fetch(`/tienda/admin/sms/message/${messageId}`);
            }
            
            const result = await response.json();

            if (result.success) {
                const msg = result.message;
                const modal = document.getElementById('sms-message-modal');
                const details = document.getElementById('sms-message-details');

                // Crear elementos sin innerHTML con estilos inline
                details.innerHTML = '';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'mb-3';
                infoDiv.innerHTML = `
                    <strong>De:</strong> <code>${escapeHtml(msg.from_number)}</code><br>
                    <strong>Para:</strong> <code>${escapeHtml(msg.to_number)}</code><br>
                    <strong>Fecha:</strong> ${msg.created_at || 'N/A'}<br>
                    <strong>Estado Twilio:</strong> <span class="badge badge-info">${escapeHtml(msg.twilio_status || 'N/A')}</span><br>
                    <strong>Procesado:</strong> <span class="badge ${msg.processed ? 'badge-success' : 'badge-warning'}">${msg.processed ? 'Sí' : 'No'}</span>
                `;
                details.appendChild(infoDiv);

                const messageDiv = document.createElement('div');
                messageDiv.className = 'mb-3';
                const messageLabel = document.createElement('strong');
                messageLabel.textContent = 'Código/Mensaje completo:';
                messageDiv.appendChild(messageLabel);
                
                const messageContent = document.createElement('div');
                messageContent.className = 'alert alert-light mt-2 sms-message-detail-text';
                const messageStrong = document.createElement('strong');
                messageStrong.textContent = escapeHtml(msg.message_body);
                messageContent.appendChild(messageStrong);
                messageDiv.appendChild(messageContent);
                details.appendChild(messageDiv);

                if (msg.raw_data) {
                    const rawDiv = document.createElement('div');
                    rawDiv.className = 'mb-3';
                    const rawLabel = document.createElement('strong');
                    rawLabel.textContent = 'Datos completos:';
                    rawDiv.appendChild(rawLabel);
                    
                    const rawPre = document.createElement('pre');
                    rawPre.className = 'bg-light p-2 br-4 sms-raw-data-pre';
                    const rawCode = document.createElement('code');
                    rawCode.textContent = JSON.stringify(msg.raw_data, null, 2);
                    rawPre.appendChild(rawCode);
                    rawDiv.appendChild(rawPre);
                    details.appendChild(rawDiv);
                }

                // Botón "Marcar como procesado" removido según solicitud del usuario

                modal.classList.remove('d-none');
            } else {
                alert('Error cargando detalles del mensaje');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error de conexión');
        }
    };

    function closeModal() {
        document.getElementById('sms-message-modal').classList.add('d-none');
    }

});

