// ============================================================================
// CHAT UNIFIED - VERSIÓN LIMPIA - CON MENSAJES TEMPORALES
// ============================================================================

// Variables globales
let chatCurrentUserId = null;
let chatCurrentUsername = null;
let isTyping = false;
let typingTimeout = null;

// ✅ NUEVO: Variables para SocketIO
let socket = null;
let isSocketConnected = false;

// ✅ NUEVO: Variables para grabación de audio
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
                   'Puedes enviar archivo de audio usando el botón de adjuntar archivo (📎). ' +
                   'Grabar el audio con otra aplicación y luego adjuntarlo.';
    
    alert(message);
}





// Elementos del DOM
let chatMessagesArea = null;
let chatInputArea = null;
let chatInputField = null;
let chatInputForm = null;
let chatTitle = null;
let chatStatus = null;

// Función para obtener token CSRF
function getUserCsrfToken() {
    const metaTag = document.querySelector('meta[name="csrf_token"]');
    const token = metaTag ? metaTag.content : '';
    return token;
}

// Función para inicializar el chat
function initializeUserChat() {
    // Inicializando chat...
    
    // Detectar elementos del DOM
    chatMessagesArea = document.querySelector('#chatMessagesAreaUser');
    chatInputArea = document.querySelector('.chat-input-area');
    chatInputField = document.querySelector('#chatInputFieldUser');
    chatInputForm = document.querySelector('#chatInputFormUser');
    chatTitle = document.querySelector('.chat-title');
    chatStatus = document.querySelector('.chat-status');
    
    
    if (!chatMessagesArea || !chatInputArea || !chatInputField || !chatInputForm) {
        return;
    }
    
    // Elementos opcionales (no críticos para el funcionamiento)
    if (!chatTitle) {
    }
    if (!chatStatus) {
    }
    
    
    // Elementos del chat detectados correctamente
    
    if (chatInputArea) {
        chatInputArea.classList.add('active');
    }
    
    const audioRecordBtn = document.getElementById('audioRecordBtnUser');
    if (audioRecordBtn) {
        // Botón de audio configurado
    }
    
    const userIdMeta = document.querySelector('meta[name="current-user-id"]');
    if (userIdMeta) {
        chatCurrentUserId = userIdMeta.content;
        window.chatCurrentUserId = chatCurrentUserId; // ✅ NUEVO: Hacer accesible desde video-utils.js
    } else {
    }
    
    // ✅ NUEVO: Inicializar SocketIO integrado
    
    const currentUsername = document.querySelector('meta[name="current-username"]')?.content;
    const currentUserType = document.querySelector('meta[name="current-user-type"]')?.content || 'user';
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    
    if (chatCurrentUserId && currentUsername) {
        chatCurrentUsername = currentUsername;
        initializeSocketIO();
    } else {
    }
    
    loadInitialMessages();
    
    setupEventListeners();
    
}

// Función para cargar mensajes iniciales
async function loadInitialMessages(response = null) {
    
    try {
        let data;
        
        if (response) {
            data = response;
        } else {
            const response = await fetch('/tienda/api/chat/get_user_messages', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getUserCsrfToken()
                }
            });
            data = await response.json();
        }
        
        
        if (data.status === 'success' && chatMessagesArea) {
            chatMessagesArea.innerHTML = '';
            
            const messages = data.data || [];
            
            let currentDate = null;
            
            messages.forEach((message, index) => {
                
                const messageDate = new Date(message.created_at);
                const messageDay = getDateString(messageDate);
                
                // Agregar fecha solo una vez por día (sin separador visual)
                if (currentDate !== messageDay) {
                    addDateHeader(message.created_at);
                    currentDate = messageDay;
                }
                
                addUserMessage(message);
            });
            
            // ✅ ELIMINADO: No actualizar fechas automáticamente para mantener fechas originales
            
            chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        } else {
            // Error en respuesta o chatMessagesArea no disponible
        }
    } catch (error) {
    }
}

// Función para enviar mensaje
async function sendMessage(message) {
    
    if (!message || !message.trim()) {
        return;
    }
    
    // ✅ MEJORADO: Verificar conexión de forma más inteligente
    const isActuallyConnected = checkActualConnection();
    if (!isActuallyConnected && window.ChatReconnectionManager && typeof window.ChatReconnectionManager.addOfflineMessage === 'function') {
        // Agregar a cola offline solo si realmente no hay conexión
        window.ChatReconnectionManager.addOfflineMessage({
            type: 'text',
            content: message,
            timestamp: new Date()
        });
        return;
    }
    
    
    try {
        // Agregar mensaje temporal con estilo visual
        // ✅ NUEVO: Verificar si ya hay un mensaje temporal pendiente
        const existingTempMessage = document.querySelector('[data-message-id^="temp_"]');
        if (existingTempMessage) {
            return;
        }
        
        const tempMessage = {
            id: 'temp_' + Date.now(),
            message: message.trim(),
            sender_id: chatCurrentUserId,
            sender_name: document.querySelector('meta[name="current-username"]')?.content || 'Usuario',
            message_type: 'user',
            created_at: new Date().toISOString(),
            is_temp: true
        };
        
        addUserMessage(tempMessage);
        chatInputField.value = '';
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // ✅ NUEVO: Usar SocketIO si está disponible, sino fallback a HTTP
        
        if (isSocketIOAvailable()) {
            try {
                const sent = sendMessageSocketIO(message.trim(), '1'); // Enviar al admin (ID: 1)
                if (sent) {
                    // ✅ NUEVO: Notificar a otras pestañas que se envió un mensaje
                    if (window.ChatReconnectionManager && typeof window.ChatReconnectionManager.broadcastToOtherTabs === 'function') {
                        window.ChatReconnectionManager.broadcastToOtherTabs('message_sent', {
                            message: message.trim(),
                            recipientId: '1',
                            connectionStatus: true
                        });
                    }
                    return; // Salir si SocketIO funcionó
                } else {
                    throw new Error('SocketIO falló');
                }
            } catch (error) {
                // Continuar con fallback HTTP
            }
        }
        
        // Fallback a HTTP (si SocketIO no está disponible o falló)
        if (!isSocketIOAvailable() || true) {
            // Fallback a HTTP
            const response = await fetch('/tienda/api/chat/send_message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getUserCsrfToken()
                },
                body: JSON.stringify({
                    message: message.trim(),
                    recipient_id: '1'  // Enviar siempre al admin (ID: 1)
                })
            });
            

            const data = await response.json();
            
            if (data.status === 'success') {
                // Remover mensaje temporal y agregar el real
                removeTempMessage(tempMessage.id);
                addUserMessage(data.data);
                chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
            } else {
            }
        }
    } catch (error) {
    }
}

