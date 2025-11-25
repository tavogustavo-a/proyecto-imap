// ============================================================================
// CHAT DASHBOARD INTEGRADO - VERSIÓN LIMPIA - CON MENSAJES TEMPORALES
// ============================================================================

    // Variables globales
    let dashboardCurrentUserId = null;
    let dashboardCurrentUsername = null;
    let isTyping = false;
    let typingTimeout = null;
    let isAdminUser = false;

// Elementos del DOM
let chatMessagesArea = null;
let chatInputArea = null;
let chatInputField = null;
let chatInputForm = null;
let chatTitle = null;
// chatStatus no existe en el HTML, se elimina
let usersList = null;

// Función para obtener token CSRF
    function getSupportCsrfToken() {
    const metaTag = document.querySelector('meta[name="csrf_token"]');
    return metaTag ? metaTag.content : '';
}

// Función para inicializar el chat
function initializeChat() {
    // Inicializando chat...
    
    // Detectar elementos del DOM
    chatMessagesArea = document.querySelector('#chatMessagesArea');
    chatInputArea = document.querySelector('#chatInputArea');
    chatInputField = document.querySelector('#chatInputField');
    chatInputForm = document.querySelector('#chatInputForm');
    chatTitle = document.querySelector('#chatTitle');
    usersList = document.querySelector('#usersList');
    

    
    if (!chatMessagesArea || !chatInputArea || !chatInputField || !chatInputForm || !chatTitle || !usersList) {
        // Elementos del chat no detectados
        return;
    }
    
    // Elementos del chat detectados correctamente
    
    // ✅ NUEVO: Inicializar variables del dashboard
    const currentUserId = document.querySelector('meta[name="current-user-id"]')?.content;
    const currentUsername = document.querySelector('meta[name="current-username"]')?.content;
    
    
    
    if (currentUserId && currentUsername) {
        dashboardCurrentUserId = currentUserId;
        dashboardCurrentUsername = currentUsername;
        window.dashboardCurrentUserId = currentUserId;
        window.dashboardCurrentUsername = currentUsername;
        // Detectar si es admin
        isAdminUser = document.querySelector('meta[name="is-admin"]')?.content === 'true';

        
        // ✅ NUEVO: Inicializar SocketIO para el dashboard
        initializeDashboardSocketIO();
        
        // ✅ NUEVO: Si es usuario soporte, NO cargar automáticamente el primer chat
        // El usuario soporte debe seleccionar manualmente el chat que desea atender
        const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
        if (isSupportUser) {
            // ✅ CORREGIDO: No cargar automáticamente ningún chat para usuarios de soporte
            // Esto evita que se conecten automáticamente a un chat sin su consentimiento
        }
    } else {
    }
    
    // Cargar lista de usuarios
    loadUsersList();
    
    // Configurar event listeners
    setupEventListeners();
    
            // ✅ NUEVO: Configurar toggle de lista de chats para móvil
        setupChatListToggle();
        
        // ✅ NUEVO: Configurar botón de limpieza de archivos corruptos
        setupCleanupButton();
        
        // ✅ NUEVO: Configurar limpieza automática periódica
        setupAutomaticCleanup();
        
}

// Función para cargar lista de usuarios
async function loadUsersList(response = null) {
    try {
        let data;
        
        if (response) {
            // Respuesta ya recibida (desde SocketIO)
            data = response;
        } else {
            // Hacer fetch HTTP (fallback)
            const response = await fetch('/tienda/api/chat/get_users_with_chat', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSupportCsrfToken()
                }
            });
            data = await response.json();
        }
        
        if (data.status === 'success' && usersList) {
            // ✅ NUEVO: Guardar estado de indicadores de escritura antes de limpiar
            const typingStates = {};
            const existingUsers = usersList.querySelectorAll('.chat-item');
            existingUsers.forEach(userItem => {
                const userId = userItem.getAttribute('data-user-id');
                const typingIndicator = userItem.querySelector('.user-typing-indicator');
                if (typingIndicator && typingIndicator.style.display === 'flex') {
                    typingStates[userId] = true;
                }
            });
            
            usersList.innerHTML = '';
            
            // ✅ NUEVO: Detectar si el usuario actual es admin
            // Los usuarios de soporte pueden finalizar soporte, pero solo admin puede eliminar chats
            const isAdminUser = document.querySelector('meta[name="is-admin"]')?.content === 'true';
            const currentUser = {
                username: document.querySelector('meta[name="current-username"]')?.content || '',
                id: document.querySelector('meta[name="current-user-id"]')?.content || ''
            };
            const ADMIN_USER = document.querySelector('meta[name="admin-username"]')?.content || 'admin';
            
                         // Permisos detectados
            

            
            // ✅ CORREGIDO: Verificar si hay usuarios CON CHAT
            if (data.data && data.data.length > 0) {
                // Hay usuarios con chat - mostrarlos
                data.data.forEach(user => {
                    const userItem = document.createElement('div');
                    userItem.className = 'chat-item';
                    userItem.setAttribute('data-user-id', user.id);
                    userItem.setAttribute('data-username', user.username);
                    
                    userItem.innerHTML = `
                        <div class="user-avatar">
                            <span class="user-initial">${user.username.charAt(0).toUpperCase()}</span>
                        </div>
                        <div class="user-info">
                            <div class="user-name">${user.username}</div>
                            <div class="user-last-message">${user.last_message || 'Sin mensajes'}</div>
                <div class="user-typing-indicator" style="display: none;">
                    <span class="typing-text">escribiendo</span>
                </div>
                        </div>
                        <div class="user-actions">
                            <button class="finish-support-btn" title="Finalizar soporte" data-user-id="${user.id}" data-username="${user.username}">
                                <i class="fas fa-check-circle"></i>
                            </button>
                            ${isAdminUser && currentUser.username === ADMIN_USER ? `
                                <button class="delete-chat-btn" title="Eliminar chat completo" data-user-id="${user.id}" data-username="${user.username}">
                                    <i class="fas fa-times"></i>
                                </button>
                            ` : ''}
                        </div>
                    `;
                    
                                    // ✅ NUEVO: Agregar atributo de estado del chat al elemento (para referencia)
                let finalChatStatus = user.chat_status || 'pending';
                
                // ✅ CRÍTICO: Si el último mensaje es "Chat finalizado, gracias por contactarnos", forzar estado FINISHED
                if (user.last_message && user.last_message.includes('Chat finalizado, gracias por contactarnos')) {
                    finalChatStatus = 'finished';
                }
                

                userItem.setAttribute('data-chat-status', finalChatStatus);
                    
                    // ✅ NUEVO: Aplicar clase específica al icono para el color
                    const userInitial = userItem.querySelector('.user-initial');
                    if (userInitial) {
                        let chatStatus = user.chat_status || 'pending';
                        
                        // ✅ CRÍTICO: Si el último mensaje es "Chat finalizado, gracias por contactarnos", forzar estado FINISHED
                        if (user.last_message && user.last_message.includes('Chat finalizado, gracias por contactarnos')) {
                            chatStatus = 'finished';
                        }
                        
                        userInitial.classList.add(`status-${chatStatus.replace('_', '-')}`);
                    }
                    
                    // ✅ NUEVO: Si el chat está finalizado, actualizar el botón
                    if (finalChatStatus === 'finished') {
                        const finishButton = userItem.querySelector('.finish-support-btn');
                        if (finishButton) {
                            finishButton.classList.add('finished');
                            finishButton.title = 'Soporte finalizado';
                        }
                    }
                    
                    usersList.appendChild(userItem);
                });
                
                // ✅ NUEVO: Restaurar indicadores de escritura después de crear la lista
                Object.keys(typingStates).forEach(userId => {
                    if (typingStates[userId]) {
                        showUserListTypingIndicator(userId);
                    }
                });
                
                // Agregar event listeners a los usuarios
                addUserItemListeners();
                
                // ✅ NUEVO: Agregar event listeners según permisos
                // Botón de finalizar soporte para todos (admin y soporte)
                addFinishSupportButtonListeners();
                
                // Botón de eliminar solo para admin
                if (isAdminUser) {
                    addDeleteButtonListeners();
                }
                
                // ✅ NUEVO: Agregar event listener para limpiar mensajes antiguos y estados
                // ✅ CORREGIDO: Limpiar event listeners duplicados primero
                clearDuplicateEventListeners();
                
                const btnLimpiarMensajes = document.getElementById('btnLimpiarMensajes');
                if (btnLimpiarMensajes) {
                    btnLimpiarMensajes.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        cleanupOldMessages();
                    });
                }
                
                // ✅ CRÍTICO: Verificar y corregir estados de chat después de cargar la lista
                setTimeout(() => {
                    verifyAndCorrectChatStatuses();
                }, 100);
                
            } else {
                // ✅ CORREGIDO: No hay usuarios con chat - mostrar mensaje simple
                                 // No hay usuarios con chat activo
                usersList.innerHTML = `
                    <div class="no-users-message">
                        <p>No hay usuarios con chat activo</p>
                        </div>
                `;
            }
            
                } else {
            // Error al cargar usuarios
        }
    } catch (error) {
        // Error al cargar usuarios
    }
}





