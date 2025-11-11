// Admin Herramientas - Funcionalidad para la plantilla herramientas.html
document.addEventListener('DOMContentLoaded', function() {
    const tipoApi = document.getElementById('api_type');
    const driveField = document.getElementById('drive-folder-id-field');
    const apiUrlInput = document.getElementById('api_url');
    const driveSubtitlesFields = document.getElementById('drive-subtitles-fields');
    const driveSubtitlePhotos = document.getElementById('drive_subtitle_photos');
    const driveSubtitleVideos = document.getElementById('drive_subtitle_videos');
    const driveSubtitlesWarning = document.getElementById('drive-subtitles-warning');
    const apiForm = document.getElementById('apiForm');
    const apiKeyTextarea = document.getElementById('api_key');

    function toggleDriveField() {
        if (tipoApi.value === 'Drive') {
            driveField.classList.remove('herramientas-drive-field');
            if(driveSubtitlesFields) driveSubtitlesFields.classList.remove('herramientas-drive-subtitles');
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 3;
            }
        } else if (tipoApi.value === '' || tipoApi.value === null) {
            // API Genérica / Ninguno - permitir HTML
            driveField.classList.add('herramientas-drive-field');
            if (apiUrlInput) apiUrlInput.value = '';
            if(driveSubtitlesFields) driveSubtitlesFields.classList.add('herramientas-drive-subtitles');
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 10;
            }
        } else {
            // Búsqueda de Medios u otros
            driveField.classList.add('herramientas-drive-field');
            if (apiUrlInput) apiUrlInput.value = '';
            if(driveSubtitlesFields) driveSubtitlesFields.classList.add('herramientas-drive-subtitles');
            if(apiKeyTextarea) {
                apiKeyTextarea.rows = 3;
            }
        }
    }
    
    setTimeout(toggleDriveField, 0);
    tipoApi.addEventListener('change', toggleDriveField);

    if(apiForm) {
        apiForm.addEventListener('submit', function(e) {
            if(tipoApi.value === 'Drive') {
                const photos = driveSubtitlePhotos.value.trim();
                const videos = driveSubtitleVideos.value.trim();
                if(!photos && !videos) {
                    driveSubtitlesWarning.textContent = 'Debes ingresar al menos un subtítulo para fotos o videos.';
                    driveSubtitlesWarning.classList.remove('herramientas-drive-warning');
                    e.preventDefault();
                    return false;
                } else {
                    driveSubtitlesWarning.textContent = '';
                    driveSubtitlesWarning.classList.add('herramientas-drive-warning');
                }
            }
        });
    }

    // Manejar exportación de configuración de herramientas
    const btnExportToolsConfig = document.getElementById('btnExportToolsConfig');
    const exportSecurityCode = document.getElementById('exportSecurityCode');
    
    if (btnExportToolsConfig) {
        btnExportToolsConfig.addEventListener('click', function() {
            const code = exportSecurityCode ? exportSecurityCode.value.trim() : '';
            if (!code) {
                alert('Por favor, ingresa el código secreto para exportar.');
                return;
            }
            
            // Construir URL con el código de seguridad
            const exportUrl = `/tienda/admin/herramientas/export_config?security_code=${encodeURIComponent(code)}`;
            
            // Hacer la petición
            fetch(exportUrl)
                .then(response => {
                    if (response.status === 401) {
                        return response.json().then(data => {
                            alert(data.error || 'Código de seguridad incorrecto.');
                            throw new Error('Unauthorized');
                        });
                    }
                    if (!response.ok) {
                        throw new Error('Error al exportar configuración');
                    }
                    return response.blob();
                })
                .then(blob => {
                    // Crear un enlace temporal para descargar el archivo
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'herramientas_configuracion_exportada.json';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                })
                .catch(error => {
                    if (error.message !== 'Unauthorized') {
                        console.error('Error:', error);
                        alert('Error al exportar la configuración. Por favor, intenta nuevamente.');
                    }
                });
        });
    }
}); 