// Función para agregar mensaje del usuario
function addUserMessage(messageData) {
    // Validar que messageData existe y tiene las propiedades necesarias
    if (!messageData || !messageData.sender_id || !chatMessagesArea) {
        return;
    }
    
    const messageElement = document.createElement('div');
    // ✅ NUEVO: Usar is_own_message del objeto si está disponible, sino calcular
    const isOwnMessage = messageData.is_own_message !== undefined ? 
        messageData.is_own_message : 
        String(messageData.sender_id) === String(chatCurrentUserId);
    
    // Debug para verificar tipos de datos
    if (messageData.has_attachment && messageData.attachment_type === 'audio') {
    }
    
    // ✅ NUEVO: Los mensajes del sistema siempre centrados
    if (messageData.message_type === 'system') {
        messageElement.className = 'message system-message';
    } else {
        // Para usuarios normales: sus mensajes van a la derecha (own-message), mensajes de admin/soporte a la izquierda (other-message)
        const isAdminMessage = messageData.message_type === 'admin' || messageData.message_type === 'support';
        const finalIsOwnMessage = isOwnMessage && !isAdminMessage;
        
        // Aplicar clases correctas para posicionamiento
        if (finalIsOwnMessage) {
            messageElement.className = 'message own-message';
            messageElement.style.marginLeft = 'auto';
            messageElement.style.flexDirection = 'column';
        } else {
            messageElement.className = 'message other-message';
        }
        
        // Debug específico para audios
        if (messageData.has_attachment && messageData.attachment_type === 'audio') {
        }
    }
    messageElement.setAttribute('data-message-id', messageData.id);
    
    // ✅ NUEVO: Agregar atributo de fecha para comparaciones
    if (messageData.created_at) {
        const messageDate = new Date(messageData.created_at);
        const messageDay = getDateString(messageDate);
        messageElement.setAttribute('data-date', messageDay);
    }
    
    // Mensaje propio
    
    if (messageData.is_temp) {
        messageElement.classList.add('temp-message');
    }
    
    let senderLabel = '';
    
    if (messageData.message_type === 'admin') {
        senderLabel = '<span class="message-sender-inline admin-inline">Admin: </span>';
    } else if (messageData.message_type === 'support') {
        // Para soporte, en el chat de usuarios normales siempre mostrar "Soporte:"
        senderLabel = '<span class="message-sender-inline support-inline">Soporte: </span>';
    } else if (messageData.message_type === 'user') {
        // Para mensajes de usuario, no mostrar etiqueta si es el usuario actual
        if (isOwnMessage) {
            senderLabel = ''; // No mostrar etiqueta para mensajes propios
        } else {
            // Solo mostrar etiqueta si es un mensaje de otro usuario (no debería pasar en chat de soporte)
            senderLabel = `<span class="message-sender-inline user-inline">${messageData.sender_name || 'Usuario'}: </span>`;
        }
    } else if (messageData.message_type === 'system') {
        // ✅ NUEVO: Mensaje del sistema (centrado, estilo especial)
        senderLabel = '<span class="message-sender-inline system-inline">Sistema: </span>';
    }
    
    const messageTime = formatTimeAgo(messageData.created_at || messageData.timestamp);
    
    // Verificar si es un mensaje con archivos
    if (messageData.has_attachment) {
        
        let attachmentHTML = '';
        
        if (messageData.attachment_type === 'audio') {
             // Audio - usar la misma estructura para todos (los estilos se aplican por own-message/other-message)
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
            attachmentHTML = displayFileInChat(messageData);
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
            
            // Botón play/pause
            playPauseBtn.addEventListener('click', function() {
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
            
            // Control de velocidad con botón toggle
            speedBtn.addEventListener('click', function() {
                currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
                const newSpeed = speeds[currentSpeedIndex];
                
                audioElement.playbackRate = newSpeed;
                speedBtn.textContent = newSpeed + 'x';
                
                // Velocidad cambiada
            });
            
            // Actualizar duración cuando esté lista
            audioElement.addEventListener('loadedmetadata', function() {
                const duration = Math.floor(audioElement.duration);
                if (duration && isFinite(duration)) {
                    // Audio cargado
                }
            });
            
            // Actualizar progreso durante la reproducción
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
            
            // ✅ CORREGIDO: Manejar fin de reproducción
            audioElement.addEventListener('ended', function() {
                if (playPauseBtn) {
                    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
                }
                if (progressFill) progressFill.style.width = '0%';
                if (progressKnob) progressKnob.style.left = '0%';
                if (audioTime) audioTime.textContent = '0:00';
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
    
    chatMessagesArea.appendChild(messageElement);
}

// ✅ ALIAS: Función addMessageToChat para compatibilidad con chat_dashboard_integrated.js
function addMessageToChat(messageData, isFromServer = false) {
    addUserMessage(messageData);
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
            const mimeType = mediaRecorder.mimeType || 'audio/webm';
            audioBlob = new Blob(audioChunks, { type: mimeType });
            
            // ✅ MEJORADO: Liberar recursos del stream
            stream.getTracks().forEach(track => track.stop());
            showAudioMessage(audioBlob);
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        // ✅ NUEVO: Cambiar apariencia del botón para indicar que está grabando
        const audioBtn = document.getElementById('audioRecordBtnUser');
        if (audioBtn) {
            audioBtn.innerHTML = '<i class="fas fa-stop"></i>';
            audioBtn.style.background = '#dc3545';
            audioBtn.title = 'Presiona de nuevo para detener grabación';
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
        
        alert(errorMessage);
    }
}

function stopAudioRecording() {
    if (!isRecording || !mediaRecorder) return;
    
    mediaRecorder.stop();
    isRecording = false;
            
            // Restaurar apariencia del botón
    const audioBtn = document.getElementById('audioRecordBtnUser');
    if (audioBtn) {
        audioBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        audioBtn.style.background = '';
        audioBtn.title = 'Mantén presionado para grabar audio';
    }
}

function showAudioMessage(audioBlob) {
    if (!chatCurrentUserId) {
            return;
        }
        
        const tempMessageId = 'temp_audio_' + Date.now();
        chatInputField.value = '';
        
    if (typeof showAudioPreviewModal === 'function') {
        showAudioPreviewModal(audioBlob, tempMessageId);
    }
        
        // Hacer scroll al final del chat
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
}

// ✅ FUNCIONES MOVIDAS A video-utils.js

// ✅ CORREGIDO: Función para enviar audio al servidor
async function sendAudioMessage(audioBlob, tempMessageId = null) {
    if (!chatCurrentUserId) return;
    
    try {
        // ✅ NUEVO: Usar SocketIO para audio en tiempo real
        if (isSocketIOAvailable()) {
            
            // Convertir audio a base64 para SocketIO
            const reader = new FileReader();
            reader.onload = function() {
                const audioData = reader.result.split(',')[1]; // Remover data:audio/...;base64,
                const extension = audioBlob.type.includes('webm') ? '.webm' : 
                                 audioBlob.type.includes('mp4') ? '.mp4' : 
                                 audioBlob.type.includes('ogg') ? '.ogg' : '.wav';
                
                // Enviar por SocketIO
                const audioMessageData = {
                    sender_id: chatCurrentUserId,
                    recipient_id: '1', // Usuario normal siempre envía al admin (ID: 1)
                    audio_data: audioData,
                    audio_filename: `audio_${Date.now()}${extension}`,
                    message_type: 'user' // ✅ CORREGIDO: Especificar que es del usuario
                };
                
                
                socket.emit('send_audio_message', audioMessageData);
                
            };
            reader.readAsDataURL(audioBlob);
            
            // Remover mensaje temporal inmediatamente
            if (tempMessageId) {
                removeTempMessage(tempMessageId);
            }
            
        } else {
            // Fallback a HTTP
            const formData = new FormData();
            
            // Usar el tipo MIME correcto del Blob
            const extension = audioBlob.type.includes('webm') ? '.webm' : 
                             audioBlob.type.includes('mp4') ? '.mp4' : 
                             audioBlob.type.includes('ogg') ? '.ogg' : '.wav';
            
            formData.append('audio', audioBlob, `audio_message${extension}`);
            formData.append('recipient_id', '1');  // Usuario normal siempre envía al admin (ID: 1)
            formData.append('message_type', 'audio');
            
            const response = await fetch('/tienda/api/chat/send_audio', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getUserCsrfToken()
                },
                body: formData
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                // Remover mensaje temporal y agregar el real
                if (tempMessageId) {
                    removeTempMessage(tempMessageId);
                }
                addUserMessage(data.data, true);
                chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
            } else {
                // Error al enviar audio
            }
        }
        
    } catch (error) {
        // Error al enviar audio
    }
}

// ✅ NUEVO: Hacer funciones accesibles desde video-utils.js
window.sendAudioMessage = sendAudioMessage;
window.showAudioMessage = showAudioMessage;

// ================== FUNCIONALIDAD DE ARCHIVOS ==================

// ✅ NUEVA FUNCIÓN: Manejar selección de archivos
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) {
        return;
    }
    
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
            alert(`❌ Tipo de archivo no soportado: ${file.name}`);
            return false;
        }
        
        const maxSize = 200 * 1024 * 1024; // 200MB (límite del servidor)
        if (file.size > maxSize) {
            alert(`❌ Archivo demasiado grande: ${file.name} (máximo 200MB)`);
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
    if (!chatCurrentUserId) return;
    
    // Crear mensaje temporal para preview
    const tempMessageId = 'temp_files_' + Date.now();
    const previewMessage = document.createElement('div');
    previewMessage.className = 'message temp-message file-preview-message';
    previewMessage.id = `preview-${tempMessageId}`;
    
    let previewHTML = `
        <div class="message-content">
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
        const fileInput = document.getElementById('chat-file-input-user');
        if (fileInput) fileInput.value = '';
    });
}

// ✅ NUEVA FUNCIÓN: Obtener icono según tipo de archivo
function getFileIcon(mimeType) {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    return '📄';
}

// ✅ NUEVA FUNCIÓN: Enviar archivos al servidor
async function sendFiles(files, tempMessageId) {
    if (!chatCurrentUserId) return;
    
    try {
        const formData = new FormData();
        formData.append('recipient_id', '1');  // ✅ CORREGIDO: Usuario normal siempre envía al admin (ID: 1)
        

        
        // ✅ CORREGIDO: Agregar cada archivo con validación
        const validFiles = [];
        files.forEach((file, index) => {
            // ✅ NUEVO: Verificar que el archivo no esté vacío
            if (file.size === 0) {
                alert(`Error: El archivo "${file.name}" está vacío`);
                return; // Solo salta este archivo, no toda la función
            }
            
            // ✅ NUEVO: Verificar que el archivo sea válido
            if (!file.type || file.type === '') {
                // Archivo sin tipo MIME
            }
            
            // ✅ CRÍTICO: Verificar que el archivo tenga contenido antes de agregarlo
            if (file.size > 0) {
                formData.append(`file_${index}`, file);
                validFiles.push(file); // Agregar a la lista de archivos válidos
            } else {
                alert(`Error: El archivo "${file.name}" no tiene contenido`);
                return; // Solo salta este archivo, no toda la función
            }
        });
        
        // ✅ NUEVO: Verificar que haya al menos un archivo válido
        if (validFiles.length === 0) {
            throw new Error('No hay archivos válidos para enviar');
        }
        
        // ✅ NUEVO: Verificar que FormData se construyó correctamente
        let formDataSize = 0;
        let fileCount = 0;
        for (let [key, value] of formData.entries()) {
            if (value instanceof File) {
                formDataSize += value.size;
                fileCount++;
            }
        }
        
        // ✅ NUEVO: Verificar que se hayan agregado todos los archivos esperados
        if (fileCount !== validFiles.length) {
            // Discrepancia detectada
        }
        
        // ✅ NUEVO: Usar SocketIO SIEMPRE con compresión automática
        if (isSocketIOAvailable() && socket && socket.connected) {
            
            // ✅ NUEVO: Enviar archivos por chunks para evitar error 400
            for (let i = 0; i < validFiles.length; i++) {
                const file = validFiles[i];
                
                // Si el archivo es muy grande (>50MB), dividirlo en chunks
                if (file.size > 50 * 1024 * 1024) {
                    await sendFileInChunks(file, chatCurrentUserId, '1', 'user');
                } else {
                    // Archivo pequeño, enviar normalmente
                    const reader = new FileReader();
                reader.onload = function() {
                    const fileData = reader.result.split(',')[1]; // Remover data:...;base64,
                    
                    // Enviar por SocketIO
                    socket.emit('send_file_message', {
                        sender_id: chatCurrentUserId,
                        recipient_id: '1', // Usuario normal siempre envía al admin (ID: 1)
                        message: `Archivo: ${file.name}`,
                        attachment_data: fileData,
                        attachment_filename: file.name,
                        attachment_type: file.type,
                        attachment_size: file.size,
                        message_type: 'user'
                    });
                };
                reader.readAsDataURL(file);
                }
            }
            
            // Remover preview temporal inmediatamente
            const previewMessage = document.getElementById(`preview-${tempMessageId}`);
            if (previewMessage) previewMessage.remove();
            
            // Limpiar input de archivos
            const fileInput = document.getElementById('chat-file-input-user');
            if (fileInput) fileInput.value = '';
            
            return; // Salir ya que se envió por SocketIO
            
        } else {
            alert('❌ SocketIO no disponible. Recargando página...');
            setTimeout(() => window.location.reload(), 2000);
        }
        
        if (data.status === 'success') {
            // Remover preview temporal
            const previewMessage = document.getElementById(`preview-${tempMessageId}`);
            if (previewMessage) previewMessage.remove();
            
            // Limpiar input de archivos
            const fileInput = document.getElementById('chat-file-input-user');
            if (fileInput) fileInput.value = '';
            
            // ✅ CORREGIDO: Manejar múltiples archivos igual que en chat_dashboard_integrated.js
            if (data.data) {
                if (Array.isArray(data.data)) {
                    // ✅ MÚLTIPLES ARCHIVOS: Crear un mensaje por cada archivo
                    
                    data.data.forEach((fileData, index) => {
                        try {
                            addUserMessage(fileData);
                        } catch (error) {
                            // Error al agregar mensaje
                        }
                    });
                    
                    // Scroll al final después de agregar todos los mensajes
                    setTimeout(() => {
                        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
                    }, 100);
                    
                } else if (data.data.has_attachment) {
                    // ✅ UN SOLO ARCHIVO: Agregar mensaje normal
                    addUserMessage(data.data);
                    chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
                } else {
                    // ✅ MENSAJE DE TEXTO: Agregar mensaje normal
                    addUserMessage(data.data);
                    chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
                }
            } else {
                // Error: data.data no tiene la estructura esperada
            }
            
        } else {
            alert('❌ Error al enviar archivos: ' + data.message);
        }
        
    } catch (error) {
        alert('❌ Error al enviar archivos: ' + error.message);
    }
}

// ✅ FUNCIÓN MOVIDA A video-utils.js

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

// Función para agregar encabezado de fecha (sin separador visual)
function addDateHeader(dateString) {
    if (!chatMessagesArea) {
        return;
    }
    
    const dateElement = document.createElement('div');
    dateElement.className = 'date-header';
    
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

// ✅ DESHABILITADO: Función para actualizar separadores de fecha existentes
function updateExistingDateHeaders() {
    // ✅ DESHABILITADO: No actualizar fechas para mantener fechas originales
    // Esta función estaba causando que las fechas se actualizaran incorrectamente
    return;
}

// Función para remover mensaje temporal
function removeTempMessage(tempId) {
    // Buscar por ID del mensaje temporal (audio o texto)
    const tempMessage = document.querySelector(`#audio-${tempId}`) || 
                       document.querySelector(`[data-message-id="${tempId}"]`);
    if (tempMessage) {
        tempMessage.remove();
    }
}

// ✅ CORREGIDO: Función para formatear tiempo
function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) {
        return '0:00';
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Función para formatear hora en formato 12 horas Colombia
function formatTimeAgo(dateString) {
    if (!dateString) return '';
    
    // Validar que dateString sea una fecha válida
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        return 'Hora inválida';
    }
    
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
        
        // Hora Colombia corregida
        
        return horaColombia;
    } catch (error) {
        // Error al formatear hora Colombia
        // Usando fallback de hora local
        // Fallback: hora local
        const horaLocal = date.toLocaleTimeString('es-CO', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        // Hora local fallback
        return horaLocal;
    }
    
    // Para mensajes más antiguos, mostrar días
    return `${Math.floor(diffInMinutes / 1440)}d`;
}

// Función para detectar cuando el usuario está escribiendo
function handleTyping() {
    if (!isTyping) {
        isTyping = true;
        // ✅ NUEVO: Enviar estado de escritura en tiempo real
        sendTypingStatus(true);
    }
    
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }
    
    typingTimeout = setTimeout(() => {
        isTyping = false;
        // ✅ NUEVO: Enviar estado de escritura en tiempo real
        sendTypingStatus(false);
    }, 2000);
}

// ✅ NUEVO: Función de estado de escritura con SocketIO
async function sendTypingStatus(typing) {
    if (!chatCurrentUserId) return;
    
    
    // ✅ NUEVO: Usar SocketIO para escritura en tiempo real
    if (isSocketIOAvailable()) {
        sendTypingStatusSocketIO(typing, '1'); // Para usuarios normales, el recipient es admin (ID: 1)
    } else {
        // Fallback a HTTP
        try {
            await fetch('/tienda/api/chat/typing_status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getUserCsrfToken()
                },
                body: JSON.stringify({
                    user_id: chatCurrentUserId,
                    typing: typing
                })
            });
        } catch (error) {
        }
    }
}

