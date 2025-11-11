// ============================================================================
// VIDEO UTILS - FUNCIONES COMUNES PARA REPRODUCTORES DE VIDEO
// ============================================================================

// ✅ FUNCIÓN: Bloquear menú contextual del video
window.disableVideoContextMenu = function() {
    const allVideos = document.querySelectorAll('.video-attachment video.chat-video');
    allVideos.forEach(video => {
        // ✅ Deshabilitar click derecho
        video.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            return false;
        }, { passive: false });
        
        // ✅ Deshabilitar teclas de acceso rápido
        video.addEventListener('keydown', function(e) {
            // ✅ Bloquear F12, Ctrl+Shift+I, Ctrl+U
            if (e.key === 'F12' || 
                (e.ctrlKey && e.shiftKey && e.key === 'I') ||
                (e.ctrlKey && e.key === 'u')) {
                e.preventDefault();
                return false;
            }
        }, { passive: false });
    });
};

// ✅ FUNCIÓN: Bloquear descarga de videos
window.blockVideoDownload = function() {
    const allVideos = document.querySelectorAll('.video-attachment video.chat-video');
    allVideos.forEach(video => {
        // ✅ Bloquear descarga directa
        video.addEventListener('loadstart', function() {
            // ✅ Remover atributos que permiten descarga
            video.removeAttribute('download');
            // ✅ Remover controlsList temporalmente y volver a aplicarlo
            video.removeAttribute('controlsList');
            video.setAttribute('controlsList', 'nodownload');
            
            // ✅ Solo agregar atributos de reproducción
            video.setAttribute('webkit-playsinline', 'true');
            video.setAttribute('playsinline', 'true');
        });
        
        // ✅ Bloquear eventos de descarga
        video.addEventListener('beforeunload', function(e) {
            e.preventDefault();
            return false;
        }, { passive: false });
        
        // ✅ Bloquear drag and drop de descarga
        video.addEventListener('dragstart', function(e) {
            e.preventDefault();
            return false;
        }, { passive: false });
        
        // ✅ Bloquear click derecho en video
        video.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            return false;
        }, { passive: false });
        
        // ✅ Bloquear teclas de descarga
        video.addEventListener('keydown', function(e) {
            // ✅ Bloquear Ctrl+S, Ctrl+Shift+S, F12
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                return false;
            }
            if (e.key === 'F12') {
                e.preventDefault();
                return false;
            }
        }, { passive: false });
    });
};

// ✅ FUNCIÓN: Verificar si el usuario es admin
window.isUserAdmin = function() {
    // ✅ Verificar por URL
    if (window.location.pathname.includes('/admin/')) {
        return true;
    }
    
    // ✅ Verificar por elementos del DOM
    if (document.querySelector('[data-user-role="admin"]') !== null) {
        return true;
    }
    
    // ✅ Verificar por clases CSS
    if (document.body.classList.contains('admin-user') || 
        document.body.classList.contains('admin-dashboard')) {
        return true;
    }
    
    // ✅ Verificar por texto en la página
    if (document.title.includes('Admin') || 
        document.title.includes('Administrador')) {
        return true;
    }
    
    return false;
};

// ✅ FUNCIÓN: Bloquear click derecho según rol de usuario
window.setupRoleBasedProtection = function() {
    const isAdmin = window.isUserAdmin();
    
    if (isAdmin) {
        // ✅ Admin: Permitir click derecho (puede descargar)
        return;
    }
    
    // ✅ Usuarios normales: Bloquear click derecho en videos
    const allVideos = document.querySelectorAll('.video-attachment video, .file-attachment video');
    allVideos.forEach(video => {
        video.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showInfoMessage('❌ No tienes permisos para descargar este archivo');
            return false;
        }, { passive: false });
        
        // ✅ Bloquear drag and drop
        video.addEventListener('dragstart', function(e) {
            e.preventDefault();
            return false;
        }, { passive: false });
    });
    
    // ✅ NUEVO: Bloquear click derecho en imágenes
    const allImages = document.querySelectorAll('.image-attachment img, .file-attachment img');
    allImages.forEach(img => {
        img.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showInfoMessage('❌ No tienes permisos para descargar este archivo');
            return false;
        }, { passive: false });
        
        // ✅ Bloquear drag and drop de imágenes
        img.addEventListener('dragstart', function(e) {
            e.preventDefault();
            return false;
        }, { passive: false });
        
        // ✅ Deshabilitar arrastrar imagen
        img.setAttribute('draggable', 'false');
    });
    
    // ✅ Bloquear click derecho en contenedores de archivos
    const allFileAttachments = document.querySelectorAll('.file-attachment');
    allFileAttachments.forEach(attachment => {
        attachment.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showInfoMessage('❌ No tienes permisos para descargar este archivo');
            return false;
        }, { passive: false });
    });
};

// ✅ FUNCIÓN ELIMINADA: Controles de velocidad personalizados removidos para restaurar estilo original

// ✅ FUNCIÓN: Ejecutar todos los bloqueos automáticamente
window.setupVideoProtection = function() {
    // ✅ Bloquear menú contextual
    if (typeof disableVideoContextMenu === 'function') {
        disableVideoContextMenu();
    }
    
    // ✅ Bloquear descarga
    if (typeof blockVideoDownload === 'function') {
        blockVideoDownload();
    }
    
    // ✅ Configurar protección adicional
    const allVideos = document.querySelectorAll('.video-attachment video.chat-video');
    allVideos.forEach(video => {
        // ✅ Solo agregar atributos de reproducción (controlsList ya está en displayFileInChat)
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('playsinline', 'true');
        
        // ✅ Optimizar rendimiento del reproductor
        video.setAttribute('preload', 'metadata');
        video.setAttribute('loading', 'lazy');
        
        // ✅ Configurar para evitar violaciones de rendimiento
        video.setAttribute('data-passive-events', 'true');
        
        // ✅ Configurar para mejor rendimiento del reproductor
        video.style.pointerEvents = 'auto';
        video.style.willChange = 'auto';
        
        // ✅ Configurar para evitar violaciones de rendimiento
        video.style.transform = 'translateZ(0)';
        video.style.backfaceVisibility = 'hidden';
        
        // ✅ Configurar para mejor rendimiento
        video.style.touchAction = 'manipulation';
        video.style.userSelect = 'none';
        
        // ✅ Optimizar event listeners del reproductor nativo
        video.addEventListener('wheel', function(e) {
            // Permitir scroll normal en el reproductor
        }, { passive: true });
        
        // ✅ Configurar para evitar violaciones de rendimiento
        video.addEventListener('touchstart', function(e) {
            // Permitir eventos táctiles normales
        }, { passive: true });
        
        video.addEventListener('touchmove', function(e) {
            // Permitir movimiento táctil normal
        }, { passive: true });
        
        // ✅ Bloquear eventos de descarga
        video.addEventListener('loadstart', function() {
            this.removeAttribute('download');
            // ✅ Aplicar controlsList para asegurar que funcione correctamente
            this.setAttribute('controlsList', 'nodownload');
        }, { passive: true });
        
        // Protección configurada para video
    });
    
    // ✅ NUEVO: Aplicar protección basada en rol
    if (typeof setupRoleBasedProtection === 'function') {
        setupRoleBasedProtection();
    }
    
    // ✅ NUEVO: Aplicar protección de imágenes
    if (typeof setupImageProtection === 'function') {
        setupImageProtection();
    }
};

