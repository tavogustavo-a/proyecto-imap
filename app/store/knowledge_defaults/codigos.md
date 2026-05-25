# Códigos (búsqueda IMAP / páginas públicas)

- **Inicio / Códigos:** la ruta raíz `/` (menú «Códigos») es la página de **búsqueda de códigos** en correos: el usuario elige servicio, filtro y busca mensajes en buzones IMAP configurados.
- **Páginas personalizadas:** rutas como `/codigos4`, `/pagina2`, etc. provienen de servidores **IMAP2** (`route_path` en administración). También pueden usarse **dominios personalizados** que apuntan a esa página.
- **Permisos:** según el usuario puede buscar solo correos permitidos o cualquier correo (`can_search_any`). Los administradores configuran servicios, filtros y regex en el panel admin.
- **SMS:** si el servicio SMS está activo, aparece la opción de consultar SMS vinculados a números permitidos.
- **No confundir** con el generador de códigos aleatorios de las hojas de cálculo admin (herramienta interna distinta).
