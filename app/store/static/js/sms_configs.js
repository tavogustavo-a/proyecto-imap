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
    function loadSMSConfigs(deletedConfigId = null) {
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
                // Pasar el deletedConfigId para que updateSMSNumberSelect sepa si se eliminó el número seleccionado
                updateSMSNumberSelect(data.configs, !deletedConfigId, deletedConfigId);
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
            if (config.number_type === 'android') {
                numberTypeBadge = '<span class="badge badge-info">Android</span>';
            } else if (config.number_type === 'comprado') {
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
                        <button type="button" class="btn-blue btn-sm reg-sms-config" data-config-id="${config.id}" title="Regex">
                            Reg
                        </button>
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
        
        // Agregar event listeners para regex
        smsConfigsList.querySelectorAll('.reg-sms-config').forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = parseInt(this.getAttribute('data-config-id'));
                openRegexModal(configId, configs);
            });
        });
        
        // Agregar event listeners para editar
        smsConfigsList.querySelectorAll('.edit-sms-config').forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = parseInt(this.getAttribute('data-config-id'));
                // ✅ Siempre usar el modal normal (ahora soporta Android)
                editConfig(configId, configs);
            });
        });
    }
    
    // Actualizar select de números SMS
    function updateSMSNumberSelect(configs, preserveSelection = true, deletedConfigId = null) {
        if (!smsNumberSelect) return;
        
        // Guardar la selección actual antes de actualizar
        const currentSelection = preserveSelection ? smsNumberSelect.value : null;
        const wasDeletedSelected = deletedConfigId && currentSelection === deletedConfigId.toString();
        
        smsNumberSelect.innerHTML = '<option value="">-- Selecciona un número --</option>';
        
        // Todos los números siempre están activos, no filtrar por is_enabled
        configs.forEach(config => {
            const option = document.createElement('option');
            option.value = config.id;
            option.textContent = `${config.phone_number} - ${config.name} (${config.messages_count || 0} mensajes)`;
            smsNumberSelect.appendChild(option);
        });
        
        // Si se eliminó el número seleccionado o no hay selección, seleccionar el primero disponible
        let configToSelect = null;
        if (wasDeletedSelected || !currentSelection) {
            // Si se eliminó el seleccionado o no había selección, seleccionar el primero
            if (configs.length > 0) {
                configToSelect = configs[0].id;
            }
        } else if (currentSelection && configs.some(c => c.id.toString() === currentSelection)) {
            // Si la selección actual todavía existe, mantenerla
            configToSelect = currentSelection;
        } else if (configs.length > 0) {
            // Si la selección actual ya no existe pero hay números disponibles, seleccionar el primero
            configToSelect = configs[0].id;
        }
        
        if (configToSelect) {
            smsNumberSelect.value = configToSelect;
            // Disparar evento change para notificar a sms_list.js
            smsNumberSelect.dispatchEvent(new Event('change'));
        }
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
                // Recargar configuraciones y actualizar select, pasando el ID del número eliminado
                loadSMSConfigs(configId);
            }
        })
        .catch(err => {
            showMessage(`Error al eliminar: ${err.message}`, 'error');
        });
    }
    
    // Variable global para almacenar el configId actual del modal
    let currentRegexModalConfigId = null;
    
    // Abrir modal de regex
    function openRegexModal(configId, configs) {
        const config = configs.find(c => c.id === configId);
        if (!config) return;
        
        currentRegexModalConfigId = configId;
        
        const regexModal = document.getElementById('sms-regex-modal');
        const regexConfigName = document.getElementById('sms-regex-config-name');
        const regexList = document.getElementById('sms-regex-list');
        const regexMessage = document.getElementById('sms-regex-message');
        
        if (!regexModal || !regexConfigName || !regexList) return;
        
        regexConfigName.textContent = `${config.name} (${config.phone_number})`;
        regexList.innerHTML = '<p class="text-center text-secondary">Cargando regex...</p>';
        if (regexMessage) {
            regexMessage.textContent = '';
            regexMessage.className = '';
        }
        
        regexModal.classList.remove('d-none');
        
        // Cargar regex SMS disponibles y los asociados a este SMS config
        loadRegexList(configId);
    }
    
    // Función para cargar la lista de regex (reutilizable) - uno-a-muchos
    function loadRegexList(configId) {
        const regexList = document.getElementById('sms-regex-list');
        if (!regexList) return;
        
        // Cargar solo los regexes del número SMS actual (uno-a-muchos)
        fetch(`/tienda/admin/sms/regex?config_id=${configId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(handleFetchResponse)
        .then(data => {
            const regexes = data.regexes || [];
            
            if (regexes.length === 0) {
                regexList.innerHTML = '<p class="text-center text-secondary">No hay regex disponibles. Crea uno nuevo arriba.</p>';
                return;
            }
            
            const regexHTML = regexes.map(regex => {
                return `
                    <div class="d-flex align-items-center justify-content-between mb-1 p-1 regex-item-container">
                        <div class="d-flex align-items-center flex-grow-1">
                            <span class="ml-1 mb-0 flex-grow-1">
                                <strong>${escapeHtml(regex.name || 'Sin nombre')}</strong>
                                <br><small class="text-secondary">${escapeHtml(regex.pattern || 'Sin patrón')}</small>
                            </span>
                        </div>
                        <div class="d-flex gap-05">
                            <button type="button" class="btn-orange btn-sm edit-sms-regex-btn" data-regex-id="${regex.id}" title="Editar">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button type="button" class="btn-red btn-sm delete-sms-regex-btn" data-regex-id="${regex.id}" title="Eliminar">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
            
            regexList.innerHTML = regexHTML;
            
            // Agregar event listeners a los botones de editar
            regexList.querySelectorAll('.edit-sms-regex-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const regexId = parseInt(this.getAttribute('data-regex-id'));
                    const regex = regexes.find(r => r.id === regexId);
                    if (regex) {
                        openEditRegexModal(regex);
                    }
                });
            });
            
            // Agregar event listeners a los botones de eliminar
            regexList.querySelectorAll('.delete-sms-regex-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const regexId = parseInt(this.getAttribute('data-regex-id'));
                    const regex = regexes.find(r => r.id === regexId);
                    if (regex) {
                        if (confirm(`¿Estás seguro de que deseas eliminar el regex "${escapeHtml(regex.name || 'Sin nombre')}"?`)) {
                            deleteSMSRegex(regexId);
                        }
                    }
                });
            });
        })
        .catch(err => {
            regexList.innerHTML = '<p class="text-center text-danger">Error al cargar regex.</p>';
        });
    }
    
    // Actualizar regex asociado a SMS config
    function updateSMSConfigRegex(configId, regexId, add) {
        const regexMessage = document.getElementById('sms-regex-message');
        
        fetch(`/tienda/admin/sms_configs/${configId}/regex`, {
            method: add ? 'POST' : 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ regex_id: regexId })
        })
        .then(handleFetchResponse)
        .then(data => {
            if (data.success) {
                if (regexMessage) {
                    regexMessage.textContent = add ? 'Regex agregado correctamente.' : 'Regex eliminado correctamente.';
                    regexMessage.className = 'text-success';
                    setTimeout(() => {
                        if (regexMessage) {
                            regexMessage.textContent = '';
                            regexMessage.className = '';
                        }
                    }, 2000);
                }
            }
        })
        .catch(err => {
            if (regexMessage) {
                regexMessage.textContent = `Error: ${err.message}`;
                regexMessage.className = 'text-danger';
            }
        });
    }
    
    // Abrir modal para editar regex
    function openEditRegexModal(regex) {
        const editModal = document.getElementById('sms-regex-edit-modal');
        const editRegexId = document.getElementById('edit-regex-id');
        const editRegexName = document.getElementById('edit-regex-name');
        const editRegexPattern = document.getElementById('edit-regex-pattern');
        const editRegexMessage = document.getElementById('edit-regex-message');
        
        if (!editModal || !editRegexId || !editRegexName || !editRegexPattern) return;
        
        editRegexId.value = regex.id;
        editRegexName.value = regex.name || '';
        editRegexPattern.value = regex.pattern || '';
        if (editRegexMessage) {
            editRegexMessage.textContent = '';
            editRegexMessage.className = '';
        }
        
        editModal.classList.remove('d-none');
    }
    
    // Eliminar regex SMS
    function deleteSMSRegex(regexId) {
        const regexMessage = document.getElementById('sms-regex-message');
        
        fetch(`/tienda/admin/sms/regex/${regexId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(handleFetchResponse)
        .then(data => {
            if (data.success) {
                if (regexMessage) {
                    regexMessage.textContent = 'Regex eliminado correctamente.';
                    regexMessage.className = 'text-success';
                }
                // Recargar la lista de regex usando el configId guardado
                if (currentRegexModalConfigId !== null) {
                    loadRegexList(currentRegexModalConfigId);
                }
                // Limpiar mensaje después de 2 segundos
                setTimeout(() => {
                    if (regexMessage) {
                        regexMessage.textContent = '';
                        regexMessage.className = '';
                    }
                }, 2000);
            }
        })
        .catch(err => {
            if (regexMessage) {
                regexMessage.textContent = `Error: ${err.message}`;
                regexMessage.className = 'text-danger';
            }
        });
    }
    
    // Crear nuevo regex
    function createSMSRegex() {
        const newRegexName = document.getElementById('new-regex-name');
        const newRegexPattern = document.getElementById('new-regex-pattern');
        const regexMessage = document.getElementById('sms-regex-message');
        
        if (!newRegexName || !newRegexPattern) return;
        
        const name = newRegexName.value.trim();
        const pattern = newRegexPattern.value.trim();
        
        if (!name || !pattern) {
            if (regexMessage) {
                regexMessage.textContent = 'Nombre y patrón son requeridos.';
                regexMessage.className = 'text-danger';
            }
            return;
        }
        
        // Obtener el configId actual del modal
        const configId = currentRegexModalConfigId;
        
        if (!configId) {
            if (regexMessage) {
                regexMessage.textContent = 'Error: No se ha seleccionado un número SMS.';
                regexMessage.className = 'text-danger';
            }
            return;
        }
        
        fetch('/tienda/admin/sms/regex', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ name, pattern, sms_config_id: configId })
        })
        .then(handleFetchResponse)
        .then(data => {
            if (data.success) {
                if (regexMessage) {
                    regexMessage.textContent = 'Regex creado correctamente.';
                    regexMessage.className = 'text-success';
                }
                // Limpiar campos
                newRegexName.value = '';
                newRegexPattern.value = '';
                // Recargar la lista de regex (necesitamos el configId)
                const regexModal = document.getElementById('sms-regex-modal');
                if (regexModal && !regexModal.classList.contains('d-none')) {
                    // Obtener el configId del modal abierto
                    const configNameEl = document.getElementById('sms-regex-config-name');
                    if (configNameEl && configNameEl.textContent) {
                        // Buscar el configId desde window.smsConfigsData
                        if (window.smsConfigsData) {
                            const configIdMatch = configNameEl.textContent.match(/\((\+\d+)\)/);
                            if (configIdMatch && window.smsConfigsData) {
                                const phoneNumber = configIdMatch[1];
                                const config = window.smsConfigsData.find(c => c.phone_number === phoneNumber);
                                if (config) {
                                    openRegexModal(config.id, window.smsConfigsData);
                                }
                            }
                        }
                    }
                }
            }
        })
        .catch(err => {
            if (regexMessage) {
                regexMessage.textContent = `Error: ${err.message}`;
                regexMessage.className = 'text-danger';
            }
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
        const editConfigType = document.getElementById('edit-sms-config-type');
        const editName = document.getElementById('edit-sms-config-name');
        const editAccountSid = document.getElementById('edit-sms-config-account-sid');
        const editAuthToken = document.getElementById('edit-sms-config-auth-token');
        const editPhone = document.getElementById('edit-sms-config-phone');
        
        // Campos Android
        const editAndroidFields = document.getElementById('edit-android-fields');
        const editTwilioFields = document.getElementById('edit-twilio-fields');
        const editAndroidConfigName = document.getElementById('edit-android-config-name');
        const editAndroidPhone = document.getElementById('edit-android-phone-number');
        const editAndroidApiKey = document.getElementById('edit-android-api-key');
        const editWebhookUrl = document.getElementById('edit-webhook-url');
        const copyEditWebhookBtn = document.getElementById('copy-edit-webhook-btn');
        
        if (!editModal || !editForm || !editConfigId || !editPhone) return;
        
            editConfigId.value = config.id;
            editPhone.value = config.phone_number;
            
        // ✅ Detectar si es Android
        const isAndroid = config.number_type === 'android';
        
        if (editConfigType) {
            editConfigType.value = isAndroid ? 'android' : 'twilio';
        }
        
        if (isAndroid) {
            // Mostrar campos Android, ocultar campos Twilio
            if (editAndroidFields) editAndroidFields.style.display = 'block';
            if (editTwilioFields) editTwilioFields.style.display = 'none';
            if (editName) editName.required = false;
            if (editAccountSid) editAccountSid.required = false;
            
            // Poblar campos Android
            if (editAndroidConfigName) {
                editAndroidConfigName.value = config.name || '';
                editAndroidConfigName.required = true;
            }
            if (editAndroidPhone) {
                editAndroidPhone.value = config.phone_number;
                editAndroidPhone.required = true;
            }
            
            // Cargar API key y webhook URL desde la configuración Android
            fetch('/tienda/admin/android-sms-config', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                }
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success && data.configs) {
                    const androidConfig = data.configs.find(c => c.id === configId);
                    if (androidConfig) {
                        if (editAndroidApiKey) {
                            editAndroidApiKey.value = androidConfig.api_key || '';
                        }
                        // ✅ Mostrar URL del webhook en el modal
                        if (editWebhookUrl && data.webhook_url) {
                            editWebhookUrl.textContent = data.webhook_url;
                        }
                    }
                }
            })
            .catch(err => {
                console.error('Error al cargar configuración Android:', err);
            });
        } else {
            // Mostrar campos Twilio, ocultar campos Android
            if (editAndroidFields) editAndroidFields.style.display = 'none';
            if (editTwilioFields) editTwilioFields.style.display = 'block';
            if (editName) editName.required = true;
            if (editAccountSid) editAccountSid.required = true;
            if (editAndroidPhone) editAndroidPhone.required = false;
            
            // Poblar campos Twilio
            if (editName) editName.value = config.name;
            if (editAccountSid) editAccountSid.value = config.twilio_account_sid;
            if (editAuthToken) editAuthToken.value = ''; // No mostrar el token por seguridad
        }
        
        editModal.classList.remove('d-none');
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
            const configType = document.getElementById('edit-sms-config-type') ? document.getElementById('edit-sms-config-type').value : '';
            const isAndroid = configType === 'android';
            
            let formData;
            
            if (isAndroid) {
                // Formulario Android
                const editAndroidConfigName = document.getElementById('edit-android-config-name');
                const editAndroidPhone = document.getElementById('edit-android-phone-number');
                const editAndroidApiKey = document.getElementById('edit-android-api-key');
                
                if (!editAndroidConfigName || !editAndroidConfigName.value.trim()) {
                    if (editConfigMessage) {
                        editConfigMessage.textContent = 'Por favor ingresa el nombre.';
                        editConfigMessage.className = 'sms-error-message';
                    }
                    return;
                }
                
                if (!editAndroidPhone || !editAndroidPhone.value.trim()) {
                    if (editConfigMessage) {
                        editConfigMessage.textContent = 'Por favor ingresa el número Android.';
                        editConfigMessage.className = 'sms-error-message';
                    }
                    return;
                }
                
                formData = {
                    name: editAndroidConfigName.value.trim(),
                    phone_number: editAndroidPhone.value.trim(),
                    api_key: editAndroidApiKey ? editAndroidApiKey.value.trim() : '',
                    config_id: configId
                };
                
                // Usar endpoint de Android
                fetch('/tienda/admin/android-sms-config', {
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
                        if (editConfigMessage) {
                            editConfigMessage.textContent = data.message || 'Configuración Android actualizada correctamente.';
                            editConfigMessage.className = 'text-success';
                        }
                        if (editModal) editModal.classList.add('d-none');
                        // Recargar listas
                        loadSMSConfigs();
                        if (typeof loadAndroidSmsConfigs === 'function') {
                            loadAndroidSmsConfigs();
                        }
                    } else {
                        if (editConfigMessage) {
                            editConfigMessage.textContent = data.message || data.error || 'Error al actualizar';
                            editConfigMessage.className = 'sms-error-message';
                        }
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    if (editConfigMessage) {
                        editConfigMessage.textContent = `Error: ${err.message}`;
                        editConfigMessage.className = 'sms-error-message';
                    }
                });
                return;
            } else {
                // Formulario Twilio (normal)
                formData = {
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
                            if (editConfigForm) {
                                editConfigForm.reset();
                                // Resetear campos específicos
                                const editConfigType = document.getElementById('edit-sms-config-type');
                                if (editConfigType) editConfigType.value = '';
                                const editAndroidFields = document.getElementById('edit-android-fields');
                                const editTwilioFields = document.getElementById('edit-twilio-fields');
                                if (editAndroidFields) editAndroidFields.style.display = 'none';
                                if (editTwilioFields) editTwilioFields.style.display = 'block';
                            }
                        if (editConfigMessage) {
                            editConfigMessage.textContent = '';
                            editConfigMessage.className = '';
                        }
                        loadSMSConfigs();
                        // Recargar números en sms_list.js si existe
                        if (typeof loadSMSNumbers === 'function') {
                            loadSMSNumbers();
                        }
                            // Recargar configuraciones Android si existe
                            if (typeof loadAndroidSmsConfigs === 'function') {
                                loadAndroidSmsConfigs();
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
            if (editConfigForm) {
                editConfigForm.reset();
                // Resetear campos específicos
                const editConfigType = document.getElementById('edit-sms-config-type');
                if (editConfigType) editConfigType.value = '';
                const editAndroidFields = document.getElementById('edit-android-fields');
                const editTwilioFields = document.getElementById('edit-twilio-fields');
                if (editAndroidFields) editAndroidFields.style.display = 'none';
                if (editTwilioFields) editTwilioFields.style.display = 'block';
                // Resetear campos requeridos
                const editName = document.getElementById('edit-sms-config-name');
                const editAccountSid = document.getElementById('edit-sms-config-account-sid');
                const editAndroidPhone = document.getElementById('edit-android-phone-number');
                if (editName) editName.required = true;
                if (editAccountSid) editAccountSid.required = true;
                if (editAndroidPhone) editAndroidPhone.required = false;
            }
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
    
    // Modal de regex
    const regexModal = document.getElementById('sms-regex-modal');
    const closeRegexModal = document.getElementById('close-regex-modal');
    const createRegexBtn = document.getElementById('create-regex-btn');
    
    if (closeRegexModal) {
        closeRegexModal.addEventListener('click', function() {
            if (regexModal) regexModal.classList.add('d-none');
        });
    }
    
    if (regexModal) {
        regexModal.addEventListener('click', function(e) {
            if (e.target === regexModal) {
                regexModal.classList.add('d-none');
            }
        });
    }
    
    if (createRegexBtn) {
        createRegexBtn.addEventListener('click', createSMSRegex);
    }
    
    // Modal de editar regex
    const editRegexModal = document.getElementById('sms-regex-edit-modal');
    const editRegexForm = document.getElementById('edit-regex-form');
    const closeEditRegexModal = document.getElementById('close-edit-regex-modal');
    
    if (editRegexForm) {
        editRegexForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const regexId = document.getElementById('edit-regex-id').value;
            const name = document.getElementById('edit-regex-name').value.trim();
            const pattern = document.getElementById('edit-regex-pattern').value.trim();
            const editRegexMessage = document.getElementById('edit-regex-message');
            
            if (!name || !pattern) {
                if (editRegexMessage) {
                    editRegexMessage.textContent = 'Nombre y patrón son requeridos.';
                    editRegexMessage.className = 'text-danger';
                }
                return;
            }
            
            fetch(`/tienda/admin/sms/regex/${regexId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ name, pattern })
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success) {
                    if (editRegexMessage) {
                        editRegexMessage.textContent = 'Regex actualizado correctamente.';
                        editRegexMessage.className = 'text-success';
                    }
                    // Cerrar modal y recargar lista
                    if (editRegexModal) editRegexModal.classList.add('d-none');
                    // Recargar la lista de regex usando el configId guardado
                    if (currentRegexModalConfigId !== null) {
                        loadRegexList(currentRegexModalConfigId);
                    }
                }
            })
            .catch(err => {
                if (editRegexMessage) {
                    editRegexMessage.textContent = `Error: ${err.message}`;
                    editRegexMessage.className = 'text-danger';
                }
            });
        });
    }
    
    if (closeEditRegexModal) {
        closeEditRegexModal.addEventListener('click', function() {
            if (editRegexModal) editRegexModal.classList.add('d-none');
            if (editRegexForm) editRegexForm.reset();
        });
    }
    
    if (editRegexModal) {
        editRegexModal.addEventListener('click', function(e) {
            if (e.target === editRegexModal) {
                editRegexModal.classList.add('d-none');
            }
        });
    }
    
    // Botón para probar estados de números
    const testNumberStatesBtn = document.getElementById('test-number-states-btn');
    if (testNumberStatesBtn) {
        testNumberStatesBtn.addEventListener('click', function() {
            // Deshabilitar botón mientras se procesa
            testNumberStatesBtn.disabled = true;
            const originalText = testNumberStatesBtn.textContent;
            testNumberStatesBtn.textContent = 'Probando...';
            
            fetch('/tienda/admin/sms_configs/test-number-states', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                }
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success) {
                    // Recargar la lista para mostrar los nuevos estados
                    loadSMSConfigs();
                }
            })
            .catch(err => {
                alert(`Error: ${err.message}`);
            })
            .finally(() => {
                // Rehabilitar botón
                testNumberStatesBtn.disabled = false;
                testNumberStatesBtn.textContent = originalText;
            });
        });
    }
    
    // Cargar configuraciones al iniciar
    loadSMSConfigs();
    
    // ============================================
    // 📱 CONFIGURACIÓN ANDROID SMS (MÚLTIPLES NÚMEROS)
    // ============================================
    const androidSmsForm = document.getElementById('android-sms-form');
    const androidConfigName = document.getElementById('android-config-name');
    const androidPhoneNumber = document.getElementById('android-phone-number');
    const androidApiKey = document.getElementById('android-api-key');
    const androidConfigId = document.getElementById('android-config-id');
    const generateApiKeyBtn = document.getElementById('generate-api-key-btn');
    const androidSmsSaveBtn = document.getElementById('android-sms-save-btn');
    const androidSmsCancelBtn = document.getElementById('android-sms-cancel-btn');
    const androidSmsMessage = document.getElementById('android-sms-message');
    const androidConfigsList = document.getElementById('android-configs-list');
    
    // Cargar configuraciones Android al iniciar
    function loadAndroidSmsConfigs() {
        if (!androidConfigsList) return;
        
        androidConfigsList.innerHTML = '<p class="text-center">Cargando...</p>';
        
        fetch('/tienda/admin/android-sms-config', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(handleFetchResponse)
        .then(data => {
            if (data.success) {
                renderAndroidConfigsList(data.configs || [], data.webhook_url || '');
            } else {
                androidConfigsList.innerHTML = '<p class="text-center text-danger">Error al cargar configuraciones</p>';
            }
        })
        .catch(error => {
            console.error('Error al cargar configuraciones Android:', error);
            androidConfigsList.innerHTML = '<p class="text-center text-danger">Error al cargar configuraciones</p>';
        });
    }
    
    // Renderizar lista de configuraciones Android (OCULTA - no se usa)
    function renderAndroidConfigsList(configs, webhookUrl) {
        // ✅ Lista oculta - los números Android se gestionan desde la lista general y el modal de edición
        if (!androidConfigsList) return;
        // No renderizar nada, la lista está oculta
        androidConfigsList.innerHTML = '';
    }
    
    // Editar configuración Android
    function editAndroidConfig(config) {
        if (androidConfigName) androidConfigName.value = config.name || '';
        if (androidPhoneNumber) androidPhoneNumber.value = config.phone_number || '';
        if (androidApiKey) androidApiKey.value = config.api_key || '';
        if (androidConfigId) androidConfigId.value = config.id || '';
        if (androidSmsSaveBtn) androidSmsSaveBtn.textContent = 'Actualizar Configuración';
        if (androidSmsCancelBtn) androidSmsCancelBtn.classList.remove('d-none');
        if (androidSmsMessage) androidSmsMessage.textContent = '';
    }
    
    // Cancelar edición
    if (androidSmsCancelBtn) {
        androidSmsCancelBtn.addEventListener('click', function() {
            resetAndroidForm();
        });
    }
    
    // Resetear formulario Android
    function resetAndroidForm() {
        if (androidPhoneNumber) androidPhoneNumber.value = '';
        if (androidApiKey) androidApiKey.value = '';
        if (androidConfigId) androidConfigId.value = '';
        if (androidSmsSaveBtn) androidSmsSaveBtn.textContent = 'Agregar Número Android';
        if (androidSmsCancelBtn) androidSmsCancelBtn.classList.add('d-none');
        if (androidSmsMessage) androidSmsMessage.textContent = '';
    }
    
    // Eliminar configuración Android
    function deleteAndroidConfig(configId) {
        if (!confirm('¿Estás seguro de que quieres eliminar esta configuración Android?')) {
            return;
        }
        
        // Eliminar usando el endpoint de SMS configs (ya existe)
        fetch(`/tienda/admin/sms_configs/${configId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        })
        .then(response => {
            // Verificar si la respuesta es JSON o HTML (error 404/500)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return response.json();
            } else {
                // Si no es JSON, probablemente es un error HTML
                return response.text().then(text => {
                    throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
                });
            }
        })
        .then(data => {
            if (data.success) {
                // Recargar lista de configuraciones Android
                loadAndroidSmsConfigs();
                // También recargar lista general de SMS configs
                if (typeof loadSMSConfigs === 'function') {
                    loadSMSConfigs();
                }
                resetAndroidForm();
                
                // Mostrar mensaje de éxito
                if (androidSmsMessage) {
                    androidSmsMessage.textContent = 'Configuración Android eliminada correctamente';
                    androidSmsMessage.className = 'mt-05 text-center text-success';
                }
            } else {
                const errorMsg = data.message || data.error || 'Error desconocido';
                alert('Error al eliminar: ' + errorMsg);
            }
        })
        .catch(error => {
            console.error('Error al eliminar configuración Android:', error);
            alert('Error al eliminar configuración: ' + (error.message || 'Error desconocido'));
        });
    }
    
    // Generar API key aleatoria
    if (generateApiKeyBtn) {
        generateApiKeyBtn.addEventListener('click', function() {
            // Generar una clave aleatoria de 32 caracteres
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let apiKey = '';
            for (let i = 0; i < 32; i++) {
                apiKey += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            androidApiKey.value = apiKey;
            // Cambiar a tipo text para mostrar la clave generada
            androidApiKey.type = 'text';
            const eyeIcon = document.getElementById('api-key-eye-icon');
            if (eyeIcon) {
                eyeIcon.classList.remove('fa-eye');
                eyeIcon.classList.add('fa-eye-slash');
            }
            androidSmsMessage.textContent = 'API Key generada. No olvides guardar la configuración.';
            androidSmsMessage.className = 'mt-05 text-center text-success';
        });
    }
    
    // Toggle mostrar/ocultar API key
    const toggleApiKeyVisibility = document.getElementById('toggle-api-key-visibility');
    if (toggleApiKeyVisibility && androidApiKey) {
        toggleApiKeyVisibility.addEventListener('click', function() {
            const eyeIcon = document.getElementById('api-key-eye-icon');
            if (androidApiKey.type === 'password') {
                androidApiKey.type = 'text';
                if (eyeIcon) {
                    eyeIcon.classList.remove('fa-eye');
                    eyeIcon.classList.add('fa-eye-slash');
                }
            } else {
                androidApiKey.type = 'password';
                if (eyeIcon) {
                    eyeIcon.classList.remove('fa-eye-slash');
                    eyeIcon.classList.add('fa-eye');
                }
            }
        });
    }
    
    // El código para copiar webhook ahora está dentro de renderAndroidConfigsList()
    // No se necesita aquí porque cada configuración tiene su propio botón de copiar
    
    // Guardar configuración Android
    if (androidSmsForm) {
        androidSmsForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const configName = androidConfigName ? androidConfigName.value.trim() : '';
            const phoneNumber = androidPhoneNumber.value.trim();
            const apiKey = androidApiKey.value.trim();
            
            if (!configName) {
                androidSmsMessage.textContent = 'Por favor ingresa un nombre para identificar este número';
                androidSmsMessage.className = 'mt-05 text-center text-danger';
                return;
            }
            
            if (!phoneNumber) {
                androidSmsMessage.textContent = 'Por favor ingresa tu número Android';
                androidSmsMessage.className = 'mt-05 text-center text-danger';
                return;
            }
            
            // Validar formato del número
            const phoneRegex = /^\+[1-9]\d{1,14}$/;
            if (!phoneRegex.test(phoneNumber)) {
                androidSmsMessage.textContent = 'Formato inválido. Debe ser: +573001234567 (con código de país)';
                androidSmsMessage.className = 'mt-05 text-center text-danger';
                return;
            }
            
            androidSmsSaveBtn.disabled = true;
            androidSmsSaveBtn.textContent = 'Guardando...';
            androidSmsMessage.textContent = '';
            
            const configId = androidConfigId ? androidConfigId.value : null;
            
            fetch('/tienda/admin/android-sms-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({
                    name: configName,
                    phone_number: phoneNumber,
                    api_key: apiKey,
                    config_id: configId || undefined
                })
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success) {
                    androidSmsMessage.textContent = data.message + (data.api_key ? ' API Key: ' + data.api_key : '');
                    androidSmsMessage.className = 'mt-05 text-center text-success';
                    
                    // Actualizar API key si se generó una nueva
                    if (data.api_key && !apiKey) {
                        androidApiKey.value = data.api_key;
                    }
                    
                    // Recargar lista de configuraciones Android
                    setTimeout(() => {
                        loadAndroidSmsConfigs();
                        resetAndroidForm();
                    }, 500);
                } else {
                    androidSmsMessage.textContent = data.message || 'Error al guardar';
                    androidSmsMessage.className = 'mt-05 text-center text-danger';
                }
            })
            .catch(error => {
                console.error('Error:', error);
                androidSmsMessage.textContent = 'Error al guardar configuración: ' + error.message;
                androidSmsMessage.className = 'mt-05 text-center text-danger';
            })
            .finally(() => {
                androidSmsSaveBtn.disabled = false;
                androidSmsSaveBtn.textContent = configId ? 'Actualizar Configuración' : 'Agregar Número Android';
            });
        });
    }
    
    // Cargar configuraciones Android al iniciar
    if (androidConfigsList) {
        // Asegurar que el formulario esté vacío al iniciar
        resetAndroidForm();
        loadAndroidSmsConfigs();
    }
    
    // ✅ Funcionalidad para campos Android en el modal de edición
    const generateEditApiKeyBtn = document.getElementById('generate-edit-api-key-btn');
    const toggleEditApiKeyVisibility = document.getElementById('toggle-edit-api-key-visibility');
    const editAndroidApiKey = document.getElementById('edit-android-api-key');
    
    // Generar API key en el modal de edición
    if (generateEditApiKeyBtn && editAndroidApiKey) {
        generateEditApiKeyBtn.addEventListener('click', function() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let apiKey = '';
            for (let i = 0; i < 32; i++) {
                apiKey += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            editAndroidApiKey.value = apiKey;
            editAndroidApiKey.type = 'text';
            const eyeIcon = document.getElementById('edit-api-key-eye-icon');
            if (eyeIcon) {
                eyeIcon.classList.remove('fa-eye');
                eyeIcon.classList.add('fa-eye-slash');
            }
        });
    }
    
    // Toggle mostrar/ocultar API key en el modal de edición
    if (toggleEditApiKeyVisibility && editAndroidApiKey) {
        toggleEditApiKeyVisibility.addEventListener('click', function() {
            const eyeIcon = document.getElementById('edit-api-key-eye-icon');
            if (editAndroidApiKey.type === 'password' || editAndroidApiKey.type === 'text') {
                editAndroidApiKey.type = editAndroidApiKey.type === 'password' ? 'text' : 'password';
                if (eyeIcon) {
                    if (editAndroidApiKey.type === 'text') {
                        eyeIcon.classList.remove('fa-eye');
                        eyeIcon.classList.add('fa-eye-slash');
                    } else {
                        eyeIcon.classList.remove('fa-eye-slash');
                        eyeIcon.classList.add('fa-eye');
                    }
                }
            }
        });
    }
    
    // ✅ Copiar URL del webhook desde el modal de edición
    const copyEditWebhookBtn = document.getElementById('copy-edit-webhook-btn');
    if (copyEditWebhookBtn) {
        copyEditWebhookBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const editWebhookUrl = document.getElementById('edit-webhook-url');
            if (!editWebhookUrl) return;
            
            const url = editWebhookUrl.textContent;
            if (!url || url === 'Cargando...') {
                console.error('URL del webhook no disponible');
                return;
            }
            
            navigator.clipboard.writeText(url).then(() => {
                const originalText = this.innerHTML;
                this.innerHTML = '<i class="fas fa-check"></i> Copiado';
                this.classList.add('btn-green');
                this.classList.remove('btn-blue');
                setTimeout(() => {
                    this.innerHTML = originalText;
                    this.classList.remove('btn-green');
                    this.classList.add('btn-blue');
                }, 2000);
            }).catch(err => {
                console.error('Error al copiar URL:', err);
                // Fallback
                const tempInput = document.createElement('input');
                tempInput.value = url;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);
                
                const originalText = this.innerHTML;
                this.innerHTML = '<i class="fas fa-check"></i> Copiado';
                this.classList.add('btn-green');
                this.classList.remove('btn-blue');
                setTimeout(() => {
                    this.innerHTML = originalText;
                    this.classList.remove('btn-green');
                    this.classList.add('btn-blue');
                }, 2000);
            });
        });
    }
});

