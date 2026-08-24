# Licencias (portal usuario)

- **URL:** `/tienda/licencias` — cuentas asignadas, días 1–31 del mes, estados verde (renovar / mes a mes / no renovar) y rojo (incidencias).
- **Caducidad:** vista que agrupa licencias que vencen en los próximos 5 días; avisos en pantalla y opcionalmente notificación del navegador.
- **Historial:** `/tienda/historial_compras#purchaseHistoryLicenciasSection` — entregas, reportes, renovaciones (tercer bloque en Historial de Compra). El resumen muestra producto y correo; la **fecha** va en su columna (no repetir «Día N» en el texto).
- **Saldo cuenta Licencias:** `users.saldo` — 0 = «Pagada» en portal; mayor que 0 = pendiente de cobro. Distinto del saldo prepago de la tienda.
- **Renovación automática:** cada día de calendario (Colombia) el sistema intenta cobrar un mes a quien tenga «Renovar 1 mes más» o «Dejar mes a mes» en el día correspondiente. Si no hay saldo suficiente o supera el límite de deuda, **no renueva** y la cuenta puede pasar a **vencidas** según la política del producto.
- **Subusuarios:** facturación y saldos del usuario **principal** (padre).

## Estados y acciones
- **Renovar 1 mes más:** solicita continuar por otro periodo cuando llegue el día aplicable.
- **Dejar mes a mes:** mantiene la cuenta en el ciclo mensual mientras se cumplan saldo, límite y reglas del producto.
- **No renovar:** indica que no debe continuar al terminar el periodo.
- Los estados rojos describen incidencias o suspensión; no deben confundirse con el estado de pago.

## Reportar y renovar
- Desde el portal de Licencias se pueden revisar cuentas asignadas, vencimientos y opciones disponibles.
- Los productos de renovación de cuenta del cliente pueden pedir que se envíe la cuenta para que el equipo la enlace o renueve.
- En Historial aparecen entregas, reportes y renovaciones. Para soporte indica producto y fecha, nunca la contraseña.

## Qué puede consultar el asistente
- Cantidad de licencias propias activas, producto y próximo vencimiento aproximado.
- Saldo pendiente de licencias y orientación sobre renovación.
- No muestra identificadores completos, correos, usuarios, contraseñas, notas privadas del admin ni cuentas de otras personas.

## Si una renovación falla
1. Revisa el estado elegido para la cuenta.
2. Confirma saldo y límite de deuda de la cuenta principal.
3. Comprueba si la cuenta ya venció o tiene una incidencia.
4. Si todo parece correcto, contacta soporte con producto y fecha.
