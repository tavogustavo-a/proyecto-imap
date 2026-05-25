# Guía rápida para agentes de soporte

## Cómo usar este asistente
- Escribe o usa el **micrófono** (voz del navegador, gratis) para preguntar.
- Las respuestas se basan en la **base de conocimiento** (textos de la tienda, notas que subas, resúmenes de videos de YouTube/NotebookLM).
- Para mejor calidad, configura en el servidor una clave gratuita **GEMINI_API_KEY** (Google AI Studio) o **GROQ_API_KEY**; sin clave, el bot responde solo con los fragmentos encontrados en la base.

## Añadir conocimiento desde YouTube / NotebookLM
1. En NotebookLM (gratis con cuenta Google), sube el video o enlace de YouTube y genera el resumen.
2. En esta página, sección «Base de conocimiento», pega el resumen en el campo de texto y opcionalmente el enlace del video.
3. Guarda; el bot usará ese contenido en las próximas preguntas.

## Temas frecuentes
- **Recarga no acreditada:** revisar solicitud en recargas de saldo y saldo prepago del usuario.
- **No renovó automático:** verificar saldo cuenta licencias, límite de deuda, estado verde en el día del calendario, y si la cuenta ya está vencida.
- **No encuentra código:** revisar permisos del usuario, servicio seleccionado y filtros en la página Códigos.