// Función para cargar mensajes de un usuario
async function loadUserMessages(userId, forceUpdate = false) {
    try {
        const response = await fetch(`/tienda/api/chat/get_user_conversation/${userId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getSupportCsrfToken()
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            chatMessagesArea.innerHTML = '';
            
            const messages = data.data.reverse();
            let currentDate = null;
            
            messages.forEach(message => {
                // ✅ CORREGIDO: Usar zona horaria local para separación de fechas
                const messageDate = new Date(message.created_at);
                const messageDay = getDateString(messageDate);
                
                if (currentDate !== messageDay) {
                    addDateSeparator(message.created_at);
                    currentDate = messageDay;
                }
                
                // ✅ NUEVO: Verificar si es un mensaje del sistema y marcarlo como tal
                if (message.message_type === 'system') {
                    message.is_system = true; // Para compatibilidad con el frontend
                    message.message_type = 'system';
                }
                
                addMessageToChat(message, true);
            });
            
            chatInputArea.classList.add('active');
            chatInputField.focus();
            
            chatTitle.textContent = `Chat con ${data.user_info ? data.user_info.username : userId}`;
            
            // ✅ ELIMINADO: No actualizar fechas automáticamente para mantener fechas originales
            
            chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
            updateUserAvatarStatus(userId);
                } else {
                         // Error al cargar mensajes
        }
    } catch (error) {
                 // Error al cargar mensajes
    }
}

// Función para enviar mensaje
async function sendMessage(message) {
    if (!window.dashboardCurrentUserId || !message.trim()) {
        return;
    }
    
    // ✅ OPTIMIZACIÓN: Crear mensaje temporal más eficiente (fuera del try para acceso en catch)
    const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    try {
        // Verificar si ya hay un mensaje temporal pendiente
        const existingTempMessage = document.querySelector('[data-message-id^="temp_"]');
        if (existingTempMessage) {
            return;
        }
        
        // ✅ NUEVO: Detectar tipo de usuario correcto para mensaje temporal
        const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
        const messageType = isSupportUser ? 'support' : 'admin';
        
        // ✅ VALIDACIÓN: Para usuarios de soporte, requiere chat seleccionado
        const currentChatUserId = getCurrentChatUserId();
        
        if (isSupportUser && !currentChatUserId) {
            showNotification('Debes seleccionar un chat antes de enviar mensajes', 'error');
            return;
        }
        
        const tempMessage = {
            id: tempId,
            message: message.trim(),
            sender_id: window.dashboardCurrentUserId,
            sender_name: window.dashboardCurrentUsername,
            message_type: messageType,
            created_at: new Date().toISOString(),
            is_temp: true
        };
        
        // ✅ OPTIMIZACIÓN: Agregar mensaje temporal y limpiar input de forma más eficiente
        addMessageToChat(tempMessage, false);
        chatInputField.value = '';
        
        // ✅ OPTIMIZACIÓN: Usar requestAnimationFrame para scroll más suave
        requestAnimationFrame(() => {
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        });
        
        // ✅ MEJORADO: Verificar conexión de forma más robusta
        const connectionStatus = checkDashboardConnection();
        
        if (connectionStatus) {
            try {
                
                // ✅ CORREGIDO: Enviar mensaje directamente sin requestAnimationFrame
                window.socket.emit('send_message', {
                    sender_id: window.dashboardCurrentUserId,
                    recipient_id: currentChatUserId || '2',
                    message: message.trim(),
                    message_type: messageType,
                    is_support: isSupportUser
                });
                
                // ✅ NUEVO: Esperar confirmación antes de remover mensaje temporal
                // El mensaje temporal se removerá cuando llegue la confirmación del servidor
                
                // ✅ NUEVO: Notificar a otras pestañas que se envió un mensaje
                if (window.ChatReconnectionManager && typeof window.ChatReconnectionManager.broadcastToOtherTabs === 'function') {
                    window.ChatReconnectionManager.broadcastToOtherTabs('message_sent', {
                        message: message.trim(),
                        recipientId: currentChatUserId || '2',
                        connectionStatus: true
                    });
                }
                
                return; // Salir ya que se envió por SocketIO
            } catch (error) {
                // Continuar con fallback HTTP
            }
        } else {
            
            // Fallback a HTTP
            const csrfToken = getSupportCsrfToken();
            const requestData = {
                message: message.trim(),
                recipient_id: currentChatUserId || '2'
            };
            
            
            const response = await fetch('/tienda/api/chat/send_message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify(requestData)
            });
            
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.status === 'success') {
            // ✅ CORREGIDO: Remover mensaje temporal y agregar el real
            removeTempMessage(tempId);
            
            // ✅ NUEVO: Verificar que el mensaje del servidor no sea duplicado
            const existingMessage = chatMessagesArea.querySelector(`[data-message-id="${data.data.id}"]`);
            if (!existingMessage) {
                addMessageToChat(data.data, true);
                chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
            } else {
        
            }
            
            // ✅ NUEVO: Actualizar estado del chat a "responded" (azul)
            // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
            
            // ✅ ELIMINADO: removeFinishedStatus ahora se maneja en addMessageToChat
            // para evitar duplicación y mejorar la lógica
            
            // ✅ COMENTADO: No recargar mensajes automáticamente 
            // esto causaba que se perdieran los mensajes antiguos
            // setTimeout(() => {
            //     loadUserMessages(window.dashboardCurrentUserId, true);
            // }, 500);
            } else {
                removeTempMessage(tempId);
                alert('Error al enviar mensaje. Por favor, inténtalo de nuevo.');
            }
        }
    } catch (error) {
        // Remover mensaje temporal en caso de error
        removeTempMessage(tempId);
        
        // Mostrar mensaje de error al usuario
        alert('Error al enviar mensaje. Por favor, inténtalo de nuevo.');
    }
}

// ✅ CORREGIDO: Obtener el ID del usuario del chat actual (NO del admin)
function getCurrentChatUserId() {
    const currentUserId = window.dashboardCurrentUserId || document.querySelector('meta[name="current-user-id"]')?.content;
    
    // Buscar el chat activo en la lista de chats
    const activeChatItem = document.querySelector('.chat-item.active, .chat-item.selected');
    if (activeChatItem) {
        const chatUserId = activeChatItem.getAttribute('data-user-id');
        // ✅ CORREGIDO: No enviar mensajes al admin mismo
        if (chatUserId && chatUserId !== window.dashboardCurrentUserId) {
            return chatUserId;
        }
    }
    
    // Si no hay chat activo, buscar en el título del chat
    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle && chatTitle.textContent.includes('Chat con')) {
        const match = chatTitle.textContent.match(/Chat con (\d+)/);
        if (match) {
            const chatUserId = match[1];
            // ✅ CORREGIDO: No enviar mensajes al admin mismo
            if (chatUserId !== window.dashboardCurrentUserId) {
                return chatUserId;
            }
        }
    }
    
    // ✅ CORREGIDO: Fallback seguro - buscar cualquier usuario que NO sea el admin
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    const currentUserType = document.querySelector('meta[name="current-user-type"]')?.content || 'user';
    
    if (isSupportUser) {
        // Si es usuario de soporte, NO usar fallback - requiere selección explícita
        return null; // Forzar selección de chat
    } else if (currentUserType === 'admin') {
        // Si es admin, buscar usuarios normales
        return '1'; // Usuario normal por defecto
    } else {
        // Si es usuario normal, enviar al admin
        return '2'; // Admin por defecto
    }
}

// Función para agregar mensaje al chat
function addMessageToChat(messageData, isFromServer = false) {
    try {
        if (!chatMessagesArea || !messageData || !messageData.id) {
            return;
        }
        
        // ✅ BLOQUEO SELECTIVO: Solo bloquear visualización de mensajes recibidos para usuarios soporte
        const activeChatUserId = getActiveChatUserId();
        const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
        const isAdminUser = !isSupportUser && window.dashboardCurrentUserId == '1';
        
        // Solo bloquear si es un mensaje recibido (isFromServer = true), es usuario soporte y no hay chat activo
        if (isFromServer && isSupportUser && !activeChatUserId) {
            return;
        }
        
        // Para admin, permitir todos los mensajes (recibidos y enviados)
        if (isAdminUser) {
            // Admin puede ver todos los mensajes
        }
        
        // Para mensajes enviados (isFromServer = false), permitir siempre
        if (!isFromServer) {
            // Mensaje enviado, permitir visualización
        }
        
        // Permitir mensajes sin texto si tienen archivos adjuntos
        if (!messageData.message && !messageData.has_attachment) {
            return;
        }
        
        const currentUserId = window.dashboardCurrentUserId || document.querySelector('meta[name="current-user-id"]')?.content;
        const currentUserType = document.querySelector('meta[name="current-user-type"]')?.content || 'user';
    
    let messageClass = 'message';
    
                    // ✅ NUEVO: Mensajes del sistema siempre centrados
                if (messageData.message_type === 'system' || messageData.is_system) {
                    messageClass += ' system-message';
                } else if (currentUserType === 'user') {
                    if (messageData.sender_id == window.dashboardCurrentUserId) {
                        messageClass += ' own-message';
                    } else {
                        messageClass += ' other-message';
                    }
                } else {
                    if (messageData.message_type === 'user') {
                        messageClass += ' other-message';
                    } else {
                        messageClass += ' own-message';
                    }
                }
    
    const messageElement = document.createElement('div');
    messageElement.className = messageClass;
    messageElement.setAttribute('data-message-id', messageData.id);
    
    // Agregar clase temporal si es mensaje temporal
    if (messageData.is_temp) {
        messageElement.classList.add('temp-message');
    }
    
    // ✅ NUEVO: Si se agrega un mensaje NUEVO y el chat estaba finalizado, quitar el estado finished
    // IMPORTANTE: SOLO se ejecuta para mensajes NUEVOS, NO para mensajes existentes que se cargan
    // Usar la variable global dashboardCurrentUserId que contiene el ID del usuario del chat actual
    if (window.dashboardCurrentUserId && !isFromServer) {
        // Solo ejecutar para mensajes NUEVOS (!isFromServer), NO para mensajes existentes (isFromServer)
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const currentStatus = userItem.getAttribute('data-chat-status');
            if (currentStatus === 'finished') {
                // Solo quitar finished si NO es un mensaje del sistema
                if (messageData.message_type !== 'system') {
                    removeFinishedStatus(window.dashboardCurrentUserId);
                }
            }
        }
    }
    
    // ✅ CORREGIDO: Sistema de etiquetas dual según el tipo de usuario
    let senderLabel = '';
    const currentUserTypeForLabel = document.querySelector('meta[name="current-user-type"]')?.content || 'user';
    
    // ✅ NUEVO: Los mensajes temporales NO tienen etiquetas visibles
    if (messageData.is_temp) {
        senderLabel = ''; // Sin etiqueta para mensajes temporales
    } else if (messageData.message_type === 'admin') {
        if (currentUserTypeForLabel === 'user') {
            // Usuario normal ve "admin:"
            senderLabel = '<span class="message-sender-inline admin-inline">Admin: </span>';
        } else {
            // Admin y soporte ven "admin:"
            senderLabel = '<span class="message-sender-inline admin-inline">Admin: </span>';
        }
    } else if (messageData.message_type === 'support') {
        if (currentUserTypeForLabel === 'user') {
            // Usuario normal ve "soporte:"
            senderLabel = '<span class="message-sender-inline support-inline">Soporte: </span>';
        } else {
            // Admin y soporte ven el nombre real
            const senderUsername = messageData.sender_name || 'Soporte';
            senderLabel = `<span class="message-sender-inline support-inline">${senderUsername}: </span>`;
        }
    } else if (messageData.message_type === 'user') {
        senderLabel = '';
    } else if (messageData.message_type === 'system' || messageData.is_system) {
        // ✅ NUEVO: Mensaje del sistema (centrado, estilo especial)
        senderLabel = '<span class="message-sender-inline system-inline">Sistema: </span>';
    }
    
    const messageTime = formatTimeAgo(messageData.created_at || messageData.timestamp);
    
    // Verificar si es un mensaje con archivos
    if (messageData.has_attachment) {
        let attachmentHTML = '';
        
        if (messageData.attachment_type === 'audio') {
            // Audio (mantener lógica existente)
            attachmentHTML = `
                <div class="audio-player-sent">
                    <button class="play-pause-btn-sent" id="playPauseBtn-sent-${messageData.id}">
                        <i class="fas fa-play"></i>
                    </button>
                    <div class="audio-progress-sent">
                        <div class="progress-bar-sent">
                            <div class="progress-fill-sent" id="progressFill-sent-${messageData.id}"></div>
                            <div class="progress-knob-sent" id="progressKnob-sent-${messageData.id}"></div>
                        </div>
                        <span class="audio-time-sent" id="audioTime-sent-${messageData.id}">0:00</span>
                    </div>
                    <button class="speed-btn-sent" id="speedBtn-sent-${messageData.id}">1x</button>
                </div>
            `;
            } else {
        // Otros tipos de archivos (imágenes, videos, etc.)
        try {
            attachmentHTML = displayFileInChat(messageData);
        } catch (error) {
            attachmentHTML = `<div class="error-attachment">Error al cargar archivo</div>`;
        }
    }
        
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-text">${senderLabel}${attachmentHTML}</div>
                <div class="message-time">${messageTime}</div>
            </div>
        `;
        
        // ✅ CORREGIDO: Solo agregar event listeners de audio si es un archivo de audio
        if (messageData.attachment_type === 'audio') {
            const playPauseBtn = messageElement.querySelector(`#playPauseBtn-sent-${messageData.id}`);
            const speedBtn = messageElement.querySelector(`#speedBtn-sent-${messageData.id}`);
            const progressFill = messageElement.querySelector(`#progressFill-sent-${messageData.id}`);
            const progressKnob = messageElement.querySelector(`#progressKnob-sent-${messageData.id}`);
            const audioTime = messageElement.querySelector(`#audioTime-sent-${messageData.id}`);
            
            // ✅ NUEVO: Verificar que los elementos existan antes de agregar event listeners
            if (!playPauseBtn || !speedBtn || !progressFill || !progressKnob || !audioTime) {
                return;
            }
        
        // Crear elemento de audio oculto DESPUÉS de tener los elementos del DOM
        const audioElement = document.createElement('audio');
        audioElement.id = `audio-sent-${messageData.id}`;
        
        // ✅ NUEVO: Usar audio_data si está disponible, sino usar URL del servidor
        if (messageData.audio_data) {
            audioElement.src = messageData.audio_data;
        } else {
            audioElement.src = `/tienda/api/chat/audio/${messageData.id}`;
        }
        audioElement.preload = 'metadata';
        
        // Manejar errores de carga de audio
        audioElement.addEventListener('error', function(e) {
            // Error al cargar audio
            if (playPauseBtn) {
                playPauseBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                playPauseBtn.style.color = '#e74c3c';
                playPauseBtn.title = 'Error al cargar audio';
            }
        });
        
        // Agregar al DOM DESPUÉS de configurar los event listeners
        document.body.appendChild(audioElement);
        
        // Array de velocidades disponibles
        const speeds = [1, 1.25, 1.5, 2, 3];
        let currentSpeedIndex = 0;
        
        // ✅ CORREGIDO: Botón play/pause con verificación de elemento
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', function(e) {
                e.preventDefault(); // Prevenir comportamiento por defecto
                
                if (audioElement.paused) {
                    // Intentar reproducir con manejo de errores
                    audioElement.play().then(() => {
                        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    }).catch(error => {
                        // Error al reproducir audio
                        playPauseBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                        playPauseBtn.style.color = '#e74c3c';
                        playPauseBtn.title = 'Error al reproducir audio';
                    });
                } else {
                    audioElement.pause();
                    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
                }
            });
        }
        
        // ✅ CORREGIDO: Control de velocidad con verificación de elemento
        if (speedBtn) {
            speedBtn.addEventListener('click', function(e) {
                e.preventDefault(); // Prevenir comportamiento por defecto
                
                currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
                const newSpeed = speeds[currentSpeedIndex];
                
                audioElement.playbackRate = newSpeed;
                speedBtn.textContent = newSpeed + 'x';
                
                // Velocidad cambiada
            });
        }
        
        // ✅ CORREGIDO: Actualizar duración cuando esté lista
        audioElement.addEventListener('loadedmetadata', function() {
            const duration = Math.floor(audioElement.duration);
            if (duration && isFinite(duration)) {
                // Audio cargado
            }
        });
        
        // ✅ CORREGIDO: Actualizar progreso durante la reproducción
        audioElement.addEventListener('timeupdate', function() {
            if (audioElement.duration && isFinite(audioElement.duration)) {
                const currentTime = audioElement.currentTime;
                const duration = audioElement.duration;
                const progress = (currentTime / duration) * 100;
                
                if (progressFill) progressFill.style.width = progress + '%';
                if (progressKnob) progressKnob.style.left = progress + '%';
                if (audioTime) audioTime.textContent = formatTime(currentTime);
            }
        });
        
        } // ✅ CERRAR EL BLOQUE if (messageData.attachment_type === 'audio')
        
    } else {
        // Mensaje de texto normal
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-text">${senderLabel}${messageData.message}</div>
                <div class="message-time">${messageTime}</div>
            </div>
        `;
    }
    
        // ✅ NUEVO: Verificar si necesita separador de fecha antes de agregar el mensaje
        if (isFromServer && (messageData.created_at || messageData.timestamp)) {
            // Solo verificar para mensajes del servidor (no temporales)
            const lastMessage = chatMessagesArea.querySelector('.message:last-child');
            if (lastMessage) {
                const lastMessageTime = lastMessage.querySelector('.message-time');
                if (lastMessageTime) {
                    // Obtener la fecha del último mensaje del atributo data-timestamp
                    const lastMessageTimestamp = lastMessage.getAttribute('data-timestamp');
                    if (lastMessageTimestamp) {
                        const lastDate = new Date(lastMessageTimestamp);
                        const currentDate = new Date(messageData.created_at || messageData.timestamp);
                        
                        // Convertir ambas fechas a zona horaria de Colombia
                        const colombiaOffset = -5 * 60 * 60 * 1000;
                        const lastDateColombia = new Date(lastDate.getTime() + colombiaOffset);
                        const currentDateColombia = new Date(currentDate.getTime() + colombiaOffset);
                        
                        // Comparar solo día/mes/año
                        const lastDay = new Date(lastDateColombia.getFullYear(), lastDateColombia.getMonth(), lastDateColombia.getDate());
                        const currentDay = new Date(currentDateColombia.getFullYear(), currentDateColombia.getMonth(), currentDateColombia.getDate());
                        
                        if (lastDay.getTime() !== currentDay.getTime()) {
                            addDateSeparator(messageData.created_at || messageData.timestamp);
                        }
                    }
                }
            }
        }
        
        // Agregar timestamp como atributo para futuras comparaciones
        messageElement.setAttribute('data-timestamp', messageData.created_at || messageData.timestamp);
        
        chatMessagesArea.appendChild(messageElement);
        
        // ✅ NUEVO: Configurar protección de videos después de agregar mensaje
        if (messageData.has_attachment && messageData.attachment_type && messageData.attachment_type.startsWith('video/')) {
            setTimeout(() => {
                if (typeof window.setupVideoProtection === 'function') {
                    window.setupVideoProtection();
                }
            }, 100);
        }
        
    } catch (error) {
        showErrorMessage('Error al mostrar mensaje. Intentando recuperar...');
        recoverChatFromCorruption();
    }
}

// Función para obtener la fecha en formato string considerando zona horaria de Colombia (UTC-5)
function getDateString(date) {
    // Convertir a zona horaria de Colombia (UTC-5)
    const colombiaOffset = -5 * 60 * 60 * 1000; // -5 horas en milisegundos
    const colombiaTime = new Date(date.getTime() + colombiaOffset);
    
    // Extraer año, mes y día en zona horaria de Colombia
    const year = colombiaTime.getUTCFullYear();
    const month = colombiaTime.getUTCMonth();
    const day = colombiaTime.getUTCDate();
    
    // Crear una nueva fecha con solo año, mes y día en zona horaria de Colombia
    const colombiaDate = new Date(year, month, day);
    return colombiaDate.toDateString();
}

// Función para agregar separador de fecha
function addDateSeparator(dateString) {
    if (!chatMessagesArea) {
        return;
    }
    
    const dateElement = document.createElement('div');
    dateElement.className = 'date-separator';
    
    // ✅ CORREGIDO: Usar la fecha original del mensaje sin recalcular
    const date = new Date(dateString);
    
    // Validar que la fecha sea válida
    if (isNaN(date.getTime())) {
        return;
    }
    
    // ✅ CORREGIDO: Mostrar la fecha original del mensaje, no la fecha actual
    const dateText = date.toLocaleDateString('es-CO', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    // ✅ NUEVO: Agregar atributo data-original-date para mantener la fecha original
    dateElement.setAttribute('data-original-date', dateString);
    dateElement.textContent = dateText;
    chatMessagesArea.appendChild(dateElement);
}

// ✅ NUEVO: Función para actualizar separadores de fecha existentes en admin
function updateExistingDateSeparators() {
    // ✅ DESHABILITADO: No actualizar fechas para mantener fechas originales
    // Esta función estaba causando que las fechas se actualizaran incorrectamente
    return;
}

// ✅ CORREGIDO: Función para remover mensaje temporal (más robusta)
function removeTempMessage(tempId) {
    
    // ✅ CORREGIDO: Buscar mensajes temporales por múltiples selectores
    let tempMessage = document.querySelector(`[data-message-id="${tempId}"]`);
    if (!tempMessage) {
        tempMessage = document.querySelector(`[data-message-id^="temp_"]`); // Cualquier mensaje que empiece con "temp_"
    }
    if (!tempMessage) {
        tempMessage = document.querySelector(`#${tempId}`);
    }
    if (!tempMessage) {
        tempMessage = document.querySelector(`#audio-${tempId}`);
    }
    
    if (tempMessage) {
        tempMessage.remove();
    } else {
        // ✅ NUEVO: Buscar por ID de preview también
        const previewMessage = document.querySelector(`#preview-${tempId}`);
        if (previewMessage) {
            previewMessage.remove();
        } else {
            // ✅ NUEVO: Buscar y eliminar TODOS los mensajes temporales restantes
            const allTempMessages = document.querySelectorAll(`[data-message-id^="temp_"], [id^="preview-"]`);
            if (allTempMessages.length > 0) {
                allTempMessages.forEach(msg => {
                    msg.remove();
                });
            }
        }
    }
    
    // También remover el elemento de audio si existe
    const audioElement = document.querySelector(`#audio-${tempId}`);
    if (audioElement) {
        audioElement.remove();
    }
}

// ✅ CORREGIDO: Función para formatear tiempo
function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) {
        return '0:00';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const formattedTime = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    return formattedTime;
}

// ✅ CORREGIDO: Función para formatear tiempo en formato Colombia (12 horas)
    function formatTimeAgo(dateString) {
        if (!dateString) {
            return '';
        }
        
        const date = new Date(dateString);
        const now = new Date();
        const diffInMinutes = Math.floor((now - date) / (1000 * 60));
        
        // ✅ CORREGIDO: Mostrar hora real en lugar de "Ahora" para mensajes en tiempo real
        // Solo usar "Ahora" si es exactamente el mismo segundo (menos de 1 segundo de diferencia)
        if (diffInMinutes === 0 && Math.floor((now - date) / 1000) < 1) {
            return 'Ahora';
        }
        
        // ✅ CORREGIDO: Usar zona horaria de Colombia (UTC-5)
        try {
            // Convertir a zona horaria de Colombia manualmente
            const utcTime = date.getTime();
            const colombiaOffset = -5 * 60 * 60 * 1000; // UTC-5 en milisegundos
            const colombiaTime = new Date(utcTime + colombiaOffset);
            
            const horaColombia = colombiaTime.toLocaleTimeString('es-CO', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            return horaColombia;
        } catch (error) {
            // Error al formatear hora
            // Fallback: hora local
            const fallbackTime = date.toLocaleTimeString('es-CO', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            return fallbackTime;
        }
    }
    
    // ✅ MEJORADO: Función para detectar cuando el usuario está escribiendo
    function handleTyping() {
        if (!window.dashboardCurrentUserId) {
            return;
        }
        
        // ✅ NUEVO: Verificar si es admin o soporte - no mostrar indicador local
        const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
        const isAdminUser = document.querySelector('meta[name="is-admin"]')?.content === 'true';
        
        if (isSupportUser || isAdminUser) {
            return;
        }
        
        if (!isTyping) {
            isTyping = true;
            sendTypingStatus(true);
            
            // ✅ NUEVO: Mostrar indicador de escritura en la lista de usuarios
            const currentChatUserId = getActiveChatUserId();
            if (currentChatUserId) {
                showUserListTypingIndicator(currentChatUserId);
            }
        }
        
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }
        
        typingTimeout = setTimeout(() => {
            isTyping = false;
            sendTypingStatus(false);
            
            // ✅ NUEVO: Ocultar indicador de escritura en la lista de usuarios
            const currentChatUserId = getActiveChatUserId();
            if (currentChatUserId) {
                hideUserListTypingIndicator(currentChatUserId);
            }
        }, 5000); // ✅ AUMENTADO: De 2 segundos a 5 segundos para mayor visibilidad
    }

    // ✅ MEJORADO: Función para enviar estado de escritura
    async function sendTypingStatus(typing) {
        if (!window.dashboardCurrentUserId) {
            return;
        }
        
        // ✅ MEJORADO: Usar SocketIO para escritura en tiempo real
        if (checkDashboardConnection()) {
            const currentChatUserId = getCurrentChatUserId();
            
            // ✅ NUEVO: Detectar si es usuario soporte/admin
            const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
            const isAdminUser = document.querySelector('meta[name="is-admin"]')?.content === 'true';
            
            
            // ✅ NUEVO: Solo enviar eventos de escritura si NO es admin o soporte
            if (isSupportUser || isAdminUser) {
                return;
            }
            
            if (typing) {
                window.socket.emit('typing_start', {
                    user_id: window.dashboardCurrentUserId,
                    username: dashboardCurrentUsername,
                    recipient_id: currentChatUserId || '2',
                    typing: true,
                    is_support: isSupportUser
                });
            } else {
                window.socket.emit('typing_stop', {
                    user_id: window.dashboardCurrentUserId,
                    username: dashboardCurrentUsername,
                    recipient_id: currentChatUserId || '2',
                    typing: false,
                    is_support: isSupportUser
                });
            }
        } else {
            // Fallback a HTTP
            try {
                await fetch('/tienda/api/chat/typing_status', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getSupportCsrfToken()
                    },
                    body: JSON.stringify({
                        user_id: window.dashboardCurrentUserId,
                        typing: typing
                    })
                });
            } catch (error) {
            }
        }
    }
    
    // ✅ NUEVO: Función para agregar event listeners a botones de eliminación
function addDeleteButtonListeners() {
    const deleteButtons = document.querySelectorAll('.delete-chat-btn');
    deleteButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation(); // Evitar que se active el chat
            
            const userId = parseInt(this.getAttribute('data-user-id'));
            const username = this.getAttribute('data-username');
            
            if (confirm(`¿Estás seguro de que quieres eliminar todo el chat de ${username}?\n\nEsta acción eliminará:\n• Todos los mensajes\n• Archivos adjuntos\n• Sesiones de chat\n• Archivos huérfanos\n\nEsta acción NO se puede deshacer.`)) {
                // ✅ CORREGIDO: Ejecutar de forma asíncrona para no bloquear la UI
                setTimeout(() => {
                    deleteUserChat(userId);
                }, 0);
            }
        });
    });
    }
    
    // Función para agregar event listeners a los usuarios
    function addUserItemListeners() {
        const chatItems = document.querySelectorAll('.chat-item');
        chatItems.forEach(item => {
            item.addEventListener('click', function() {
                if (this.classList.contains('chat-disabled')) {
                    // Este usuario no tiene chat habilitado
                    return;
                }
                
                document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                
                const newUserId = parseInt(this.getAttribute('data-user-id'));
                const newUsername = this.getAttribute('data-username');
                
                // NO cambiar dashboardCurrentUserId - debe permanecer como el ID del admin
                // window.dashboardCurrentUserId debe ser el ID del admin, no del usuario con quien chatea
                
                // ✅ CRÍTICO: Hacer dashboardCurrentUserId global para que sea accesible desde addMessageToChat
                // Ya se asignó arriba, no es necesario duplicar
                
            
                chatMessagesArea.innerHTML = '';
                chatInputArea.classList.remove('active');
                chatTitle.textContent = 'Cargando...';
                
                // ✅ CORREGIDO: Cargar mensajes del usuario seleccionado, no del admin
                loadUserMessages(newUserId);
            });
        });
    }
    
// Función para actualizar estado del avatar del usuario
function updateUserAvatarStatus(userId) {
    const userItem = document.querySelector(`[data-user-id="${userId}"]`);
    if (userItem) {
        const statusElement = userItem.querySelector('.user-status');
        if (statusElement) {
            statusElement.className = 'user-status online';
        }
    }
}

