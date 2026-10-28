// Admin Herramientas - Drive para fotos y películas
document.addEventListener('DOMContentLoaded', function() {
    const driveSubtitlePhotos = document.getElementById('drive_subtitle_photos');
    const driveSubtitleVideos = document.getElementById('drive_subtitle_videos');
    const driveSubtitlesWarning = document.getElementById('drive-subtitles-warning');
    const apiForm = document.getElementById('apiForm');

    if (apiForm) {
        apiForm.addEventListener('submit', function(e) {
            const photos = (driveSubtitlePhotos && driveSubtitlePhotos.value.trim()) || '';
            const videos = (driveSubtitleVideos && driveSubtitleVideos.value.trim()) || '';
            if (!photos && !videos) {
                if (driveSubtitlesWarning) {
                    driveSubtitlesWarning.textContent = 'Debes ingresar al menos un subtítulo para fotos o videos.';
                    driveSubtitlesWarning.classList.remove('herramientas-drive-warning');
                }
                e.preventDefault();
                return false;
            }
            if (driveSubtitlesWarning) {
                driveSubtitlesWarning.textContent = '';
                driveSubtitlesWarning.classList.add('herramientas-drive-warning');
            }
        });
    }

    const btnExportToolsConfig = document.getElementById('btnExportToolsConfig');
    const exportSecurityCode = document.getElementById('exportSecurityCode');

    if (btnExportToolsConfig) {
        btnExportToolsConfig.addEventListener('click', function() {
            const code = exportSecurityCode ? exportSecurityCode.value.trim() : '';
            if (!code) {
                alert('Por favor, ingresa el código secreto para exportar.');
                return;
            }

            const exportUrl = `/tienda/admin/herramientas/export_config?security_code=${encodeURIComponent(code)}`;

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

    const toolsConfigFileInput = document.getElementById('toolsConfigFile');
    const toolsConfigFileTrigger = document.getElementById('toolsConfigFileTrigger');
    const toolsConfigFileTriggerText = document.getElementById('toolsConfigFileTriggerText');
    if (toolsConfigFileInput && toolsConfigFileTrigger && toolsConfigFileTriggerText) {
        const toolsConfigFileTriggerIcon = toolsConfigFileTrigger.querySelector('.import-export-file-trigger-icon');
        function setToolsConfigFileTriggerReady(ready) {
            if (ready) {
                toolsConfigFileTriggerText.textContent = 'Subido listo';
                toolsConfigFileTrigger.classList.add('import-export-file-trigger--ready');
                toolsConfigFileTrigger.setAttribute('title', 'Archivo JSON seleccionado');
                toolsConfigFileTrigger.setAttribute('aria-label', 'Archivo JSON seleccionado');
                if (toolsConfigFileTriggerIcon) {
                    toolsConfigFileTriggerIcon.classList.remove('fa-upload');
                    toolsConfigFileTriggerIcon.classList.add('fa-check');
                }
            } else {
                toolsConfigFileTriggerText.textContent = 'Subir archivo';
                toolsConfigFileTrigger.classList.remove('import-export-file-trigger--ready');
                toolsConfigFileTrigger.setAttribute('title', 'Subir archivo JSON');
                toolsConfigFileTrigger.setAttribute('aria-label', 'Subir archivo JSON');
                if (toolsConfigFileTriggerIcon) {
                    toolsConfigFileTriggerIcon.classList.remove('fa-check');
                    toolsConfigFileTriggerIcon.classList.add('fa-upload');
                }
            }
        }
        toolsConfigFileInput.addEventListener('change', function () {
            setToolsConfigFileTriggerReady(toolsConfigFileInput.files && toolsConfigFileInput.files.length > 0);
        });
    }

    const importToolsConfigForm = document.getElementById('importToolsConfigForm');
    if (importToolsConfigForm) {
        importToolsConfigForm.addEventListener('submit', function (event) {
            const confirmation = confirm(
                '¿Estás seguro? Esto borrará las herramientas, HTML, YouTube, APIs y datos relacionados antes de importar.'
            );
            if (!confirmation) {
                event.preventDefault();
            }
        });
    }
});
