/**
 * SMS Numbers Manager - JavaScript para gestión de números permitidos SMS
 * Maneja: búsqueda, paginación, agregar masivamente, eliminar números
 */

document.addEventListener('DOMContentLoaded', function() {
    // --- Funciones Auxiliares ---
    function getCsrfToken(){
        const meta = document.querySelector('meta[name="csrf_token"]');
        return meta ? meta.getAttribute('content') : '';
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    function handleFetchResponse(response) {
        if (!response.ok) {
            return response.json()
                .then(errData => { 
                    throw new Error(errData.message || `Error del servidor: ${response.status}`); 
                })
                .catch(() => {
                   throw new Error(`Error del servidor: ${response.status}`);
                });
        }
        return response.json();
    }

    // ======= PAGINACIÓN NÚMEROS PERMITIDOS =======
    const allowedNumbersTextContainer = document.getElementById("allowedNumbersTextContainer");
    const paginationInfoNumbers = document.getElementById("paginationInfoNumbers");
    const prevPageBtnNumbers = document.getElementById("prevPageBtnNumbers");
    const nextPageBtnNumbers = document.getElementById("nextPageBtnNumbers");
    const perPageSelectNumbers = document.getElementById("perPageSelectNumbers");
    const deleteAllNumbersBtn = document.getElementById("deleteAllNumbersBtn");
    
    let currentPageNumbers = 1;
    let currentPerPageNumbers = 10;
    if (perPageSelectNumbers) perPageSelectNumbers.value = currentPerPageNumbers;

    // Función para obtener el número SMS seleccionado
    function getSelectedSMSConfigId() {
        const smsNumberSelect = document.getElementById('sms-number-select');
        if (smsNumberSelect && smsNumberSelect.value) {
            return parseInt(smsNumberSelect.value);
        }
        return null;
    }

    function fetchAllowedNumbers(page = 1, perPage = 10) {
        const smsConfigId = getSelectedSMSConfigId();
        if (!smsConfigId) {
            if (allowedNumbersTextContainer) {
                allowedNumbersTextContainer.textContent = "Debe seleccionar un número SMS primero.";
            }
            // Deshabilitar formulario
            if (addNumbersBtn) addNumbersBtn.disabled = true;
            if (newNumbersInput) newNumbersInput.disabled = true;
            return;
        }
        
        currentPageNumbers = page;
        currentPerPageNumbers = parseInt(perPage, 10) || 10;
        if (currentPerPageNumbers === -1) {
            perPage = 999999;
        } else {
             perPage = currentPerPageNumbers;
        }
        const url = `/tienda/admin/sms/allowed-numbers/paginated?page=${page}&per_page=${perPage}&sms_config_id=${smsConfigId}`;
        
        if (allowedNumbersTextContainer) allowedNumbersTextContainer.innerHTML = "<p>Cargando...</p>";
        
        fetch(url, {
            method: "GET",
            headers: { "X-CSRFToken": getCsrfToken() }
        })
        .then(handleFetchResponse)
        .then(data => {
            if (data.success) {
                if (allowedNumbersTextContainer) renderAllowedNumbersText(data.numbers);
                if (paginationInfoNumbers) updatePaginationControlsNumbers(data.pagination);
            } else {
                if (allowedNumbersTextContainer) {
                    const errorDiv = document.createElement('p');
                    errorDiv.className = 'sms-error-message';
                    errorDiv.textContent = `Error: ${data.message || 'No se pudieron cargar los números.'}`;
                    allowedNumbersTextContainer.innerHTML = '';
                    allowedNumbersTextContainer.appendChild(errorDiv);
                }
            }
        })
        .catch(err => {
            if (allowedNumbersTextContainer) {
                const errorDiv = document.createElement('p');
                errorDiv.className = 'sms-error-message';
                errorDiv.textContent = `Error al cargar números: ${err.message}`;
                allowedNumbersTextContainer.innerHTML = '';
                allowedNumbersTextContainer.appendChild(errorDiv);
            }
        });
    }

    function renderAllowedNumbersText(numbers) {
        if (!allowedNumbersTextContainer) return;
        if (!numbers || numbers.length === 0) {
            allowedNumbersTextContainer.textContent = "No hay correos permitidos asignados.";
            return;
        }
        allowedNumbersTextContainer.textContent = numbers.join('\n'); 
    }

    function updatePaginationControlsNumbers(pagination) {
        if (!paginationInfoNumbers) return;
        
        const total = pagination.total_items || 0;
        const page = pagination.page || 1;
        const totalPages = pagination.total_pages || 1;
        
        paginationInfoNumbers.textContent = `Página ${page} de ${totalPages}.`;
        
        if (prevPageBtnNumbers) {
            prevPageBtnNumbers.disabled = !pagination.has_prev;
        }
        if (nextPageBtnNumbers) {
            nextPageBtnNumbers.disabled = !pagination.has_next;
        }
        
        if (deleteAllNumbersBtn) {
            deleteAllNumbersBtn.innerHTML = `<i class="fas fa-trash"></i> Eliminar Todos (${total})`;
        }
    }

    // Event listeners para paginación
    if (prevPageBtnNumbers) {
        prevPageBtnNumbers.addEventListener("click", function(e) {
            e.preventDefault();
            if (currentPageNumbers > 1) {
                fetchAllowedNumbers(currentPageNumbers - 1, currentPerPageNumbers);
            }
        });
    }

    if (nextPageBtnNumbers) {
        nextPageBtnNumbers.addEventListener("click", function(e) {
            e.preventDefault();
            if (allowedNumbersTextContainer && allowedNumbersTextContainer.textContent !== "No hay correos permitidos asignados.") {
                fetchAllowedNumbers(currentPageNumbers + 1, currentPerPageNumbers);
            }
        });
    }

    if (perPageSelectNumbers) {
        perPageSelectNumbers.addEventListener("change", function() {
            currentPerPageNumbers = parseInt(this.value, 10) || 10;
            fetchAllowedNumbers(1, currentPerPageNumbers);
        });
    }

    // ======= BÚSQUEDA Y ELIMINACIÓN =======
    const searchNumbersForm = document.getElementById("searchNumbersForm");
    const searchNumbersInput = document.getElementById("searchNumbersInput");
    const numbersSearchResults = document.getElementById("numbersSearchResults");
    const searchStatus = document.getElementById("searchStatus");
    const deleteDisplayedBtn = document.getElementById("deleteDisplayedBtn");
    
    let displayedNumbers = [];

    if (searchNumbersForm && searchNumbersInput && numbersSearchResults && deleteDisplayedBtn) {
        // Búsqueda cuando se presiona Enter o se hace submit
        searchNumbersForm.addEventListener("submit", function(e) {
            e.preventDefault();
            const searchText = searchNumbersInput.value.trim();
            if (!searchText) {
                renderSearchResults([]);
                return;
            }
            searchNumbers(searchText);
        });
        
        // También buscar cuando se presiona Enter en el textarea (sin Shift)
        searchNumbersInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                searchNumbersForm.dispatchEvent(new Event('submit'));
            }
        });
        
        // Búsqueda automática mientras se escribe (con debounce)
        let searchTimeout;
        searchNumbersInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            const searchText = searchNumbersInput.value.trim();
            if (!searchText) {
                renderSearchResults([]);
                return;
            }
            // Buscar después de 300ms de inactividad
            searchTimeout = setTimeout(() => {
                searchNumbers(searchText);
            }, 300);
        });
        
        // Cambiar el botón Limpiar para limpiar todo
        const limpiarBtnSMS = searchNumbersForm.querySelector('button[type="submit"]');
        if (limpiarBtnSMS) {
            limpiarBtnSMS.type = 'button';
            limpiarBtnSMS.addEventListener('click', function(e) {
                e.preventDefault();
                searchNumbersInput.value = '';
                // Limpiar resultados y ocultar botón
                if (numbersSearchResults) {
                    numbersSearchResults.innerHTML = '';
                    numbersSearchResults.style.display = 'none';
                }
                if (deleteDisplayedBtn) {
                    deleteDisplayedBtn.style.display = 'none';
                }
                if (searchStatus) {
                    searchStatus.textContent = '';
                }
                displayedNumbers = [];
                // Disparar evento input para limpiar cualquier búsqueda pendiente
                searchNumbersInput.dispatchEvent(new Event('input'));
            });
        }
    }

    function searchNumbers(searchText) {
        const smsConfigId = getSelectedSMSConfigId();
        if (!smsConfigId) {
            if (numbersSearchResults) {
                numbersSearchResults.innerHTML = "<p class='sms-error-message'>Debe seleccionar un número SMS primero.</p>";
                numbersSearchResults.style.display = 'block';
            }
            return;
        }
        
        if (numbersSearchResults) {
            numbersSearchResults.innerHTML = "<p>Buscando...</p>";
            numbersSearchResults.style.display = 'block';
        }
        if (searchStatus) searchStatus.textContent = "";
        
        fetch("/tienda/admin/sms/allowed-numbers/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify({ search_text: searchText, sms_config_id: smsConfigId })
        })
        .then(handleFetchResponse)
        .then(data => {
            if (data.success) {
                displayedNumbers = data.numbers || [];
                renderSearchResults(displayedNumbers);
            } else {
                if (numbersSearchResults) {
                    const errorDiv = document.createElement('p');
                    errorDiv.className = 'sms-error-message';
                    errorDiv.textContent = `Error: ${data.message || 'Error en la búsqueda'}`;
                    numbersSearchResults.innerHTML = '';
                    numbersSearchResults.appendChild(errorDiv);
                }
                if (searchStatus) searchStatus.textContent = '';
                if (deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'none';
            }
        })
        .catch(err => {
            if (numbersSearchResults) {
                const errorDiv = document.createElement('p');
                errorDiv.className = 'sms-error-message';
                errorDiv.textContent = `Error de conexión: ${err.message}`;
                numbersSearchResults.innerHTML = '';
                numbersSearchResults.appendChild(errorDiv);
            }
            if (searchStatus) searchStatus.textContent = '';
            if (deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'none';
        });
    }

    function renderSearchResults(numbers) {
        if (!numbersSearchResults) return;
        numbersSearchResults.innerHTML = '';
        if (!numbers || numbers.length === 0) {
            numbersSearchResults.style.display = 'none';
            if (deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'none';
            if (searchStatus) searchStatus.textContent = '';
            return;
        }

        numbersSearchResults.style.display = 'block';
        numbers.forEach(num => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('search-result-item');
            itemDiv.innerHTML = `
                <span>${escapeHtml(num)}</span>
                <button class="delete-search-result-btn" data-number="${escapeHtml(num)}" title="Eliminar este correo">X</button>
            `;
            numbersSearchResults.appendChild(itemDiv);
        });

        if (deleteDisplayedBtn) {
            deleteDisplayedBtn.textContent = `Eliminar ${numbers.length} Mostrados`;
            deleteDisplayedBtn.style.display = 'inline-block';
            deleteDisplayedBtn.disabled = false;
        }
        
        if (searchStatus) {
            searchStatus.textContent = '';
        }
    }

    // Delegación de eventos para eliminar individual (igual que en admin_user_emails.js)
    if (numbersSearchResults) {
        numbersSearchResults.addEventListener("click", function(e) {
            if (e.target.classList.contains("delete-search-result-btn")) {
                e.preventDefault();
                const button = e.target;
                const numberToDelete = button.getAttribute("data-number");
                if (!numberToDelete || !confirm(`¿Eliminar ${numberToDelete}?`)) { 
                    return; 
                }

                button.disabled = true;
                button.textContent = '...';

                const smsConfigId = getSelectedSMSConfigId();
                if (!smsConfigId) {
                    alert("Debe seleccionar un número SMS primero.");
                    button.disabled = false;
                    button.textContent = 'X';
                    return;
                }
                
                fetch("/tienda/admin/sms/allowed-numbers/delete", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCsrfToken()
                    },
                    body: JSON.stringify({ phone_number: numberToDelete, sms_config_id: smsConfigId })
                })
                .then(handleFetchResponse)
                .then(data => {
                    if (data.success) {
                        button.closest('.search-result-item').remove();
                        displayedNumbers = displayedNumbers.filter(num => num !== numberToDelete);
                        if (displayedNumbers.length > 0) {
                            if (deleteDisplayedBtn) deleteDisplayedBtn.textContent = `Eliminar ${displayedNumbers.length} Mostrados`;
                            if (deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'inline-block';
                            if (searchStatus) searchStatus.textContent = '';
                        } else {
                            numbersSearchResults.style.display = 'none';
                            if (deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'none';
                            if (searchStatus) searchStatus.textContent = '';
                        }
                        fetchAllowedNumbers(currentPageNumbers, currentPerPageNumbers);
                    } else {
                        alert(`Error: ${data.message || 'Error desconocido'}`);
                        button.disabled = false;
                        button.textContent = 'X';
                    }
                })
                .catch(err => {
                    alert(`Error de red: ${err.message}`);
                    button.disabled = false;
                    button.textContent = 'X';
                });
            }
        });
    }

    if (deleteDisplayedBtn) {
        deleteDisplayedBtn.addEventListener("click", function() {
            if (displayedNumbers.length === 0) return;
            const smsConfigId = getSelectedSMSConfigId();
            if (!smsConfigId) {
                alert("Debe seleccionar un número SMS primero.");
                return;
            }
            if (!confirm(`¿Estás seguro de eliminar ${displayedNumbers.length} correo(s)?`)) return;
            
            fetch("/tienda/admin/sms/allowed-numbers/delete-many", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCsrfToken()
                },
                body: JSON.stringify({ phone_numbers: displayedNumbers, sms_config_id: smsConfigId })
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success) {
                    // Limpiar búsqueda y recargar lista
                    if (searchNumbersInput) searchNumbersInput.value = "";
                    if (numbersSearchResults) {
                        numbersSearchResults.innerHTML = "";
                        numbersSearchResults.style.display = 'none';
                    }
                    if (searchStatus) searchStatus.textContent = "";
                    if (deleteDisplayedBtn) deleteDisplayedBtn.style.display = 'none';
                    displayedNumbers = [];
                    fetchAllowedNumbers(currentPageNumbers, currentPerPageNumbers);
                } else {
                    alert(`Error: ${data.message || 'No se pudieron eliminar los correos'}`);
                }
            })
            .catch(err => {
                alert(`Error de conexión: ${err.message}`);
            });
        });
    }

    // ======= ELIMINAR TODOS =======
    if (deleteAllNumbersBtn) {
        deleteAllNumbersBtn.addEventListener("click", function() {
            const smsConfigId = getSelectedSMSConfigId();
            if (!smsConfigId) {
                alert("Debe seleccionar un número SMS primero.");
                return;
            }
            if (!confirm("¿Seguro que quieres eliminar TODOS los correos permitidos de este número SMS? Esta acción no se puede deshacer.")) {
                return;
            }
            
            fetch("/tienda/admin/sms/allowed-numbers/delete-all", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCsrfToken()
                },
                body: JSON.stringify({ sms_config_id: smsConfigId })
            })
            .then(handleFetchResponse)
            .then(data => {
                if (data.success) {
                    alert(`${data.message || 'Correos eliminados correctamente.'}`);
                    fetchAllowedNumbers(1, currentPerPageNumbers);
                } else {
                    alert(`Error: ${data.message || 'Error desconocido'}`);
                }
            })
            .catch(err => {
                alert(`Error de red: ${err.message}`);
            });
        });
    }

    // ======= AGREGAR NÚMEROS MASIVAMENTE =======
    const addNumbersBtn = document.getElementById("addNumbersBtn");
    const newNumbersInput = document.getElementById("newNumbersInput");
    const addNumbersMsg = document.getElementById("addNumbersMsg");

    // Función para actualizar el estado del formulario según el número seleccionado
    function updateFormState() {
        const smsConfigId = getSelectedSMSConfigId();
        const hasSelection = smsConfigId !== null;
        
        // Deshabilitar/habilitar el formulario de agregar números
        if (addNumbersBtn) {
            addNumbersBtn.disabled = !hasSelection;
            if (!hasSelection) {
                addNumbersBtn.title = "Debe seleccionar un número SMS primero.";
            } else {
                addNumbersBtn.title = "";
            }
        }
        
        if (newNumbersInput) {
            newNumbersInput.disabled = !hasSelection;
            if (!hasSelection) {
                newNumbersInput.placeholder = "Debe seleccionar un número SMS primero.";
            } else {
                newNumbersInput.placeholder = "Ingresa uno o varios correos (separados por comas, espacios o saltos de línea). Ejemplo: correo1@gmail.com, correo2@gmail.com...";
            }
        }
        
        // Mostrar mensaje informativo si no hay selección
        if (addNumbersMsg && !hasSelection && !addNumbersMsg.textContent.includes("Se agregaron")) {
            addNumbersMsg.textContent = "Debe seleccionar un número SMS en 'Consultar Mensajes SMS' antes de agregar correos permitidos.";
            addNumbersMsg.className = "text-italic text-danger";
        } else if (addNumbersMsg && hasSelection && !addNumbersMsg.textContent.includes("Se agregaron")) {
            addNumbersMsg.textContent = "";
            addNumbersMsg.className = "";
        }
        
        // Recargar la lista si hay selección
        if (hasSelection) {
            fetchAllowedNumbers(1, currentPerPageNumbers);
        } else {
            if (allowedNumbersTextContainer) {
                allowedNumbersTextContainer.textContent = "Debe seleccionar un número SMS primero.";
            }
        }
    }

    // Función para verificar si hay SMSConfig configurados y habilitar/deshabilitar el formulario
    // Expuesta globalmente para ser llamada desde otros scripts
    window.checkSMSConfigsAndToggleForm = function() {
        updateFormState();
    };
    
    // Listener para cambios en el selector de números SMS
    const smsNumberSelect = document.getElementById('sms-number-select');
    if (smsNumberSelect) {
        smsNumberSelect.addEventListener('change', function() {
            const smsConfigId = this.value ? parseInt(this.value) : null;
            
            // Guardar en la sesión del servidor
            if (smsConfigId) {
                fetch('/tienda/admin/sms/set-selected-number', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ sms_config_id: smsConfigId })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updateFormState();
                    }
                })
                .catch(() => {});
            } else {
                // Limpiar selección
                fetch('/tienda/admin/sms/set-selected-number', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ sms_config_id: null })
                })
                .then(() => updateFormState())
                .catch(() => {});
            }
        });
    }

    if (addNumbersBtn) {
        addNumbersBtn.addEventListener("click", function(e) {
            e.preventDefault();
            
            const smsConfigId = getSelectedSMSConfigId();
            if (!smsConfigId) {
                if (addNumbersMsg) {
                    addNumbersMsg.textContent = "Debe seleccionar un número SMS primero.";
                    addNumbersMsg.className = "text-italic text-danger";
                }
                return;
            }
            
            const rawText = newNumbersInput ? newNumbersInput.value.trim() : "";
            if (!rawText) {
                if (addNumbersMsg) {
                    addNumbersMsg.textContent = "Por favor ingresa al menos un correo.";
                    addNumbersMsg.className = "text-italic text-danger";
                }
                return;
            }
            
            // Procesar números (separados por comas, espacios, saltos de línea)
            const numbers = rawText.split(/[,\n\r\s]+/)
                .map(n => n.trim())
                .filter(n => n.length > 0);
            
            if (numbers.length === 0) {
                if (addNumbersMsg) {
                    addNumbersMsg.textContent = "No se encontraron correos válidos.";
                    addNumbersMsg.className = "text-italic text-danger";
                }
                return;
            }
            
            fetch("/tienda/admin/sms/allowed-numbers/add", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCsrfToken()
                },
                body: JSON.stringify({ phone_numbers: numbers, sms_config_id: smsConfigId })
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errData => {
                        throw new Error(errData.message || `Error del servidor: ${response.status}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                if (addNumbersMsg) {
                    // Limpiar clases previas
                    addNumbersMsg.className = "text-italic";
                    
                    if (data.success) {
                        // Si hay HTML, usar innerHTML, sino textContent
                        if (data.is_html && data.message) {
                            addNumbersMsg.innerHTML = data.message;
                        } else {
                            addNumbersMsg.textContent = data.message || `Se agregaron ${data.added_count || 0} correo(s) exitosamente.`;
                            addNumbersMsg.className = "text-italic text-success";
                        }
                        
                        // Eliminar correos procesados del campo de entrada
                        if (data.processed_emails && data.processed_emails.length > 0 && newNumbersInput) {
                            removeProcessedEmailsFromInput(newNumbersInput, data.processed_emails);
                        } else if (newNumbersInput) {
                            // Si todos se procesaron, limpiar completamente
                            newNumbersInput.value = "";
                        }
                        
                        fetchAllowedNumbers(currentPageNumbers, currentPerPageNumbers);
                    } else {
                        // Error: si hay HTML, usar innerHTML, sino textContent
                        if (data.is_html && data.message) {
                            addNumbersMsg.innerHTML = data.message;
                        } else {
                            addNumbersMsg.textContent = `Error: ${data.message || 'No se pudieron agregar los números'}`;
                            addNumbersMsg.className = "text-italic text-danger";
                        }
                        
                        // Eliminar solo los correos procesados del campo de entrada (mantener los que están en otros números)
                        if (data.processed_emails && data.processed_emails.length > 0 && newNumbersInput) {
                            removeProcessedEmailsFromInput(newNumbersInput, data.processed_emails);
                        }
                    }
                }
            })
            .catch(err => {
                if (addNumbersMsg) {
                    // Intentar parsear el mensaje de error como JSON si es posible
                    // Si el error viene del backend con HTML, usarlo directamente
                    addNumbersMsg.innerHTML = err.message || "Error al agregar correos"; 
                    addNumbersMsg.className = "text-italic"; // Limpiar clases específicas para que apliquen las del HTML
                }
            });
        });
    }

    /**
     * Elimina correos procesados del campo de entrada, manteniendo solo los que quedan pendientes
     * @param {HTMLTextAreaElement} inputElement - El elemento textarea del input
     * @param {string[]} processedEmails - Array de correos que se procesaron y deben eliminarse
     */
    function removeProcessedEmailsFromInput(inputElement, processedEmails) {
        if (!inputElement || !processedEmails || processedEmails.length === 0) {
            return;
        }
        
        // Obtener el contenido actual del input
        const currentValue = inputElement.value.trim();
        if (!currentValue) {
            return;
        }
        
        // Normalizar los correos procesados a minúsculas para comparación
        const processedSet = new Set(processedEmails.map(email => email.toLowerCase().trim()));
        
        // Dividir el contenido en líneas y procesar cada línea
        const lines = currentValue.split(/[,\n\r]+/).map(line => line.trim()).filter(line => line.length > 0);
        
        // Filtrar los correos que NO están en la lista de procesados
        const remainingLines = lines.filter(line => {
            const normalizedLine = line.toLowerCase().trim();
            return !processedSet.has(normalizedLine);
        });
        
        // Actualizar el campo con solo los correos que quedan pendientes
        if (remainingLines.length > 0) {
            inputElement.value = remainingLines.join('\n');
        } else {
            // Si no quedan correos, limpiar el campo
            inputElement.value = "";
        }
    }

    // Inicializar estado del formulario al cargar
    // Esperar a que se carguen las configuraciones SMS antes de actualizar el estado
    function initializeAfterConfigsLoad() {
        // Verificar si ya hay datos cargados o esperar un momento
        if (window.smsConfigsData) {
            updateFormState();
        } else {
            // Esperar un poco más si aún no se han cargado
            setTimeout(() => {
                updateFormState();
            }, 200);
        }
    }
    
    initializeAfterConfigsLoad();
    
    // También escuchar cuando se carguen las configuraciones
    window.addEventListener('smsConfigsLoaded', function() {
        updateFormState();
    });
});