// Función para configurar event listeners
// ✅ CORREGIDO: Todos los event listeners usan la opción passive apropiada
// - passive: true para eventos que no necesitan bloquear el scroll (touchstart, input, change)
// - passive: false para eventos que necesitan preventDefault (submit, keydown, click)
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
            if (message) {
                sendMessage(message);
            } else {
            }
            
            return false;
        });
    }
    
    // Envío con Enter
    if (chatInputField) {
        chatInputField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const message = chatInputField.value.trim();
                if (message) {
                    sendMessage(message);
                }
            }
        }, { passive: false });
    } else {
    }
    
    // Event listener para typing
    if (chatInputField) {
        chatInputField.addEventListener('input', handleTyping, { passive: true });
    } else {
    }
    
    // ✅ NUEVO: Event listeners para audio (toggle de grabación)
    const audioRecordBtn = document.getElementById('audioRecordBtnUser');
    if (audioRecordBtn) {
        // ✅ NUEVO: Solo usar click para toggle de grabación
        audioRecordBtn.addEventListener('click', startAudioRecording);
        
        // ✅ NUEVO: Eventos táctiles para dispositivos móviles (también toggle)
        audioRecordBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startAudioRecording();
        }, { passive: true });
        
        // Botón de audio configurado correctamente
    } else {
        // No se encontró el botón de audio
    }
    
    // ✅ NUEVO: Event listener para input de archivos
    const fileInput = document.getElementById('chat-file-input-user');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelection, { passive: true });
    }
    
    // ✅ NUEVO: Event listener para el botón de envío
    const chatSendButton = document.getElementById('chatSendButtonUser');
    if (chatSendButton) {
        chatSendButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const message = chatInputField.value.trim();
            if (message) {
                sendMessage(message);
            } else {
            }
            
            return false;
        }, { passive: false });
    } else {
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    initializeUserChat();
    
    // ✅ NUEVO: Solicitar permisos de notificaciones al cargar la página
    setTimeout(() => {
        requestNotificationPermission();
    }, 1000); // Esperar 1 segundo para que la página se cargue completamente
});