// Función para eliminar chat de un usuario
async function deleteUserChat(userId) {
    if (!confirm('¿Estás seguro de que quieres eliminar todo el chat de este usuario? Esta acción no se puede deshacer.')) {
            return;
        }
        
        try {
            const response = await fetch('/tienda/api/chat/delete_user_chat', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSupportCsrfToken()
                },
                body: JSON.stringify({
                    user_id: userId
                })
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                const summary = data.data;
                
                // NO cambiar dashboardCurrentUserId - debe permanecer como el ID del admin
                // if (window.dashboardCurrentUserId === userId) {
                //     window.dashboardCurrentUserId = null;
                // }
                
                if (chatMessagesArea) {
                    chatMessagesArea.innerHTML = '<div class="text-center text-muted mt-5"><i class="fas fa-comments fa-3x mb-3"></i><p>Selecciona un usuario de la lista para comenzar a chatear</p></div>';
                }
                if (chatInputArea) {
                    chatInputArea.classList.remove('active');
                }
                
                if (chatTitle) {
                    chatTitle.textContent = 'Selecciona un usuario para chatear';
                }
                // chatStatus no existe en el HTML
                
                loadUsersList();
                
                // Chat eliminado exitosamente
            } else {
                // Error al eliminar chat del usuario
            }
        } catch (error) {
                 // Error al eliminar chat
            // Error al eliminar chat del usuario
        }
    }
    
    // Función para limpiar mensajes antiguos, estados obsoletos y usuarios inactivos
    async function cleanupOldMessages() {
        
        // ✅ Obtener días seleccionados del selector
        const daysSelect = document.getElementById('cleanupDaysSelect');
        const selectedDays = daysSelect ? parseInt(daysSelect.value) : 5;
        
        
        // ✅ RESTAURADO: Preguntar qué tipo de limpieza quiere
        const cleanupChoice = prompt(`¿Qué tipo de limpieza quieres realizar?\n\n1 = Limpieza COMPLETA (elimina TODO)\n2 = Limpieza parcial (solo mensajes antiguos)\n3 = Solo archivos huérfanos\n\nEscribe el número (1, 2 o 3):`);
        
        if (cleanupChoice === '1') {
            // Limpieza COMPLETA
            if (!confirm(`⚠️ ADVERTENCIA: LIMPIEZA COMPLETA ⚠️\n\nEsta acción eliminará ABSOLUTAMENTE TODO:\n• TODOS los mensajes del chat\n• TODAS las sesiones\n• TODOS los archivos\n• TODOS los archivos huérfanos\n\nEsta acción NO SE PUEDE DESHACER.\n\n¿Estás SEGURO de continuar?`)) {
                return;
            }
            
            try {
                // Llamar a la nueva ruta de limpieza completa
                const response = await fetch('/tienda/api/chat/cleanup_all_messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getSupportCsrfToken()
                    }
                });
                
                const data = await response.json();
                
                if (data.status === 'success') {
                    alert(data.message);
                    // Recargar lista de usuarios
                    loadUsersList();
                } else {
                    alert(`❌ Error: ${data.message}`);
                }
                
            } catch (error) {
                alert(`❌ Error durante la limpieza completa: ${error.message}`);
            }
            return;
        }
        
        if (cleanupChoice === '3') {
            // Limpieza solo de archivos huérfanos
            if (!confirm(`¿Estás seguro de que quieres limpiar solo archivos huérfanos?\n\nEsta acción eliminará:\n• Archivos de audio sin mensaje asociado\n• Archivos de imagen sin mensaje asociado\n• Archivos de video sin mensaje asociado\n• Otros archivos huérfanos\n\n¿Continuar?`)) {
                return;
            }
            
            try {
                // Llamar a la ruta de limpieza de archivos huérfanos
                const response = await fetch('/tienda/api/chat/cleanup_orphaned_files', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getSupportCsrfToken()
                    }
                });
                
                const data = await response.json();
                
                if (data.status === 'success') {
                    alert(data.message);
                } else {
                    alert(`❌ Error: ${data.message}`);
                }
                
            } catch (error) {
                alert(`❌ Error durante la limpieza de archivos huérfanos: ${error.message}`);
            }
            return;
        }
        
        if (cleanupChoice !== '2') {
            // Si no eligió una opción válida
            alert('Opción no válida. Operación cancelada.');
            return;
        }
        
        // Limpieza parcial (original)
        if (!confirm(`¿Estás seguro de que quieres realizar la limpieza parcial?\n\nEsta acción eliminará:\n• Mensajes antiguos (más de ${selectedDays} días)\n• Estados obsoletos\n• Chats de usuarios inactivos (${selectedDays}+ días)\n• Archivos adjuntos y huérfanos\n\n¿Continuar?`)) {
            return;
        }
        
        try {
            
            // 1. Limpiar mensajes antiguos con días personalizados
            const messagesResponse = await fetch('/tienda/api/chat/cleanup_old_messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSupportCsrfToken()
                },
                body: JSON.stringify({ days: selectedDays })
            });
            
            const messagesData = await messagesResponse.json();
            
            // 2. Limpiar estados obsoletos
            const statusResponse = await fetch('/tienda/api/chat/cleanup_obsolete_statuses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSupportCsrfToken()
                }
            });
            
            const statusData = await statusResponse.json();
            
            // 3. Limpiar usuarios inactivos con días personalizados
            const inactiveResponse = await fetch('/tienda/api/chat/auto_cleanup_inactive_users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSupportCsrfToken()
                },
                body: JSON.stringify({ days: selectedDays })
            });
            
            const inactiveData = await inactiveResponse.json();
            
            // ✅ Mostrar resumen completo
            let summaryMessage = `✅ LIMPIEZA COMPLETA FINALIZADA!\n\n`;
            
            // 📊 Resumen de mensajes antiguos
            if (messagesData.status === 'success') {
                summaryMessage += `📊 Mensajes Antiguos (${selectedDays} días):\n• ${messagesData.data.deleted_count} mensajes eliminados\n• ${messagesData.data.sessions_deleted} sesiones eliminadas\n• ${messagesData.data.files_deleted} archivos eliminados\n• ${messagesData.data.orphaned_files_deleted} archivos huérfanos eliminados\n• ${messagesData.data.support_users_cleaned} usuarios de soporte limpiados\n\n`;
            }
            
            // 🔄 Estados corregidos
            if (statusData.status === 'success') {
                summaryMessage += `🔄 Estados Obsoletos:\n• ${statusData.data.cleaned_count} estados obsoletos actualizados\n\n`;
            }
            
            // ⚠️ Usuarios inactivos
            if (inactiveData.status === 'success') {
                summaryMessage += `⚠️ Usuarios Inactivos (${selectedDays}+ días):\n• ${inactiveData.data.users_cleaned} usuarios inactivos limpiados\n• ${inactiveData.data.total_files_deleted} archivos eliminados\n• ${inactiveData.data.total_orphaned_files_deleted} archivos huérfanos eliminados`;
            }
            
            // Limpieza completada
            alert(summaryMessage);
            
            // ✅ Recargar lista de usuarios
            loadUsersList();
            
        } catch (error) {
            // Error al realizar la limpieza completa
            alert(`❌ Error durante la limpieza: ${error.message}`);
        }
    }
    
// ✅ NUEVA FUNCIÓN: Variables para grabación de audio
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let audioBlob = null;

// ✅ NUEVA FUNCIÓN: Verificar compatibilidad de grabación de audio
function checkAudioRecordingSupport() {
    // ✅ SIMPLIFICADO: Ahora que tenemos polyfill, solo verificar básico
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { supported: false, reason: 'getUserMedia no está disponible' };
    }
    
    if (!window.MediaRecorder) {
        return { supported: false, reason: 'MediaRecorder no está disponible' };
    }
    
    return { supported: true, reason: 'Soporte completo disponible' };
}

// ✅ NUEVA FUNCIÓN: Alternativa para navegadores sin soporte de grabación
function showAudioRecordingAlternative() {
    const message = 'Tu navegador no soporta grabación de audio directa. ' +
                   'Puedes enviar archivos de audio usando el botón de adjuntar archivo (📎). ' +
                   'Grabar el audio con otra aplicación y luego adjuntarlo.';
    
    // Mostrar mensaje
    alert(message);
}





// ✅ NUEVA FUNCIÓN: Función para iniciar/detener grabación de audio (toggle)
async function startAudioRecording() {
    // ✅ NUEVO: Si ya está grabando, detener la grabación
    if (isRecording) {
        stopAudioRecording();
        return;
    }
    
    try {
        // ✅ MEJORADO: Verificar compatibilidad antes de solicitar acceso
        const compatibility = checkAudioRecordingSupport();
        if (!compatibility.supported) {
            // ✅ NUEVO: Mostrar alternativa en lugar de lanzar error
            showAudioRecordingAlternative();
            return;
        }
        
        // ✅ MEJORADO: Solicitar permisos de micrófono usando la API estándar
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 44100,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                // ✅ NUEVO: Opciones específicas para móviles
                latency: 0.1,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: true
            } 
        });
        
        // ✅ MEJORADO: Configurar MediaRecorder con opciones específicas para móviles
        const options = {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 128000
        };
        
        // ✅ MEJORADO: Fallback mejorado para diferentes navegadores y dispositivos
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'audio/webm';
        }
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'audio/mp4';
        }
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'audio/ogg;codecs=opus';
        }
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'audio/wav';
        }
        
        // ✅ MEJORADO: Verificar que se seleccionó un MIME Type válido
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            throw new Error('Tu navegador no soporta ningún formato de audio compatible');
        }
        
        mediaRecorder = new MediaRecorder(stream, options);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = () => {
            // Determinar el tipo MIME correcto basado en el MediaRecorder
            const mimeType = mediaRecorder.mimeType || 'audio/webm';
            audioBlob = new Blob(audioChunks, { type: mimeType });
            
            // ✅ MEJORADO: Liberar recursos del stream
            stream.getTracks().forEach(track => track.stop());
            
            // Mostrar mensaje de audio grabado
            showAudioMessage(audioBlob);
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        // ✅ NUEVO: Cambiar apariencia del botón para indicar que está grabando
        const audioBtn = document.getElementById('audioRecordBtn');
        if (audioBtn) {
            audioBtn.innerHTML = '<i class="fas fa-stop"></i>';
            audioBtn.style.background = '#dc3545';
            audioBtn.title = 'Presiona de nuevo para detener grabación';
        }
        
        // ✅ NUEVO: Verificar si el botón existe y configurarlo
        if (audioBtn) {
            // Verificar compatibilidad al cargar la página
            const compatibility = checkAudioRecordingSupport();
            if (!compatibility.supported) {
                audioBtn.style.background = '#6c757d'; // Gris para indicar no disponible
                audioBtn.title = 'Grabación no disponible - Usa adjuntar archivo';
                audioBtn.onclick = function() {
                    showAudioRecordingAlternative();
                };
            }
        }
        
    } catch (error) {
        // ✅ MEJORADO: Manejo de errores específicos para móviles
        // Error al iniciar grabación de audio
        
        let errorMessage = 'Error al acceder al micrófono. ';
        
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Permiso denegado. Por favor, permite el acceso al micrófono en tu navegador.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No se encontró ningún dispositivo de audio.';
        } else if (error.name === 'NotSupportedError') {
            errorMessage += 'Tu navegador no soporta grabación de audio.';
        } else if (error.name === 'NotReadableError') {
            errorMessage += 'El micrófono está siendo usado por otra aplicación.';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage += 'Las opciones de audio no son compatibles con tu dispositivo.';
        } else if (error.name === 'TypeError' && error.message.includes('getUserMedia')) {
            errorMessage += 'Tu navegador no soporta la API de grabación de audio.';
        } else {
            errorMessage += error.message || 'Error desconocido.';
        }
        
        // Error de grabación de audio
    }
}

// ✅ NUEVA FUNCIÓN: Función para detener grabación de audio
function stopAudioRecording() {
    if (!isRecording || !mediaRecorder) return;
    
            mediaRecorder.stop();
            isRecording = false;
    
    // Restaurar apariencia del botón
        const audioBtn = document.getElementById('audioRecordBtn');
        if (audioBtn) {
                audioBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        audioBtn.style.background = '';
                audioBtn.title = 'Mantén presionado para grabar audio';
    }
}

// ✅ CORREGIDO: Función para mostrar reproductor de audio directamente
function showAudioMessage(audioBlob) {
    if (!window.dashboardCurrentUserId) return;
    
    // ✅ NUEVO: Validar duración mínima del audio (más de 1 segundo)
    const tempAudio = document.createElement('audio');
    tempAudio.src = URL.createObjectURL(audioBlob);
    
    tempAudio.addEventListener('loadedmetadata', function() {
        const duration = tempAudio.duration;
        
        // Verificar que el audio sea mayor a 1 segundo
        if (duration <= 1) {
            // Audio muy corto - mostrar error y no permitir envío
            showAudioDurationError();
            return;
        }
        
        // Audio válido - proceder normalmente
        const tempMessageId = 'temp_audio_' + Date.now();
        
        // Limpiar campo de entrada
        chatInputField.value = '';
        
        // ✅ NUEVO: Mostrar reproductor de audio directamente en el chat
        showAudioPreviewModal(audioBlob, tempMessageId);
        
        // Hacer scroll al final del chat
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // Limpiar el audio temporal
        URL.revokeObjectURL(tempAudio.src);
    });
    
    tempAudio.addEventListener('error', function() {
        // Error al cargar el audio
        showAudioDurationError();
        URL.revokeObjectURL(tempAudio.src);
    });
}

// ✅ FUNCIÓN MOVIDA A video-utils.js

// ✅ FUNCIÓN MOVIDA A video-utils.js

// ✅ CORREGIDO: Función para enviar audio al servidor
async function sendAudioMessage(audioBlob, tempMessageId = null) {
    if (!window.dashboardCurrentUserId) return;
    
    try {
        // ✅ MEJORADO: Usar SocketIO para audio en tiempo real
        if (checkDashboardConnection()) {
            
            // Convertir audio a base64 para SocketIO
            const reader = new FileReader();
            reader.onload = function() {
                const audioData = reader.result.split(',')[1]; // Remover data:audio/...;base64,
                const extension = audioBlob.type.includes('webm') ? '.webm' : 
                                 audioBlob.type.includes('mp4') ? '.mp4' : 
                                 audioBlob.type.includes('ogg') ? '.ogg' : '.wav';
                
                // ✅ CORREGIDO: El admin debe enviar audio al usuario del chat actual
                const currentChatUserId = getCurrentChatUserId();
                
                // ✅ NUEVO: Detectar si es usuario soporte para usar el tipo correcto
                const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
                const messageType = isSupportUser ? 'support' : 'admin';
                
                // Enviar por SocketIO
                
                
                // ✅ MEJORADO: Verificar conexión SocketIO
                if (!checkDashboardConnection()) {
                    return;
                }
                
                
                // ✅ CORREGIDO: Enviar audio directamente sin requestAnimationFrame
                window.socket.emit('send_audio_message', {
                    sender_id: window.dashboardCurrentUserId,
                    recipient_id: currentChatUserId || '2',
                    audio_data: audioData,
                    audio_filename: `audio_${Date.now()}${extension}`,
                    message_type: messageType
                });
                
                
            };
            reader.readAsDataURL(audioBlob);
            
            // Remover mensaje temporal inmediatamente
            if (tempMessageId) {
                removeTempMessage(tempMessageId);
            }
            
            // ✅ NUEVO: Actualizar estado del chat a "responded" (azul) para audio
            // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
            
        } else {
            // ✅ CORREGIDO: Solo usar SocketIO, no HTTP fallback
            showNotification('Error: No se puede enviar audio. Verifica la conexión.', 'error');
        }
    } catch (error) {
    }
}

// Función para configurar event listeners
function setupEventListeners() {
    // Envío de formulario de chat
    if (chatInputForm) {
        // ✅ NUEVO: Prevenir envío tradicional del formulario
        chatInputForm.setAttribute('novalidate', 'true');
        chatInputForm.setAttribute('action', 'javascript:void(0);');
        chatInputForm.setAttribute('method', 'post');
        
        chatInputForm.addEventListener('submit', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const message = chatInputField.value.trim();
            if (message && window.dashboardCurrentUserId) {
                sendMessage(message);
            }
            
            return false;
        });
    }
    
    // ✅ OPTIMIZACIÓN: Envío con Enter optimizado para escritura rápida
    if (chatInputField) {
        // ✅ CORREGIDO: Envío directo sin requestAnimationFrame para mejor rendimiento
        chatInputField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const message = chatInputField.value.trim();
                if (message && window.dashboardCurrentUserId) {
                    // ✅ CORREGIDO: Enviar directamente sin requestAnimationFrame
                    sendMessage(message);
                }
            }
        }, { passive: false });
        
        // ✅ OPTIMIZACIÓN: Usar debounce para handleTyping
        let typingTimeout;
        chatInputField.addEventListener('input', function() {
            // ✅ NUEVO: No activar indicador de escritura si es admin o soporte
            const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
            const isAdminUser = document.querySelector('meta[name="is-admin"]')?.content === 'true';
            
            if (isSupportUser || isAdminUser) {
                return;
            }
            
            // ✅ NUEVO: No activar indicador de escritura si se está seleccionando un archivo
            const fileInput = document.getElementById('chat-file-input');
            if (fileInput && fileInput.files && fileInput.files.length > 0) {
                return;
            }
            
            // ✅ NUEVO: No activar indicador si hay preview de archivos activo
            const filePreview = document.querySelector('.file-preview-message');
            if (filePreview) {
                return;
            }
            
            // ✅ NUEVO: No activar indicador si se están procesando archivos
            if (window.isProcessingFiles) {
                return;
            }
            
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                handleTyping();
            }, 100); // Debounce de 100ms
        });
    }
    
    // ✅ NUEVO: Event listeners para audio (toggle de grabación)
    const audioRecordBtn = document.getElementById('audioRecordBtn');
    if (audioRecordBtn) {
        // ✅ NUEVO: Solo usar click para toggle de grabación
        audioRecordBtn.addEventListener('click', startAudioRecording);
        
        // ✅ NUEVO: Eventos táctiles para dispositivos móviles (también toggle)
        audioRecordBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startAudioRecording();
        }, { passive: false }); // ✅ CORREGIDO: Cambiar a passive: false para permitir preventDefault
    }
    
    // ✅ NUEVO: Event listener para input de archivos
    const fileInput = document.getElementById('chat-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelection);
    }
    
    // ✅ NUEVO: Event listener para el botón de envío
    const chatSendButton = document.getElementById('chatSendButton');
    if (chatSendButton) {
        chatSendButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const message = chatInputField.value.trim();
            if (message && window.dashboardCurrentUserId) {
                sendMessage(message);
            }
            
            return false;
        });
    }
}

// ✅ NUEVO: Función para configurar toggle de lista de chats
function setupChatListToggle() {
    const chatListToggle = document.getElementById('chatListToggle');
    const chatListContainer = document.querySelector('.chat-list-container');
    
    if (chatListToggle && chatListContainer) {
        chatListToggle.addEventListener('click', function() {
            chatListContainer.classList.toggle('collapsed');
            
            // Cambiar el icono según el estado
            const icon = chatListToggle.querySelector('i');
            if (icon) {
                if (chatListContainer.classList.contains('collapsed')) {
                    icon.className = 'fas fa-chevron-left'; // Flecha hacia la izquierda cuando está colapsado
                } else {
                    icon.className = 'fas fa-chevron-right'; // Flecha hacia la derecha cuando está expandido
                }
            }
        });
    }
}

// ✅ NUEVA FUNCIÓN: Configurar botón de limpieza de archivos corruptos
function setupCleanupButton() {
    // ✅ CORREGIDO: Buscar el botón de limpiar mensajes antiguos con selectores válidos
    const cleanupBtn = document.querySelector('button[onclick*="limpiar"]') || 
                      document.querySelector('button[title*="limpiar"]') ||
                      Array.from(document.querySelectorAll('button')).find(btn => 
                          btn.textContent.includes('Limpiar') || 
                          btn.innerHTML.includes('Limpiar')
                      );
    
    if (cleanupBtn) {
        // ✅ FUNCIONALIDAD INTEGRADA: Los botones de limpieza están integrados en cleanupOldMessages
    }
}

// ✅ NUEVA FUNCIÓN: Limpiar event listeners duplicados
function clearDuplicateEventListeners() {
    const btnLimpiarMensajes = document.getElementById('btnLimpiarMensajes');
    if (btnLimpiarMensajes) {
        // Clonar el botón para eliminar todos los event listeners
        const newBtn = btnLimpiarMensajes.cloneNode(true);
        btnLimpiarMensajes.parentNode.replaceChild(newBtn, btnLimpiarMensajes);
    }
}

// ✅ NUEVO: Contador global de errores del chat
window.chatErrorCount = 0;

// ✅ NUEVO: Interceptor global de errores para monitorear la salud del chat
window.addEventListener('error', function(e) {
    window.chatErrorCount = (window.chatErrorCount || 0) + 1;
    
    // Si hay demasiados errores, intentar recuperar el chat
    if (window.chatErrorCount > 15) {
        setTimeout(() => {
            recoverChatFromCorruption();
        }, 1000);
    }
});

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
         // DOM cargado, inicializando chat
    initializeChat();
    
    // ✅ NUEVO: Inicializar compatibilidad de audio
    initializeAudioCompatibility();
    
    // ✅ NUEVO: Inicializar limpieza periódica del área de chat
    initializeChatAreaCleanup();
    
    // ✅ NUEVO: Configurar protección de videos
    if (typeof window.setupVideoProtection === 'function') {
        window.setupVideoProtection();
    }
    
    // ✅ NUEVO: Solicitar permisos de notificaciones al cargar la página
    setTimeout(() => {
        requestNotificationPermission();
    }, 1000); // Esperar 1 segundo para que la página se cargue completamente
});

