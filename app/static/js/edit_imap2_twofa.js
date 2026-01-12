// app/static/js/edit_imap2_twofa.js
// Gestión de configuraciones 2FA por correo específicas para servidores IMAP2

(function() {
    'use strict';
    
    // Elementos del DOM
    const twofaForm = document.getElementById('imap2-twofa-config-form');
    const twofaConfigsList = document.getElementById('imap2-twofa-configs-list');
    const twofaEmailsInput = document.getElementById('imap2-twofa-emails-input');
    const twofaConfigId = document.getElementById('imap2-twofa-config-id');
    const twofaServerId = document.getElementById('imap2-twofa-server-id');
    const twofaSecretInput = document.getElementById('imap2-twofa-secret-input');
    const twofaQrFile = document.getElementById('imap2-twofa-qr-file');
    const twofaSecretDisplay = document.getElementById('imap2-twofa-secret-display');
    const twofaSecretDisplayValue = document.getElementById('imap2-twofa-secret-display-value');
    const twofaSaveBtn = document.getElementById('imap2-twofa-save-btn');
    const twofaCancelBtn = document.getElementById('imap2-twofa-cancel-btn');
    const twofaMessage = document.getElementById('imap2-twofa-message');
    const twofaUploadQrBtn = document.getElementById('imap2-twofa-upload-qr-btn');
    const twofaQrPreview = document.getElementById('imap2-twofa-qr-preview');
    
    let currentSecret = null;
    let currentConfigs = [];
    
    // Elementos de búsqueda y paginación
    const searchTwofaInput = document.getElementById('searchImap2TwofaInput');
    const showTwofaCount = document.getElementById('showImap2TwofaCount');
    const prevTwofaPageBtn = document.getElementById('prevImap2TwofaPageBtn');
    const nextTwofaPageBtn = document.getElementById('nextImap2TwofaPageBtn');
    
    let currentTwofaPage = 1;
    let perPage = showTwofaCount ? (parseInt(showTwofaCount.value) || 20) : 20;
    
    // Función para obtener token CSRF
    function getCsrfToken() {
        const metaTag = document.querySelector('meta[name="csrf_token"]');
        return metaTag ? metaTag.getAttribute('content') : '';
    }
    
    // Función para obtener server_id
    function getServerId() {
        return twofaServerId ? parseInt(twofaServerId.value) : null;
    }
    
    // Función para mostrar mensaje
    function showMessage(message, type = 'success') {
        if (!twofaMessage) return;
        twofaMessage.textContent = message;
        twofaMessage.className = `mt-05 text-center text-${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info'}`;
        setTimeout(() => {
            twofaMessage.textContent = '';
            twofaMessage.className = 'mt-05 text-center';
        }, 5000);
    }
    
    // Función para resetear formulario
    function resetForm() {
        if (twofaEmailsInput) twofaEmailsInput.value = '';
        if (twofaConfigId) twofaConfigId.value = '';
        if (twofaSecretInput) twofaSecretInput.value = '';
        if (twofaQrFile) twofaQrFile.value = '';
        currentSecret = null;
        if (twofaSecretDisplay) twofaSecretDisplay.classList.add('d-none');
        if (twofaSaveBtn) twofaSaveBtn.textContent = 'Agregar';
        if (twofaCancelBtn) twofaCancelBtn.classList.add('d-none');
        if (twofaQrPreview) {
            twofaQrPreview.innerHTML = '';
            twofaQrPreview.classList.add('d-none');
        }
    }
    
    // Manejar click en "Subir QR" - ahora abre el selector de archivo
    if (twofaUploadQrBtn) {
        twofaUploadQrBtn.addEventListener('click', function() {
            if (twofaQrFile) {
                twofaQrFile.click();
            }
        });
    }
    
    // Manejar subida de archivo QR
    if (twofaQrFile) {
        twofaQrFile.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            // Validar que sea una imagen
            if (!file.type.startsWith('image/')) {
                showMessage('Por favor selecciona un archivo de imagen', 'error');
                return;
            }
            
            // Mostrar preview
            const reader = new FileReader();
            reader.onload = function(e) {
                if (twofaQrPreview) {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.alt = 'QR Preview';
                    img.className = 'twofa-qr-preview-img';
                    twofaQrPreview.innerHTML = '';
                    twofaQrPreview.appendChild(img);
                    twofaQrPreview.classList.remove('d-none');
                }
            };
            reader.readAsDataURL(file);
            
            // Leer QR y extraer secreto
            const formData = new FormData();
            formData.append('qr_file', file);
            
            try {
                const response = await fetch('/admin/imap2/twofa-configs/read-qr', {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: formData
                });
                
                const data = await response.json();
                
                if (data.success && data.secret_key) {
                    currentSecret = data.secret_key;
                    // Llenar el campo de código manual con el secreto extraído
                    if (twofaSecretInput) {
                        twofaSecretInput.value = currentSecret;
                    }
                    if (twofaSecretDisplay) {
                        twofaSecretDisplayValue.textContent = currentSecret;
                        twofaSecretDisplay.classList.remove('d-none');
                    }
                    showMessage('QR code leído correctamente', 'success');
                } else {
                    showMessage(data.error || 'Error al leer el código QR', 'error');
                }
            } catch (error) {
                showMessage('Error al procesar el QR: ' + error.message, 'error');
            }
        });
    }
    
    // Manejar entrada manual de secreto
    if (twofaSecretInput) {
        twofaSecretInput.addEventListener('input', function(e) {
            const secret = e.target.value.trim().toUpperCase();
            if (secret && /^[A-Z0-9]{16,}$/.test(secret)) {
                currentSecret = secret;
                if (twofaSecretDisplay) {
                    twofaSecretDisplayValue.textContent = currentSecret;
                    twofaSecretDisplay.classList.remove('d-none');
                }
            } else if (secret.length === 0) {
                currentSecret = null;
                if (twofaSecretDisplay) twofaSecretDisplay.classList.add('d-none');
            }
        });
    }
    
    // Manejar envío del formulario (SOLO PARA CREAR, NO EDITAR)
    if (twofaForm) {
        twofaForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const serverId = getServerId();
            if (!serverId) {
                showMessage('Error: No se pudo identificar el servidor IMAP2', 'error');
                return;
            }
            
            const emails = twofaEmailsInput ? twofaEmailsInput.value.trim() : '';
            
            if (!emails) {
                showMessage('Debes ingresar al menos un correo', 'error');
                return;
            }
            
            // Obtener secreto del campo de código manual o del secreto actual
            const secretFromInput = twofaSecretInput ? twofaSecretInput.value.trim().toUpperCase() : '';
            if (secretFromInput && /^[A-Z0-9]{16,}$/.test(secretFromInput)) {
                currentSecret = secretFromInput;
            }
            
            if (!currentSecret) {
                showMessage('Debes proporcionar un secreto TOTP (ingresa el código manual o sube un QR)', 'error');
                return;
            }
            
            try {
                const response = await fetch(`/admin/imap2/${serverId}/twofa-configs`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        emails: emails,
                        secret_key: currentSecret
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showMessage(data.message || 'Configuración guardada correctamente', 'success');
                    resetForm();
                    loadConfigs();
                } else {
                    showMessage(data.error || 'Error al guardar la configuración', 'error');
                }
            } catch (error) {
                showMessage('Error al guardar: ' + error.message, 'error');
            }
        });
    }
    
    // Manejar cancelar
    if (twofaCancelBtn) {
        twofaCancelBtn.addEventListener('click', function() {
            resetForm();
        });
    }
    
    // Función para cargar configuraciones
    async function loadConfigs() {
        const serverId = getServerId();
        if (!serverId) {
            if (twofaConfigsList) {
                twofaConfigsList.innerHTML = '<p class="text-center text-danger">Error: No se pudo identificar el servidor IMAP2.</p>';
            }
            return;
        }
        
        try {
            const response = await fetch(`/admin/imap2/${serverId}/twofa-configs`, {
                method: 'GET',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (data.success && data.configs) {
                currentConfigs = data.configs;
                renderConfigsList(data.configs);
            } else {
                if (twofaConfigsList) {
                    twofaConfigsList.innerHTML = '<p class="text-center text-secondary">No hay configuraciones 2FA.</p>';
                }
            }
        } catch (error) {
            if (twofaConfigsList) {
                twofaConfigsList.innerHTML = '<p class="text-center text-danger">Error al cargar configuraciones.</p>';
            }
        }
    }
    
    // Función para obtener filas filtradas
    function getFilteredConfigs() {
        if (!twofaConfigsList) return [];
        const searchTerm = searchTwofaInput ? searchTwofaInput.value.toLowerCase() : '';
        const configItems = Array.from(twofaConfigsList.querySelectorAll('.regex-item[data-emails]'));
        
        return configItems.filter(item => {
            if (!searchTerm) return true;
            const emails = item.getAttribute('data-emails').toLowerCase();
            return emails.includes(searchTerm);
        });
    }
    
    // Función para renderizar página
    function renderTwofaPage() {
        const filteredConfigs = getFilteredConfigs();
        const totalConfigs = filteredConfigs.length;
        const showCount = showTwofaCount ? showTwofaCount.value : '5';
        const totalPages = showCount === 'all' ? 1 : Math.ceil(totalConfigs / perPage);
        
        let start = showCount === 'all' ? 0 : (currentTwofaPage - 1) * perPage;
        let end = showCount === 'all' ? totalConfigs : start + perPage;
        
        // Ocultar todas las configuraciones
        const allConfigs = Array.from(twofaConfigsList.querySelectorAll('.regex-item[data-emails]'));
        allConfigs.forEach(item => {
            item.style.display = 'none';
        });
        
        // Mostrar solo las configuraciones de la página actual
        filteredConfigs.slice(start, end).forEach(item => {
            item.style.display = '';
        });
        
        // Actualizar estado de botones de paginación
        if (prevTwofaPageBtn) {
            prevTwofaPageBtn.disabled = currentTwofaPage <= 1;
        }
        if (nextTwofaPageBtn) {
            nextTwofaPageBtn.disabled = currentTwofaPage >= totalPages || showCount === 'all';
        }
    }
    
    // Función para filtrar configuraciones
    function filterTwofaConfigs() {
        currentTwofaPage = 1;
        renderTwofaPage();
    }
    
    // Función para renderizar lista de configuraciones
    function renderConfigsList(configs) {
        if (!twofaConfigsList) return;
        
        if (!configs || configs.length === 0) {
            twofaConfigsList.innerHTML = '<p class="text-center text-secondary">No hay configuraciones 2FA. Agrega una nueva configuración arriba.</p>';
            return;
        }
        
        const configsHTML = configs.map(config => {
            const emailsList = config.emails_list || [];
            const emailsStr = emailsList.join(', ');
            
            return `
                <div class="regex-item" data-emails="${emailsStr.toLowerCase()}" data-config-id="${config.id}">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="flex-grow-1">
                            <div class="regex-description">${emailsStr || 'Sin correos'}</div>
                        </div>
                        <div class="d-flex gap-05">
                            <button type="button" class="btn-orange btn-small edit-twofa-config" data-config-id="${config.id}" title="Editar">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button type="button" class="btn-red btn-small delete-twofa-config" data-config-id="${config.id}" title="Eliminar">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        twofaConfigsList.innerHTML = configsHTML;
        
        // Agregar listeners para editar y eliminar
        attachEditDeleteListeners();
        
        // Renderizar página inicial
        renderTwofaPage();
    }
    
    // Función para agregar listeners de editar y eliminar
    function attachEditDeleteListeners() {
        // Listeners para editar
        const editButtons = twofaConfigsList.querySelectorAll('.edit-twofa-config');
        editButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = parseInt(this.getAttribute('data-config-id'));
                openEditModal(configId);
            });
        });
        
        // Listeners para eliminar
        const deleteButtons = twofaConfigsList.querySelectorAll('.delete-twofa-config');
        deleteButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                const configId = parseInt(this.getAttribute('data-config-id'));
                deleteConfig(configId);
            });
        });
    }
    
    // Función para abrir modal de edición
    function openEditModal(configId) {
        const config = currentConfigs.find(c => c.id === configId);
        if (!config) return;
        
        const editModal = document.getElementById('imap2-twofa-edit-modal');
        const editEmailsInput = document.getElementById('edit-imap2-twofa-emails-input');
        const editSecretInput = document.getElementById('edit-imap2-twofa-secret-input');
        const editSecretDisplay = document.getElementById('edit-imap2-twofa-secret-display');
        const editSecretDisplayValue = document.getElementById('edit-imap2-twofa-secret-display-value');
        const editConfigId = document.getElementById('edit-imap2-twofa-config-id');
        
        if (editModal && editEmailsInput && editSecretInput && editConfigId) {
            editConfigId.value = configId;
            editEmailsInput.value = config.emails;
            editSecretInput.value = config.secret_key;
            if (editSecretDisplay && editSecretDisplayValue) {
                editSecretDisplayValue.textContent = config.secret_key;
                editSecretDisplay.classList.remove('d-none');
            }
            editModal.classList.remove('d-none');
        }
    }
    
    // Función para cerrar modal de edición
    function closeEditModal() {
        const editModal = document.getElementById('imap2-twofa-edit-modal');
        if (editModal) {
            editModal.classList.add('d-none');
        }
    }
    
    // Listener para cerrar modal
    const closeEditModalBtn = document.getElementById('close-edit-imap2-twofa-modal');
    if (closeEditModalBtn) {
        closeEditModalBtn.addEventListener('click', closeEditModal);
    }
    
    // Listener para cancelar edición
    const editCancelBtn = document.getElementById('edit-imap2-twofa-cancel-btn');
    if (editCancelBtn) {
        editCancelBtn.addEventListener('click', closeEditModal);
    }
    
    // Listener para formulario de edición
    const editForm = document.getElementById('imap2-twofa-edit-form');
    if (editForm) {
        editForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const editConfigId = document.getElementById('edit-imap2-twofa-config-id');
            const editEmailsInput = document.getElementById('edit-imap2-twofa-emails-input');
            const editSecretInput = document.getElementById('edit-imap2-twofa-secret-input');
            
            if (!editConfigId || !editEmailsInput || !editSecretInput) return;
            
            const configId = parseInt(editConfigId.value);
            const emails = editEmailsInput.value.trim();
            const secretKey = editSecretInput.value.trim().toUpperCase();
            
            if (!emails) {
                showMessage('Debes ingresar al menos un correo', 'error');
                return;
            }
            
            if (!secretKey || !/^[A-Z0-9]{16,}$/.test(secretKey)) {
                showMessage('Debes proporcionar un secreto TOTP válido', 'error');
                return;
            }
            
            try {
                const response = await fetch(`/admin/imap2/twofa-configs/${configId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        emails: emails,
                        secret_key: secretKey
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showMessage(data.message || 'Configuración actualizada correctamente', 'success');
                    closeEditModal();
                    loadConfigs();
                } else {
                    showMessage(data.error || 'Error al actualizar la configuración', 'error');
                }
            } catch (error) {
                showMessage('Error al actualizar: ' + error.message, 'error');
            }
        });
    }
    
    // Función para eliminar configuración
    async function deleteConfig(configId) {
        if (!confirm('¿Estás seguro de que deseas eliminar esta configuración 2FA?')) {
            return;
        }
        
        try {
            const response = await fetch(`/admin/imap2/twofa-configs/${configId}`, {
                method: 'DELETE',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                showMessage(data.message || 'Configuración eliminada correctamente', 'success');
                loadConfigs();
            } else {
                showMessage(data.error || 'Error al eliminar la configuración', 'error');
            }
        } catch (error) {
            showMessage('Error al eliminar: ' + error.message, 'error');
        }
    }
    
    // Listeners para búsqueda y paginación
    if (searchTwofaInput) {
        searchTwofaInput.addEventListener('input', filterTwofaConfigs);
    }
    
    if (showTwofaCount) {
        showTwofaCount.addEventListener('change', function() {
            perPage = this.value === 'all' ? 999999 : parseInt(this.value) || 20;
            currentTwofaPage = 1;
            renderTwofaPage();
        });
    }
    
    if (prevTwofaPageBtn) {
        prevTwofaPageBtn.addEventListener('click', function() {
            if (currentTwofaPage > 1) {
                currentTwofaPage--;
                renderTwofaPage();
            }
        });
    }
    
    if (nextTwofaPageBtn) {
        nextTwofaPageBtn.addEventListener('click', function() {
            const filteredConfigs = getFilteredConfigs();
            const showCount = showTwofaCount ? showTwofaCount.value : '5';
            const totalPages = showCount === 'all' ? 1 : Math.ceil(filteredConfigs.length / perPage);
            if (currentTwofaPage < totalPages) {
                currentTwofaPage++;
                renderTwofaPage();
            }
        });
    }
    
    // Cargar configuraciones al iniciar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadConfigs);
    } else {
        loadConfigs();
    }
})();
