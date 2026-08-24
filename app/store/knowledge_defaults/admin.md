# Operación administrativa del proyecto

## Alcance del administrador
- El administrador configura usuarios, permisos, tienda, productos, licencias, recargas, servicios de códigos, filtros, integraciones y soporte.
- El centro de integraciones del chatbot permite añadir conocimiento y clasificarlo como visible para usuarios o solo para administración.
- Las explicaciones administrativas deben describir el proceso, las validaciones y dónde revisarlo, sin copiar secretos ni credenciales.

## Usuarios y permisos
- Un usuario principal puede tener subusuarios. Los permisos de tienda, licencias, soporte, búsqueda y administración de subusuarios se validan en el servidor.
- El nombre configurado como administrador no basta por sí solo: también se requiere una sesión administrativa y que la cuenta no sea subusuario.
- Las cuentas de soporte tienen permisos específicos y no deben tratarse automáticamente como administrador.
- En usuarios se administran acceso a tienda, chat, búsquedas, correos permitidos, subusuarios, tipo de precio y funciones de licencias. Cada endpoint debe volver a comprobar el permiso.
- Importar o exportar configuración requiere un código secreto y debe manejarse fuera del chatbot.

## Tienda y licencias
- La tienda administra catálogo, precios USD/COP, compras, saldo prepago, cupones, reservas y renovaciones.
- Admin Licencias administra inventario, asignaciones, días del calendario, incidencias, vencidas, renovaciones y saldo pendiente.
- El saldo prepago y el saldo pendiente de licencias son conceptos separados.
- Productos controla catálogo, precios, visibilidad y relación con inventario. Cupones y roles limitan descuentos y productos disponibles.
- Admin Licencias separa inventario disponible, entregas por día, caídas, vencidas, cambios, cuentas para renovar y proveedores. Los blocs pueden contener datos confidenciales y nunca entran al contexto del asistente.
- Reservas pueden ser por falta de stock o programadas para el día siguiente; solo una entrega confirmada debe considerarse venta completada.

## Códigos e integraciones
- El módulo Códigos consulta IMAP/SMS bajo permisos, servicios, filtros y expresiones configuradas.
- Los proyectos vinculados usan URL y token; esos tokens nunca deben copiarse en conocimiento ni mostrarse en respuestas.
- Las APIs de licencias y códigos tienen tokens independientes.
- Servicios, filtros y expresiones determinan qué mensaje se busca y qué parte se devuelve. Los usuarios normales siguen sus correos permitidos y reglas de búsqueda.
- Probar una API vinculada verifica que el remoto responda JSON válido en el endpoint esperado; una página HTML con estado 200 no cuenta como conexión correcta.

## Integrar correo (detalle técnico solo bajo consulta del administrador)
- Cuando el administrador pregunte expresamente por integrar un correo o por IMAP, se puede explicar que el sistema conecta un buzón mediante servidor, puerto, cifrado y credenciales configuradas en el panel protegido.
- IMAP permite leer los mensajes del buzón sin depender de una sesión abierta en el navegador. Los servicios y filtros deciden qué mensajes se revisan y qué resultado permitido se devuelve.
- Antes de guardar, hay que confirmar proveedor, servidor, puerto seguro y acceso de la cuenta. Algunos proveedores requieren una contraseña de aplicación.
- Las credenciales del correo nunca deben escribirse en el chatbot ni aparecer en su respuesta; se introducen únicamente en el formulario administrativo correspondiente.
- Si la prueba falla, revisar conectividad, puerto, cifrado, permiso del proveedor y estado del buzón, sin copiar la contraseña en logs o notas.

## Seguridad y sesiones
- La capa de seguridad controla registros temporales, observación y sesiones. Cerrar sesiones o regenerar tokens son acciones administrativas explícitas.
- El asistente no ejecuta cambios destructivos, no regenera tokens y no modifica permisos; solo explica dónde realizar la operación.
- Los datos de autenticación, logs con contenido sensible, claves de cifrado y secretos de proveedores quedan fuera de la base de conocimiento.

## Recargas y soporte
- Las recargas pasan por estados de revisión y acreditación. Los comprobantes y datos del método de pago son confidenciales.
- El chat de soporte es privado entre participantes autorizados; el chatbot de conocimiento no debe leerlo.
- El panel de recargas permite revisar estados y acreditar el saldo correcto. El asistente solo usa conteos agregados para administración.
- Configuraciones reúne ajustes y herramientas de la tienda; cambiar un ajuste requiere usar el formulario administrativo correspondiente.

## Aplicación móvil
- El proyecto incluye un cliente Android que abre flujos web autorizados. La autorización y los permisos siguen validándose en el servidor.
- Los enlaces externos deben abrirse con controles de navegación seguros; el chatbot no entrega enlaces privados ni tokens de acceso.

## Diagnóstico seguro
- El asistente puede dar conteos agregados de usuarios, productos, ventas recientes, licencias y recargas pendientes cuando la pregunta lo necesite.
- Para investigar un caso individual, el administrador debe abrir el módulo correspondiente. El asistente no expone contraseñas, tokens, correos completos, cuerpos de mensajes ni archivos privados.