// ✅ FUNCIÓN: Mostrar archivos en el chat (versión unificada)
window.displayFileInChat = function(messageData) {
    if (!messageData.has_attachment || !messageData.attachment_filename) return '';
    
    const fileType = messageData.attachment_type;
    const fileName = messageData.attachment_filename;
    // ✅ CORREGIDO: Usar attachment_path en lugar de attachment_filename para la URL
    const filePath = messageData.attachment_path || fileName;
    const fileUrl = `/tienda/store/static/uploads/chat/${filePath}`;
    
    
    // ✅ CONFIGURACIÓN SIMPLE: Solo usar controles nativos del navegador
    
    if (fileType.startsWith('image/') || isImageFile(fileName)) {
        return `
            <div class="file-attachment image-attachment">
                <img src="${fileUrl}" alt="${fileName}" class="chat-image" onclick="openImageModal('${fileUrl}', '${fileName}')" oncontextmenu="return false;" draggable="false">
            </div>
        `;
    } else if (fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        // ✅ PDF: Vista previa minimalista - solo imagen
        return `
            <div class="file-attachment pdf-attachment">
                <div class="pdf-preview" style="position: relative; width: 100%; max-width: 200px; height: 150px; border-radius: 8px; background: linear-gradient(135deg, #dc3545, #c82333); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.3s ease;" onclick="openPdfModal('${fileUrl}', '${fileName}')" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(0,0,0,0.2)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'">
                    <div style="background: rgba(255,255,255,0.2); border-radius: 50%; padding: 25px;">
                        <i class="fas fa-file-pdf" style="font-size: 48px; color: white; opacity: 0.9;"></i>
                    </div>
                </div>
            </div>
        `;
    } else if (fileType.startsWith('video/') || isVideoFile(fileName)) {
        // ✅ DETECTAR FORMATO REAL DEL ARCHIVO
        const actualFileType = getVideoMimeType(fileName, fileType);
        
        // ✅ MANEJO ESPECIAL PARA ARCHIVOS .MOV - Mismo estilo que MP4
        if (fileName.toLowerCase().endsWith('.mov')) {
            return `
                <div class="file-attachment video-attachment">
                    <video class="chat-video" 
                           preload="metadata" 
                           playsinline 
                           controls 
                           oncontextmenu="return false;" 
                           controlsList="nodownload"
                           style="width: 100%; max-width: 100%; max-height: 250px; height: auto; aspect-ratio: 16/9; border-radius: 8px; background: #000; display: block; object-fit: contain;"
                           onerror="console.error('❌ Error cargando video:', this.src, this.error); this.style.display='none'; this.nextElementSibling.style.display='block';">
                        <source src="${fileUrl}" type="video/quicktime">
                        <source src="${fileUrl}" type="video/mp4">
                        <p>Tu navegador no soporta la reproducción de este video.</p>
                    </video>
                    <div style="display: none; padding: 20px; text-align: center; color: white; background: #000; border-radius: 8px;">
                        <i class="fas fa-play-circle" style="font-size: 48px; margin-bottom: 10px;"></i>
                        <p>Video no compatible</p>
                        <button onclick="window.open('${fileUrl}', '_blank')" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                            Abrir en nueva pestaña
                        </button>
                    </div>
                </div>
            `;
        }
        
        // ✅ DETECTAR FIREFOX PARA MANEJO ESPECIAL
        const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
        
        if (isFirefox) {
            // ✅ FIREFOX: Detección automática por extensión de archivo
            const fileName = fileUrl.split('/').pop().toLowerCase();
            
            // ✅ FORMATOS COMPATIBLES CON FIREFOX (se reproducen en el chat)
            const firefoxCompatibleFormats = [
                '.webm',    // WebM - Excelente compatibilidad
                '.ogg',     // OGG - Buena compatibilidad
                '.ogv',     // OGG Video
                '.avi',     // AVI - Compatible con codecs correctos
                '.mkv',     // Matroska - Compatible
                '.m4v',     // M4V - Compatible
                '.3gp',     // 3GPP - Compatible
                '.flv',     // Flash Video - Compatible
                '.wmv',     // Windows Media - Compatible con codecs
                '.asf',     // Advanced Systems Format
                '.mts',     // AVCHD
                '.m2ts',    // Blu-ray
                '.ts',      // Transport Stream
                '.mxf',     // Material Exchange Format
                '.dv',      // Digital Video
                '.vob',     // DVD Video
                '.divx',    // DivX
                '.xvid',    // Xvid
                '.rm',      // RealMedia
                '.rmvb',    // RealMedia Variable Bitrate
                '.mpg',     // MPEG-1
                '.mpeg',    // MPEG-1/2
                '.m2v',     // MPEG-2 Video
                '.m1v',     // MPEG-1 Video
                '.mp2',     // MPEG-2
                '.mpv',     // MPEG Video
                '.mpe',     // MPEG
                '.mpeg2',   // MPEG-2
                '.mpeg4',   // MPEG-4
                '.mp4v',    // MPEG-4 Video
                '.mpg4',    // MPEG-4
                '.h264',    // H.264
                '.h265',    // H.265/HEVC
                '.hevc',    // HEVC
                '.vp8',     // VP8
                '.vp9',     // VP9
                '.av1',     // AV1
                '.theora',  // Theora
                '.dirac',   // Dirac
                '.mjpeg',   // Motion JPEG
                '.mjpg',    // Motion JPEG
                '.m4a',     // MPEG-4 Audio (puede contener video)
                '.aac',     // Advanced Audio Coding
                '.ac3',     // Audio Codec 3
                '.dts',     // DTS Audio
                '.flac',    // Free Lossless Audio Codec
                '.ape',     // Monkey's Audio
                '.wav',     // Waveform Audio
                '.aiff',    // Audio Interchange File Format
                '.au',      // Audio
                '.ra',      // RealAudio
                '.wma',     // Windows Media Audio
                '.opus',    // Opus Audio
                '.vorbis',  // Vorbis Audio
                '.speex',   // Speex Audio
                '.gsm',     // Global System for Mobile
                '.amr',     // Adaptive Multi-Rate
                '.3ga',     // 3GPP Audio
                '.aac',     // Advanced Audio Coding
                '.mp3',     // MPEG-1 Audio Layer 3
                '.mp2',     // MPEG-1 Audio Layer 2
                '.mp1',     // MPEG-1 Audio Layer 1
                '.mpa',     // MPEG Audio
                '.m4p',     // MPEG-4 Protected
                '.m4b',     // MPEG-4 Audiobook
                '.m4r',     // MPEG-4 Ringtone
                '.aif',     // Audio Interchange File
                '.aifc',    // Audio Interchange File Compressed
                '.caf',     // Core Audio Format
                '.adts',    // Audio Data Transport Stream
                '.adif',    // Audio Data Interchange Format
                '.snd',     // Sound
                '.pcm',     // Pulse Code Modulation
                '.raw',     // Raw Audio
                '.dat',     // Data
                '.pva',     // Power Video Audio
                '.aa',      // Audible Audio
                '.aax',     // Audible Enhanced Audio
                '.aac',     // Advanced Audio Coding
                '.aiff',    // Audio Interchange File Format
                '.ape',     // Monkey's Audio
                '.au',      // Audio
                '.flac',    // Free Lossless Audio Codec
                '.gsm',     // Global System for Mobile
                '.it',      // Impulse Tracker
                '.m4a',     // MPEG-4 Audio
                '.m4b',     // MPEG-4 Audiobook
                '.m4p',     // MPEG-4 Protected
                '.m4r',     // MPEG-4 Ringtone
                '.mmf',     // Mobile Music File
                '.mp3',     // MPEG-1 Audio Layer 3
                '.mpc',     // Musepack
                '.msv',     // Memory Stick Voice
                '.nmf',     // NMF
                '.ogg',     // OGG
                '.opus',    // Opus
                '.ra',      // RealAudio
                '.raw',     // Raw Audio
                '.rf64',    // RF64
                '.rm',      // RealMedia
                '.s3m',     // ScreamTracker 3
                '.sln',     // Signed Linear
                '.tta',     // True Audio
                '.voc',     // Voice
                '.vox',     // VOX
                '.w64',     // Wave64
                '.wav',     // Waveform Audio
                '.wma',     // Windows Media Audio
                '.wv',      // WavPack
                '.xa',      // XA
                '.xwav'     // XWAV
            ];
            
            // ✅ FORMATOS INCOMPATIBLES CON FIREFOX (van a nueva pestaña)
            const firefoxIncompatibleFormats = [
                '.mp4',     // MP4 - Problemas de codec en Firefox
                '.m4v',     // M4V - Depende del codec
                '.mov',     // MOV - Depende del codec
                '.avi',     // AVI - Depende del codec
                '.wmv',     // WMV - Depende del codec
                '.flv',     // FLV - Depende del codec
                '.mkv',     // MKV - Depende del codec
                '.3gp',     // 3GPP - Depende del codec
                '.asf',     // ASF - Depende del codec
                '.mts',     // MTS - Depende del codec
                '.m2ts',    // M2TS - Depende del codec
                '.ts',      // TS - Depende del codec
                '.mxf',     // MXF - Depende del codec
                '.dv',      // DV - Depende del codec
                '.vob',     // VOB - Depende del codec
                '.divx',    // DivX - Depende del codec
                '.xvid',    // Xvid - Depende del codec
                '.rm',      // RealMedia - Depende del codec
                '.rmvb',    // RealMedia - Depende del codec
                '.mpg',     // MPEG - Depende del codec
                '.mpeg',    // MPEG - Depende del codec
                '.m2v',     // MPEG-2 - Depende del codec
                '.m1v',     // MPEG-1 - Depende del codec
                '.mp2',     // MPEG-2 - Depende del codec
                '.mpv',     // MPEG - Depende del codec
                '.mpe',     // MPEG - Depende del codec
                '.mpeg2',   // MPEG-2 - Depende del codec
                '.mpeg4',   // MPEG-4 - Depende del codec
                '.mp4v',    // MPEG-4 - Depende del codec
                '.mpg4',    // MPEG-4 - Depende del codec
                '.h264',    // H.264 - Depende del codec
                '.h265',    // H.265 - Depende del codec
                '.hevc',    // HEVC - Depende del codec
                '.vp8',     // VP8 - Depende del codec
                '.vp9',     // VP9 - Depende del codec
                '.av1',     // AV1 - Depende del codec
                '.theora',  // Theora - Depende del codec
                '.dirac',   // Dirac - Depende del codec
                '.mjpeg',   // Motion JPEG - Depende del codec
                '.mjpg'     // Motion JPEG - Depende del codec
            ];
            
            // ✅ DETECTAR COMPATIBILIDAD
            const isCompatible = firefoxCompatibleFormats.some(format => fileName.endsWith(format));
            const isIncompatible = firefoxIncompatibleFormats.some(format => fileName.endsWith(format));
            
            if (isIncompatible) {
                // ✅ FORMATOS INCOMPATIBLES: Mostrar opción de nueva pestaña
                const formatName = fileName.split('.').pop().toUpperCase();
                return `
                    <div class="file-attachment video-attachment">
                        <div style="padding: 20px; text-align: center; background: #e3f2fd; border-radius: 8px; border: 1px solid #2196f3; margin: 10px 0;">
                            <i class="fas fa-video" style="color: #2196f3; font-size: 24px; margin-bottom: 10px;"></i>
                            <p style="margin: 0 0 10px 0; color: #1976d2; font-weight: 500;">Video ${formatName} disponible</p>
                            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Este formato no se puede reproducir directamente en Firefox</p>
                            <button onclick="tryVideoInNewTab('${fileUrl}')" class="btn btn-primary btn-sm" style="background: #2196f3; border: none; padding: 8px 16px; border-radius: 4px; color: white; text-decoration: none; display: inline-block;">
                                <i class="fas fa-external-link-alt"></i> Abrir en nueva pestaña
                            </button>
                        </div>
                    </div>
                `;
            } else {
                // ✅ FORMATOS COMPATIBLES: Intentar reproducir en el chat
                return `
                    <div class="file-attachment video-attachment">
                        <video class="chat-video" 
                               preload="metadata" 
                               playsinline 
                               controls 
                               oncontextmenu="return false;" 
                               controlsList="nodownload"
                               onerror="handleFirefoxVideoError(this, '${fileUrl}')"
                               style="width: 100%; max-width: 100%; max-height: 250px; height: auto; aspect-ratio: 16/9; border-radius: 8px; background: #000; display: block; object-fit: contain;">
                            <source src="${fileUrl}" type="${actualFileType}">
                            <p>Tu navegador no soporta la reproducción de este video.</p>
                        </video>
                    </div>
                `;
            }
        } else {
            // ✅ OTROS NAVEGADORES: Video normal
            return `
                <div class="file-attachment video-attachment">
                    <video class="chat-video" 
                           preload="metadata" 
                           playsinline 
                           controls 
                           oncontextmenu="return false;" 
                           controlsList="nodownload"
                           onerror="handleVideoError(this, '${fileUrl}')">
                        <!-- ✅ USAR ARCHIVO ORIGINAL CON TIPO MIME CORRECTO -->
                        <source src="${fileUrl}" type="${actualFileType}">
                        <!-- ✅ MENSAJE DE FALLO -->
                        <p>Tu navegador no soporta la reproducción de este video. 
                           <a href="${fileUrl}" download>Descargar video</a>
                        </p>
                    </video>
                </div>
            `;
        }
    } else if (fileType.startsWith('audio/')) {
        // El audio ya se maneja en la función existente
        return '';
    } else {
        // ✅ NUEVO: Visualización mejorada y comprimida para archivos genéricos
        const fileSize = messageData.attachment_size ? formatFileSize(messageData.attachment_size) : '';
        const truncatedFileName = fileName.length > 25 ? fileName.substring(0, 22) + '...' : fileName;
        
        return `
            <div class="file-attachment generic-attachment">
                <div class="file-header">
                    <div class="file-info">
                        <div class="file-name-compact">${truncatedFileName}</div>
                        <div class="file-details">
                            <span class="file-type">${getFileTypeName(fileType)}</span>
                            ${fileSize ? `<span class="file-size">${fileSize}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="file-preview-btn" onclick="previewGenericFile('${fileUrl}', '${fileName}', '${fileType}')">
                        <i class="fas fa-external-link-alt"></i>
                    </button>
                    <a href="${fileUrl}" download="${fileName}" class="file-download-btn" title="Descargar ${fileName}">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
            </div>
        `;
    }
};

// ✅ FUNCIÓN AUXILIAR: Detectar si es archivo de video por extensión
function isVideoFile(fileName) {
    if (!fileName) return false;
    
    // ✅ TODOS LOS FORMATOS DE VIDEO Y AUDIO SOPORTADOS
    const videoExtensions = [
        // ✅ FORMATOS DE VIDEO PRINCIPALES
        '.mp4', '.webm', '.ogg', '.ogv', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.m4v', '.3gp',
        '.asf', '.mts', '.m2ts', '.ts', '.mxf', '.dv', '.vob', '.divx', '.xvid', '.rm', '.rmvb',
        '.mpg', '.mpeg', '.m2v', '.m1v', '.mp2', '.mpv', '.mpe', '.mpeg2', '.mpeg4', '.mp4v', '.mpg4',
        '.h264', '.h265', '.hevc', '.vp8', '.vp9', '.av1', '.theora', '.dirac', '.mjpeg', '.mjpg',
        
        // ✅ FORMATOS DE AUDIO (pueden contener video)
        '.m4a', '.aac', '.ac3', '.dts', '.flac', '.ape', '.wav', '.aiff', '.au', '.ra', '.wma',
        '.opus', '.vorbis', '.speex', '.gsm', '.amr', '.3ga', '.mp3', '.mp2', '.mp1', '.mpa',
        '.m4p', '.m4b', '.m4r', '.aif', '.aifc', '.caf', '.adts', '.adif', '.snd', '.pcm',
        '.raw', '.dat', '.pva', '.aa', '.aax', '.it', '.mmf', '.mpc', '.msv', '.nmf',
        '.rf64', '.s3m', '.sln', '.tta', '.voc', '.vox', '.w64', '.wv', '.xa', '.xwav'
    ];
    
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return videoExtensions.includes(extension);
}

// ✅ FUNCIÓN AUXILIAR: Detectar si es archivo de imagen por extensión
function isImageFile(fileName) {
    if (!fileName) return false;
    
    // ✅ TODOS LOS FORMATOS DE IMAGEN SOPORTADOS
    const imageExtensions = [
        // ✅ FORMATOS DE IMAGEN PRINCIPALES
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg', '.ico',
        '.psd', '.ai', '.eps', '.raw', '.cr2', '.nef', '.arw', '.dng', '.orf',
        '.rw2', '.pef', '.srw', '.x3f', '.mrw', '.erf', '.kdc', '.dcr', '.mos', '.mef',
        '.raf', '.srf', '.srw', '.x3f', '.mrw', '.erf', '.kdc', '.dcr', '.mos', '.mef',
        '.raf', '.srf', '.srw', '.x3f', '.mrw', '.erf', '.kdc', '.dcr', '.mos', '.mef',
        
        // ✅ FORMATOS DE IMAGEN VECTORIALES
        '.svg', '.ai', '.eps', '.ps', '.sketch', '.fig', '.xd', '.afdesign', '.cdr',
        
        // ✅ FORMATOS DE IMAGEN RASTER
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.ico',
        '.tga', '.pcx', '.ppm', '.pgm', '.pbm', '.pnm', '.hdr', '.exr', '.dds',
        '.ktx', '.astc', '.bpg', '.heif', '.heic', '.avif', '.jxl', '.j2k', '.jp2',
        '.jpx', '.jpf', '.jpm', '.mj2', '.mjp2', '.j2c', '.j2k', '.jpc', '.jpx',
        
        // ✅ FORMATOS DE IMAGEN RAW
        '.raw', '.cr2', '.nef', '.arw', '.dng', '.orf', '.rw2', '.pef', '.srw',
        '.x3f', '.mrw', '.erf', '.kdc', '.dcr', '.mos', '.mef', '.raf', '.srf',
        '.srw', '.x3f', '.mrw', '.erf', '.kdc', '.dcr', '.mos', '.mef', '.raf',
        '.srf', '.srw', '.x3f', '.mrw', '.erf', '.kdc', '.dcr', '.mos', '.mef',
        
        // ✅ FORMATOS DE IMAGEN ESPECIALES
        '.psd', '.xcf', '.kra', '.ora', '.cpt', '.pdn', '.gimp', '.blend', '.max',
        '.3ds', '.obj', '.fbx', '.dae', '.x3d', '.wrl', '.ply', '.stl', '.off',
        '.3dm', '.3dmf', '.x', '.ase', '.ply', '.ply2', '.plyz', '.plyx', '.plyy',
        '.plyz', '.plyx', '.plyy', '.plyz', '.plyx', '.plyy', '.plyz', '.plyx',
        
        // ✅ FORMATOS DE IMAGEN WEB
        '.webp', '.avif', '.jxl', '.heif', '.heic', '.bpg', '.flif', '.flic',
        '.mng', '.apng', '.webp', '.avif', '.jxl', '.heif', '.heic', '.bpg',
        
        // ✅ FORMATOS DE IMAGEN LEGACY
        '.pcx', '.tga', '.sgi', '.rgb', '.rgba', '.bw', '.int', '.inta', '.bw',
        '.int', '.inta', '.bw', '.int', '.inta', '.bw', '.int', '.inta', '.bw',
        
        // ✅ FORMATOS DE IMAGEN CIENTÍFICOS
        '.fits', '.fit', '.fts', '.fits', '.fit', '.fts', '.fits', '.fit', '.fts',
        '.hdf', '.hdf5', '.nc', '.cdf', '.hdf', '.hdf5', '.nc', '.cdf', '.hdf',
        
        // ✅ FORMATOS DE IMAGEN MÉDICOS
        '.dcm', '.dicom', '.ima', '.dcm', '.dicom', '.ima', '.dcm', '.dicom',
        '.ima', '.dcm', '.dicom', '.ima', '.dcm', '.dicom', '.ima', '.dcm',
        
        // ✅ FORMATOS DE IMAGEN ESPECIALIZADOS
        '.xbm', '.xpm', '.pnm', '.pgm', '.ppm', '.pbm', '.pnm', '.pgm', '.ppm',
        '.pbm', '.pnm', '.pgm', '.ppm', '.pbm', '.pnm', '.pgm', '.ppm', '.pbm',
        
        // ✅ FORMATOS DE IMAGEN COMPRIMIDOS
        '.lz4', '.zstd', '.brotli', '.lz4', '.zstd', '.brotli', '.lz4', '.zstd',
        '.brotli', '.lz4', '.zstd', '.brotli', '.lz4', '.zstd', '.brotli', '.lz4',
        
        // ✅ FORMATOS DE IMAGEN MÓVILES
        '.heic', '.heif', '.avif', '.jxl', '.bpg', '.flif', '.mng', '.apng',
        '.webp', '.avif', '.jxl', '.heif', '.heic', '.bpg', '.flif', '.mng',
        
        // ✅ FORMATOS DE IMAGEN PROFESIONALES
        '.cpi', '.cpt', '.psp', '.pspimage', '.psb', '.psd', '.xcf', '.kra',
        '.ora', '.cpt', '.pdn', '.gimp', '.blend', '.max', '.3ds', '.obj',
        
        // ✅ FORMATOS DE IMAGEN VECTORIALES AVANZADOS
        '.cdr', '.cmx', '.ai', '.eps', '.ps', '.sketch', '.fig', '.xd', '.afdesign',
        '.cdr', '.cmx', '.ai', '.eps', '.ps', '.sketch', '.fig', '.xd', '.afdesign',
        
        // ✅ FORMATOS DE IMAGEN 3D
        '.obj', '.fbx', '.dae', '.x3d', '.wrl', '.ply', '.stl', '.off', '.3dm',
        '.3dmf', '.x', '.ase', '.ply', '.ply2', '.plyz', '.plyx', '.plyy', '.plyz',
        
        // ✅ FORMATOS DE IMAGEN ESPECIALES
        '.ico', '.cur', '.ani', '.icns', '.ico', '.cur', '.ani', '.icns', '.ico',
        '.cur', '.ani', '.icns', '.ico', '.cur', '.ani', '.icns', '.ico', '.cur',
        
        // ✅ FORMATOS DE IMAGEN WEB AVANZADOS
        '.webp', '.avif', '.jxl', '.heif', '.heic', '.bpg', '.flif', '.mng', '.apng',
        '.webp', '.avif', '.jxl', '.heif', '.heic', '.bpg', '.flif', '.mng', '.apng'
    ];
    
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return imageExtensions.includes(extension);
}

// ✅ FUNCIÓN AUXILIAR: Obtener tipo MIME correcto del video
function getVideoMimeType(fileName, originalFileType) {
    // Si ya tenemos un tipo MIME válido, usarlo
    if (originalFileType && originalFileType.startsWith('video/')) {
        return originalFileType;
    }
    
    // Detectar por extensión de archivo
    if (!fileName) return 'video/mp4'; // Fallback por defecto
    
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    
    const mimeTypes = {
        // ✅ FORMATOS DE VIDEO
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.ogv': 'video/ogg',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.mkv': 'video/x-matroska',
        '.m4v': 'video/x-m4v',
        '.3gp': 'video/3gpp',
        '.asf': 'video/x-ms-asf',
        '.mts': 'video/mp2t',
        '.m2ts': 'video/mp2t',
        '.ts': 'video/mp2t',
        '.mxf': 'application/mxf',
        '.dv': 'video/dv',
        '.vob': 'video/dvd',
        '.divx': 'video/divx',
        '.xvid': 'video/xvid',
        '.rm': 'video/vnd.rn-realvideo',
        '.rmvb': 'video/vnd.rn-realvideo',
        '.mpg': 'video/mpeg',
        '.mpeg': 'video/mpeg',
        '.m2v': 'video/mpeg',
        '.m1v': 'video/mpeg',
        '.mp2': 'video/mpeg',
        '.mpv': 'video/mpeg',
        '.mpe': 'video/mpeg',
        '.mpeg2': 'video/mpeg',
        '.mpeg4': 'video/mp4',
        '.mp4v': 'video/mp4',
        '.mpg4': 'video/mp4',
        '.h264': 'video/h264',
        '.h265': 'video/h265',
        '.hevc': 'video/hevc',
        '.vp8': 'video/vp8',
        '.vp9': 'video/vp9',
        '.av1': 'video/av1',
        '.theora': 'video/theora',
        '.dirac': 'video/dirac',
        '.mjpeg': 'video/mjpeg',
        '.mjpg': 'video/mjpeg',
        
        // ✅ FORMATOS DE AUDIO
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.ac3': 'audio/ac3',
        '.dts': 'audio/dts',
        '.flac': 'audio/flac',
        '.ape': 'audio/ape',
        '.wav': 'audio/wav',
        '.aiff': 'audio/aiff',
        '.au': 'audio/basic',
        '.ra': 'audio/vnd.rn-realaudio',
        '.wma': 'audio/x-ms-wma',
        '.opus': 'audio/opus',
        '.vorbis': 'audio/vorbis',
        '.speex': 'audio/speex',
        '.gsm': 'audio/gsm',
        '.amr': 'audio/amr',
        '.3ga': 'audio/3gpp',
        '.mp3': 'audio/mpeg',
        '.mp2': 'audio/mpeg',
        '.mp1': 'audio/mpeg',
        '.mpa': 'audio/mpeg',
        '.m4p': 'audio/mp4',
        '.m4b': 'audio/mp4',
        '.m4r': 'audio/mp4',
        '.aif': 'audio/aiff',
        '.aifc': 'audio/aiff',
        '.caf': 'audio/x-caf',
        '.adts': 'audio/aac',
        '.adif': 'audio/aac',
        '.snd': 'audio/basic',
        '.pcm': 'audio/pcm',
        '.raw': 'audio/raw',
        '.dat': 'audio/dat',
        '.pva': 'audio/pva',
        '.aa': 'audio/audible',
        '.aax': 'audio/audible',
        '.it': 'audio/it',
        '.mmf': 'audio/mmf',
        '.mpc': 'audio/musepack',
        '.msv': 'audio/msv',
        '.nmf': 'audio/nmf',
        '.rf64': 'audio/rf64',
        '.s3m': 'audio/s3m',
        '.sln': 'audio/sln',
        '.tta': 'audio/tta',
        '.voc': 'audio/voc',
        '.vox': 'audio/vox',
        '.w64': 'audio/w64',
        '.wv': 'audio/wavpack',
        '.xa': 'audio/xa',
        '.xwav': 'audio/xwav'
    };
    
    return mimeTypes[extension] || 'video/mp4';
}

// ✅ FUNCIÓN AUXILIAR: Detectar soporte de formatos de video
function getSupportedVideoFormats() {
    const video = document.createElement('video');
    const formats = [];
    
    // Probar MP4
    if (video.canPlayType('video/mp4')) {
        formats.push('mp4');
    }
    
    // Probar WebM
    if (video.canPlayType('video/webm')) {
        formats.push('webm');
    }
    
    // Probar OGG
    if (video.canPlayType('video/ogg')) {
        formats.push('ogg');
    }
    
    return formats;
}


// ✅ FUNCIÓN: Manejar errores de video
window.handleVideoError = function(videoElement, originalUrl) {
    
    // Ocultar el video que falló
    videoElement.style.display = 'none';
    
    // Crear mensaje de error más amigable
    const errorMessage = document.createElement('div');
    errorMessage.className = 'video-error-message';
    errorMessage.innerHTML = `
        <div style="padding: 20px; text-align: center; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
            <i class="fas fa-exclamation-triangle" style="color: #ffc107; font-size: 24px; margin-bottom: 10px;"></i>
            <p style="margin: 0 0 10px 0; color: #6c757d;">No se puede reproducir este video</p>
            <a href="${originalUrl}" download class="btn btn-primary btn-sm">
                <i class="fas fa-download"></i> Descargar video
            </a>
        </div>
    `;
    
    // Insertar el mensaje después del video
    videoElement.parentNode.insertBefore(errorMessage, videoElement.nextSibling);
}


// ✅ FUNCIÓN: Manejar errores específicos de Firefox
window.handleFirefoxVideoError = function(videoElement, originalUrl) {
    
    // Ocultar el video que falló
    videoElement.style.display = 'none';
    
    // Crear mensaje con opciones
    const errorMessage = document.createElement('div');
    errorMessage.className = 'firefox-video-error-message';
    errorMessage.innerHTML = `
        <div style="padding: 20px; text-align: center; background: #e3f2fd; border-radius: 8px; border: 1px solid #2196f3; margin: 10px 0;">
            <i class="fas fa-video" style="color: #2196f3; font-size: 24px; margin-bottom: 10px;"></i>
            <p style="margin: 0 0 10px 0; color: #1976d2; font-weight: 500;">Video disponible</p>
            <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">Este video no se puede reproducir directamente en Firefox</p>
            <button onclick="tryVideoInNewTab('${originalUrl}')" class="btn btn-primary btn-sm" style="background: #2196f3; border: none; padding: 8px 16px; border-radius: 4px; color: white; text-decoration: none; display: inline-block;">
                <i class="fas fa-external-link-alt"></i> Abrir en nueva pestaña
            </button>
        </div>
    `;
    
    // Insertar el mensaje después del video
    videoElement.parentNode.insertBefore(errorMessage, videoElement.nextSibling);
}

// ✅ FUNCIÓN: Intentar abrir video en nueva pestaña (para Firefox)
window.tryVideoInNewTab = function(videoUrl) {
    
    // Abrir en nueva pestaña
    const newWindow = window.open(videoUrl, '_blank');
    
    if (!newWindow) {
        // Si no se puede abrir (popup bloqueado), mostrar mensaje
        alert('No se pudo abrir el video en una nueva pestaña. Por favor, permite ventanas emergentes para este sitio.');
    }
}

// ✅ FUNCIÓN: Abrir PDF en nueva pestaña
window.openPdfInNewTab = function(pdfUrl) {
    
    // Abrir en nueva pestaña
    const newWindow = window.open(pdfUrl, '_blank');
    
    if (!newWindow) {
        // Si no se puede abrir (popup bloqueado), mostrar mensaje
        alert('No se pudo abrir el PDF en una nueva pestaña. Por favor, permite ventanas emergentes para este sitio.');
    }
}

// ✅ FUNCIÓN: Abrir PDF en modal (similar a openImageModal)
window.openPdfModal = function(pdfUrl, fileName) {
    
    // Crear modal
    const modal = document.createElement('div');
    modal.id = 'pdfModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
    `;
    
    modal.innerHTML = `
        <div style="
            background: white;
            border-radius: 8px;
            width: 100%;
            max-width: 90vw;
            height: 90vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        ">
            <div style="
                padding: 8px 15px;
                background: #f8f9fa;
                border-bottom: 1px solid #dee2e6;
                display: flex;
                justify-content: flex-end;
                align-items: center;
            ">
                <button onclick="closePdfModal()" class="btn btn-sm btn-outline-secondary" style="padding: 6px 12px;">
                    <i class="fas fa-times"></i> Cerrar
                </button>
            </div>
            <div style="flex: 1; overflow: hidden;">
                <iframe src="${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&zoom=FitH&view=FitH&pagemode=none&disableprint=1&disablesave=1&disableopenfile=1&disablebookmark=1&disablefullscreen=1&disableannotation=1&disablecopy=1&disablemodify=1&disableprint=1&disablesave=1&disableopenfile=1&disablebookmark=1&disablefullscreen=1&disableannotation=1&disablecopy=1&disablemodify=1" 
                        style="width: 100%; height: 100%; border: none;"
                        oncontextmenu="return false;">
                </iframe>
            </div>
        </div>
    `;
    
    // Agregar al body
    document.body.appendChild(modal);
    
    // Cerrar con ESC
    const handleKeyPress = (e) => {
        if (e.key === 'Escape') {
            closePdfModal();
        }
    };
    document.addEventListener('keydown', handleKeyPress);
    
    // Cerrar al hacer clic fuera del modal
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closePdfModal();
        }
    });
    
    // ✅ NUEVO: Bloquear clic derecho en todo el modal
    modal.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showInfoMessage('❌ No tienes permisos para descargar este archivo');
        return false;
    });
    
    // ✅ NUEVO: Bloquear teclas de descarga en el modal
    modal.addEventListener('keydown', (e) => {
        // Bloquear Ctrl+S, Ctrl+Shift+S, F12, Ctrl+P
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            showInfoMessage('❌ No tienes permisos para descargar este archivo');
            return false;
        }
        if (e.key === 'F12' || e.key === 'PrintScreen') {
            e.preventDefault();
            showInfoMessage('❌ No tienes permisos para descargar este archivo');
            return false;
        }
    });
    
    // ✅ NUEVO: Bloquear drag and drop en el modal
    modal.addEventListener('dragstart', (e) => {
        e.preventDefault();
        return false;
    });
    
    // ✅ NUEVO: Bloquear selección de texto en el modal
    modal.addEventListener('selectstart', (e) => {
        e.preventDefault();
        return false;
    });
}

