# Licencias (portal usuario)

- **URL:** `/tienda/licencias` — cuentas asignadas, días 1–31 del mes, estados verde (renovar / mes a mes / no renovar) y rojo (incidencias).
- **Caducidad:** vista que agrupa licencias que vencen en los próximos 5 días; avisos en pantalla y opcionalmente notificación del navegador.
- **Historial:** `/tienda/historial_compras#purchaseHistoryLicenciasSection` — entregas, reportes, renovaciones (tercer bloque en Historial de Compra). El resumen muestra producto y correo; la **fecha** va en su columna (no repetir «Día N» en el texto).
- **Saldo cuenta Licencias:** `users.saldo` — 0 = «Pagada» en portal; mayor que 0 = pendiente de cobro. Distinto del saldo prepago de la tienda.
- **Renovación automática:** cada día de calendario (Colombia) el sistema intenta cobrar un mes a quien tenga «Renovar 1 mes más» o «Dejar mes a mes» en el día correspondiente. Si no hay saldo suficiente o supera el límite de deuda, **no renueva** y la cuenta puede pasar a **vencidas** según la política del producto.
- **Subusuarios:** facturación y saldos del usuario **principal** (padre).