// ✅ NUEVA FUNCIÓN: Inicializar compatibilidad de audio
function initializeAudioCompatibility() {
    const audioBtn = document.getElementById('audioRecordBtn');
    if (audioBtn) {
        const compatibility = checkAudioRecordingSupport();
        if (!compatibility.supported) {
            audioBtn.style.background = '#6c757d'; // Gris para indicar no disponible
            audioBtn.title = 'Grabación no disponible - Usa adjuntar archivo';
            audioBtn.onclick = function() {
                showAudioRecordingAlternative();
            };
        }
    }
    


}

// ================== FUNCIONES GLOBALES ==================

// Función global para eliminar chat (llamada desde HTML)
window.deleteUserChat = deleteUserChat;

// Función global para limpiar mensajes antiguos (llamada desde HTML)
window.cleanupOldMessages = cleanupOldMessages;

// ✅ FUNCIONALIDAD INTEGRADA: La limpieza de estados obsoletos ahora está integrada en cleanupOldMessages

// ✅ NUEVA FUNCIÓN: Actualizar estado del chat en la lista
// IMPORTANTE: Solo se debe llamar cuando hay acciones reales (escribir/responder)
// NO cuando se cargan mensajes existentes
// ✅ ELIMINADO: Función duplicada updateChatStatus - ahora se usa updateUserChatStatus

// ✅ NUEVA FUNCIÓN: Agregar event listeners para botones de finalizar soporte
function addFinishSupportButtonListeners() {
    const finishButtons = document.querySelectorAll('.finish-support-btn');
    finishButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation(); // Evitar que se seleccione el chat
            
            const userId = this.getAttribute('data-user-id');
            const username = this.getAttribute('data-username');
            

            
            // ✅ NUEVO: Marcar chat como finalizado
            finishSupportChat(userId, username);
        });
    });
}

// ✅ NUEVA FUNCIÓN: Finalizar soporte del chat
async function finishSupportChat(userId, username) {
    try {
        // ✅ CORREGIDO: Usar SocketIO para finalizar chat
        let data = { status: 'success' }; // Inicializar data por defecto
        
        if (typeof window.socket !== 'undefined' && window.socket && window.socket.connected) {
            // Emitir evento y esperar respuesta
            window.socket.emit('finalize_chat', {
                user_id: userId,
                admin_id: dashboardCurrentUserId
            });
            
            // Continuar con la lógica visual inmediatamente
            data = { status: 'success' };
        } else {
            const response = await fetch('/tienda/api/chat/update_chat_status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getSupportCsrfToken()
                },
                body: JSON.stringify({
                    user_id: userId,
                    status: 'finished'
                })
            });
            
            data = await response.json();
        }
        
        if (data.status === 'success') {
            // ✅ NUEVO: Actualizar estado del chat a "finished" (morado)
            // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
            
            // ✅ NUEVO: Cambiar el icono del botón para indicar que está finalizado
            const finishButton = document.querySelector(`.finish-support-btn[data-user-id="${userId}"]`);
            if (finishButton) {
                finishButton.innerHTML = '<i class="fas fa-check-circle"></i>';
                finishButton.classList.add('finished');
                finishButton.title = 'Soporte finalizado';
            }
            
            // ✅ CORREGIDO: No crear mensaje del sistema aquí - SocketIO se encarga
            
            // ✅ NUEVO: Mostrar confirmación
            // Soporte finalizado
            
            // Estado del chat actualizado en el servidor
        } else {
            // Error del servidor al finalizar soporte
            // Error del servidor al finalizar soporte
        }
        
    } catch (error) {
        // Error al finalizar soporte
    }
}

// ✅ NUEVA FUNCIÓN: Quitar estado finished cuando hay nueva actividad
// Esta función se llama cuando CUALQUIERA escribe en un chat finalizado
// Cambia el estado de 'finished' (morado) a 'responded' (azul)
// Se ejecuta tanto para mensajes de texto como de audio
async function removeFinishedStatus(userId) {
    try {
        // Buscar el elemento del usuario en la lista
        const userItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
        if (!userItem) return;
        
        // Verificar si el chat estaba en estado finished
        const currentStatus = userItem.getAttribute('data-chat-status');
        if (currentStatus === 'finished') {
            // Quitando estado finished
            
            // Quitar la clase finished del botón
            const finishButton = userItem.querySelector('.finish-support-btn');
            if (finishButton) {
                finishButton.classList.remove('finished');
                finishButton.title = 'Finalizar soporte';
            }
            
            // ✅ MIGRADO: Usar SocketIO primero, HTTP como fallback
            if (typeof window.socket !== 'undefined' && window.socket && window.socket.connected) {
                window.socket.emit('update_chat_status', {
                    user_id: userId,
                    status: 'responded'
                });
                
                // ✅ CORREGIDO: No llamar updateUserChatStatus directamente
                // El event listener de SocketIO se encargará de la actualización
            } else {
                try {
                    const response = await fetch('/tienda/api/chat/update_chat_status', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getSupportCsrfToken()
                        },
                        body: JSON.stringify({
                            user_id: userId,
                            status: 'responded'
                        })
                    });
                    
                    const data = await response.json();
                    if (data.status === 'success') {
                        
                        // ✅ CRÍTICO: Usar updateUserChatStatus para mantener sincronización completa
                        // Esto actualizará tanto el atributo como las clases CSS del icono
                        // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
                        
                    } else {
                    }
                } catch (apiError) {
                }
            }
        }
        
    } catch (error) {
        // Error al quitar estado finished
    }
}

// ✅ FUNCIONES PARA EL SISTEMA DE ESTADOS
window.testChatStatus = function() {
    if (window.dashboardCurrentUserId) {
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            // Elemento del usuario encontrado
        } else {
            // No se encontró elemento del usuario
        }
    } else {
        // No hay usuario seleccionado
    }
};