// ✅ NUEVA FUNCIÓN: Verificar mensajes en el chat
window.verifyChatMessages = function() {
    // Función para verificar el estado del chat
};







// ✅ FUNCIÓN MOVIDA A video-utils.js

// ✅ FUNCIONES MOVIDAS A video-utils.js

// ✅ NUEVAS FUNCIONES AUXILIARES PARA ARCHIVOS GENÉRICOS
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

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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
            showInfoMessage('Error al cargar el archivo de texto');
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
                <div class="file-info-content">
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
        const response = await fetch('/tienda/api/chat/verify_upload_dir', {
            method: 'GET',
            headers: {
                'X-CSRFToken': getUserCsrfToken()
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                const uploadInfo = data.upload_info;
                const message = `
📁 INFORMACIÓN DEL DIRECTORIO:

📁 Ruta del directorio: ${uploadInfo.upload_dir}
✅ Existe: ${uploadInfo.upload_dir_exists}
📂 Es directorio: ${uploadInfo.upload_dir_is_dir}
✍️ Permisos de escritura: ${uploadInfo.write_permissions}
📊 Archivos en directorio: ${uploadInfo.file_count}
⚙️ MAX_CONTENT_LENGTH: ${uploadInfo.flask_config.MAX_CONTENT_LENGTH} bytes
                `;
                alert(message);
            } else {
                alert('Error al verificar: ' + data.message);
            }
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        alert('Error al verificar directorio: ' + error.message);
    }
};

// ============================================================================
// ✅ NUEVO: FUNCIONES SOCKETIO INTEGRADAS
// ============================================================================

