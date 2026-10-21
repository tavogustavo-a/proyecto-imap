document.addEventListener('DOMContentLoaded', function () {
    const publicCheckbox = document.getElementById('is_public');
    const publicLinkBox = document.getElementById('toolPublicLinkBox');
    const copyPublicUrlBtn = document.getElementById('btnCopyToolPublicUrl');
    const openPublicUrlBtn = document.getElementById('btnOpenToolPublicUrl');
    const publicUrlInput = document.getElementById('toolPublicUrl');
    const publicSaveHint = document.getElementById('toolPublicSaveHint');
    const publicActiveHint = document.getElementById('toolPublicActiveHint');
    if (!publicCheckbox || !publicLinkBox) return;

    const savedPublic = publicLinkBox.getAttribute('data-saved-public') === '1';

    function setOpenPublicUrlEnabled(enabled) {
        if (!openPublicUrlBtn) return;
        openPublicUrlBtn.classList.toggle('disabled', !enabled);
        if (enabled) {
            openPublicUrlBtn.removeAttribute('aria-disabled');
            openPublicUrlBtn.removeAttribute('tabindex');
        } else {
            openPublicUrlBtn.setAttribute('aria-disabled', 'true');
            openPublicUrlBtn.setAttribute('tabindex', '-1');
        }
    }

    function syncPublicLinkUi() {
        const enabled = publicCheckbox.checked;
        const ready = enabled && savedPublic;
        publicLinkBox.classList.toggle('d-none', !enabled);
        publicLinkBox.hidden = !enabled;
        setOpenPublicUrlEnabled(ready);
        if (publicSaveHint) {
            publicSaveHint.classList.toggle('d-none', ready);
            publicSaveHint.hidden = ready;
        }
        if (publicActiveHint) {
            publicActiveHint.classList.toggle('d-none', !ready);
            publicActiveHint.hidden = !ready;
        }
    }

    publicCheckbox.addEventListener('change', syncPublicLinkUi);
    syncPublicLinkUi();

    if (openPublicUrlBtn) {
        openPublicUrlBtn.addEventListener('click', function (e) {
            if (openPublicUrlBtn.classList.contains('disabled') || openPublicUrlBtn.getAttribute('aria-disabled') === 'true') {
                e.preventDefault();
                alert('Primero marca el checkbox y pulsa Guardar para activar el link público.');
            }
        });
    }

    if (copyPublicUrlBtn && publicUrlInput) {
        copyPublicUrlBtn.addEventListener('click', function () {
            if (!savedPublic || !publicCheckbox.checked) {
                alert('Primero marca el checkbox y pulsa Guardar para activar el link público.');
                return;
            }
            const value = publicUrlInput.value || '';
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).then(function () {
                    copyPublicUrlBtn.textContent = 'Copiado';
                }).catch(function () {
                    publicUrlInput.select();
                    document.execCommand('copy');
                });
            } else {
                publicUrlInput.select();
                document.execCommand('copy');
            }
        });
    }
});
