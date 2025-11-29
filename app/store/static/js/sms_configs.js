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
    
    // Función para cargar la lista de regex (reutilizable)
    function loadRegexList(configId) {
        const regexList = document.getElementById('sms-regex-list');
        if (!regexList) return;
        
        Promise.all([
            fetch('/tienda/admin/sms/regex', {
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            }).then(r => r.json()),
            fetch(`/tienda/admin/sms_configs/${configId}/regex`, {
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            }).then(r => r.json())
        ])
        .then(([allRegexData, configRegexData]) => {
            if (!allRegexData.success || !configRegexData.success) {
                regexList.innerHTML = '<p class="text-center text-danger">Error al cargar regex.</p>';
                return;
            }
            
            const allRegex = allRegexData.regexes || [];
            const configRegexIds = (configRegexData.regex_ids || []).map(id => parseInt(id));
            
            if (allRegex.length === 0) {
                regexList.innerHTML = '<p class="text-center text-secondary">No hay regex disponibles. Crea uno nuevo arriba.</p>';
                return;
            }
            
            const regexHTML = allRegex.map(regex => {
                const isChecked = configRegexIds.includes(regex.id);
                return `
                    <div class="d-flex align-items-center justify-content-between mb-1 p-1 regex-item-container">
                        <div class="d-flex align-items-center flex-grow-1">
                            <span class="ml-1 mb-0 flex-grow-1">
                                <strong>${escapeHtml(regex.name || 'Sin nombre')}</strong>
                                ${isChecked ? '<span class="text-success ml-1">✓ Asociado</span>' : ''}
                                <br><small class="text-secondary">${escapeHtml(regex.pattern || 'Sin patrón')}</small>
                            </span>
                        </div>
                        <div class="d-flex gap-05">
                            ${!isChecked ? `
                                <button type="button" class="btn-green btn-sm associate-regex-btn" data-regex-id="${regex.id}" title="Asociar a este número">
                                    <i class="fas fa-plus"></i>
                                </button>
                            ` : ''}
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
            
            // Agregar event listeners a los botones de asociar
            regexList.querySelectorAll('.associate-regex-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const regexId = parseInt(this.getAttribute('data-regex-id'));
                    updateSMSConfigRegex(configId, regexId, true);
                });
            });
            
            // Agregar event listeners a los botones de editar
            regexList.querySelectorAll('.edit-sms-regex-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const regexId = parseInt(this.getAttribute('data-regex-id'));
                    const regex = allRegex.find(r => r.id === regexId);
                    if (regex) {
                        openEditRegexModal(regex);
                    }
                });
            });
            
            // Agregar event listeners a los botones de eliminar
            regexList.querySelectorAll('.delete-sms-regex-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const regexId = parseInt(this.getAttribute('data-regex-id'));
                    const regex = allRegex.find(r => r.id === regexId);
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
});