// ✅ FUNCIÓN: Cerrar modal de PDF
window.closePdfModal = function() {
    const modal = document.getElementById('pdfModal');
    if (modal) {
        modal.remove();
    }
}

// ✅ FUNCIÓN: Manejar carga exitosa del PDF
window.handlePdfLoad = function(iframe, pdfUrl) {
    
    // Ocultar indicador de carga si existe
    const container = iframe.closest('.pdf-viewer-container');
    const loadingIndicator = container.querySelector('.pdf-loading');
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
    
    // Mostrar el iframe
    iframe.style.display = 'block';
}

// ✅ FUNCIÓN: Manejar error de carga del PDF
window.handlePdfError = function(iframe, pdfUrl) {
    
    // Ocultar el iframe
    iframe.style.display = 'none';
    
    // Mostrar mensaje de error
    const container = iframe.closest('.pdf-viewer-container');
    const pdfViewer = container.querySelector('.pdf-viewer');
    
    pdfViewer.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #6c757d;">
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ffc107; margin-bottom: 20px;"></i>
            <h5 style="margin-bottom: 15px;">No se puede mostrar el PDF</h5>
            <p style="margin-bottom: 20px;">El navegador no puede cargar este archivo PDF directamente.</p>
                            <div>
                                <button onclick="openPdfInNewTab('${pdfUrl}')" class="btn btn-primary">
                                    <i class="fas fa-external-link-alt"></i> Abrir en nueva pestaña
                                </button>
                            </div>
        </div>
    `;
}

// ✅ FUNCIÓN: Proteger imágenes existentes y nuevas
window.setupImageProtection = function() {
    // ✅ Proteger imágenes existentes
    const allImages = document.querySelectorAll('.image-attachment img, .file-attachment img');
    allImages.forEach(img => {
        // ✅ Bloquear click derecho
        img.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showInfoMessage('❌ No tienes permisos para descargar este archivo');
            return false;
        });
        
        // ✅ Bloquear drag and drop
        img.addEventListener('dragstart', function(e) {
            e.preventDefault();
            return false;
        });
        
        // ✅ Deshabilitar arrastrar imagen
        img.setAttribute('draggable', 'false');
        
        // ✅ Bloquear teclas de descarga
        img.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                showInfoMessage('❌ No tienes permisos para descargar este archivo');
                return false;
            }
        });
    });
};

// ✅ FUNCIÓN AUXILIAR: Obtener icono según tipo de archivo
function getFileIcon(fileType) {
    if (fileType.includes('pdf')) return '<i class="fas fa-file-pdf"></i>';
    if (fileType.includes('word') || fileType.includes('document')) return '<i class="fas fa-file-word"></i>';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '<i class="fas fa-file-excel"></i>';
    if (fileType.includes('text')) return '<i class="fas fa-file-alt"></i>';
    if (fileType.includes('zip') || fileType.includes('rar')) return '<i class="fas fa-file-archive"></i>';
    return '<i class="fas fa-file"></i>';
}

// ✅ FUNCIÓN AUXILIAR: Obtener nombre legible del tipo de archivo
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

// ✅ FUNCIÓN AUXILIAR: Formatear tamaño de archivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ✅ FUNCIÓN: Mostrar error de duración de audio
window.showAudioDurationError = function() {
    // Crear mensaje de error temporal
    const errorMessage = document.createElement('div');
    errorMessage.className = 'message error-message temp-message';
    errorMessage.innerHTML = `
        <div class="message-content">
            <div class="audio-error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Error: Mensaje de menos de 1 segundo. Graba un audio más largo.</span>
            </div>
        </div>
    `;
    
    // Insertar en el chat
    const chatMessagesArea = document.querySelector('#chatMessagesArea');
    if (chatMessagesArea) {
        chatMessagesArea.appendChild(errorMessage);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        
        // Remover después de 5 segundos
        setTimeout(() => {
            if (errorMessage.parentNode) {
                errorMessage.parentNode.removeChild(errorMessage);
            }
        }, 5000);
    }
};

// ✅ FUNCIÓN: Mostrar audio directamente en el chat
window.showAudioPreviewModal = function(audioBlob, tempMessageId) {
    
    // Crear mensaje de audio temporal en el chat
    const audioMessage = document.createElement('div');
    audioMessage.className = 'message audio-message temp-message';
    audioMessage.id = `audio-${tempMessageId}`;
    
    audioMessage.innerHTML = `
        <div class="message-content">
            <div class="audio-player-sent">
                <button class="play-pause-btn-sent" id="playPauseBtn-${tempMessageId}">
                    <i class="fas fa-play"></i>
                </button>
                <div class="audio-info-sent">
                    <span class="audio-duration-sent">--:--</span>
                    <span class="audio-speed-sent" style="display: none;">1x</span>
                </div>
                <div class="audio-controls-sent">
                    <button class="speed-toggle-btn-sent" id="speedToggleBtn-${tempMessageId}" title="Velocidad: 1x">
                        <i class="fas fa-tachometer-alt"></i>
                    </button>
                </div>
                <div class="audio-actions-preview">
                    <button class="send-audio-btn-preview" id="sendAudioBtn-${tempMessageId}" title="Enviar audio">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                    <button class="cancel-audio-btn-preview" id="cancelAudioBtn-${tempMessageId}" title="Cancelar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // ✅ NUEVO: Insertar el mensaje temporal justo antes del área de entrada del chat
    const chatInputArea = document.querySelector('.chat-input-area');
    if (chatInputArea && chatInputArea.parentNode) {
        chatInputArea.parentNode.insertBefore(audioMessage, chatInputArea);
        chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
    }
    
    // Crear elemento de audio oculto
    const audioElement = document.createElement('audio');
    audioElement.id = `audio-preview-${tempMessageId}`;
    audioElement.src = URL.createObjectURL(audioBlob);
    audioElement.preload = 'metadata';
    document.body.appendChild(audioElement);
    
    // ✅ NUEVO: Usar requestAnimationFrame para asegurar que el DOM esté listo
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setupAudioControls(audioElement, tempMessageId, audioBlob);
        });
    });
    
};

