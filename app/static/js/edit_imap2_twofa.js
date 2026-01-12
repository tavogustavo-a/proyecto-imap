// app/static/js/edit_imap2_twofa.js
// Gestión de configuraciones 2FA por correo específicas para servidores IMAP2

(function() {
    'use strict';
    
    // Función para escapar HTML (CSP compliant)
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
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
            // Limpiar contenido usando removeChild (CSP compliant)
            while (twofaQrPreview.firstChild) {
                twofaQrPreview.removeChild(twofaQrPreview.firstChild);
            }
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
                    // Limpiar contenido usando removeChild (CSP compliant)
                    while (twofaQrPreview.firstChild) {
                        twofaQrPreview.removeChild(twofaQrPreview.firstChild);
                    }
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.alt = 'QR Preview';
                    img.className = 'twofa-qr-preview-img';
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
                // Limpiar contenido usando removeChild (CSP compliant)
                while (twofaConfigsList.firstChild) {
                    twofaConfigsList.removeChild(twofaConfigsList.firstChild);
                }
                const errorP = document.createElement('p');
                errorP.className = 'text-center text-danger';
                errorP.textContent = 'Error: No se pudo identificar el servidor IMAP2.';
                twofaConfigsList.appendChild(errorP);
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
                    // Limpiar contenido usando removeChild (CSP compliant)
                    while (twofaConfigsList.firstChild) {
                        twofaConfigsList.removeChild(twofaConfigsList.firstChild);
                    }
                    const noConfigP = document.createElement('p');
                    noConfigP.className = 'text-center text-secondary';
                    noConfigP.textContent = 'No hay configuraciones 2FA.';
                    twofaConfigsList.appendChild(noConfigP);
                }
            }
        } catch (error) {
            if (twofaConfigsList) {
                // Limpiar contenido usando removeChild (CSP compliant)
                while (twofaConfigsList.firstChild) {
                    twofaConfigsList.removeChild(twofaConfigsList.firstChild);
                }
                const errorP = document.createElement('p');
                errorP.className = 'text-center text-danger';
                errorP.textContent = 'Error al cargar configuraciones.';
                twofaConfigsList.appendChild(errorP);
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
        const showCount = showTwofaCount ? showTwofaCount.value : '20';
        const currentPerPage = showCount === 'all' ? 999999 : parseInt(showCount) || 20;
        const totalPages = showCount === 'all' ? 1 : Math.ceil(totalConfigs / currentPerPage);
        
        let start = showCount === 'all' ? 0 : (currentTwofaPage - 1) * currentPerPage;
        let end = showCount === 'all' ? totalConfigs : start + currentPerPage;
        
        // Ocultar todas las configuraciones (usando clases CSS en lugar de style.display para CSP)
        const allConfigs = Array.from(twofaConfigsList.querySelectorAll('.regex-item[data-emails]'));
        allConfigs.forEach(item => {
            item.classList.add('d-none');
        });
        
        // Mostrar solo las configuraciones de la página actual
        filteredConfigs.slice(start, end).forEach(item => {
            item.classList.remove('d-none');
        });
        
        // Obtener contenedor de paginación
        const paginationContainer = document.querySelector('.pagination-buttons');
        
        // Mostrar/ocultar botones de paginación solo si hay más elementos que la cantidad a mostrar
        if (paginationContainer) {
            if (showCount === 'all' || totalConfigs <= currentPerPage || totalPages <= 1) {
                paginationContainer.classList.add('d-none');
            } else {
                paginationContainer.classList.remove('d-none');
            }
        }
        
        // Actualizar estado de botones de paginación
        if (prevTwofaPageBtn) {
            const hasPrev = currentTwofaPage > 1;
            prevTwofaPageBtn.disabled = !hasPrev;
            if (hasPrev) {
                prevTwofaPageBtn.classList.remove('pagination-disabled');
            } else {
                prevTwofaPageBtn.classList.add('pagination-disabled');
            }
        }
        if (nextTwofaPageBtn) {
            const hasNext = currentTwofaPage < totalPages && showCount !== 'all';
            nextTwofaPageBtn.disabled = !hasNext;
            if (hasNext) {
                nextTwofaPageBtn.classList.remove('pagination-disabled');
            } else {
                nextTwofaPageBtn.classList.add('pagination-disabled');
            }
        }
    }
    
    // Función para filtrar configuraciones
    function filterTwofaConfigs() {
        currentTwofaPage = 1;
        renderTwofaPage();
    }
    
    // Función para renderizar lista de configuraciones (CSP compliant usando createElement)
    function renderConfigsList(configs) {
        if (!twofaConfigsList) return;
        
        // Limpiar contenido existente usando removeChild (más seguro que innerHTML)
        while (twofaConfigsList.firstChild) {
            twofaConfigsList.removeChild(twofaConfigsList.firstChild);
        }
        
        if (!configs || configs.length === 0) {
            const noConfigP = document.createElement('p');
            noConfigP.className = 'text-center text-secondary';
            noConfigP.textContent = 'No hay configuraciones 2FA. Agrega una nueva configuración arriba.';
            twofaConfigsList.appendChild(noConfigP);
            return;
        }
        
        configs.forEach(config => {
            const emailsList = config.emails_list || [];
            const emailsStr = emailsList.join(', ');
            const emailsEscaped = escapeHtml(emailsStr || 'Sin correos');
            const emailsLowerEscaped = escapeHtml(emailsStr.toLowerCase());
            
            // Crear contenedor principal usando createElement
            const itemDiv = document.createElement('div');
            itemDiv.className = 'regex-item';
            itemDiv.setAttribute('data-emails', emailsLowerEscaped);
            itemDiv.setAttribute('data-config-id', config.id.toString());
            
            // Crear contenedor flex
            const flexDiv = document.createElement('div');
            flexDiv.className = 'd-flex justify-content-between align-items-center';
            
            // Crear contenedor de texto
            const textDiv = document.createElement('div');
            textDiv.className = 'flex-grow-1';
            
            const descDiv = document.createElement('div');
            descDiv.className = 'regex-description';
            descDiv.textContent = emailsEscaped;
            textDiv.appendChild(descDiv);
            flexDiv.appendChild(textDiv);
            
            // Crear contenedor de botones
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'd-flex gap-05';
            
            // Botón Editar
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn-orange btn-small edit-twofa-config';
            editBtn.setAttribute('data-config-id', config.id.toString());
            editBtn.title = 'Editar';
            const editIcon = document.createElement('i');
            editIcon.className = 'fas fa-edit';
            editBtn.appendChild(editIcon);
            buttonsDiv.appendChild(editBtn);
            
            // Botón Eliminar
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn-red btn-small delete-twofa-config';
            deleteBtn.setAttribute('data-config-id', config.id.toString());
            deleteBtn.title = 'Eliminar';
            const deleteIcon = document.createElement('i');
            deleteIcon.className = 'fas fa-trash';
            deleteBtn.appendChild(deleteIcon);
            buttonsDiv.appendChild(deleteBtn);
            
            flexDiv.appendChild(buttonsDiv);
            itemDiv.appendChild(flexDiv);
            twofaConfigsList.appendChild(itemDiv);
        });
        
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