// ✅ NUEVA FUNCIÓN: Probar cambio manual de estado
window.testStatusChange = function() {
    if (window.dashboardCurrentUserId) {
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const currentStatus = userItem.getAttribute('data-chat-status');
            
            if (currentStatus === 'finished') {
                // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
            } else if (currentStatus === 'responded') {
                // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Verificar persistencia del estado del chat
window.verifyStatusPersistence = function() {
    const userItems = document.querySelectorAll('.chat-item');
    
    // Verificar si hay inconsistencias
    let inconsistencies = 0;
    const finishedUsers = document.querySelectorAll('.chat-item[data-chat-status="finished"]');
    const respondedUsers = document.querySelectorAll('.chat-item[data-chat-status="responded"]');
    const newMessageUsers = document.querySelectorAll('.chat-item[data-chat-status="new_message"]');
    
    // Verificar que las clases CSS coincidan con los atributos
    userItems.forEach(userItem => {
        const status = userItem.getAttribute('data-chat-status');
        const userInitial = userItem.querySelector('.user-initial');
        
        if (userInitial) {
            const hasCorrectClass = userInitial.classList.contains(`status-${status.replace('_', '-')}`);
            if (!hasCorrectClass) {
                inconsistencies++;
            }
        }
    });
};

// ✅ NUEVA FUNCIÓN: Probar mensaje del sistema
window.testSystemMessage = function() {
    if (window.dashboardCurrentUserId) {
        // Crear un mensaje del sistema
        const systemMessage = {
            id: 'system_' + Date.now(),
            message: 'Mensaje del sistema',
            sender_id: 'system',
            sender_name: 'Sistema',
            message_type: 'system',
            created_at: new Date().toISOString()
        };
        
        // Agregar el mensaje del sistema al chat
        addMessageToChat(systemMessage, false);
    }
};

// ✅ NUEVA FUNCIÓN: Probar color morado
window.testPurpleColor = function() {
    if (window.dashboardCurrentUserId) {
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const userInitial = userItem.querySelector('.user-initial');
            if (userInitial) {
                // Remover todas las clases de estado
                userInitial.classList.remove('status-new-message', 'status-responded', 'status-finished', 'status-pending');
                
                // Agregar clase finished (morado)
                userInitial.classList.add('status-finished');
                
                // Actualizar atributo del elemento
                userItem.setAttribute('data-chat-status', 'finished');
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Verificar estado actual del chat
window.verifyChatStatus = function() {
    if (window.dashboardCurrentUserId) {
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const userInitial = userItem.querySelector('.user-initial');
            if (userInitial) {
                // Estado actual del chat verificado
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Forzar estado finished
window.forceFinishedStatus = async function() {
    if (window.dashboardCurrentUserId) {
        // ✅ MIGRADO: Usar SocketIO primero, HTTP como fallback
        if (typeof window.socket !== 'undefined' && window.socket && window.socket.connected) {
            window.socket.emit('update_chat_status', {
                user_id: window.dashboardCurrentUserId,
                status: 'finished'
            });
            
            // ✅ CORREGIDO: No llamar updateUserChatStatus directamente
            // El event listener de SocketIO se encargará de la actualización
            
            // Recargar lista de usuarios para ver el cambio
            setTimeout(() => {
                loadUsersList();
            }, 500);
        } else {
            try {
                const response = await fetch('/tienda/api/chat/force_finished_status', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getSupportCsrfToken()
                    },
                    body: JSON.stringify({
                        user_id: window.dashboardCurrentUserId
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 'success') {
                        // Actualizar estado visual
                        // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
                        
                        // Recargar lista de usuarios para ver el cambio
                        setTimeout(() => {
                            loadUsersList();
                        }, 500);
                    }
                }
            } catch (error) {
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Verificar prioridad del estado finished
window.verifyFinishedPriority = function() {
    if (window.dashboardCurrentUserId) {
        // Verificar estado actual
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const userInitial = userItem.querySelector('.user-initial');
            if (userInitial) {
                // Verificar si hay mensajes del sistema en el chat
                const chatMessages = document.querySelectorAll('.message.system-message');
                
                // Verificar si el último mensaje es del sistema
                const allMessages = document.querySelectorAll('.message');
                const lastMessage = allMessages[allMessages.length - 1];
                if (lastMessage) {
                    const isSystemMessage = lastMessage.classList.contains('system-message');
                }
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Verificar consistencia de colores
window.verifyColorConsistency = function() {
    if (window.dashboardCurrentUserId) {
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const userInitial = userItem.querySelector('.user-initial');
            if (userInitial) {
                // Verificar qué estado debería tener
                const hasFinished = userInitial.classList.contains('status-finished');
                const hasResponded = userInitial.classList.contains('status-responded');
                const hasNewMessage = userInitial.classList.contains('status-new-message');
                const hasPending = userInitial.classList.contains('status-pending');
                
                // Verificar si hay mensajes del sistema
                const systemMessages = document.querySelectorAll('.message.system-message');
                if (systemMessages.length > 0) {
                                    // El chat debería estar en estado FINISHED (morado)
            }
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Verificar prioridad del estado finished
window.testFinishedPriority = function() {
    if (window.dashboardCurrentUserId) {
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const userInitial = userItem.querySelector('.user-initial');
            if (userInitial) {
                // Forzar estado finished
                userInitial.classList.remove('status-responded', 'status-new-message', 'status-pending');
                userInitial.classList.add('status-finished');
                userItem.setAttribute('data-chat-status', 'finished');
                
                // Simular hover para verificar que se mantiene morado
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Verificar estado del usuario 2 (soporte)
window.verifyUser2Status = function() {
    // Verificando estado del usuario 2 (soporte)
    const user2Item = document.querySelector('.chat-item[data-user-id="2"]');
    if (user2Item) {
        const userInitial = user2Item.querySelector('.user-initial');
        if (userInitial) {
            // Verificar si hay mensajes del sistema en el chat
            const chatMessages = document.querySelectorAll('.message.system-message');
            
            if (chatMessages.length > 0) {
                // El usuario 2 DEBERÍA estar en estado FINISHED (morado)
                
                // Forzar estado finished
                userInitial.classList.remove('status-responded', 'status-new-message', 'status-pending');
                userInitial.classList.add('status-finished');
                user2Item.setAttribute('data-chat-status', 'finished');
            }
        }
    }
};

// ================== FUNCIONALIDAD DE ARCHIVOS ==================

// ✅ NUEVA FUNCIÓN: Manejar selección de archivos
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    // Validar archivos
    const validFiles = files.filter(file => {
        
        // ✅ NUEVO: Usar las mismas funciones de detección que displayFileInChat
        const isValidType = file.type.startsWith('image/') || 
                           file.type.startsWith('video/') || 
                           file.type.startsWith('audio/') ||
                           file.type === 'application/pdf' ||
                           file.type === 'application/msword' ||
                           file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                           file.type === 'application/vnd.ms-excel' ||
                           file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                           file.type === 'text/plain' ||
                           file.type === 'text/csv' ||
                           // ✅ NUEVO: Usar funciones de detección por extensión
                           (typeof isVideoFile === 'function' && isVideoFile(file.name)) ||
                           (typeof isImageFile === 'function' && isImageFile(file.name));
        
        
        if (!isValidType) {
            return false;
        }
        
        const maxSize = 200 * 1024 * 1024; // 200MB (límite del servidor)
        if (file.size > maxSize) {
            return false;
        }
        
        return true;
    });
    
    if (validFiles.length === 0) {
        return;
    }
    
    // Mostrar preview y enviar archivos
    showFilePreview(validFiles);
}

// ✅ NUEVA FUNCIÓN: Mostrar preview de archivos
function showFilePreview(files) {
    if (!window.dashboardCurrentUserId) return;
    
    // Crear mensaje temporal para preview
    const tempMessageId = 'temp_files_' + Date.now();
    const previewMessage = document.createElement('div');
    previewMessage.className = 'message temp-message file-preview-message';
    previewMessage.id = `preview-${tempMessageId}`;
    
    let previewHTML = `
        <div class="message-content">
            <span class="message-sender-inline admin-inline">Admin: </span>
            <div class="file-preview-container">
                <div class="file-preview-title">📎 Archivos seleccionados (${files.length})</div>
                <div class="file-preview-list">
    `;
    
    files.forEach((file, index) => {
        const fileSize = (file.size / 1024 / 1024).toFixed(2);
        const fileIcon = getFileIcon(file.type);
        
        previewHTML += `
            <div class="file-preview-item">
                <span class="file-icon">${fileIcon}</span>
                <span class="file-name">${file.name}</span>
                <span class="file-size">${fileSize} MB</span>
            </div>
        `;
    });
    
    previewHTML += `
                </div>
                <div class="file-preview-actions">
                    <button class="send-files-btn" id="sendFilesBtn-${tempMessageId}">
                        <i class="fas fa-paper-plane"></i> Enviar
                    </button>
                    <button class="cancel-files-btn" id="cancelFilesBtn-${tempMessageId}">
                        <i class="fas fa-times"></i> Cancelar
                    </button>
                </div>
            </div>
        </div>
        <div class="message-time">Ahora</div>
    `;
    
    previewMessage.innerHTML = previewHTML;
    chatMessagesArea.appendChild(previewMessage);
    chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
    
    // Event listeners para los botones
    const sendBtn = document.getElementById(`sendFilesBtn-${tempMessageId}`);
    const cancelBtn = document.getElementById(`cancelFilesBtn-${tempMessageId}`);
    
    sendBtn.addEventListener('click', () => {
        sendFiles(files, tempMessageId);
    });
    
    cancelBtn.addEventListener('click', () => {
        previewMessage.remove();
        // Limpiar input de archivos
        const fileInput = document.getElementById('chat-file-input');
        if (fileInput) fileInput.value = '';
    });
}

// ✅ NUEVA FUNCIÓN: Obtener icono según tipo de archivo
function getFileIcon(fileType) {
    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType.startsWith('video/')) return '🎥';
    if (fileType.startsWith('audio/')) return '🎵';
    if (fileType === 'application/pdf') return '📄';
    if (fileType.includes('word') || fileType.includes('document')) return '📝';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📊';
    if (fileType === 'text/plain') return '📄';
    if (fileType === 'text/csv') return '📊';
    return '📎';
}

// ✅ NUEVA FUNCIÓN: Obtener icono específico para archivos genéricos
function getFileIconByType(fileType, fileName) {
    if (fileType === 'application/pdf') return '📕';
    if (fileType === 'application/msword') return '📘';
    if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '📘';
    if (fileType === 'application/vnd.ms-excel') return '📗';
    if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '📗';
    if (fileType === 'text/plain') return '📄';
    if (fileType === 'text/csv') return '📊';
    
    // Por extensión del archivo si el tipo no está definido
    const extension = fileName.split('.').pop().toLowerCase();
    if (extension === 'pdf') return '📕';
    if (extension === 'doc' || extension === 'docx') return '📘';
    if (extension === 'xls' || extension === 'xlsx') return '📗';
    if (extension === 'txt') return '📄';
    if (extension === 'csv') return '📊';
    
    return '📎';
}

// ✅ NUEVA FUNCIÓN: Obtener nombre legible del tipo de archivo
function getFileTypeName(fileType) {
    if (fileType === 'application/pdf') return 'PDF';
    if (fileType === 'application/msword') return 'Word';
    if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'Word';
    if (fileType === 'application/vnd.ms-excel') return 'Excel';
    if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'Excel';
    if (fileType === 'text/plain') return 'Texto';
    if (fileType === 'text/csv') return 'CSV';
    
    return 'Documento';
}

// ✅ NUEVA FUNCIÓN: Formatear tamaño de archivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function getFileIcon(mimeType) {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    return '📄';
}

// ✅ NUEVA FUNCIÓN: Verificar tipos de archivo soportados
function getSupportedFileTypes() {
    return {
        images: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
        videos: ['video/mp4', 'video/webm', 'video/ogg', 'video/avi', 'video/mov', 'video/wmv'],
        audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a', 'audio/aac'],
        documents: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    };
}

// ✅ NUEVA FUNCIÓN: Verificar si un tipo de archivo es soportado
function isFileTypeSupported(mimeType) {
    const supportedTypes = getSupportedFileTypes();
    const allSupported = [...supportedTypes.images, ...supportedTypes.videos, ...supportedTypes.audio, ...supportedTypes.documents];
    return allSupported.includes(mimeType);
}

// ✅ NUEVA FUNCIÓN: Mostrar información de tipos de archivo soportados
window.showSupportedFileTypes = function() {
    const supportedTypes = getSupportedFileTypes();
    
    // Mostrar en la interfaz
    const message = `
🖼️ Imágenes: JPEG, JPG, PNG, GIF, WebP, BMP
🎥 Videos: MP4, WebM, OGG, AVI, MOV, WMV
🎵 Audio: MP3, WAV, OGG, WebM, M4A, AAC
📄 Documentos: PDF, TXT, DOC, DOCX, XLS, XLSX
    `;
    
    // Tipos de archivo soportados
};

// ✅ NUEVA FUNCIÓN: Verificar configuración del input de archivos
window.checkFileInputConfig = function() {
    const adminInput = document.getElementById('chat-file-input');
    const supportInput = document.getElementById('chat-file-input-support');
    const userInput = document.getElementById('chat-file-input-user');
    
    // Verificar que los tipos estén incluidos
    const expectedTypes = [
        'image/*', 'video/*', 'audio/*', 'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv'
    ];
    
    const allInputs = [adminInput, supportInput, userInput].filter(Boolean);
    allInputs.forEach((input, index) => {
        const missingTypes = expectedTypes.filter(type => !input.accept.includes(type));
        if (missingTypes.length > 0) {
            // Input le faltan tipos
        }
    });
};

// ✅ NUEVA FUNCIÓN: Previsualizar archivos genéricos
window.previewGenericFile = function(fileUrl, fileName, fileType) {
    // ✅ Para PDFs, abrir en nueva pestaña
    if (fileType === 'application/pdf') {
        window.open(fileUrl, '_blank');
        return;
    }
    
    // ✅ Para archivos de texto, mostrar contenido
    if (fileType === 'text/plain' || fileType === 'text/csv') {
        showTextFilePreview(fileUrl, fileName);
        return;
    }
    
    // ✅ Para otros archivos, abrir directamente en nueva pestaña
    window.open(fileUrl, '_blank');
};

// ✅ NUEVA FUNCIÓN: Mostrar preview de archivos de texto
function showTextFilePreview(fileUrl, fileName) {
    fetch(fileUrl)
        .then(response => response.text())
        .then(content => {
            const modal = document.createElement('div');
            modal.className = 'file-preview-modal-overlay';
            modal.innerHTML = `
                <div class="file-preview-modal">
                    <div class="file-preview-header">
                        <span class="file-preview-title">📄 ${fileName}</span>
                        <button class="file-preview-close" data-action="close-file-preview-modal">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="file-preview-content">
                        <pre class="text-file-content">${content}</pre>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Cerrar modal al hacer clic fuera
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
            
            // Cerrar modal con ESC
            document.addEventListener('keydown', function closeOnEsc(e) {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', closeOnEsc);
                }
            });
        })
        .catch(error => {
            showErrorMessage('Error al cargar el archivo de texto');
        });
}

// ✅ NUEVA FUNCIÓN: Mostrar información del archivo
function showFileInfo(fileUrl, fileName, fileType) {
    const modal = document.createElement('div');
    modal.className = 'file-info-modal-overlay';
    modal.innerHTML = `
        <div class="file-info-modal">
            <div class="file-info-header">
                <span class="file-info-title">📎 ${fileName}</span>
                <button class="file-info-close" data-action="close-file-info-modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="file-info-content">
                <div class="file-info-item">
                    <strong>Tipo:</strong> ${getFileTypeName(fileType)}
                </div>
                <div class="file-info-item">
                    <strong>Archivo:</strong> ${fileName}
                </div>
                <div class="file-info-actions">
                    <a href="${fileUrl}" download="${fileName}" class="file-download-btn-large">
                        <i class="fas fa-download"></i> Descargar
                    </a>
                    <button class="file-open-btn" data-action="open-file-new-tab" data-file-url="${fileUrl.replace(/'/g, "&#39;").replace(/"/g, "&quot;")}">
                        <i class="fas fa-external-link-alt"></i> Abrir
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    // Cerrar modal con ESC
    document.addEventListener('keydown', function closeOnEsc(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', closeOnEsc);
        }
    });
}


// ✅ NUEVA FUNCIÓN: Verificar directorio de uploads
window.verifyUploadDir = async function() {
    try {
        const response = await fetch('/tienda/api/chat/debug_upload_dir', {
            method: 'GET',
            headers: {
                'X-CSRFToken': getSupportCsrfToken()
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                // Mostrar información en la interfaz
                const debugInfo = data.debug_info;
                const message = `
📁 INFORMACIÓN DEL DIRECTORIO:

📁 Ruta del directorio: ${debugInfo.upload_dir}
✅ Existe: ${debugInfo.upload_dir_exists}
📂 Es directorio: ${debugInfo.upload_dir_is_dir}
✍️ Permisos de escritura: ${debugInfo.write_permissions}
📊 Archivos en directorio: ${debugInfo.file_count}
⚙️ MAX_CONTENT_LENGTH: ${debugInfo.flask_config.MAX_CONTENT_LENGTH} bytes
                `;
                
                // Mostrar mensaje
            } else {
                // Error al verificar
            }
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        // Error al verificar directorio
    }
};

// ✅ NUEVA FUNCIÓN: Verificar archivo JPG
window.verifyJpgFile = function() {
    const fileInput = document.getElementById('chat-file-input');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        // No hay archivos seleccionados
        return;
    }
    
    const file = fileInput.files[0];
    
    // Verificar si es realmente un archivo JPG
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
        // Crear un FormData
        const formData = new FormData();
        formData.append('file', file);
        
        // Archivo JPG analizado
    } else {
        // El archivo no es un JPG válido
    }
};

// ✅ NUEVA FUNCIÓN: Enviar archivos al servidor
async function sendFiles(files, tempMessageId) {
    if (!window.dashboardCurrentUserId) return;
    
    
    // ✅ NUEVO: Prevenir corrupción del chat
    if (!preventChatCorruption()) {
        showErrorMessage('Error: El chat está en un estado inestable. Recargando...');
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        return;
    }
    
    try {

        
        const formData = new FormData();
        
        // ✅ CORREGIDO: El admin debe enviar archivos al usuario del chat actual
        const currentChatUserId = getCurrentChatUserId();
        
        // ✅ VALIDACIÓN: Para usuarios de soporte, requiere chat seleccionado
        const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
        if (isSupportUser && !currentChatUserId) {
            showNotification('Debes seleccionar un chat antes de enviar archivos', 'error');
            return;
        }
        
        formData.append('recipient_id', currentChatUserId || '2');
        
        

        
        // Agregar cada archivo
        const validFiles = [];
        files.forEach((file, index) => {
            if (file.size === 0) {
                showErrorMessage(`Error: El archivo "${file.name}" está vacío`);
                return;
            }
            
            if (file.size > 0) {
                formData.append(`file_${index}`, file);
                validFiles.push(file);
            }
        });
        
        if (validFiles.length === 0) {
            throw new Error('No hay archivos válidos para enviar');
        }
        
        // Verificar que el FormData tenga contenido
        let formDataSize = 0;
        for (let [key, value] of formData.entries()) {
            if (value instanceof File) {
                formDataSize += value.size;
            }
        }
        
        if (formDataSize === 0) {
            throw new Error('FormData está vacío - no hay archivos válidos para enviar');
        }
        
        // ✅ NUEVO: Usar SocketIO SIEMPRE con compresión automática
        if (typeof window.socket !== 'undefined' && window.socket && window.socket.connected) {
            
            // ✅ NUEVO: Enviar archivos por chunks para evitar error 400
            for (let i = 0; i < validFiles.length; i++) {
                const file = validFiles[i];
                    
                    // ✅ NUEVO: Detectar si es usuario soporte para usar el tipo correcto
                    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
                    const messageType = isSupportUser ? 'support' : 'admin';
                    
                // ✅ OPTIMIZADO: Agregar archivo a la cola de procesamiento
                fileProcessingQueue.push({
                    file: file,
                    senderId: window.dashboardCurrentUserId,
                    recipientId: currentChatUserId || '2',
                    messageType: messageType
                });
                
                // ✅ NUEVO: Mostrar indicador de progreso
                showFileProcessingIndicator(fileProcessingQueue.length);
                
                // ✅ NUEVO: Limpiar indicadores de escritura cuando se envían archivos
                // clearAllTypingIndicators();
                
                // ✅ NUEVO: Marcar que se están procesando archivos
                window.isProcessingFiles = true;
                
                // Iniciar procesamiento de la cola
                processFileQueue();
            }
            
            // Remover mensaje temporal
            removeTempMessage(tempMessageId);
            
            // Actualizar estado del chat
            // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
            
            return; // Salir ya que se envió por SocketIO
            
        } else {
            
            // Enviar archivos
            const response = await fetch('/tienda/api/chat/send_message', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getSupportCsrfToken()
                },
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
        }
        
        if (data.status === 'success') {
            // Manejar múltiples archivos
            if (data.data) {
                if (Array.isArray(data.data)) {
                    // MÚLTIPLES ARCHIVOS: Crear un mensaje por cada archivo
                    data.data.forEach((fileData, index) => {
                        try {
                            addMessageToChat(fileData, true);
                        } catch (error) {
                            // Error al agregar mensaje
                        }
                    });
                    
                    // Scroll al final después de agregar todos los mensajes
                    setTimeout(() => {
                        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
                    }, 100);
                    
                } else if (data.data.has_attachment) {
                    // UN SOLO ARCHIVO: Agregar mensaje normal
                    addMessageToChat(data.data, true);
                    chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
                } else {
                    // MENSAJE DE TEXTO: Agregar mensaje normal
                    addMessageToChat(data.data, true);
                    chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
                }
            }
            
            // Remover preview temporal
            const previewMessage = document.getElementById(`preview-${tempMessageId}`);
            if (previewMessage) previewMessage.remove();
            
            // Limpiar input de archivos
            const fileInput = document.getElementById('chat-file-input');
            if (fileInput) fileInput.value = '';
            
            // Actualizar estado del chat
            // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
            
        } else {
            showErrorMessage(`Error al enviar archivos: ${data.message}`);
        }
        
            } catch (error) {
            // ✅ NUEVO: Mostrar error al usuario
            showErrorMessage(`Error al enviar archivos: ${error.message}`);
            
            // ✅ NUEVO: Intentar recuperar el chat automáticamente
            setTimeout(() => {
                recoverChatFromCorruption();
            }, 2000);
        }
}

// ✅ FUNCIÓN MOVIDA A video-utils.js

// ✅ NUEVA FUNCIÓN: Verificar si un archivo existe
async function checkFileExists(fileUrl) {
    try {
        const response = await fetch(fileUrl, { method: 'HEAD' });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// ✅ NUEVA FUNCIÓN: Mostrar mensaje de error
function showErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #e74c3c;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
        z-index: 10000;
        max-width: 300px;
        word-wrap: break-word;
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    // Remover después de 5 segundos
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

// ✅ FUNCIONALIDAD INTEGRADA: Estas funciones están ahora integradas en cleanupOldMessages
// y en la limpieza automática del sistema

// ✅ NUEVA FUNCIÓN: Probar envío de múltiples archivos
window.testMultipleFiles = function() {
    const fileInput = document.getElementById('chat-file-input');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        // No hay archivos seleccionados
        return;
    }
    
    const files = Array.from(fileInput.files);
    
            // Crear FormData
    const formData = new FormData();
    formData.append('recipient_id', 'verification');
    
    files.forEach((file, index) => {
        if (file.size > 0) {
            formData.append(`file_${index}`, file);
        }
    });
    
    // Verificar FormData
    let fileCount = 0;
    for (let [key, value] of formData.entries()) {
        if (value instanceof File) {
            fileCount++;
        }
    }
    
    if (fileCount === files.length) {
        // Verificación exitosa
    } else {
        // Verificación con advertencias
    }
};

// ✅ FUNCIONALIDAD INTEGRADA: La verificación de archivos está integrada en el sistema automático

// ✅ NUEVA FUNCIÓN: Recuperar chat de corrupción
async function recoverChatFromCorruption() {
            try {
            // Verificar si realmente hay problemas antes de recuperar
            const hasRealProblems = checkForRealChatProblems();
            
            if (!hasRealProblems) {
                showInfoMessage('El chat está funcionando correctamente');
                return;
            }
            
            showInfoMessage('Recuperando chat...');
            
            // Limpiar área de mensajes
            if (chatMessagesArea) {
                chatMessagesArea.innerHTML = '';
            }
            
            // Recargar lista de usuarios
            await loadUsersList();
            
            // Si hay un usuario seleccionado, recargar su conversación
            if (window.dashboardCurrentUserId) {
                await loadUserMessages(window.dashboardCurrentUserId);
            }
            
            showSuccessMessage('Chat recuperado exitosamente');
            
        } catch (error) {
            showErrorMessage('Error al recuperar chat. Intenta recargar la página.');
        }
}

// ✅ NUEVA FUNCIÓN: Verificar si realmente hay problemas en el chat
function checkForRealChatProblems() {
    let hasProblems = false;
    
    // Verificar mensajes corruptos (solo si están marcados explícitamente)
    const corruptedMessages = document.querySelectorAll('.message[data-corrupted="true"]');
    if (corruptedMessages.length > 0) {
        hasProblems = true;
    }
    
    // Verificar mensajes sin contenido (solo si son realmente problemáticos)
    const emptyMessages = document.querySelectorAll('.message:not(:has(.message-text)):not(:has(.file-attachment)):not(.system-message):not(.date-separator)');
    if (emptyMessages.length > 0) {
        // Solo considerar problemáticos si no son mensajes del sistema o separadores de fecha
        const problematicEmptyMessages = Array.from(emptyMessages).filter(msg => {
            const isSystemMessage = msg.classList.contains('system-message');
            const isDateSeparator = msg.classList.contains('date-separator');
            const hasHiddenContent = msg.querySelector('.message-text, .file-attachment, .audio-player, .video-player');
            const isAdminMessage = msg.querySelector('.admin-message, .support-message');
            
            // Solo es problemático si no es ninguno de estos tipos válidos
            return !isSystemMessage && !isDateSeparator && !hasHiddenContent && !isAdminMessage;
        });
        
        if (problematicEmptyMessages.length > 0) {
            hasProblems = true;
        }
    }
    
    // Verificar archivos rotos (solo si las URLs están realmente malformadas)
    const brokenFiles = document.querySelectorAll('.file-attachment img[src*="undefined"], .file-attachment video[src*="undefined"], .file-attachment audio[src*="undefined"]');
    if (brokenFiles.length > 0) {
        hasProblems = true;
    }
    
    // Verificar errores de JavaScript (solo si están marcados explícitamente)
    const errorElements = document.querySelectorAll('.message[data-error="true"]');
    if (errorElements.length > 0) {
        hasProblems = true;
    }
    
    // Verificar si el chat está completamente roto (solo si no hay mensajes y debería haberlos)
    const chatArea = document.querySelector('.chat-messages-area');
    if (!chatArea) {
        hasProblems = true;
    } else if (chatArea.children.length === 0 && window.dashboardCurrentUserId) {
        // Solo es problemático si hay un usuario seleccionado pero no hay mensajes
        hasProblems = true;
    }
    
    return hasProblems;
}

// ✅ NUEVA FUNCIÓN: Mostrar mensaje de éxito
function showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #27ae60;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(39, 174, 96, 0.3);
        z-index: 10000;
        max-width: 300px;
        word-wrap: break-word;
    `;
    successDiv.textContent = message;
    
    document.body.appendChild(successDiv);
    
    // Remover después de 3 segundos
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.parentNode.removeChild(successDiv);
        }
    }, 3000);
}

// ✅ NUEVA FUNCIÓN: Mostrar mensaje informativo
function showInfoMessage(message) {
    const infoDiv = document.createElement('div');
    infoDiv.className = 'info-message';
    infoDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #3498db;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
        z-index: 10000;
        max-width: 300px;
        word-wrap: break-word;
    `;
    infoDiv.textContent = message;
    
    document.body.appendChild(infoDiv);
    
    // Remover después de 4 segundos
    setTimeout(() => {
        if (infoDiv.parentNode) {
            infoDiv.parentNode.removeChild(infoDiv);
        }
    }, 4000);
}

// ✅ NUEVA FUNCIÓN: Prevenir corrupción del chat
function preventChatCorruption() {
    try {
        // Verificar que los elementos críticos existan
        if (!chatMessagesArea || !chatInputArea || !chatInputField) {
            return false;
        }
        
        // Verificar que el área de mensajes sea válida
        if (chatMessagesArea.innerHTML === '' && chatMessagesArea.children.length === 0) {
            // Solo es problemático si hay un usuario seleccionado
            if (window.dashboardCurrentUserId) {
                return false;
            }
        }
        
        // Verificar que no haya demasiados mensajes de error
        const errorMessages = document.querySelectorAll('.error-message');
        if (errorMessages.length > 5) {
            return false;
        }
        
        // Verificar que el usuario actual sea válido
        if (!window.dashboardCurrentUserId || window.dashboardCurrentUserId === 'null' || window.dashboardCurrentUserId === 'undefined') {
            return false;
        }
        
        // Verificar que no haya errores de JavaScript en la consola
        if (window.chatErrorCount && window.chatErrorCount > 10) {
            return false;
        }
        
        // Verificar que no haya problemas reales antes de activar prevención
        const hasRealProblems = checkForRealChatProblems();
        if (hasRealProblems) {
            // PERMITIR envío aunque haya problemas menores
            return true;
        }
        
        return true;
        
    } catch (error) {
        return false;
    }
}

// ✅ NUEVA FUNCIÓN: Configurar limpieza automática periódica
function setupAutomaticCleanup() {
    // Verificar estado del chat cada 2 minutos
    setInterval(() => {
        try {
            // Solo verificar si hay problemas reales
            const hasRealProblems = checkForRealChatProblems();
            if (hasRealProblems) {
                recoverChatFromCorruption();
            }
        } catch (error) {
            // Error silencioso
        }
    }, 2 * 60 * 1000); // 2 minutos
    
    // Limpiar errores de consola cada 1 minuto
    setInterval(() => {
        try {
            // Limpiar mensajes de error excesivos
            const errorMessages = document.querySelectorAll('.error-message');
            if (errorMessages.length > 3) {
                errorMessages.forEach((msg, index) => {
                    if (index > 2) msg.remove();
                });
            }
        } catch (error) {
            // Error silencioso
        }
    }, 1 * 60 * 1000); // 1 minuto
    
    // ✅ NUEVO: Limpieza automática semanal (cada 7 días)
    const WEEKLY_CLEANUP_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos
    
    // ✅ Verificar si es la primera vez o si ya pasó una semana
    const lastCleanup = localStorage.getItem('lastWeeklyCleanup');
    const now = Date.now();
    
    if (!lastCleanup || (now - parseInt(lastCleanup)) >= WEEKLY_CLEANUP_INTERVAL) {
        executeWeeklyCleanup();
        localStorage.setItem('lastWeeklyCleanup', now.toString());
    }
}

// ✅ NUEVA FUNCIÓN: Ejecutar limpieza automática semanal
async function executeWeeklyCleanup() {
    try {
        const response = await fetch('/tienda/api/chat/schedule_weekly_cleanup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getSupportCsrfToken()
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                // ✅ Mostrar notificación al admin
                if (data.data.users_cleaned > 0) {
                    showSuccessMessage(`🧹 Limpieza semanal completada: ${data.data.users_cleaned} usuarios inactivos limpiados, ${data.data.total_files_deleted} archivos eliminados`);
                } else {
                    showInfoMessage('🧹 Limpieza semanal completada: No hay usuarios inactivos para limpiar');
                }
                
                // ✅ Recargar lista de usuarios
                if (typeof loadUsersList === 'function') {
                    loadUsersList();
                }
            }
        }
        
    } catch (error) {
        // Error ejecutando limpieza semanal
    }
}

// ✅ NUEVA FUNCIÓN: Verificar estado de limpieza automática
window.checkCleanupStatus = async function() {
    try {
        const response = await fetch('/tienda/api/chat/cleanup_status', {
            method: 'GET',
            headers: {
                'X-CSRFToken': getSupportCsrfToken()
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                const status = data.data;
                
                const message = `
🧹 ESTADO DE LIMPIEZA AUTOMÁTICA:

📊 Estadísticas Generales:
• Total usuarios: ${status.total_users}
• Total mensajes: ${status.total_messages}
• Total sesiones: ${status.total_sessions}

⚠️ Usuarios Inactivos (5+ días):
• Cantidad: ${status.inactive_users_count}
• Próxima limpieza: ${new Date(status.next_cleanup).toLocaleDateString()}

⚙️ Configuración:
• Días de inactividad: ${status.cleanup_config.inactivity_days}
• Frecuencia: ${status.cleanup_config.frequency}
• Ejecución automática: ${status.cleanup_config.auto_execution ? 'SÍ' : 'NO'}

${status.inactive_users.length > 0 ? '\n👥 Top 5 Usuarios Más Inactivos:\n' + status.inactive_users.slice(0, 5).map(u => `• ${u.username}: ${u.days_inactive} días`).join('\n') : ''}
                `;
                
                // Mostrar mensaje
                
            } else {
                // Error en verificación
            }
        } else {
            // Error HTTP
        }
        
    } catch (error) {
        // Error en verificación
    }
};

// ✅ NUEVA FUNCIÓN: Ejecutar limpieza manual (para admin)
window.executeManualCleanup = async function() {
    try {
        if (!confirm('¿Estás seguro de que quieres ejecutar la limpieza automática AHORA?\n\nEsta acción eliminará chats de usuarios inactivos por 5+ días.')) {
            return;
        }
        
        await executeWeeklyCleanup();
        
    } catch (error) {
        // Error en verificación
    }
};

// ✅ NUEVA FUNCIÓN: Verificar problemas en tiempo real
window.checkChatHealth = function() {
    const health = {
        messages: 0,
        corrupted: 0,
        empty: 0,
        brokenFiles: 0,
        errors: 0,
        status: 'healthy'
    };
    
    try {
        // ✅ Contar mensajes totales
        const allMessages = document.querySelectorAll('.message');
        health.messages = allMessages.length;
        
        // ✅ Verificar mensajes corruptos
        const corruptedMessages = document.querySelectorAll('.message[data-corrupted="true"]');
        health.corrupted = corruptedMessages.length;
        
        // ✅ Verificar mensajes vacíos
        const emptyMessages = document.querySelectorAll('.message:not(:has(.message-text)):not(:has(.file-attachment))');
        health.empty = emptyMessages.length;
        
        // ✅ Verificar archivos rotos
        const brokenFiles = document.querySelectorAll('.file-attachment img[src*="undefined"], .file-attachment video[src*="undefined"]');
        health.brokenFiles = brokenFiles.length;
        
        // ✅ Verificar errores
        const errorElements = document.querySelectorAll('.message[data-error="true"]');
        health.errors = errorElements.length;
        
        // ✅ Determinar estado de salud
        if (health.corrupted > 0 || health.brokenFiles > 0 || health.errors > 5) {
            health.status = 'unhealthy';
        } else if (health.empty > 3 || health.errors > 2) {
            health.status = 'warning';
        } else {
            health.status = 'healthy';
        }
        
        // ✅ Mostrar mensaje al usuario si hay problemas
        if (health.status === 'unhealthy') {
            showErrorMessage('⚠️ Se detectaron problemas en el chat. Considera recargar la página.');
        } else if (health.status === 'warning') {
            showInfoMessage('⚠️ El chat tiene algunos problemas menores.');
        } else {
            showSuccessMessage('✅ El chat está funcionando correctamente');
        }
        
        return health;
        
    } catch (error) {
        return { status: 'error', message: error.message };
    }
};

// ✅ NUEVA FUNCIÓN: Abrir modal de imagen
window.openImageModal = function(imageUrl, fileName) {
    const modal = document.createElement('div');
    modal.className = 'image-modal-overlay';
    modal.innerHTML = `
        <div class="image-modal">
            <div class="image-modal-header">
                <span class="image-modal-title">${fileName}</span>
                <button class="image-modal-close" data-action="close-image-modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="image-modal-content">
                <img src="${imageUrl}" alt="${fileName}" class="image-modal-image">
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Cerrar modal al hacer clic fuera
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    // Cerrar modal con ESC
    document.addEventListener('keydown', function closeOnEsc(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', closeOnEsc);
        }
    });
};

// ✅ NUEVA FUNCIÓN: Forzar aplicación de estados de chat
window.forceChatStatuses = function() {
    const userItems = document.querySelectorAll('.chat-item');
    
    userItems.forEach((userItem, index) => {
        const userId = userItem.getAttribute('data-user-id');
        const currentStatus = userItem.getAttribute('data-chat-status');
        const userInitial = userItem.querySelector('.user-initial');
        
        if (userInitial && currentStatus) {
            // Remover todas las clases de estado existentes
            userInitial.classList.remove('status-new-message', 'status-responded', 'status-finished', 'status-pending');
            
            // Aplicar la clase correcta
            const statusClass = `status-${currentStatus.replace('_', '-')}`;
            userInitial.classList.add(statusClass);
            
            // Forzar el color correcto con CSS inline
            let expectedColor = '';
            let expectedShadow = '';
            switch(currentStatus) {
                case 'new_message':
                case 'pending':
                    expectedColor = '#28a745'; // VERDE
                    expectedShadow = '0 0 8px rgba(40, 167, 69, 0.6)';
                    break;
                case 'responded':
                    expectedColor = '#007bff'; // AZUL
                    expectedShadow = '0 0 8px rgba(0, 123, 255, 0.6)';
                    break;
                case 'finished':
                    expectedColor = '#6f42c1'; // MORADO
                    expectedShadow = '0 0 8px rgba(111, 66, 193, 0.6)';
                    break;
            }
            
            userInitial.style.backgroundColor = expectedColor;
            userInitial.style.boxShadow = expectedShadow;
            userInitial.style.color = 'white';
            userInitial.style.fontWeight = 'bold';
        }
    });
};

// ✅ NUEVA FUNCIÓN: Corregir estados incorrectos de responded a new_message
window.fixRespondedToNewMessage = async function() {
    const userItems = document.querySelectorAll('.chat-item[data-chat-status="responded"]');
    
    for (let userItem of userItems) {
        const userId = userItem.getAttribute('data-user-id');
        const userInitial = userItem.querySelector('.user-initial');
        
        if (userInitial) {
            // Verificar el estado real en el backend
            const realStatus = await checkRealChatStatus(userId);
            
            if (realStatus && realStatus !== 'responded') {
                // Actualizar atributo
                userItem.setAttribute('data-chat-status', realStatus);
                
                // Actualizar clases CSS
                userInitial.classList.remove('status-new-message', 'status-responded', 'status-finished', 'status-pending');
                userInitial.classList.add(`status-${realStatus.replace('_', '-')}`);
                
                // Forzar color correcto
                let expectedColor = '';
                switch(realStatus) {
                    case 'new_message':
                    case 'pending':
                        expectedColor = '#28a745'; // VERDE
                        break;
                    case 'finished':
                        expectedColor = '#6f42c1'; // MORADO
                        break;
                }
                
                if (expectedColor) {
                    userInitial.style.backgroundColor = expectedColor;
                    userInitial.style.boxShadow = `0 0 8px ${expectedColor.replace('#', 'rgba(').replace(')', ', 0.6)')}`;
                    userInitial.style.color = 'white';
                    userInitial.style.fontWeight = 'bold';
                }
            }
        }
    }
    

};

// ✅ NUEVA FUNCIÓN: Verificar estados de chat
window.verifyChatStatuses = function() {
    const userItems = document.querySelectorAll('.chat-item');
    
    userItems.forEach((userItem, index) => {
        const userId = userItem.getAttribute('data-user-id');
        const username = userItem.querySelector('.username')?.textContent || 'N/A';
        const currentStatus = userItem.getAttribute('data-chat-status');
        const userInitial = userItem.querySelector('.user-initial');
        const lastMessage = userItem.querySelector('.user-last-message')?.textContent || 'N/A';
        
        if (userInitial) {
            const appliedClasses = Array.from(userInitial.classList).filter(cls => cls.startsWith('status-'));
            const computedStyle = window.getComputedStyle(userInitial);
            const backgroundColor = computedStyle.backgroundColor;
            const color = computedStyle.color;
        }
    });
};

// ✅ NUEVA FUNCIÓN: Forzar estado finished (morado) directamente en el frontend
window.forceFinishedStatusFrontend = function() {
    if (window.dashboardCurrentUserId) {
        const userItem = document.querySelector(`.chat-item[data-user-id="${window.dashboardCurrentUserId}"]`);
        if (userItem) {
            const userInitial = userItem.querySelector('.user-initial');
            if (userInitial) {
                // Remover todas las clases de estado
                userInitial.classList.remove('status-new-message', 'status-responded', 'status-finished', 'status-pending');
                
                // Agregar clase finished (morado)
                userInitial.classList.add('status-finished');
                
                // Actualizar atributo del elemento
                userItem.setAttribute('data-chat-status', 'finished');
                
                // También actualizar el botón
                const finishButton = userItem.querySelector('.finish-support-btn');
                if (finishButton) {
                    finishButton.classList.add('finished');
                    finishButton.title = 'Soporte finalizado';
                }
            }
        }
    }
};

// ✅ NUEVA FUNCIÓN: Verificar el estado real del chat en el backend
async function checkRealChatStatus(userId) {
    try {
        const response = await fetch(`/tienda/api/chat/get_user_conversation/${userId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getSupportCsrfToken()
            }
        });
        
        const data = await response.json();
        
        if (data.status === 'success' && data.data && data.data.length > 0) {
            const lastMessage = data.data[data.data.length - 1]; // Último mensaje
            
            // ✅ Lógica para determinar el estado real del chat
            if (lastMessage.message_type === 'system' || 
                lastMessage.message.includes('Chat finalizado, gracias por contactarnos')) {
                return 'finished'; // 🟣 MORADO
            } else if (lastMessage.sender_id == userId) {
                return 'new_message'; // 🟢 VERDE (usuario normal)
            } else {
                return 'responded'; // 🔵 AZUL (admin/soporte)
            }
        }
        
        return null; // No se pudo determinar
    } catch (error) {
        return null;
    }
}

// ✅ NUEVA FUNCIÓN: Verificar y corregir automáticamente los estados de chat
function verifyAndCorrectChatStatuses() {
    const userItems = document.querySelectorAll('.chat-item');
    let correctedCount = 0;
    
    userItems.forEach(userItem => {
        const userId = userItem.getAttribute('data-user-id');
        const lastMessageElement = userItem.querySelector('.user-last-message');
        const currentStatus = userItem.getAttribute('data-chat-status');
        const userInitial = userItem.querySelector('.user-initial');
        
        if (lastMessageElement && lastMessageElement.textContent.includes('Chat finalizado, gracias por contactarnos')) {
            // Este chat debería estar en estado FINISHED (morado)
            if (currentStatus !== 'finished') {
                // Actualizar atributo
                userItem.setAttribute('data-chat-status', 'finished');
                
                // Actualizar clases CSS del icono
                if (userInitial) {
                    userInitial.classList.remove('status-new-message', 'status-responded', 'status-finished', 'status-pending');
                    userInitial.classList.add('status-finished');
                }
                
                // Actualizar botón
                const finishButton = userItem.querySelector('.finish-support-btn');
                if (finishButton) {
                    finishButton.classList.add('finished');
                    finishButton.title = 'Soporte finalizado';
                }
                
                correctedCount++;
            }
        } else {
            // Verificar si el estado actual es incorrecto
            const lastMessageText = lastMessageElement ? lastMessageElement.textContent : '';
            const isSystemMessage = lastMessageText.includes('Chat finalizado, gracias por contactarnos');
            
            if (!isSystemMessage) {
                // ✅ CORREGIDO: Solo verificar si el estado es 'new_message' cuando debería ser 'responded'
                // NO verificar 'responded' cuando ya es correcto
                if (currentStatus === 'new_message') {
                    // Solo verificar si debería ser 'responded' (azul)
                    checkRealChatStatus(userId).then(realStatus => {
                        if (realStatus === 'responded' && realStatus !== currentStatus) {
                            // Actualizar atributo
                            userItem.setAttribute('data-chat-status', realStatus);
                            
                            // Actualizar clases CSS del icono
                            if (userInitial) {
                                userInitial.classList.remove('status-new-message', 'status-responded', 'status-finished', 'status-pending');
                                userInitial.classList.add(`status-responded`);
                            }
                            
                            correctedCount++;
                        }
                    });
                }
            }
        }
    });
}

// ============================================================================
// ✅ NUEVO: FUNCIONES SOCKETIO PARA DASHBOARD
// ============================================================================

// Función para inicializar SocketIO en el dashboard
function initializeDashboardSocketIO() {
    if (typeof io === 'undefined' && typeof window.io === 'undefined') {
        // Intentar cargar SocketIO dinámicamente
        if (!document.querySelector('script[src*="socket.io"]')) {
        }
        
        return false;
    }
    
    try {
        // Conectar a SocketIO en el puerto 5002 (servidor standalone)
        // ✅ NUEVO: Detectar la URL base para móviles
        const isMobile = isMobileDevice();
        const baseUrl = isMobile ? 
            `${window.location.protocol}//${window.location.hostname}:5002` : 
            'http://127.0.0.1:5002';
        
        // ✅ CORREGIDO: Conectar a SocketIO con configuración optimizada para estabilidad
        window.socket = io(baseUrl, {
            transports: ['polling'], // Solo polling para mayor estabilidad
            timeout: 30000, // Timeout más largo
            forceNew: true,
            reconnection: true,
            reconnectionDelay: 3000, // Delay más largo entre reconexiones
            reconnectionAttempts: 3, // Menos intentos para evitar spam
            maxReconnectionAttempts: 3,
            upgrade: false, // Deshabilitar upgrade a websocket
            rememberUpgrade: false,
            autoConnect: true,
            // ✅ NUEVO: Configuración específica para polling estable
            polling: {
                extraHeaders: {
                    'Cache-Control': 'no-cache'
                }
            }
        });
        
        // Event listeners básicos
        window.socket.on('connect', function() {
            joinDashboardChatRoom();
            
            // Notificar al manager de reconexión
            if (window.ChatReconnectionManager && typeof window.ChatReconnectionManager.handleReconnection === 'function') {
                window.ChatReconnectionManager.handleReconnection();
            }
        });
        
        window.socket.on('disconnect', function(reason) {
            // No mostrar error si es reconexión normal
            if (reason !== 'io client disconnect') {
            }
            
            // Notificar al manager de reconexión
            if (window.ChatReconnectionManager && typeof window.ChatReconnectionManager.handleDisconnection === 'function') {
                window.ChatReconnectionManager.handleDisconnection();
            }
        });
        
        window.socket.on('connect_error', function(error) {
            // No mostrar error si es reconexión normal
            if (!error.message?.includes('xhr poll error')) {
            }
        });
        
        window.socket.on('reconnect', function(attemptNumber) {
            joinDashboardChatRoom();
        });
        
        window.socket.on('reconnect_error', function(error) {
        });
        
        window.socket.on('reconnect_failed', function() {
        });
        
        window.socket.on('error', function(data) {
        });
        
        // Event listeners específicos del dashboard
        setupDashboardSocketIOEventListeners();
        
        return true;
    } catch (error) {
        return false;
    }
}

// Función para configurar event listeners de SocketIO del dashboard
function setupDashboardSocketIOEventListeners() {
    if (!window.socket) return;
    
    // Mensaje recibido en tiempo real
    window.socket.on('message_received', function(data) {
        // ✅ NUEVO: Limpiar área de chat si no hay chat activo
        clearChatAreaWhenNoActiveChat();
        handleDashboardRealTimeMessage(data);
    });
    
    // Audio recibido en tiempo real
    window.socket.on('audio_message_received', function(data) {
        // ✅ NUEVO: Limpiar área de chat si no hay chat activo
        clearChatAreaWhenNoActiveChat();
        handleDashboardAudioMessageReceived(data);
    });
    
    // Estado de escritura
    window.socket.on('user_typing', function(data) {
        handleDashboardTypingStatus(data);
    });
    
    // Archivo recibido en tiempo real
    window.socket.on('file_message_received', function(data) {
        // ✅ NUEVO: Limpiar área de chat si no hay chat activo
        clearChatAreaWhenNoActiveChat();
        handleDashboardFileMessageReceived(data);
    });
    
    // Confirmación de mensaje enviado
    window.socket.on('message_sent', function(data) {
        if (data.status === 'success' && data.data) {
            // ✅ CORREGIDO: Solo remover mensaje temporal si existe
            const tempMessages = document.querySelectorAll('[data-message-id^="temp_"]');
            if (tempMessages.length > 0) {
                const lastTempMessage = tempMessages[tempMessages.length - 1];
                const tempId = lastTempMessage.getAttribute('data-message-id');
                removeTempMessage(tempId);
            }
            
            // ✅ NUEVO: Solo agregar el mensaje real si no existe ya
            const existingMessage = document.querySelector(`[data-message-id="${data.data.id}"]`);
            if (!existingMessage) {
                addMessageToChat(data.data, true);
            }
        }
    });
    
    // Confirmación de archivo enviado
    window.socket.on('file_message_sent', function(data) {
        if (data.status === 'success') {
            // ✅ NUEVO: Limpiar input de archivos cuando se confirma el envío
            const fileInput = document.getElementById('chat-file-input');
            if (fileInput) {
                fileInput.value = '';
            }
        }
    });
    
    // Estado de conexión de usuarios
    window.socket.on('user_online_status', function(data) {
        handleDashboardUserOnlineStatus(data);
    });
    
    // ✅ NUEVO: Actualización de lista de usuarios en tiempo real
    window.socket.on('user_list_update', function(data) {
        handleUserListUpdate(data);
    });
    
    
    // ✅ NUEVO: Mensaje del sistema recibido
    window.socket.on('system_message_received', function(data) {
        handleSystemMessageReceived(data);
    });
    
    // ✅ NUEVO: Estado del chat actualizado
    window.socket.on('chat_status_updated', function(data) {
        if (data.status === 'success') {
        }
    });
    
    // ✅ NUEVO: Cambio de estado del chat (broadcast)
    window.socket.on('chat_status_changed', function(data) {
        // Actualizar el estado visual si es necesario
        if (data.user_id && data.status) {
            updateUserChatStatus(data.user_id, data.status);
        }
    });
    
    // ✅ NUEVO: Chat finalizado
    window.socket.on('chat_finalized', function(data) {
        if (data.user_id && data.status === 'finished') {
            // ✅ NUEVO: Actualizar color del icono a morado inmediatamente
            updateUserChatStatus(data.user_id, 'finished');
            
            // Si hay un message_id, crear el mensaje del sistema
            if (data.message_id) {
                const systemMessage = {
                    id: data.message_id,
                    message: 'Chat finalizado, gracias por contactarnos',
                    sender_id: 'system',
                    sender_name: 'Sistema',
                    message_type: 'system',
                    has_attachment: false,
                    created_at: new Date().toISOString(),
                    timestamp: new Date().toISOString(),
                    is_temp: false
                };
                
                addMessageToChat(systemMessage, true);
            }
        }
    });
    
    // ✅ NUEVO: Chat eliminado - actualizar en tiempo real
    window.socket.on('chat_deleted', function(data) {
        
        const userId = data.user_id;
        const username = data.username;
        
        if (!userId) {
            return;
        }
        
        // Remover el usuario de la lista de usuarios
        const userItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
        if (userItem) {
            userItem.remove();
        } else {
            // Si no se encuentra el usuario, recargar la lista completa
            setTimeout(() => {
                loadUsersList();
            }, 100);
        }
        
        // Si el chat eliminado es el que está activo, limpiar el área de chat
        const activeChatUserId = getActiveChatUserId();
        if (activeChatUserId && parseInt(activeChatUserId) === userId) {
            
            // Limpiar área de mensajes
            if (chatMessagesArea) {
                chatMessagesArea.innerHTML = '<div class="text-center text-muted mt-5"><i class="fas fa-comments fa-3x mb-3"></i><p>Selecciona un usuario de la lista para comenzar a chatear</p></div>';
            }
            
            // Ocultar área de entrada
            if (chatInputArea) {
                chatInputArea.classList.remove('active');
            }
            
            // Actualizar título
            if (chatTitle) {
                chatTitle.textContent = 'Selecciona un usuario para chatear';
            }
            
            // Limpiar estado del chat activo
            window.dashboardCurrentUserId = null;
            window.dashboardCurrentUsername = null;
        }
        
        // Mostrar notificación de chat eliminado
        if (data.messages_deleted > 0 || data.sessions_deleted > 0) {
        }
    });
}

// Función para unirse a la sala de chat del dashboard
function joinDashboardChatRoom() {
    if (!window.socket || !window.socket.connected) {
        return;
    }
    
    // Detectar si es usuario soporte
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';

    window.socket.emit('join_chat', {
        user_id: dashboardCurrentUserId,
        username: dashboardCurrentUsername,
        is_support: isSupportUser
    });
}

// Función para obtener el ID del usuario del chat activo
function getActiveChatUserId() {
    const activeChatItem = document.querySelector('.chat-item.active');
    if (activeChatItem) {
        return activeChatItem.getAttribute('data-user-id');
    }
    return null;
}

// ✅ NUEVA FUNCIÓN: Limpiar mensajes del área de chat cuando no hay chat activo
function clearChatAreaWhenNoActiveChat() {
    const activeChatUserId = getActiveChatUserId();
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    const isAdminUser = !isSupportUser && window.dashboardCurrentUserId == '1';
    
    // Solo limpiar si es usuario soporte y no hay chat activo (admin puede ver todos los mensajes)
    if (isSupportUser && !activeChatUserId) {
        // Verificar si hay mensajes en el área de chat
        if (chatMessagesArea && chatMessagesArea.children.length > 0) {
            chatMessagesArea.innerHTML = '';
        }
    }
    
    // Para admin, no limpiar nunca (puede ver todos los mensajes)
    if (isAdminUser) {
        // Admin mantiene todos los mensajes visibles
    }
}

// ✅ NUEVA FUNCIÓN: Inicializar limpieza periódica del área de chat
function initializeChatAreaCleanup() {
    // Limpiar cada 10 segundos si no hay chat activo (menos agresivo)
    setInterval(() => {
        clearChatAreaWhenNoActiveChat();
    }, 10000);
    
}

// Función para cargar automáticamente el primer chat disponible (para usuarios soporte)
function loadFirstAvailableChat() {
    const firstChatItem = document.querySelector('.chat-item:not(.chat-disabled)');
    if (firstChatItem) {
        // Simular clic en el primer chat
        firstChatItem.click();
    }
}

// Función para manejar mensajes en tiempo real en el dashboard
function handleDashboardRealTimeMessage(messageData) {
    // ✅ NUEVO: Validar que messageData existe
    if (!messageData) {
        return;
    }
    
    if (!messageData.recipient_id) {
        return;
    }
    
    // ✅ NUEVO: Detectar si es usuario soporte
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    // ✅ NUEVO: Detectar si es admin
    const isAdminUser = !isSupportUser && dashboardCurrentUserId == '1';
    const activeChatUserId = getActiveChatUserId();
    
    // ✅ SIMPLIFICADO: Lógica más clara para mostrar mensajes
    let shouldShowMessage = false;
    
    // 1. Si es un mensaje del sistema, siempre mostrarlo
    if (messageData.message_type === 'system') {
        shouldShowMessage = true;
    }
    // 2. Si es admin, mostrar TODOS los mensajes del chat activo
    else if (isAdminUser && activeChatUserId) {
        shouldShowMessage = (messageData.recipient_id == activeChatUserId || messageData.sender_id == activeChatUserId);
    }
    // 3. Si es soporte, mostrar solo mensajes del chat activo
    else if (isSupportUser) {
        if (activeChatUserId) {
            shouldShowMessage = (messageData.recipient_id == activeChatUserId || messageData.sender_id == activeChatUserId);
        } else {
            // Si no hay chat activo, no mostrar mensajes
            shouldShowMessage = false;
        }
    }
    // 4. Si es usuario normal, mostrar mensajes dirigidos a él
    else {
        shouldShowMessage = (messageData.recipient_id == dashboardCurrentUserId);
    }
    
    if (shouldShowMessage) {
        // ✅ CORREGIDO: Permitir que cada sesión vea sus propios mensajes
        // Solo evitar duplicados si el mensaje ya existe
        const existingMessage = document.querySelector(`[data-message-id="${messageData.id}"]`);
        if (existingMessage) {
            return;
        }
        
        // ✅ OPTIMIZACIÓN: Agregar mensaje del usuario de forma más eficiente
        addMessageToChat(messageData, true);
        
        // ✅ OPTIMIZACIÓN: Usar requestAnimationFrame para scroll más suave
        requestAnimationFrame(() => {
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        });
        
        // ✅ NUEVO: Actualizar last_message en tiempo real
        updateLastMessageInUserList(messageData);
        
        // ✅ NUEVO: Mostrar notificación del navegador
        const senderName = messageData.message_type === 'admin' ? 'Admin' : 
                          messageData.message_type === 'support' ? 'Soporte' : 
                          messageData.sender_name || 'Usuario';
        showBrowserNotification(senderName, messageData.message);
        
        // Actualizar estado del chat
            // ✅ CORREGIDO: No actualizar estado directamente - SocketIO se encarga
    }
}

// Función para manejar audio recibido en tiempo real en el dashboard
function handleDashboardAudioMessageReceived(audioData) {
    
    // ✅ NUEVO: Validar que audioData existe
    if (!audioData) {
        return;
    }
    
    if (!audioData.recipient_id) {
        return;
    }
    
    // ✅ BLOQUEO SELECTIVO: Solo bloquear visualización de audios recibidos para usuarios soporte
    const activeChatUserId = getActiveChatUserId();
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    // Solo bloquear si es usuario soporte y no hay chat activo
    if (isSupportUser && !activeChatUserId) {
        return;
    }
    
    // ✅ CORREGIDO: Evitar duplicados usando un ID único del mensaje
    const messageId = audioData.id;
    const messageKey = `audio_msg_${messageId}`;
    
    // Verificar si ya se procesó este mensaje
    if (window.processedAudioMessages && window.processedAudioMessages.has(messageKey)) {
        return; // Ya se procesó, no duplicar
    }
    
    // Marcar como procesado
    if (!window.processedAudioMessages) {
        window.processedAudioMessages = new Set();
    }
    window.processedAudioMessages.add(messageKey);
    
    // ✅ CORREGIDO: Verificar si el audio es relevante para el chat actual
    // El audio es relevante si:
    // 1. Es para el usuario del chat actual (recipient_id == dashboardCurrentUserId)
    // 2. O es del usuario del chat actual (sender_id == dashboardCurrentUserId)
    // 3. O es del usuario del chat actual enviado al admin (sender_id == dashboardCurrentUserId && recipient_id == '1')
    // 4. O es un mensaje de soporte/admin (message_type === 'support' o 'admin')
    const { isAdminUser, isNormalUser } = getUserTypeInfo();
    
    let shouldShowAudio = false;
    
    // 1. Si es un mensaje del sistema, siempre mostrarlo
    if (audioData.message_type === 'system') {
        shouldShowAudio = true;
    }
    // 2. Si es admin, mostrar TODOS los audios del chat activo
    else if (isAdminUser) {
        if (activeChatUserId) {
            shouldShowAudio = (audioData.recipient_id == activeChatUserId || audioData.sender_id == activeChatUserId);
        } else {
            // Si no hay chat activo, mostrar audios dirigidos al admin
            shouldShowAudio = (audioData.recipient_id == dashboardCurrentUserId);
        }
    }
    // 3. Si es soporte, mostrar solo audios del chat activo
    else if (isSupportUser) {
        if (activeChatUserId) {
            shouldShowAudio = (audioData.recipient_id == activeChatUserId || audioData.sender_id == activeChatUserId);
        } else {
            // Si no hay chat activo, mostrar audios dirigidos al soporte
            shouldShowAudio = (audioData.recipient_id == dashboardCurrentUserId);
        }
    }
    // 4. Si es usuario normal, mostrar audios dirigidos a él
    else {
        shouldShowAudio = (audioData.recipient_id == dashboardCurrentUserId);
    }
    
    
    if (shouldShowAudio) {
        // Determinar el tipo de mensaje y nombre del remitente
        let messageType, senderName;
        
        if (audioData.message_type === 'admin') {
            messageType = 'admin';
            senderName = 'Admin';
        } else if (audioData.message_type === 'support') {
            messageType = 'support';
            senderName = audioData.sender_name || 'Soporte';
        } else if (audioData.sender_id == dashboardCurrentUserId) {
            // El admin envió el audio
            messageType = 'admin';
            senderName = 'Admin';
        } else {
            // El usuario normal envió el audio
            messageType = 'user';
            senderName = audioData.sender_name || 'Usuario';
        }
        
        // Crear mensaje de audio
        const audioMessage = {
            id: audioData.id,
            message: audioData.message,
            sender_id: audioData.sender_id,
            sender_name: senderName,
            message_type: messageType,
            has_attachment: true,
            attachment_type: 'audio',
            attachment_filename: audioData.audio_filename || audioData.attachment_filename,
            attachment_data: audioData.audio_data || audioData.attachment_data,
            created_at: audioData.created_at || audioData.timestamp,
            is_temp: false
        };
        
        // Agregar mensaje de audio al chat
        addMessageToChat(audioMessage, true);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // ✅ NUEVO: Actualizar last_message en tiempo real
        updateLastMessageInUserList(audioMessage);
        
        // ✅ NUEVO: Mostrar notificación del navegador para audio
        showBrowserNotification(senderName, '[Mensaje de audio]');
        
        // ✅ NUEVO: Actualizar estado del chat según el tipo de mensaje
        // Lógica: Si es admin/soporte → actualizar recipient_id, si es usuario normal → actualizar sender_id
        const targetUserId = (audioData.message_type === 'admin' || audioData.message_type === 'support') 
            ? audioData.recipient_id 
            : audioData.sender_id;
        let chatStatus = 'active'; // Por defecto, mensaje de usuario normal
        
        if (audioData.message_type === 'admin' || audioData.message_type === 'support') {
            chatStatus = 'responded'; // Mensaje de admin/soporte
        }
        
        
        // Actualizar el estado del chat en la lista de usuarios
        updateUserChatStatus(targetUserId, chatStatus);
    }
}

// ✅ MEJORADO: Función para manejar estado de escritura en el dashboard
function handleDashboardTypingStatus(data) {
    
    // ✅ CORREGIDO: Comparar como strings para evitar problemas de tipo
    if (String(data.user_id) !== String(dashboardCurrentUserId)) {
        // ✅ NUEVO: Verificar que el usuario existe en la lista antes de mostrar indicador
        const allChatItems = document.querySelectorAll('.chat-item');
        const userExists = Array.from(allChatItems).some(item => 
            String(item.getAttribute('data-user-id')) === String(data.user_id)
        );
        
        if (!userExists) {
            return;
        }
        
        // ✅ NUEVO: Mostrar indicador de escritura SOLO en la lista de usuarios
        if (data.typing) {
            showUserListTypingIndicator(data.user_id);
        } else {
            hideUserListTypingIndicator(data.user_id);
        }
    }
}

// ❌ FUNCIÓN ELIMINADA: showDashboardTypingIndicator
// Esta función se eliminó para evitar que aparezcan indicadores en el área de chat
// Los indicadores de escritura ahora solo aparecen en la lista de usuarios

// ✅ NUEVA FUNCIÓN: Limpiar indicadores del área de chat

// Función para manejar archivos recibidos en tiempo real en el dashboard
function handleDashboardFileMessageReceived(fileData) {
    
    // ✅ NUEVO: Validar que fileData existe
    if (!fileData) {
        return;
    }
    
    if (!fileData.recipient_id) {
        return;
    }
    
    // ✅ BLOQUEO SELECTIVO: Solo bloquear visualización de archivos recibidos para usuarios soporte
    const activeChatUserId = getActiveChatUserId();
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    // Solo bloquear si es usuario soporte y no hay chat activo
    if (isSupportUser && !activeChatUserId) {
        return;
    }
    
    // ✅ CORREGIDO: Verificar si el archivo es relevante para el chat actual
    // El archivo es relevante si:
    // 1. Es para el usuario del chat actual (recipient_id == dashboardCurrentUserId)
    // 2. O es del usuario del chat actual (sender_id == dashboardCurrentUserId)
    // 3. O es un mensaje de soporte/admin (message_type === 'support' o 'admin')
    const { isAdminUser, isNormalUser } = getUserTypeInfo();
    
    let shouldShowFile = false;
    
    // 1. Si es un mensaje del sistema, siempre mostrarlo
    if (fileData.message_type === 'system') {
        shouldShowFile = true;
    }
    // 2. Si es admin, mostrar TODOS los archivos del chat activo
    else if (isAdminUser && activeChatUserId) {
        shouldShowFile = (fileData.recipient_id == activeChatUserId || fileData.sender_id == activeChatUserId);
    }
    // 3. Si es soporte, mostrar solo archivos del chat activo
    else if (isSupportUser) {
        if (activeChatUserId) {
            shouldShowFile = (fileData.recipient_id == activeChatUserId || fileData.sender_id == activeChatUserId);
        } else {
            shouldShowFile = false;
        }
    }
    // 4. Si es usuario normal, mostrar archivos dirigidos a él
    else {
        shouldShowFile = (fileData.recipient_id == dashboardCurrentUserId);
    }
    
    if (shouldShowFile) {
        // ✅ NUEVO: Verificar si el mensaje ya existe para evitar duplicados
        const existingMessage = document.querySelector(`[data-message-id="${fileData.id}"]`);
        if (existingMessage) {
            return;
        }
        
        // ✅ CORREGIDO: Determinar el tipo de mensaje y nombre del remitente
        let messageType, senderName;
        
        if (fileData.message_type === 'admin') {
            messageType = 'admin';
            senderName = 'Admin';
        } else if (fileData.message_type === 'support') {
            messageType = 'support';
            senderName = fileData.sender_name || 'Soporte';
        } else if (fileData.sender_id == dashboardCurrentUserId) {
            // El admin envió el archivo
            messageType = 'admin';
            senderName = 'Admin';
        } else {
            // El usuario normal envió el archivo
            messageType = 'user';
            senderName = fileData.sender_name || 'Usuario';
        }
        
        // Crear mensaje de archivo
        const fileMessage = {
            id: fileData.id,
            message: fileData.message,
            sender_id: fileData.sender_id,
            sender_name: senderName,
            message_type: messageType,
            has_attachment: true,
            attachment_type: fileData.attachment_type,
            attachment_filename: fileData.attachment_filename,
            attachment_data: fileData.attachment_data,
            attachment_path: fileData.attachment_path,  // ✅ NUEVO: Incluir path del archivo
            attachment_size: fileData.attachment_size,
            created_at: fileData.created_at || fileData.timestamp,
            is_temp: false
        };
        
        // Agregar mensaje de archivo al chat
        addMessageToChat(fileMessage, true);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // ✅ NUEVO: Actualizar last_message en tiempo real
        updateLastMessageInUserList(fileMessage);
        
        // ✅ NUEVO: Mostrar notificación del navegador para archivo
        showBrowserNotification(senderName, `[Archivo: ${fileData.attachment_filename}]`);
        
        // ✅ NUEVO: Actualizar estado del chat según el tipo de mensaje
        // Lógica: Si es admin/soporte → actualizar recipient_id, si es usuario normal → actualizar sender_id
        const targetUserId = (fileData.message_type === 'admin' || fileData.message_type === 'support') 
            ? fileData.recipient_id 
            : fileData.sender_id;
        let chatStatus = 'active'; // Por defecto, mensaje de usuario normal
        
        if (fileData.message_type === 'admin' || fileData.message_type === 'support') {
            chatStatus = 'responded'; // Mensaje de admin/soporte
        }
        
        
        // Actualizar el estado del chat en la lista de usuarios
        updateUserChatStatus(targetUserId, chatStatus);
    }
}

// Función para manejar estado de conexión de usuarios en el dashboard
function handleDashboardUserOnlineStatus(data) {
    
    // Mostrar notificación de estado de conexión
    if (data.status === 'online') {
        showDashboardConnectionNotification(`${data.username} se conectó`, 'online');
    } else if (data.status === 'offline') {
        showDashboardConnectionNotification(`${data.username} se desconectó`, 'offline');
    }
}

// ✅ NUEVO: Función para manejar actualizaciones de lista de usuarios en tiempo real
function handleUserListUpdate(data) {
    const { user_id, action, username, status } = data;
    
    switch (action) {
        case 'user_online':
            // Usuario se conectó - actualizar estado a verde
            updateUserOnlineStatus(user_id, true);
            break;
            
        case 'user_offline':
            // Usuario se desconectó - actualizar estado a gris
            updateUserOnlineStatus(user_id, false);
            break;
            
        case 'new_user':
            // Nuevo usuario se conectó - recargar lista completa
            loadUsersList();
            break;
            
        case 'new_message':
            // Nuevo mensaje - actualizar indicador de mensaje nuevo y reordenar lista
            updateUserMessageIndicator(user_id, true);
            updateUserListOrder(user_id, data.message_preview);
            break;
            
        case 'status_change':
            // Cambio de estado del chat - actualizar color según estado
            updateUserChatStatus(user_id, status);
            break;
            
        case 'chat_deleted':
            // Chat eliminado - remover de la lista o actualizar estado
            handleChatDeleted(user_id);
            break;
    }
}

// ✅ NUEVO: Función para actualizar estado online/offline de usuario
function updateUserOnlineStatus(userId, isOnline) {
    const userItem = document.querySelector(`[data-user-id="${userId}"]`);
    if (userItem) {
        const statusIndicator = userItem.querySelector('.user-status-indicator');
        if (statusIndicator) {
            if (isOnline) {
                statusIndicator.className = 'user-status-indicator online';
                statusIndicator.title = 'Usuario en línea';
            } else {
                statusIndicator.className = 'user-status-indicator offline';
                statusIndicator.title = 'Usuario desconectado';
            }
        }
    }
}

// ✅ NUEVO: Función para reordenar la lista de usuarios por mensajes recientes
function updateUserListOrder(userId, messagePreview) {
    const userItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
    if (!userItem) {
        loadUsersList();
        return;
    }
    
    // Actualizar el último mensaje si se proporciona
    if (messagePreview) {
        const lastMessageElement = userItem.querySelector('.user-last-message');
        if (lastMessageElement) {
            lastMessageElement.textContent = messagePreview;
        }
    }
    
    // Mover el usuario al principio de la lista
    const usersList = document.querySelector('.users-list');
    if (usersList && userItem.parentNode === usersList) {
        // Remover el elemento de su posición actual
        userItem.remove();
        
        // Insertarlo al principio de la lista
        usersList.insertBefore(userItem, usersList.firstChild);
        
    }
}

// ✅ NUEVA FUNCIÓN: Detección centralizada de tipos de usuario
function getUserTypeInfo() {
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    const isAdminUser = !isSupportUser && dashboardCurrentUserId == '1';
    const isNormalUser = !isAdminUser && !isSupportUser;
    
    return {
        isSupportUser,
        isAdminUser,
        isNormalUser,
        currentUserId: dashboardCurrentUserId
    };
}

// ✅ NUEVO: Función para actualizar indicador de mensaje nuevo
function updateUserMessageIndicator(userId, hasNewMessage) {
    const userItem = document.querySelector(`[data-user-id="${userId}"]`);
    if (userItem) {
        if (hasNewMessage) {
            userItem.classList.add('has-new-message');
            // ✅ ELIMINADO: Indicador visual del punto blanco
        } else {
            userItem.classList.remove('has-new-message');
            const indicator = userItem.querySelector('.new-message-indicator');
            if (indicator) {
                indicator.remove();
            }
        }
    }
}

// ✅ NUEVO: Función para actualizar estado del chat (colores verde, azul, morado)
function updateUserChatStatus(userId, status) {
    const userItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
    
    if (userItem) {
        // Actualizar el avatar del usuario según el estado
        const userInitial = userItem.querySelector('.user-initial');
        
        if (userInitial) {
            // Remover todas las clases de estado
            userInitial.classList.remove('status-pending', 'status-responded', 'status-new-message', 'status-finished');
            
            // Agregar nueva clase según el estado
            switch (status) {
                case 'pending':
                    userInitial.classList.add('status-pending'); // Azul - esperando respuesta
                    break;
                case 'active':
                    userInitial.classList.add('status-new-message'); // Verde - último mensaje del usuario
                    break;
                case 'responded':
                    userInitial.classList.add('status-responded'); // Azul - admin/soporte respondió
                    break;
                case 'resolved':
                case 'finished':
                    userInitial.classList.add('status-finished'); // Morado - chat finalizado
                    break;
            }
        }
        
        // Actualizar atributo de estado
        userItem.setAttribute('data-chat-status', status);
        
        // ✅ NUEVO: Si es "responded", también actualizar el último mensaje
        if (status === 'responded') {
            const lastMessageElement = userItem.querySelector('.user-last-message');
            if (lastMessageElement) {
                // Obtener el mensaje actual del input
                const currentMessage = chatInputField.value.trim();
                if (currentMessage) {
                    lastMessageElement.textContent = currentMessage.length > 50 ? 
                        currentMessage.substring(0, 50) + '...' : currentMessage;
                }
            }
        }
    }
}

// ✅ NUEVO: Función para manejar chat eliminado
function handleChatDeleted(userId) {
    const userItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
    if (userItem) {
        // Remover el elemento de la lista
        userItem.remove();
        
        // Si era el chat activo, limpiar el área de chat
        const activeChatUserId = getActiveChatUserId();
        if (activeChatUserId == userId) {
            chatMessagesArea.innerHTML = '<div class="text-center text-muted mt-5"><i class="fas fa-comments fa-3x mb-3"></i><p>Selecciona un usuario de la lista para comenzar a chatear</p></div>';
            chatInputArea.classList.remove('active');
            chatTitle.textContent = 'Chat de Soporte';
        }
    }
}

// ✅ NUEVO: Función para manejar mensajes del sistema
function handleSystemMessageReceived(data) {
    // ✅ CORREGIDO: Evitar duplicados usando un ID único del mensaje
    const messageId = data.id;
    const messageKey = `system_msg_${messageId}`;
    
    // Verificar si ya se procesó este mensaje
    if (window.processedSystemMessages && window.processedSystemMessages.has(messageKey)) {
        return; // Ya se procesó, no duplicar
    }
    
    // Marcar como procesado
    if (!window.processedSystemMessages) {
        window.processedSystemMessages = new Set();
    }
    window.processedSystemMessages.add(messageKey);
    
    // Verificar si el mensaje es para el chat activo
    const activeChatUserId = getActiveChatUserId();
    
    // ✅ CORREGIDO: Solo mostrar mensajes si hay un chat activo seleccionado
    if (activeChatUserId && data.recipient_id == activeChatUserId) {
        addMessageToChat(data, true);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
    }
    // ✅ ELIMINADO: Ya no mostrar mensajes sin chat activo para evitar vista previa
}

// ✅ NUEVA FUNCIÓN: Cola de procesamiento de archivos para mejor rendimiento
let fileProcessingQueue = [];
let isProcessingFiles = false;

async function processFileQueue() {
    if (isProcessingFiles || fileProcessingQueue.length === 0) {
        return;
    }
    
    isProcessingFiles = true;
    
    while (fileProcessingQueue.length > 0) {
        const fileData = fileProcessingQueue.shift();
        
        
        // ✅ NUEVO: Actualizar indicador de progreso
        updateFileProcessingIndicator(fileProcessingQueue.length);
        
        try {
            await processSingleFile(fileData);
        } catch (error) {
        }
        
        // Pequeña pausa para evitar saturar el navegador
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    isProcessingFiles = false;
    window.isProcessingFiles = false; // ✅ NUEVO: Limpiar bandera global también
    
    
    // ✅ NUEVO: Ocultar indicador cuando termine el procesamiento
    hideFileProcessingIndicator();
}

// ✅ NUEVA FUNCIÓN: Mostrar indicador de progreso de archivos
function showFileProcessingIndicator(queueLength) {
    let indicator = document.getElementById('file-processing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'file-processing-indicator';
        indicator.className = 'file-processing-indicator';
        indicator.innerHTML = `
            <div class="processing-content">
                <div class="spinner"></div>
                <span class="processing-text">Procesando archivos...</span>
                <span class="queue-count">${queueLength} en cola</span>
            </div>
        `;
        
        // Agregar estilos
        const style = document.createElement('style');
        style.id = 'file-processing-indicator-styles'; // ✅ NUEVO: ID para los estilos
        style.textContent = `
            .file-processing-indicator {
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 15px 20px;
                border-radius: 8px;
                z-index: 10000;
                font-size: 14px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            }
            .processing-content {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .spinner {
                width: 16px;
                height: 16px;
                border: 2px solid #333;
                border-top: 2px solid #4CAF50;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .queue-count {
                color: #4CAF50;
                font-weight: bold;
            }
            
            /* ✅ MEJORADO: Estilos para indicador de escritura en lista de usuarios */
            .chat-item .user-typing-indicator {
                font-size: 9px !important;
                color: #FFFFFF !important;
                font-style: italic !important;
                font-weight: bold !important;
                margin-top: 2px !important;
                margin-left: 8px !important;
                display: flex;
                align-items: center !important;
                gap: 2px !important;
                max-width: 100% !important;
                overflow: hidden !important;
                position: static !important;
                z-index: 1 !important;
                visibility: visible;
                opacity: 1;
                height: auto !important;
                min-height: 10px !important;
                background: #2196F3 !important;
                border: 1px solid #2196F3 !important;
            }
            
            .typing-text {
                font-size: 8px !important;
                color: #FFFFFF !important;
                white-space: nowrap !important;
                display: inline !important;
                visibility: visible !important;
                opacity: 1 !important;
                font-weight: bold !important;
                text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8) !important;
            }
            
            
            /* ✅ NUEVO: Responsive para pantallas grandes */
            @media (min-width: 768px) {
                .user-typing-indicator {
                    font-size: 10px;
                }
                
                .typing-text {
                    font-size: 9px;
                }
                
            }
            
            /* ✅ NUEVO: Para pantallas muy pequeñas (móviles) */
            @media (max-width: 480px) {
                .user-typing-indicator {
                    font-size: 12px;
                }
                
                .typing-text {
                    font-size: 11px;
                }
                
            }
            
            /* ✅ NUEVO: Asegurar que NO aparezcan indicadores en el área de chat */
            .chat-messages-area .user-typing-indicator,
            .chat-messages-area .dashboard-typing-indicator,
            .chat-messages-area .typing-indicator,
            .chat-messages-area *[class*="typing"],
            .chat-messages-area *[class*="escribiendo"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            
            /* ✅ NUEVO: Bloquear cualquier elemento que contenga "escribiendo" en el área de chat */
            .chat-messages-area *:not(.chat-item):not(.user-typing-indicator) {
                content: none !important;
            }
            
            /* ✅ NUEVO: Ocultar cualquier mensaje que contenga "escribiendo" */
            .chat-messages-area .message:has-text("escribiendo"),
            .chat-messages-area .message-bubble:has-text("escribiendo") {
                display: none !important;
            }
            
            /* ✅ NUEVO: Asegurar que el indicador se mantenga dentro de la lista de usuarios */
            .chat-item {
                position: relative !important;
                overflow: visible !important;
            }
            
            .chat-item .user-info {
                position: relative !important;
                overflow: visible !important;
            }
            
            .chat-item .user-typing-indicator {
                position: static !important;
                z-index: 1 !important;
                margin-top: 2px !important;
                margin-left: 8px !important;
                width: 100% !important;
                box-sizing: border-box !important;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(indicator);
    } else {
        indicator.querySelector('.queue-count').textContent = `${queueLength} en cola`;
    }
}

// ✅ NUEVA FUNCIÓN: Actualizar indicador de progreso
function updateFileProcessingIndicator(queueLength) {
    const indicator = document.getElementById('file-processing-indicator');
    if (indicator) {
        const queueCount = indicator.querySelector('.queue-count');
        if (queueCount) {
            queueCount.textContent = `${queueLength} en cola`;
        }
    }
}

// ✅ NUEVA FUNCIÓN: Ocultar indicador de progreso
function hideFileProcessingIndicator() {
    const indicator = document.getElementById('file-processing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

// ✅ MEJORADO: Mostrar indicador de escritura para un usuario en la lista
function showUserListTypingIndicator(userId) {
    // No mostrar indicador si es el mismo usuario
    if (String(userId) === String(dashboardCurrentUserId)) {
        return;
    }
    
    const userItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
    if (!userItem) {
        return;
    }
    
    const typingIndicator = userItem.querySelector('.user-typing-indicator');
    if (typingIndicator) {
        // Aplicar estilos para posicionar correctamente el indicador en la lista de chats
        typingIndicator.style.cssText = `
            display: flex;
            visibility: visible;
            opacity: 1;
            color: #FFFFFF;
            font-size: 9px;
            font-style: italic;
            font-weight: bold;
            margin-top: 2px;
            margin-left: 8px;
            align-items: center;
            gap: 2px;
            max-width: 100%;
            overflow: hidden;
            position: static;
            z-index: 1;
            height: auto;
            min-height: 10px;
            background: #2196F3;
            border: 1px solid #2196F3;
            border-radius: 3px;
            padding: 1px 4px;
            box-shadow: 0 1px 3px rgba(33, 150, 243, 0.5);
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
        `;
        
        // Asegurar que el texto interno también sea visible
        const typingText = typingIndicator.querySelector('.typing-text');
        if (typingText) {
            typingText.style.cssText = `
                font-size: 8px;
                color: #FFFFFF;
                white-space: nowrap;
                display: inline;
                visibility: visible;
                opacity: 1;
                font-weight: bold;
                text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
            `;
        }
    }
}

// ✅ MEJORADO: Ocultar indicador de escritura para un usuario en la lista
function hideUserListTypingIndicator(userId) {
    // ✅ NUEVO: No ocultar indicador si es el mismo usuario (admin/soporte viendo su propio indicador)
    if (String(userId) === String(dashboardCurrentUserId)) {
        return;
    }
    
    // ✅ NUEVO: Verificar que el usuario existe en la lista antes de ocultar indicador
    const allChatItems = document.querySelectorAll('.chat-item');
    const userExists = Array.from(allChatItems).some(item => 
        String(item.getAttribute('data-user-id')) === String(userId)
    );
    
    if (!userExists) {
        return;
    }
    
    const userItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
    if (userItem) {
        const typingIndicator = userItem.querySelector('.user-typing-indicator');
        if (typingIndicator) {
            typingIndicator.style.display = 'none';
        }
    }
}

// ✅ NUEVA FUNCIÓN: Limpiar todos los indicadores de escritura

async function processSingleFile(fileData) {
    const { file, senderId, recipientId, messageType } = fileData;
    
    
    // ✅ CORREGIDO: Detectar tipo de usuario para is_support
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    try {
        if (file.size > 50 * 1024 * 1024) {
            // Archivo grande: usar chunks
            await sendFileInChunks(file, senderId, recipientId, messageType);
        } else {
            // Archivo pequeño: enviar directamente
            const reader = new FileReader();
            
            return new Promise((resolve, reject) => {
                reader.onload = function(e) {
                    try {
                        const base64Data = e.target.result.split(',')[1];
                        
                        
                        window.socket.emit('send_file_message', {
                            sender_id: senderId,
                            recipient_id: recipientId,
                            message: `Archivo: ${file.name}`,
                            attachment_filename: file.name,
                            attachment_type: file.type,
                            attachment_data: base64Data,
                            attachment_size: file.size,
                            message_type: messageType,
                            is_support: isSupportUser
                        });
                        
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                
                reader.onerror = function() {
                    reject(new Error(`Error leyendo archivo: ${file.name}`));
                };
                
                reader.readAsDataURL(file);
            });
        }
    } catch (error) {
        alert(`Error procesando archivo: ${file.name}`);
    }
}

// ✅ NUEVA FUNCIÓN: Actualizar last_message en la lista de usuarios en tiempo real
function updateLastMessageInUserList(messageData) {
    if (!messageData || !messageData.sender_id || !messageData.recipient_id) return;
    
    // Determinar el ID del usuario para actualizar
    const userIdToUpdate = messageData.sender_id === dashboardCurrentUserId ? messageData.recipient_id : messageData.sender_id;
    
    // Buscar el elemento del usuario en la lista
    const userItem = document.querySelector(`.chat-item[data-user-id="${userIdToUpdate}"]`);
    if (!userItem) return;
    
    const lastMessageElement = userItem.querySelector('.user-last-message');
    if (!lastMessageElement) return;
    
    // Formatear el mensaje igual que en el servidor
    let messageText = messageData.message;
    
    if (messageData.has_attachment && messageData.attachment_filename) {
        // Extraer extensión del archivo
        const fileExtension = messageData.attachment_filename.split('.').pop();
        if (fileExtension) {
            messageText = `[Archivo.${fileExtension}]`;
        } else {
            messageText = '[Archivo]';
        }
    } else if (messageData.message_type === 'system') {
        messageText = messageData.message;
    } else if (messageData.message.length > 50) {
        messageText = messageData.message.substring(0, 50) + '...';
    }
    
    // Actualizar el texto del mensaje
    lastMessageElement.textContent = messageText;
}

// Función para mostrar notificación de conexión en el dashboard
function showDashboardConnectionNotification(message, status) {
    const notification = document.createElement('div');
    notification.className = `dashboard-connection-notification ${status}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${status === 'online' ? '🟢' : '🔴'}</span>
            <span class="notification-text">${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remover después de 3 segundos
    setTimeout(() => {
        if (notification && notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

// ✅ NUEVO: Función para detectar si es dispositivo móvil
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) ||
           window.innerWidth <= 768;
}

// ✅ NUEVO: Función para mostrar notificaciones del navegador
function showBrowserNotification(senderName, message) {
    // ✅ NUEVO: En móviles, usar notificaciones en la página por defecto
    if (isMobileDevice()) {
        showInPageNotification(senderName, message);
        return;
    }
    
    // Verificar si el navegador soporta notificaciones
    if (!("Notification" in window)) {
        // Mostrar notificación en la página como fallback
        showInPageNotification(senderName, message);
        return;
    }
    
    // Verificar si ya se tiene permiso
    if (Notification.permission === "granted") {
        // Crear y mostrar notificación
        const notification = new Notification(`Nuevo mensaje de ${senderName}`, {
            body: message.length > 50 ? message.substring(0, 50) + "..." : message,
            // ✅ CORREGIDO: Removido icono que no existe para evitar error 404
            tag: 'chat-message', // Para agrupar notificaciones
            requireInteraction: false,
            // ✅ NUEVO: Opciones específicas para móviles
            silent: false,
            vibrate: [200, 100, 200]
        });
        
        // Auto-cerrar después de 5 segundos
        setTimeout(() => {
            notification.close();
        }, 5000);
        
        // Hacer clic en la notificación para enfocar la ventana
        notification.onclick = function() {
            window.focus();
            notification.close();
        };
    } else if (Notification.permission === "default") {
        // Solicitar permiso si no se ha hecho antes
        Notification.requestPermission().then(function(permission) {
            if (permission === "granted") {
                showBrowserNotification(senderName, message);
            } else {
                // Mostrar mensaje alternativo en la página
                showInPageNotification(senderName, message);
            }
        });
    } else {
        // Mostrar notificación alternativa en la página
        showInPageNotification(senderName, message);
    }
}

// ✅ NUEVO: Función para mostrar notificación alternativa en la página
function showInPageNotification(senderName, message) {
    // Crear notificación en la página
    const notification = document.createElement('div');
    notification.className = 'in-page-notification';
    
    // ✅ NUEVO: Estilos adaptativos para móviles
    const isMobile = isMobileDevice();
    const notificationStyle = isMobile ? `
        position: fixed;
        top: 10px;
        left: 10px;
        right: 10px;
        background: #4CAF50;
        color: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        z-index: 10000;
        font-family: Arial, sans-serif;
        font-size: 16px;
        cursor: pointer;
        animation: slideInMobile 0.4s ease-out;
        border: 2px solid #45a049;
    ` : `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        max-width: 300px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        cursor: pointer;
        animation: slideIn 0.3s ease-out;
    `;
    
    notification.style.cssText = notificationStyle;
    
    notification.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; font-size: ${isMobile ? '18px' : '16px'};">📱 Nuevo mensaje de ${senderName}</div>
        <div style="opacity: 0.9; font-size: ${isMobile ? '16px' : '14px'};">${message.length > 50 ? message.substring(0, 50) + "..." : message}</div>
        ${isMobile ? '<div style="margin-top: 10px; font-size: 12px; opacity: 0.7;">Toca para cerrar</div>' : ''}
    `;
    
    // Agregar estilos de animación
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInMobile {
            from { transform: translateY(-100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notification);
    
    // ✅ NUEVO: Vibración en móviles si está disponible
    if (isMobile && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
    
    // Auto-remover después de 7 segundos en móviles, 5 en escritorio
    const timeout = isMobile ? 7000 : 5000;
    setTimeout(() => {
        if (notification && notification.parentNode) {
            const animation = isMobile ? 'slideInMobile 0.4s ease-out reverse' : 'slideIn 0.3s ease-out reverse';
            notification.style.animation = animation;
            setTimeout(() => {
                notification.remove();
            }, 400);
        }
    }, timeout);
    
    // Hacer clic para cerrar
    notification.onclick = function() {
        notification.remove();
    };
}

// ✅ NUEVO: Función para solicitar permisos de notificaciones al cargar la página
function requestNotificationPermission() {
    if (!("Notification" in window)) {
        return;
    }
    
    if (Notification.permission === "default") {
        Notification.requestPermission().then(function(permission) {
            // Permisos manejados silenciosamente
        });
    }
}

// ✅ NUEVA FUNCIÓN: Enviar archivo por chunks
async function sendFileInChunks(file, senderId, recipientId, messageType) {
    const chunkSize = 10 * 1024 * 1024; // 10MB por chunk
    const totalChunks = Math.ceil(file.size / chunkSize);
    const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // ✅ CORREGIDO: Detectar tipo de usuario para is_support
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    
    // Enviar información del archivo primero
    window.socket.emit('start_file_upload', {
        file_id: fileId,
        filename: file.name,
        file_type: file.type,
        file_size: file.size,
        total_chunks: totalChunks,
        sender_id: senderId,
        recipient_id: recipientId,
        message_type: messageType,
        is_support: isSupportUser
    });
    
    // Enviar cada chunk
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        
        const reader = new FileReader();
        await new Promise((resolve) => {
            reader.onload = function(e) {
                const base64Data = e.target.result.split(',')[1];
                
                window.socket.emit('file_chunk', {
                    file_id: fileId,
                    chunk_index: chunkIndex,
                    chunk_data: base64Data,
                    is_last_chunk: chunkIndex === totalChunks - 1
                });
                
                resolve();
            };
            reader.readAsDataURL(chunk);
        });
        
        // Pequeña pausa entre chunks para evitar sobrecarga
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
}

// ✅ NUEVO: Verificar conexión real del dashboard de forma más robusta
function checkDashboardConnection() {
    // Verificar si hay conexión de red
    if (!navigator.onLine) {
        return false;
    }
    
    // Verificar si el socket existe y está conectado
    if (window.socket && window.socket.connected) {
        return true;
    }
    
    // Verificar si el socket existe pero no está conectado
    if (window.socket && !window.socket.connected) {
        // Intentar reconectar si es posible
        try {
            window.socket.connect();
            return true;
        } catch (error) {
            return false;
        }
    }
    
    // Si no hay socket, verificar si se puede crear uno
    if (!window.socket) {
        try {
            initializeDashboardSocketIO();
            return window.socket && window.socket.connected;
        } catch (error) {
            return false;
        }
    }
    
    return false;
}

// ============================================================================
// EVENT LISTENERS DELEGADOS PARA CSP COMPLIANCE
// ============================================================================

// Event listener delegado para modales y acciones de archivos (CSP compliant)
document.addEventListener('click', function(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    const action = target.getAttribute('data-action');
    
    switch(action) {
        case 'close-file-preview-modal':
            const filePreviewModal = target.closest('.file-preview-modal-overlay');
            if (filePreviewModal) {
                filePreviewModal.remove();
            }
            break;
            
        case 'close-file-info-modal':
            const fileInfoModal = target.closest('.file-info-modal-overlay');
            if (fileInfoModal) {
                fileInfoModal.remove();
            }
            break;
            
        case 'close-image-modal':
            const imageModal = target.closest('.image-modal-overlay');
            if (imageModal) {
                imageModal.remove();
            }
            break;
            
        case 'open-file-new-tab':
            const fileUrl = target.getAttribute('data-file-url').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
            window.open(fileUrl, '_blank');
            break;
    }
});