// Función para inicializar SocketIO
function initializeSocketIO() {
    
    if (typeof io === 'undefined') {
        return false;
    }
    
    try {
        // ✅ NUEVO: Detectar la URL base para móviles
        const isMobile = isMobileDevice();
        const baseUrl = isMobile ? 
            `${window.location.protocol}//${window.location.hostname}:5001` : 
            'http://127.0.0.1:5001';
        
        // ✅ CORREGIDO: Conectar a SocketIO con configuración optimizada para estabilidad
        socket = io(baseUrl, {
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
        
        // ✅ NUEVO: Hacer socket accesible desde video-utils.js
        window.socket = socket;
        
    // Event listeners básicos
    socket.on('connect', function() {
        isSocketConnected = true;
        joinChatRoom();
        
        // Notificar al manager de reconexión
        if (window.ChatReconnectionManager && typeof window.ChatReconnectionManager.handleReconnection === 'function') {
            window.ChatReconnectionManager.handleReconnection();
        }
    });
        
        socket.on('disconnect', function(reason) {
            isSocketConnected = false;
            // No mostrar error si es reconexión normal
            if (reason !== 'io client disconnect') {
            }
            
            // Notificar al manager de reconexión
            if (window.ChatReconnectionManager && typeof window.ChatReconnectionManager.handleDisconnection === 'function') {
                window.ChatReconnectionManager.handleDisconnection();
            }
        });
        
        socket.on('connect_error', function(error) {
            isSocketConnected = false;
            // No mostrar error si es reconexión normal
            if (!error.message?.includes('xhr poll error')) {
            }
        });
        
        socket.on('reconnect', function(attemptNumber) {
            isSocketConnected = true;
            joinChatRoom();
        });
        
        socket.on('reconnect_error', function(error) {
        });
        
        socket.on('reconnect_failed', function() {
            isSocketConnected = false;
        });
        
        socket.on('error', function(data) {
        });
        
        // Event listeners específicos del chat
        setupSocketIOEventListeners();
        
        return true;
    } catch (error) {
        isSocketConnected = false;
        return false;
    }
}

// Función para configurar event listeners de SocketIO
function setupSocketIOEventListeners() {
    if (!socket) return;
    
    // Mensaje recibido en tiempo real
    socket.on('message_received', function(data) {
        handleRealTimeMessage(data);
    });
    
    // ✅ NUEVO: Manejar mensajes del sistema
    socket.on('system_message_received', function(data) {
        handleSystemMessage(data);
    });
    
    // Confirmación de mensaje enviado
    socket.on('message_sent', function(data) {
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
                // ✅ NUEVO: Verificar si necesitamos agregar separador de fecha para mensajes propios
                const messageDate = new Date(data.data.created_at || data.data.timestamp);
                const messageDay = getDateString(messageDate);
                const lastMessage = chatMessagesArea.lastElementChild;
                
                if (lastMessage && lastMessage.classList.contains('date-header')) {
                    // Si el último elemento es un separador de fecha, no agregar otro
                } else {
                    // Verificar si el último mensaje es de un día diferente
                    const lastMessageElement = chatMessagesArea.querySelector('.message:last-child');
                    if (lastMessageElement) {
                        const lastMessageDate = lastMessageElement.getAttribute('data-date');
                        if (lastMessageDate !== messageDay) {
                            addDateHeader(data.data.created_at || data.data.timestamp);
                        }
                    } else {
                        // Si no hay mensajes previos, agregar separador de fecha
                        addDateHeader(data.data.created_at || data.data.timestamp);
                    }
                }
                
                addUserMessage(data.data);
            }
        }
    });
    
    // Estado de escritura - DESHABILITADO para admin/soporte
    // Solo usuarios normales deben usar este sistema
    const isAdminUser = document.querySelector('meta[name="is-admin"]')?.content === 'true';
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    if (!isAdminUser && !isSupportUser) {
    socket.on('typing_status', function(data) {
        handleTypingStatus(data);
    });
    }
    
    // Audio recibido en tiempo real
    socket.on('audio_message_received', function(data) {
        handleAudioMessageReceived(data);
    });
    
    // Confirmación de audio enviado
    socket.on('audio_message_sent', function(data) {
        if (data.status === 'success') {
        }
    });
    
    // Archivo recibido en tiempo real
    socket.on('file_message_received', function(data) {
        handleFileMessageReceived(data);
    });
    
    // Confirmación de archivo enviado
    socket.on('file_message_sent', function(data) {
        if (data.status === 'success') {
            
            // ✅ NUEVO: Limpiar input de archivos cuando se confirma el envío
            const fileInput = document.getElementById('chat-file-input-user');
            if (fileInput) {
                fileInput.value = '';
            }
        } else {
        }
    });
    
    // Estado de conexión de usuarios
    socket.on('user_online_status', function(data) {
        handleUserOnlineStatus(data);
    });
    
    // Chat finalizado
    socket.on('chat_finalized', function(data) {
        if (data.user_id && data.status === 'finished') {
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
    
    // Estado del chat cambiado (colores en tiempo real)
    socket.on('chat_status_changed', function(data) {
        if (data.user_id && data.status) {
            updateUserChatStatus(data.user_id, data.status);
        }
    });
}

// ✅ NUEVA FUNCIÓN: Actualizar estado del chat (colores en tiempo real)
function updateUserChatStatus(userId, status) {
    // Para usuarios normales, no hay lista de chats como en el admin
    // Solo mostramos una notificación visual del estado
    const statusMessages = {
        'pending': 'Chat pendiente - esperando respuesta',
        'active': 'Nuevo mensaje recibido',
        'responded': 'Admin/soporte respondió',
        'resolved': 'Chat resuelto',
        'finished': 'Chat finalizado'
    };
    
    const statusMessage = statusMessages[status] || 'Estado desconocido';
    
    // Mostrar notificación visual del estado
    if (status === 'finished') {
        showConnectionNotification('Chat finalizado', 'success');
    } else if (status === 'responded') {
        showConnectionNotification('Admin respondió', 'info');
    }
}

// Función para unirse a la sala de chat
function joinChatRoom() {
    if (!socket || !isSocketConnected) return;
    
    socket.emit('join_chat', {
        user_id: chatCurrentUserId,
        username: chatCurrentUsername
    });
}

// Función para enviar mensaje por SocketIO
// ✅ MEJORADO: Función para enviar mensaje por SocketIO más robusta
function sendMessageSocketIO(message, recipientId = '1') {
    // Verificar conexión real
    if (!checkActualConnection()) {
        return false;
    }
    
    try {
        socket.emit('new_message', {
            sender_id: chatCurrentUserId,
            recipient_id: recipientId,
            message: message,
            message_type: 'user'
        });
        
        // Actualizar estado de conexión si el envío fue exitoso
        isSocketConnected = true;
        return true;
    } catch (error) {
        isSocketConnected = false;
        return false;
    }
}

// ✅ MEJORADO: Función para enviar estado de escritura por SocketIO
function sendTypingStatusSocketIO(typing, recipientId = '1') {
    if (!checkActualConnection()) return;
    
    if (typing) {
        socket.emit('typing_start', {
            user_id: chatCurrentUserId,
            username: chatCurrentUsername,
            recipient_id: recipientId
        });
    } else {
        socket.emit('typing_stop', {
            user_id: chatCurrentUserId,
            username: chatCurrentUsername,
            recipient_id: recipientId
        });
    }
}

// ✅ MEJORADO: Función para verificar si SocketIO está disponible
function isSocketIOAvailable() {
    return checkActualConnection();
}

// ✅ NUEVO: Verificar conexión real de forma más robusta
function checkActualConnection() {
    // Verificar si hay conexión de red
    if (!navigator.onLine) {
        return false;
    }
    
    // Verificar si el socket existe y está conectado
    if (socket && socket.connected) {
        return true;
    }
    
    // Verificar si el socket existe pero no está conectado
    if (socket && !socket.connected) {
        // Intentar reconectar si es posible
        try {
            socket.connect();
            return true;
        } catch (error) {
            return false;
        }
    }
    
    // Si no hay socket, verificar si se puede crear uno
    if (!socket) {
        try {
            initializeSocketIO();
            return socket && socket.connected;
        } catch (error) {
            return false;
        }
    }
    
    return false;
}

// ✅ NUEVO: Función para evitar duplicados de mensajes entre pestañas
function isMessageDuplicate(messageData) {
    if (!messageData || !messageData.id) {
        return false;
    }
    
    // Verificar si el mensaje ya existe en el DOM
    const existingMessage = document.querySelector(`[data-message-id="${messageData.id}"]`);
    if (existingMessage) {
        return true;
    }
    
    // Verificar si es un mensaje temporal que ya se procesó
    if (messageData.is_temp && messageData.id.startsWith('temp_')) {
        const tempMessage = document.querySelector(`[data-message-id="${messageData.id}"]`);
        return tempMessage !== null;
    }
    
    return false;
}

// ✅ NUEVO: Función para manejar mensajes del sistema
function handleSystemMessage(messageData) {
    // Validar que messageData existe
    if (!messageData) {
        return;
    }
    
    // ✅ NUEVO: Verificar duplicados antes de procesar
    if (isMessageDuplicate(messageData)) {
        return;
    }
    
    // ✅ CORREGIDO: Evitar duplicados usando un ID único del mensaje
    const messageId = messageData.id;
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
    
    // Verificar si el mensaje es para este usuario
    if (messageData.recipient_id == chatCurrentUserId) {
        // Solo evitar duplicados si el mensaje ya existe
        const existingMessage = document.querySelector(`[data-message-id="${messageData.id}"]`);
        if (existingMessage) {
            return;
        }
        
        // Verificar si necesitamos agregar separador de fecha
        const messageDate = new Date(messageData.created_at || messageData.timestamp);
        const messageDay = getDateString(messageDate);
        const lastMessage = chatMessagesArea.lastElementChild;
        
        if (lastMessage && lastMessage.classList.contains('date-header')) {
            // Si el último elemento es un separador de fecha, no agregar otro
        } else {
            // Verificar si el último mensaje es de un día diferente
            const lastMessageElement = chatMessagesArea.querySelector('.message:last-child');
            if (lastMessageElement) {
                const lastMessageDate = lastMessageElement.getAttribute('data-date');
                if (lastMessageDate !== messageDay) {
                    addDateHeader(messageData.created_at || messageData.timestamp);
                }
            } else {
                // Si no hay mensajes previos, agregar separador de fecha
                addDateHeader(messageData.created_at || messageData.timestamp);
            }
        }
        
        const systemMessage = {
            id: messageData.id,
            message: messageData.message,
            sender_id: messageData.sender_id,
            sender_name: 'Sistema',
            message_type: 'system',
            created_at: messageData.created_at || messageData.timestamp,
            is_temp: false
        };
        
        addUserMessage(systemMessage);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // Mostrar notificación del navegador
        showBrowserNotification('Sistema', messageData.message);
    }
}

// Función para manejar mensajes en tiempo real
function handleRealTimeMessage(messageData) {
    
    // ✅ NUEVO: Validar que messageData existe
    if (!messageData) {
        return;
    }
    
    if (!messageData.recipient_id) {
        return;
    }
    
    // Verificar si el mensaje es para este usuario
    if (messageData.recipient_id == chatCurrentUserId) {
        // ✅ CORREGIDO: Permitir que cada sesión vea sus propios mensajes
        // Solo evitar duplicados si el mensaje ya existe
        const existingMessage = document.querySelector(`[data-message-id="${messageData.id}"]`);
        if (existingMessage) {
            return;
        }
        
        // ✅ CORREGIDO: Manejar tanto mensajes de admin como de soporte
        const senderName = messageData.message_type === 'admin' ? 'Admin' : 'Soporte';
        
        // ✅ NUEVO: Verificar si necesitamos agregar separador de fecha
        const messageDate = new Date(messageData.created_at || messageData.timestamp);
        const messageDay = getDateString(messageDate);
        const lastMessage = chatMessagesArea.lastElementChild;
        
        if (lastMessage && lastMessage.classList.contains('date-header')) {
            // Si el último elemento es un separador de fecha, no agregar otro
        } else {
            // Verificar si el último mensaje es de un día diferente
            const lastMessageElement = chatMessagesArea.querySelector('.message:last-child');
            if (lastMessageElement) {
                const lastMessageDate = lastMessageElement.getAttribute('data-date');
                if (lastMessageDate !== messageDay) {
                    addDateHeader(messageData.created_at || messageData.timestamp);
                }
            } else {
                // Si no hay mensajes previos, agregar separador de fecha
                addDateHeader(messageData.created_at || messageData.timestamp);
            }
        }
        
        const receivedMessage = {
            id: messageData.id,
            message: messageData.message,
            sender_id: messageData.sender_id,
            sender_name: senderName,
            message_type: messageData.message_type,
            created_at: messageData.created_at || messageData.timestamp,
            is_temp: false
        };
        
        addUserMessage(receivedMessage);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // ✅ NUEVO: Mostrar notificación del navegador
        showBrowserNotification(senderName, messageData.message);
    }
}

// Función para manejar estado de escritura
function handleTypingStatus(data) {
    if (data.user_id != chatCurrentUserId) {
        // Mostrar indicador de escritura del soporte con hora
        showTypingIndicator('Soporte está escribiendo...', data.timestamp);
    }
}

// Función para mostrar indicador de escritura
function showTypingIndicator(text, timestamp = null) {
    
    // Remover indicador existente
    const existingIndicator = document.querySelector('.user-typing-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    // Crear nuevo indicador
    const indicator = document.createElement('div');
    indicator.className = 'user-typing-indicator';
    
    // Formatear hora si se proporciona timestamp
    let timeDisplay = '';
    if (timestamp) {
        const time = new Date(timestamp);
        timeDisplay = `<span class="typing-time">${time.toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit', second: '2-digit'})}</span>`;
    }
    
    indicator.innerHTML = `
        <div class="typing-content">
            <span>${text}</span>
            ${timeDisplay}
        </div>
        <div class="typing-dots">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;
    
    document.body.appendChild(indicator);
    
    // Auto-remover después de 5 segundos (más tiempo para ver la hora)
    setTimeout(() => {
        if (indicator && indicator.parentNode) {
            indicator.remove();
        }
    }, 5000);
}

// Función para manejar audio recibido en tiempo real
function handleAudioMessageReceived(audioData) {
    
    // ✅ NUEVO: Validar que audioData existe
    if (!audioData) {
        return;
    }
    
    if (!audioData.recipient_id) {
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
    
    // ✅ CORREGIDO: Verificar si el mensaje es para este usuario
    // El audio es relevante si:
    // 1. Es para este usuario (recipient_id == chatCurrentUserId)
    // 2. O es de este usuario (sender_id == chatCurrentUserId)
    // 3. O si es usuario soporte, puede ver todos los audios
    
    const currentUserType = document.querySelector('meta[name="current-user-type"]')?.content || 'user';
    const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
    
    // ✅ CORREGIDO: Comparar como strings para evitar problemas de tipo
    // El audio es relevante si:
    // 1. Es para este usuario (recipient_id == chatCurrentUserId)
    // 2. O es de este usuario (sender_id == chatCurrentUserId) - IMPORTANTE para ver propios audios
    // 3. O si es usuario soporte, puede ver todos los audios
    const isRelevant = String(audioData.recipient_id) === String(chatCurrentUserId) || 
                      String(audioData.sender_id) === String(chatCurrentUserId) ||
                      isSupportUser;
    
    
    if (isRelevant) {
        
        // ✅ CORREGIDO: Determinar el tipo de mensaje y nombre del remitente
        let messageType, senderName;
        
        // ✅ CORREGIDO: Usar el message_type del servidor en lugar de asumir
        if (String(audioData.sender_id) === String(chatCurrentUserId)) {
            // Este usuario envió el audio
            messageType = 'user';
            senderName = 'Tú';
        } else {
            // Usar el message_type que viene del servidor
            messageType = audioData.message_type || 'support';
            
            // Determinar el nombre del remitente según el tipo
            if (messageType === 'admin') {
                senderName = 'Admin';
            } else if (messageType === 'support') {
                senderName = 'Soporte';
            } else {
                senderName = audioData.sender_name || 'Usuario';
            }
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
        
        
        // ✅ CORREGIDO: Verificar que no existe ya un elemento con este ID
        const existingElement = document.getElementById(`message-${audioMessage.id}`);
        if (existingElement) {
            return;
        }
        
        // ✅ NUEVO: Limpiar elementos huérfanos antes de crear el nuevo
        cleanupOrphanedAudioElements();
        
        // Crear elemento de audio y agregarlo al chat usando la función correcta
        addUserMessage(audioMessage);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // ✅ NUEVO: Mostrar notificación del navegador para audio
        showBrowserNotification(senderName, '[Mensaje de audio]');
    }
}

// ✅ NUEVA FUNCIÓN: Limpiar elementos de audio huérfanos
function cleanupOrphanedAudioElements() {
    // Buscar elementos que no tienen la estructura correcta de mensaje
    const orphanedElements = chatMessagesArea.querySelectorAll('.audio-message:not(.chat-message .audio-message)');
    orphanedElements.forEach(element => {
        element.remove();
    });
    
    // Buscar elementos con IDs numéricos largos (elementos dañados)
    const damagedElements = chatMessagesArea.querySelectorAll('[id*="29283"]');
    damagedElements.forEach(element => {
        element.remove();
    });
}

// Función para crear elemento de audio en tiempo real
function createAudioMessageElement(audioMessage) {
    
    const messageElement = document.createElement('div');
    
    // ✅ CORREGIDO: Determinar la clase CSS basada en el tipo de mensaje
    if (audioMessage.message_type === 'user') {
        messageElement.className = 'chat-message user';
    } else {
        messageElement.className = 'chat-message support';
    }
    
    messageElement.id = `message-${audioMessage.id}`;
    
    // ✅ CORREGIDO: Crear blob desde base64 con validación
    let audioBlob, audioUrl;
    
    try {
        // Validar que attachment_data existe y no está vacío
        if (!audioMessage.attachment_data || audioMessage.attachment_data.trim() === '') {
            throw new Error('No hay datos de audio');
        }
        
        // Decodificar base64 de forma segura
        const binaryString = atob(audioMessage.attachment_data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Determinar el tipo MIME correcto basado en la extensión del archivo
        let mimeType = 'audio/webm';
        if (audioMessage.attachment_filename) {
            const extension = audioMessage.attachment_filename.toLowerCase().split('.').pop();
            switch (extension) {
                case 'mp4':
                    mimeType = 'audio/mp4';
                    break;
                case 'ogg':
                    mimeType = 'audio/ogg';
                    break;
                case 'wav':
                    mimeType = 'audio/wav';
                    break;
                default:
                    mimeType = 'audio/webm';
            }
        }
        
        audioBlob = new Blob([bytes], { type: mimeType });
        audioUrl = URL.createObjectURL(audioBlob);
        
    } catch (error) {
        // Si hay error al decodificar, mostrar mensaje de error
        messageElement.innerHTML = `
            <div class="chat-message-bubble">
                <div class="message-text">
                    <div class="audio-message">
                        <div class="audio-controls">
                            <button class="audio-play-btn" disabled>
                                <i class="fas fa-exclamation-triangle"></i>
                            </button>
                            <div class="audio-progress">
                                <div class="audio-progress-bar" style="width: 0%"></div>
                            </div>
                            <span class="audio-duration">Error</span>
                        </div>
                        <p style="color: #ff6b6b; font-size: 12px; margin: 5px 0 0 0;">Error al cargar audio</p>
                    </div>
                </div>
            </div>
            <div class="chat-message-time">${formatTime(new Date(audioMessage.created_at))}</div>
        `;
        chatMessagesArea.appendChild(messageElement);
        return; // Salir de la función si hay error
    }
    
    const messageTime = formatTime(new Date(audioMessage.created_at));
    
    messageElement.innerHTML = `
        <div class="chat-message-bubble">
            <div class="message-text">
                <div class="audio-player-sent">
                    <button class="play-pause-btn-sent" id="playPauseBtn-sent-${audioMessage.id}">
                        <i class="fas fa-play"></i>
                    </button>
                    <div class="audio-progress-sent">
                        <div class="progress-bar-sent">
                            <div class="progress-fill-sent" id="progressFill-sent-${audioMessage.id}"></div>
                            <div class="progress-knob-sent" id="progressKnob-sent-${audioMessage.id}"></div>
                        </div>
                        <span class="audio-time-sent" id="audioTime-sent-${audioMessage.id}">0:00</span>
                    </div>
                    <button class="speed-btn-sent" id="speedBtn-sent-${audioMessage.id}">1x</button>
                </div>
                <audio id="audio-sent-${audioMessage.id}" preload="metadata">
                    <source src="${audioUrl}" type="audio/webm">
                </audio>
            </div>
        </div>
        <div class="chat-message-time">${messageTime}</div>
    `;
    
    chatMessagesArea.appendChild(messageElement);
    
    // Configurar controles de audio
    setupAudioControls(audioMessage.id, audioUrl);
}

// Función para configurar controles de audio
function setupAudioControls(messageId, audioUrl) {
    const playBtn = document.getElementById(`playPauseBtn-sent-${messageId}`);
    const audio = document.getElementById(`audio-sent-${messageId}`);
    const progressFill = document.getElementById(`progressFill-sent-${messageId}`);
    const progressKnob = document.getElementById(`progressKnob-sent-${messageId}`);
    const duration = document.getElementById(`audioTime-sent-${messageId}`);
    const speedBtn = document.getElementById(`speedBtn-sent-${messageId}`);
    
    if (!playBtn || !audio || !progressFill || !progressKnob || !duration) return;
    
    audio.addEventListener('loadedmetadata', function() {
        const totalTime = Math.floor(audio.duration);
        duration.textContent = formatTime(totalTime);
    });
    
    audio.addEventListener('timeupdate', function() {
        const progress = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = progress + '%';
        progressKnob.style.left = progress + '%';
    });
    
    audio.addEventListener('ended', function() {
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
        progressFill.style.width = '0%';
        progressKnob.style.left = '0%';
    });
    
    playBtn.addEventListener('click', function() {
        if (audio.paused) {
            audio.play();
            playBtn.innerHTML = '<i class="fas fa-pause"></i>';
        } else {
            audio.pause();
            playBtn.innerHTML = '<i class="fas fa-play"></i>';
        }
    });
    
    // Configurar botón de velocidad
    if (speedBtn) {
        speedBtn.addEventListener('click', function() {
            const speeds = [1, 1.25, 1.5, 2];
            const currentSpeed = audio.playbackRate;
            const currentIndex = speeds.indexOf(currentSpeed);
            const nextIndex = (currentIndex + 1) % speeds.length;
            const newSpeed = speeds[nextIndex];
            
            audio.playbackRate = newSpeed;
            speedBtn.textContent = newSpeed + 'x';
        });
    }
}

// Función para manejar archivos recibidos en tiempo real
function handleFileMessageReceived(fileData) {
    
    // ✅ NUEVO: Validar que fileData existe
    if (!fileData) {
        return;
    }
    
    if (!fileData.recipient_id) {
        return;
    }
    
    // Verificar si el archivo es para este usuario O si es del usuario actual
    
    if (fileData.recipient_id == chatCurrentUserId || fileData.sender_id == chatCurrentUserId) {
        // ✅ NUEVO: Verificar si el mensaje ya existe para evitar duplicados
        const existingMessage = document.querySelector(`[data-message-id="${fileData.id}"]`);
        if (existingMessage) {
            return;
        }
        
        
        // ✅ CORREGIDO: Usar el message_type del servidor
        const messageType = fileData.message_type || 'support';
        const isOwnMessage = fileData.sender_id == chatCurrentUserId;
        let senderName;
        
        if (isOwnMessage) {
            // Si es el propio mensaje, no mostrar etiqueta de remitente
            senderName = '';
        } else if (messageType === 'admin') {
            senderName = 'Admin';
        } else if (messageType === 'support') {
            senderName = 'Soporte';
        } else {
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
            created_at: fileData.created_at,
            is_temp: false,
            is_own_message: isOwnMessage  // ✅ NUEVO: Indicar si es mensaje propio
        };
        
        // Crear elemento de archivo y agregarlo al chat usando la función correcta
        addUserMessage(fileMessage);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // ✅ NUEVO: Mostrar notificación del navegador para archivo
        showBrowserNotification('Soporte', `[Archivo: ${fileData.attachment_filename}]`);
    } else {
    }
}

// Función para crear elemento de archivo en tiempo real
function createFileMessageElement(fileMessage) {
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message support';
    messageElement.id = `message-${fileMessage.id}`;
    
    // ✅ NUEVO: Usar URL del servidor si está disponible, sino crear blob
    let fileUrl;
    if (fileMessage.attachment_path) {
        // Usar URL del servidor para archivos guardados
        fileUrl = `/tienda/store/static/uploads/chat/${fileMessage.attachment_path}`;
    } else if (fileMessage.attachment_data) {
        // Crear blob desde base64 para archivos en memoria
        const fileBlob = new Blob([Uint8Array.from(atob(fileMessage.attachment_data), c => c.charCodeAt(0))], {
            type: fileMessage.attachment_type
        });
        fileUrl = URL.createObjectURL(fileBlob);
    } else {
        return null;
    }
    
    const messageTime = formatTime(new Date(fileMessage.created_at));
    const fileSize = (fileMessage.attachment_size / 1024 / 1024).toFixed(2);
    
    // Determinar icono según tipo de archivo
    let fileIcon = '📄';
    if (fileMessage.attachment_type.startsWith('image/')) fileIcon = '🖼️';
    else if (fileMessage.attachment_type.startsWith('video/')) fileIcon = '🎥';
    else if (fileMessage.attachment_type.startsWith('audio/')) fileIcon = '🎵';
    else if (fileMessage.attachment_type.includes('pdf')) fileIcon = '📕';
    else if (fileMessage.attachment_type.includes('word')) fileIcon = '📝';
    else if (fileMessage.attachment_type.includes('excel')) fileIcon = '📊';
    
    // ✅ NUEVO: Usar displayFileInChat para generar el HTML correcto
    const attachmentHTML = displayFileInChat(fileMessage);
    
    messageElement.innerHTML = `
        <div class="chat-message-bubble">
            <div class="message-text">
                ${attachmentHTML}
            </div>
        </div>
        <div class="chat-message-time">${messageTime}</div>
    `;
    
    chatMessagesArea.appendChild(messageElement);
}

// Función para ver imagen
function viewImage(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="image-modal-content">
            <span class="close-modal">&times;</span>
            <img src="${imageUrl}" alt="Imagen">
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Cerrar modal
    modal.querySelector('.close-modal').addEventListener('click', () => {
        modal.remove();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Función para manejar estado de conexión de usuarios
function handleUserOnlineStatus(data) {
    
    // Mostrar notificación de estado de conexión
    if (data.status === 'online') {
        showConnectionNotification(`${data.username} se conectó`, 'online');
    } else if (data.status === 'offline') {
        showConnectionNotification(`${data.username} se desconectó`, 'offline');
    }
}

// Función para mostrar notificación de conexión
function showConnectionNotification(message, status) {
    const notification = document.createElement('div');
    notification.className = `connection-notification ${status}`;
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

// Hacer funciones disponibles globalmente
window.initializeSocketIO = initializeSocketIO;
window.sendMessageSocketIO = sendMessageSocketIO;
window.sendTypingStatusSocketIO = sendTypingStatusSocketIO;
window.isSocketIOAvailable = isSocketIOAvailable;
window.requestNotificationPermission = requestNotificationPermission;

// ✅ NUEVA FUNCIÓN: Enviar archivo por chunks
async function sendFileInChunks(file, senderId, recipientId, messageType) {
    const chunkSize = 10 * 1024 * 1024; // 10MB por chunk
    const totalChunks = Math.ceil(file.size / chunkSize);
    const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    
    // Enviar información del archivo primero
    socket.emit('start_file_upload', {
        file_id: fileId,
        filename: file.name,
        file_type: file.type,
        file_size: file.size,
        total_chunks: totalChunks,
        sender_id: senderId,
        recipient_id: recipientId,
        message_type: messageType
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
                
                socket.emit('file_chunk', {
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
