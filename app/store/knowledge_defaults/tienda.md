# Tienda (portal cliente)

- **URL:** `/tienda` — catálogo de productos, carrito y pago con saldo prepago (USD o COP según tipo de precio del usuario).
- **Saldo prepago:** se muestra en el menú lateral (`saldo_usd` / `saldo_cop`). Las compras descuentan ese saldo.
- **Límite de deuda:** si el usuario tiene «Puede tener deuda» en permisos, existe un tope (`limite_deuda_usd` / `limite_deuda_cop`) que aplica al checkout de la tienda, no a ventas manuales del admin en licencias.
- **Recargas de saldo:** `/tienda/recargas-saldo` — el cliente sube **una foto** del comprobante de transferencia; un administrador revisa y acredita el saldo.
- **Renovación manual:** desde la tienda, modal «Renovación» para buscar cuentas propias y reservar renovación en carrito.
