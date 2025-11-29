// Gestión de configuraciones SMS
document.addEventListener('DOMContentLoaded', function() {
    const smsConfigForm = document.getElementById('sms-config-form');
    const smsConfigsList = document.getElementById('sms-configs-list');
    const smsNumberSelect = document.getElementById('sms-number-select');
    const smsConfigName = document.getElementById('sms-config-name');
    const smsConfigAccountSid = document.getElementById('sms-config-account-sid');
    const smsConfigAuthToken = document.getElementById('sms-config-auth-token');
    const smsConfigPhone = document.getElementById('sms-config-phone');
    const smsConfigSaveBtn = document.getElementById('sms-config-save-btn');
    const smsConfigMessage = document.getElementById('sms-config-message');
    
    // Función para obtener CSRF token
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf_token"]');
        return meta ? meta.content : '';
    }
    
    // Función para manejar respuestas fetch
    function handleFetchResponse(response) {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.error || `Error HTTP: ${response.status}`);
            });
        }
        return response.json();
    }
    
    // Cargar configuraciones al iniciar (solo si no se cargaron desde otro script)
    function loadSMSConfigs() {
        // Verificar si ya se están cargando desde sms_list.js para evitar llamadas duplicadas
        if (window.smsConfigsLoading) {
            return;
        }
        
        window.smsConfigsLoading = true;
        fetch('/tienda/admin/sms_configs', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(handleFetchResponse)
        .then(data => {
            window.smsConfigsLoading = false;
            if (data.success) {
                renderConfigsList(data.configs);
                updateSMSNumberSelect(data.configs);
                // Notificar a otros scripts que los datos están listos
                window.smsConfigsData = data.configs;
                window.smsLastSelectedId = data.last_selected_id || null;
                // Disparar evento personalizado para que otros scripts se enteren
                window.dispatchEvent(new CustomEvent('smsConfigsLoaded', { detail: data.configs }));
                if (typeof window.onSMSConfigsLoaded === 'function') {
                    window.onSMSConfigsLoaded(data.configs);
                }
            }
        })
        .catch(err => {
            window.smsConfigsLoading = false;
            if (smsConfigsList) {
                const errorDiv = document.createElement('p');
                errorDiv.className = 'sms-error-message';
                errorDiv.textContent = `Error al cargar configuraciones: ${err.message}`;
                smsConfigsList.innerHTML = '';
                smsConfigsList.appendChild(errorDiv);
            }
        });
    }
    
    // Renderizar lista de configuraciones (estilo similar a regex)
    function renderConfigsList(configs) {
        if (!smsConfigsList) return;
        
        if (!configs || configs.length === 0) {
            smsConfigsList.innerHTML = '<p class="text-center text-secondary">No hay configuraciones SMS. Agrega una nueva configuración arriba.</p>';
            return;
        }
        
        const configsHTML = configs.map(config => {
            // Determinar el tipo de número y el color del badge (CSP Compliant - sin estilos inline)
            let numberTypeBadge = '';
            if (config.number_type === 'comprado') {
                numberTypeBadge = '<span class="badge badge-success">Comprado</span>';
            } else if (config.number_type === 'temporal') {
                numberTypeBadge = '<span class="badge badge-warning">Temporal</span>';
            } else {
                numberTypeBadge = '<span class="badge badge-secondary">Desconocido</span>';
            }
            
            return `
                <div class="regex-item d-flex justify-content-between align-items-center p-2">
                    <div class="flex-grow-1">
                        <div class="font-weight-bold mb-05">${escapeHtml(config.name)}</div>
                        <div class="text-secondary">${escapeHtml(config.phone_number)}${numberTypeBadge}</div>
                    </div>
                    <div class="d-flex gap-05 ml-2">
                        <button type="button" class="btn-orange btn-sm edit-sms-config" data-config-id="${config.id}" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="btn-red btn-sm delete-sms-config btn-imap-action btn-imap-small" data-id="${config.id}" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        smsConfigsList.innerHTML = configsHTML;
        
        // Agregar event listeners
        smsConfigsList.querySelectorAll('.delete-sms-config').forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = parseInt(this.getAttribute('data-id'));
                deleteConfig(configId);
            });
        });
        
        // Agregar event listeners para editar
        smsConfigsList.querySelectorAll('.edit-sms-config').forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = parseInt(this.getAttribute('data-config-id'));
                editConfig(configId, configs);
            });
        });
    }
    
    // Actualizar select de números SMS
    function updateSMSNumberSelect(configs) {
        if (!smsNumberSelect) return;
        
        smsNumberSelect.innerHTML = '<option value="">-- Selecciona un número --</option>';
        
        // Todos los números siempre están activos, no filtrar por is_enabled
        configs.forEach(config => {
            const option = document.createElement('option');
            option.value = config.id;
            option.textContent = `${config.phone_number} (${config.messages_count || 0} mensajes)`;
            smsNumberSelect.appendChild(option);
        });
    }
    
    // Eliminar configuración
    function deleteConfig(configId) {
        if (!confirm('¿Estás seguro de eliminar esta configuración SMS? Esto también eliminará todos los mensajes asociados.')) {
            return;
        }
        
        fetch(`/tienda/admin/sms_configs/${configId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(handleFetchResponse)
        .then(data => {
            if (data.success) {
                showMessage('Configuración eliminada correctamente.', 'success');
                loadSMSConfigs();
            }
        })
        .catch(err => {
            showMessage(`Error al eliminar: ${err.message}`, 'error');
        });
    }
    
    // Editar configuración (abre modal)
    function editConfig(configId, configs) {
        const config = configs.find(c => c.id === configId);
        if (!config) {
            showMessage('Configuración no encontrada.', 'error');
            return;
        }
        
        // Abrir modal y poblar campos
        const editModal = document.getElementById('sms-edit-config-modal');
        const editForm = document.getElementById('sms-edit-config-form');
        const editConfigId = document.getElementById('edit-sms-config-id');
        const editName = document.getElementById('edit-sms-config-name');
        const editAccountSid = document.getElementById('edit-sms-config-account-sid');
        const editAuthToken = document.getElementById('edit-sms-config-auth-token');
        const editPhone = document.getElementById('edit-sms-config-phone');
        
        if (editModal && editForm && editConfigId && editName && editAccountSid && editAuthToken && editPhone) {
            editConfigId.value = config.id;
            editName.value = config.name;
            editAccountSid.value = config.twilio_account_sid;
            editAuthToken.value = ''; // No mostrar el token por seguridad
            editPhone.value = config.phone_number;
            
            editModal.classList.remove('d-none');
        }
    }
    
    // Manejar envío del formulario
    if (smsConfigForm) {
        smsConfigForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const formData = {
                name: smsConfigName ? smsConfigName.value.trim() : '',
                twilio_account_sid: smsConfigAccountSid ? smsConfigAccountSid.value.trim() : '',
                twilio_auth_token: smsConfigAuthToken ? smsConfigAuthToken.value.trim() : '',
                phone_number: smsConfigPhone ? smsConfigPhone.value.trim() : '',
                is_enabled: true
            };
            
            if (!formData.name || !formData.twilio_account_sid || !formData.twilio_auth_token || !formData.phone_number) {
                showMessage('Por favor completa todos los campos requeridos.', 'error');
                return;
            }
            
            fetch('/tienda/admin/sms_configs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(formData)
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success) {
                    showMessage(data.message || 'Configuración creada correctamente.', 'success');
                    resetForm();
                    loadSMSConfigs();
                }
            })
            .catch(err => {
                showMessage(`Error: ${err.message}`, 'error');
            });
        });
    }
    
    // Resetear formulario
    function resetForm() {
        if (smsConfigForm) smsConfigForm.reset();
        if (smsConfigMessage) smsConfigMessage.textContent = '';
    }
    
    // Mostrar mensaje
    function showMessage(message, type) {
        if (!smsConfigMessage) return;
        
        smsConfigMessage.textContent = message;
        smsConfigMessage.className = `mt-05 ${type === 'success' ? 'text-success' : 'sms-error-message'}`;
        
        setTimeout(() => {
            if (smsConfigMessage) {
                smsConfigMessage.textContent = '';
                smsConfigMessage.className = '';
            }
        }, 5000);
    }
    
    // Función para escapar HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Manejar formulario de edición
    const editConfigForm = document.getElementById('sms-edit-config-form');
    const editModal = document.getElementById('sms-edit-config-modal');
    const closeEditModalBtn = document.getElementById('close-edit-config-modal');
    const editConfigMessage = document.getElementById('edit-sms-config-message');
    
    if (editConfigForm) {
        editConfigForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const configId = document.getElementById('edit-sms-config-id').value;
            const formData = {
                name: document.getElementById('edit-sms-config-name').value.trim(),
                twilio_account_sid: document.getElementById('edit-sms-config-account-sid').value.trim(),
                twilio_auth_token: document.getElementById('edit-sms-config-auth-token').value.trim(),
                phone_number: document.getElementById('edit-sms-config-phone').value.trim()
            };
            
            if (!formData.name || !formData.twilio_account_sid || !formData.phone_number) {
                if (editConfigMessage) {
                    editConfigMessage.textContent = 'Por favor completa todos los campos requeridos.';
                    editConfigMessage.className = 'sms-error-message';
                }
                return;
            }
            
            fetch(`/tienda/admin/sms_configs/${configId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(formData)
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success) {
                    if (editConfigMessage) {
                        editConfigMessage.textContent = data.message || 'Configuración actualizada correctamente.';
                        editConfigMessage.className = 'text-success';
                    }
                    setTimeout(() => {
                        if (editModal) editModal.classList.add('d-none');
                        if (editConfigForm) editConfigForm.reset();
                        if (editConfigMessage) {
                            editConfigMessage.textContent = '';
                            editConfigMessage.className = '';
                        }
                        loadSMSConfigs();
                        // Recargar números en sms_list.js si existe
                        if (typeof loadSMSNumbers === 'function') {
                            loadSMSNumbers();
                        }
                    }, 1500);
                }
            })
            .catch(err => {
                if (editConfigMessage) {
                    editConfigMessage.textContent = `Error: ${err.message}`;
                    editConfigMessage.className = 'sms-error-message';
                }
            });
        });
    }
    
    // Cerrar modal de edición
    if (closeEditModalBtn) {
        closeEditModalBtn.addEventListener('click', function() {
            if (editModal) editModal.classList.add('d-none');
            if (editConfigForm) editConfigForm.reset();
            if (editConfigMessage) {
                editConfigMessage.textContent = '';
                editConfigMessage.className = '';
            }
        });
    }
    
    // Cerrar modal al hacer clic fuera
    if (editModal) {
        editModal.addEventListener('click', function(e) {
            if (e.target === editModal) {
                editModal.classList.add('d-none');
                if (editConfigForm) editConfigForm.reset();
                if (editConfigMessage) {
                    editConfigMessage.textContent = '';
                    editConfigMessage.className = '';
                }
            }
        });
    }
    
    // Cargar configuraciones al iniciar
    loadSMSConfigs();
});