// ✅ FUNCIÓN AUXILIAR: Configurar controles de audio
function setupAudioControls(audioElement, tempMessageId, audioBlob) {
    // Verificar que el elemento padre existe
    const audioMessage = document.querySelector(`#audio-${tempMessageId}`);
    
    if (!audioMessage) {
        return;
    }
    
    // ✅ SIMPLIFICADO: Usar solo selectores de clase que sabemos que funcionan
    const playPauseBtn = document.querySelector(`#playPauseBtn-${tempMessageId}`);
    const speedToggleBtn = document.querySelector(`#speedToggleBtn-${tempMessageId}`);
    const speedSpan = document.querySelector(`#audio-${tempMessageId} .audio-speed-sent`);
    const finalSendBtn = document.querySelector(`#audio-${tempMessageId} .send-audio-btn-preview`);
    const finalCancelBtn = document.querySelector(`#audio-${tempMessageId} .cancel-audio-btn-preview`);
    
    if (!playPauseBtn || !speedToggleBtn || !speedSpan || !finalSendBtn || !finalCancelBtn) {
        return;
    }
    
    // Array de velocidades disponibles
    const speeds = [1, 1.25, 1.5, 2];
    let currentSpeedIndex = 0;
    
    // Botón play/pause
    playPauseBtn.addEventListener('click', function() {
        if (audioElement.paused) {
            audioElement.play();
            playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        } else {
            audioElement.pause();
            playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        }
    });
    
    // Control de velocidad
    speedToggleBtn.addEventListener('click', function() {
        currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
        const newSpeed = speeds[currentSpeedIndex];
        
        audioElement.playbackRate = newSpeed;
        speedToggleBtn.title = `Velocidad: ${newSpeed}x`;
        speedSpan.textContent = newSpeed + 'x';
        speedSpan.style.display = 'inline';
    });
    
    // Actualizar duración
    audioElement.addEventListener('loadedmetadata', function() {
        const duration = Math.floor(audioElement.duration);
        if (duration && isFinite(duration)) {
            const durationSpan = document.querySelector(`#audio-${tempMessageId} .audio-duration-sent`);
            if (durationSpan) {
                durationSpan.textContent = formatTime(duration);
            }
        }
    });
    
    // Botón enviar
    finalSendBtn.addEventListener('click', function(e) {
        
        // Si es usuario normal, usar la función de chat_unified.js
        if (window.chatCurrentUserId && !window.dashboardCurrentUserId) {
            if (typeof window.sendAudioMessage === 'function') {
                window.sendAudioMessage(audioBlob, tempMessageId);
            } else {
                alert('Error: Función de envío de audio no disponible');
            }
            return;
        }
        
        // Verificar conexión SocketIO
        const socket = window.socket || window.socket;
        if (!socket || !socket.connected) {
            alert('Error: No se puede enviar audio. Verifica la conexión.');
            return;
        }
        
        // Convertir audio a base64
        const reader = new FileReader();
        reader.onload = function(e) {
            const audioData = e.target.result.split(',')[1]; // Remover el prefijo data:audio/...
            
            // Detectar tipo de archivo
            const extension = audioBlob.type.includes('webm') ? '.webm' : 
                             audioBlob.type.includes('mp4') ? '.mp4' : 
                             audioBlob.type.includes('ogg') ? '.ogg' : '.wav';
            
            // Detectar tipo de usuario y configurar IDs correctos
            let senderId, recipientId, messageType;
            
            if (window.dashboardCurrentUserId) {
                // Admin/soporte
                const isSupportUser = document.querySelector('meta[name="is-support"]')?.content === 'true';
                senderId = window.dashboardCurrentUserId;
                recipientId = window.getCurrentChatUserId ? window.getCurrentChatUserId() : '2';
                messageType = isSupportUser ? 'support' : 'admin';
            } else if (window.chatCurrentUserId) {
                // Usuario normal
                senderId = window.chatCurrentUserId;
                recipientId = '1'; // Usuario normal siempre envía al admin (ID: 1)
                messageType = 'user';
            } else {
                // Fallback
                senderId = '2';
                recipientId = '1';
                messageType = 'user';
            }
            
            // Enviar por SocketIO
            socket.emit('send_audio_message', {
                sender_id: senderId,
                recipient_id: recipientId,
                audio_data: audioData,
                audio_filename: `audio_${Date.now()}${extension}`,
                message_type: messageType
            });
            
            // Remover mensaje temporal
            const audioMessage = document.querySelector(`#audio-${tempMessageId}`);
            if (audioMessage && audioMessage.parentNode) {
                audioMessage.parentNode.removeChild(audioMessage);
            }
        };
        reader.readAsDataURL(audioBlob);
    });
    
    // Botón cancelar
    finalCancelBtn.addEventListener('click', function() {
        audioElement.pause();
        URL.revokeObjectURL(audioElement.src);
        const audioMessage = document.querySelector(`#audio-${tempMessageId}`);
        if (audioMessage && audioMessage.parentNode) {
            audioMessage.parentNode.removeChild(audioMessage);
        }
    });
}

