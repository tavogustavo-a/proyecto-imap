# Tienda (portal cliente)

- **URL:** `/tienda` — catálogo de productos, carrito y pago con saldo prepago (USD o COP según tipo de precio del usuario).
- **Saldo prepago:** se muestra en el menú lateral (`saldo_usd` / `saldo_cop`). Las compras descuentan ese saldo.
- **Límite de deuda:** si el usuario tiene «Puede tener deuda» en permisos, existe un tope (`limite_deuda_usd` / `limite_deuda_cop`) que aplica al checkout de la tienda, no a ventas manuales del admin en licencias.
- **Recargas de saldo:** `/tienda/recargas-saldo` — el cliente sube **una foto** del comprobante de transferencia; un administrador revisa y acredita el saldo.
- **Renovación manual:** desde la tienda, modal «Renovación» para buscar cuentas propias y reservar renovación en carrito.

## Comprar
1. Abre el catálogo y selecciona la cantidad disponible del producto.
2. Revisa el carrito, la moneda y el total antes de confirmar.
3. El servidor vuelve a validar precio, permisos, saldo y existencias; lo mostrado en el navegador no reemplaza esa validación.
4. Después de una compra correcta, consulta la entrega desde Historial de compra o Licencias.

## Reservas y disponibilidad
- Si un producto admite reserva y no tiene stock, puede ofrecer una lista de espera.
- Algunos productos permiten programar la entrega para el día siguiente.
- Una reserva no equivale a una entrega hasta que el sistema confirme disponibilidad y cobro.

## Usuarios y subusuarios
- El catálogo y la moneda dependen de los permisos y tipo de precio asignados.
- Un subusuario puede usar permisos de la cuenta principal; su facturación y saldo visible pueden corresponder al padre.
- Si un producto no aparece, puede estar deshabilitado, archivado o fuera del rol asignado.

## Problemas frecuentes
- **Saldo insuficiente:** revisa que estés mirando la moneda correcta y solicita una recarga.
- **Producto agotado:** comprueba si admite reserva o espera nuevo inventario.
- **Compra no visible:** revisa Historial y Licencias con la cuenta principal; si persiste, contacta soporte con fecha y producto.
- El asistente nunca devuelve las credenciales de una compra; deben consultarse en la pantalla protegida correspondiente.