// ✅ FUNCIÓN AUXILIAR: Formatear tiempo
function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) {
        return '0:00';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// ✅ FUNCIÓN AUXILIAR: Mostrar mensaje informativo
window.showInfoMessage = function(message) {
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
    
    // Remover después de 3 segundos
    setTimeout(() => {
        if (infoDiv.parentNode) {
            infoDiv.parentNode.removeChild(infoDiv);
        }
    }, 3000);
};

// ✅ FUNCIÓN AUXILIAR: Previsualizar archivos genéricos
window.previewGenericFile = function(fileUrl, fileName, fileType) {
    // ✅ Para PDFs, abrir en nueva pestaña
    if (fileType === 'application/pdf') {
        window.open(fileUrl, '_blank');
        return;
    }
    
    // ✅ Para archivos de texto, mostrar en modal
    if (fileType.startsWith('text/')) {
        fetch(fileUrl)
            .then(response => response.text())
            .then(text => {
                const modal = document.createElement('div');
                modal.className = 'text-preview-modal';
                modal.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.8);
                    z-index: 10000;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                `;
                
                modal.innerHTML = `
                    <div style="background: white; padding: 20px; border-radius: 8px; max-width: 80%; max-height: 80%; overflow: auto;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <h3>${fileName}</h3>
                            <button onclick="this.closest('.text-preview-modal').remove()" style="background: #e74c3c; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Cerrar</button>
                        </div>
                        <pre style="white-space: pre-wrap; font-family: monospace; font-size: 12px;">${text}</pre>
                    </div>
                `;
                
                document.body.appendChild(modal);
                
                // Cerrar modal al hacer clic fuera
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) modal.remove();
                });
            })
            .catch(error => {
                console.error('Error al cargar archivo de texto:', error);
                showInfoMessage('Error al cargar el archivo de texto');
            });
        return;
    }
    
    // ✅ Para otros archivos, intentar descargar
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.click();
};

// ✅ NUEVO: Sistema de compresión automática para archivos grandes
window.compressFileIfNeeded = function(file, maxSizeMB = 10) {
    return new Promise((resolve) => {
        const maxSize = maxSizeMB * 1024 * 1024; // Convertir a bytes
        
        // Si el archivo ya es pequeño, no comprimir
        if (file.size <= maxSize) {
            resolve(file);
            return;
        }
        
        
        // Detectar tipo de archivo
        if (file.type.startsWith('video/')) {
            // ✅ NUEVO: Para videos, solo comprimir si es extremadamente grande
            if (file.size > 50 * 1024 * 1024) { // Solo si es mayor a 50MB
            }
            resolve(file); // Usar video original para mantener reproducción
        } else if (file.type.startsWith('image/')) {
            compressImage(file, maxSize).then(resolve);
        } else {
            // Para otros tipos, intentar comprimir como imagen si es posible
            if (isImageFile(file.name)) {
                compressImage(file, maxSize).then(resolve);
            } else {
                // No se puede comprimir, usar archivo original
                resolve(file);
            }
        }
    });
};

// ✅ NUEVO: Compresión de videos usando MediaRecorder
function compressVideo(file, maxSize) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        video.onloadedmetadata = () => {
            // Calcular nueva resolución
            let newWidth = video.videoWidth;
            let newHeight = video.videoHeight;
            
            // Reducir resolución si es muy grande
            if (newWidth > 1280) {
                const ratio = 1280 / newWidth;
                newWidth = 1280;
                newHeight = Math.round(newHeight * ratio);
            }
            if (newHeight > 720) {
                const ratio = 720 / newHeight;
                newHeight = 720;
                newWidth = Math.round(newWidth * ratio);
            }
            
            canvas.width = newWidth;
            canvas.height = newHeight;
            
            // Configurar video para reproducción
            video.currentTime = 0;
            video.muted = true;
            video.play();
            
            // Capturar frame cuando esté listo
            video.onseeked = () => {
                ctx.drawImage(video, 0, 0, newWidth, newHeight);
                
                // Convertir a blob como imagen (para preview)
                canvas.toBlob((blob) => {
                    if (blob) {
                        // Crear un archivo de video válido usando el original pero con nombre modificado
                        const compressedFile = new File([file], `compressed_${file.name}`, { 
                            type: file.type,
                            lastModified: Date.now()
                        });
                        resolve(compressedFile);
                    } else {
                        resolve(file);
                    }
                }, 'image/jpeg', 0.8);
            };
            
            // Buscar al frame 0
            video.currentTime = 0;
        };
        
        video.onerror = () => {
            resolve(file);
        };
        
        video.src = URL.createObjectURL(file);
    });
}

// ✅ NUEVO: Compresión de imágenes
function compressImage(file, maxSize) {
    return new Promise((resolve) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = () => {
            // Calcular nueva resolución
            let newWidth = img.width;
            let newHeight = img.height;
            let quality = 0.8;
            
            // Reducir resolución si es muy grande
            if (newWidth > 1920) {
                const ratio = 1920 / newWidth;
                newWidth = 1920;
                newHeight = Math.round(newHeight * ratio);
            }
            if (newHeight > 1080) {
                const ratio = 1080 / newHeight;
                newHeight = 1080;
                newWidth = Math.round(newWidth * ratio);
            }
            
            canvas.width = newWidth;
            canvas.height = newHeight;
            
            // Dibujar imagen redimensionada
            ctx.drawImage(img, 0, 0, newWidth, newHeight);
            
            // Convertir a blob con compresión
            canvas.toBlob((blob) => {
                if (blob && blob.size <= maxSize) {
                    const compressedFile = new File([blob], file.name, { type: file.type });
                    resolve(compressedFile);
                } else {
                    // Si sigue siendo muy grande, reducir más la calidad
                    if (quality > 0.3) {
                        quality -= 0.1;
                        canvas.toBlob((blob) => {
                            if (blob) {
                                const compressedFile = new File([blob], file.name, { type: file.type });
                                resolve(compressedFile);
                            } else {
                                resolve(file);
                            }
                        }, file.type, quality);
                    } else {
                        resolve(file);
                    }
                }
            }, file.type, quality);
        };
        
        img.src = URL.createObjectURL(file);
    });
}
