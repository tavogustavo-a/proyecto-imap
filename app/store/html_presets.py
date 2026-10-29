"""Plantillas HTML preconfiguradas (contenido generado en runtime; ver preset_key)."""

from __future__ import annotations

import copy
import json
import re

from markupsafe import Markup, escape

# (clave estable, título mostrado en el selector)
HTML_PRESET_CHOICES: tuple[tuple[str, str], ...] = (
    ('medios_de_pago', 'Medios De Pago Que Recibo'),
    ('como_trabajo', 'Como Trabajo Rapida explicacion'),
    ('resumen_consultas_codigos', 'Resumen de las Consultas de la Pagina de Codigos'),
    ('foto_pantallas_perfiles_tv', 'Foto de pantallas, perfiles, links de tv'),
    ('busqueda_medios', 'Búsqueda de Medios'),
    ('drive_fotos_peliculas', 'Drive para fotos y películas'),
)

HTML_PRESET_KEYS = frozenset(k for k, _ in HTML_PRESET_CHOICES)

MEDIOS_DE_PAGO_KEY = 'medios_de_pago'
COMO_TRABAJO_KEY = 'como_trabajo'
RESUMEN_CODIGOS_KEY = 'resumen_consultas_codigos'
FOTO_PANTALLAS_KEY = 'foto_pantallas_perfiles_tv'
BUSQUEDA_MEDIOS_KEY = 'busqueda_medios'
DRIVE_FOTOS_PELICULAS_KEY = 'drive_fotos_peliculas'
_MAIN_TITLE_DEFAULT = 'medios de pago que recibo'
_CODIGOS_TITLE_DEFAULT = 'resumen de las consultas de la pagina de codigos'
_CODIGOS_INTRO = (
    'Cada botón consulta los códigos de ese servicio. '
    'La lista es lo que muestra su icono de información.'
)
_CODIGOS_PALETTE = ('#1e88e5', '#00acc1', '#2e9d57', '#f04436', '#7e57c2', '#fb8c00')
_CODIGOS_GUEST_COLOR = '#1e88e5'
_HEX_COLOR = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
_DOMAIN_RE = re.compile(
    r'^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:/[^\s]*)?$'
)
# Atajos sin TLD (p. ej. primevideo/mytv → https://www.primevideo.com/mytv)
_TV_BRAND_SHORTCUTS: dict[str, str] = {
    'primevideo': 'www.primevideo.com',
    'netflix': 'www.netflix.com',
    'disneyplus': 'www.disneyplus.com',
    'max': 'www.max.com',
    'hbomax': 'www.max.com',
    'hulu': 'www.hulu.com',
    'crunchyroll': 'www.crunchyroll.com',
    'paramountplus': 'www.paramountplus.com',
    'plex': 'www.plex.tv',
    'spotify': 'open.spotify.com',
    'deezer': 'www.deezer.com',
    'directvgo': 'www.directvgo.com',
    'vix': 'www.vix.com',
    'canva': 'www.canva.com',
    'youtube': 'www.youtube.com',
    'winplay': 'www.winplay.co',
}


def _tv_brand_linkify_alternation() -> str:
    return '|'.join(
        re.escape(key)
        for key in sorted(_TV_BRAND_SHORTCUTS, key=len, reverse=True)
    )


_LINKIFY_RE = re.compile(
    r'(https?://[^\s<]+|(?<![\w@])(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:/[^\s<]*)?'
    r'|(?<![\w@/])(?:' + _tv_brand_linkify_alternation() + r')/[^\s<]+)'
)
_TV_JOIN_ONLY = re.compile(
    r'^(?:\s*(?:o|y|u|or|and|/|,|;|\||&)\s*)*$',
    re.IGNORECASE,
)
_MAX_SECTIONS = 40
_MAX_SUBTITLES = 30

MEDIOS_PAGO_MAIN_ICONS: tuple[tuple[str, str], ...] = (
    ('👑', 'Corona'),
    ('💰', 'Dinero'),
    ('💳', 'Tarjeta'),
    ('🏦', 'Banco'),
    ('💵', 'Efectivo'),
    ('💎', 'Diamante'),
    ('⭐', 'Estrella'),
    ('✨', 'Brillo'),
    ('✅', 'Confirmado'),
    ('🔒', 'Seguro'),
    ('fa:crown', 'Corona (icono)'),
    ('fa:credit-card', 'Tarjeta crédito'),
    ('fa:wallet', 'Billetera'),
    ('fa:money-bill-wave', 'Billete'),
    ('fa:coins', 'Monedas'),
    ('fa:gem', 'Gema'),
    ('fa:star', 'Estrella (icono)'),
    ('fa:university', 'Banco (icono)'),
    ('fa:hand-holding-usd', 'Pago'),
    ('fa:shield-alt', 'Protección'),
)

MEDIOS_PAGO_MAIN_ICON_VALUES = frozenset(value for value, _ in MEDIOS_PAGO_MAIN_ICONS)
_MAIN_ICON_DEFAULT = '👑'
_COMO_TITLE_DEFAULT = 'Cómo trabajo — Guía rápida'
_COMO_ICON_DEFAULT = '🛠️'

_COMO_TRABAJO_EXTRA_ICONS: tuple[tuple[str, str], ...] = (
    # Emojis
    ('🛠️', 'Herramientas'),
    ('🔧', 'Llave'),
    ('⚙️', 'Engranaje'),
    ('📵', 'Sin llamadas'),
    ('📞', 'Llamada'),
    ('☎️', 'Teléfono'),
    ('📱', 'Celular'),
    ('📲', 'Móvil'),
    ('💬', 'Chat'),
    ('🗨️', 'Mensaje'),
    ('💭', 'Pensamiento'),
    ('🗣️', 'Hablar'),
    ('🔍', 'Revisión'),
    ('🔎', 'Buscar'),
    ('🛡️', 'Garantía'),
    ('⚔️', 'Escudo'),
    ('📝', 'Reporte'),
    ('✏️', 'Lápiz'),
    ('🖊️', 'Bolígrafo'),
    ('📋', 'Lista'),
    ('📌', 'Pin'),
    ('📍', 'Ubicación'),
    ('🔄', 'Renovación'),
    ('♻️', 'Reciclar'),
    ('🔁', 'Repetir'),
    ('↩️', 'Volver'),
    ('↪️', 'Seguir'),
    ('⚠️', 'Aviso'),
    ('❗', 'Importante'),
    ('‼️', 'Doble'),
    ('❓', 'Pregunta'),
    ('❔', 'Duda'),
    ('ℹ️', 'Info'),
    ('🧩', 'Fallas'),
    ('🏷️', 'Precios'),
    ('💵', 'Billete'),
    ('💴', 'Yen'),
    ('💶', 'Euro'),
    ('💷', 'Libra'),
    ('💸', 'Gasto'),
    ('📅', 'Calendario'),
    ('🗓️', 'Agenda'),
    ('⏰', 'Reloj'),
    ('⏳', 'Espera'),
    ('⏱️', 'Cronómetro'),
    ('🎨', 'Canva'),
    ('🖼️', 'Imagen'),
    ('✅', 'OK'),
    ('☑️', 'Check'),
    ('✔️', 'Correcto'),
    ('❌', 'No'),
    ('❎', 'Cruz'),
    ('⛔', 'Prohibido'),
    ('🚫', 'Bloqueado'),
    ('🛑', 'Stop'),
    ('👍', 'Bien'),
    ('👎', 'Mal'),
    ('👏', 'Aplauso'),
    ('🙏', 'Gracias'),
    ('👀', 'Revisar'),
    ('👁️', 'Ver'),
    ('🙈', 'No ver'),
    ('🔐', 'Candado'),
    ('🔒', 'Cerrado'),
    ('🔓', 'Abierto'),
    ('🔑', 'Llave'),
    ('🗝️', 'Llave vieja'),
    ('📧', 'Correo'),
    ('✉️', 'Carta'),
    ('📨', 'Entrante'),
    ('📩', 'Bandeja'),
    ('🔔', 'Campana'),
    ('🔕', 'Silencio'),
    ('📢', 'Anuncio'),
    ('📣', 'Megáfono'),
    ('💡', 'Idea'),
    ('⚡', 'Rápido'),
    ('🔥', 'Urgente'),
    ('💥', 'Boom'),
    ('✨', 'Brillo'),
    ('⭐', 'Estrella'),
    ('🌟', 'Destacado'),
    ('🎯', 'Objetivo'),
    ('🏆', 'Trofeo'),
    ('🥇', 'Primero'),
    ('🎉', 'Fiesta'),
    ('📦', 'Caja'),
    ('📮', 'Buzón'),
    ('📤', 'Enviado'),
    ('📥', 'Recibido'),
    ('🎁', 'Regalo'),
    ('🛒', 'Carrito'),
    ('🛍️', 'Bolsas'),
    ('🏪', 'Tienda'),
    ('🏬', 'Centro'),
    ('🏦', 'Banco'),
    ('🚚', 'Envío'),
    ('🚛', 'Camión'),
    ('✈️', 'Avión'),
    ('🚀', 'Cohete'),
    ('🖥️', 'PC'),
    ('💻', 'Laptop'),
    ('⌨️', 'Teclado'),
    ('🖱️', 'Mouse'),
    ('🖨️', 'Impresora'),
    ('📺', 'TV'),
    ('📷', 'Cámara'),
    ('🎥', 'Video'),
    ('🎬', 'Claqueta'),
    ('🎮', 'Juego'),
    ('📶', 'Señal'),
    ('📡', 'Antena'),
    ('🌐', 'Web'),
    ('🌍', 'Mundo'),
    ('🔗', 'Enlace'),
    ('⛓️', 'Cadena'),
    ('📎', 'Adjunto'),
    ('🖇️', 'Clips'),
    ('📂', 'Carpeta'),
    ('📁', 'Archivo'),
    ('🗂️', 'Índice'),
    ('📄', 'Hoja'),
    ('📃', 'Página'),
    ('📑', 'Marcadores'),
    ('📊', 'Gráfico'),
    ('📈', 'Subida'),
    ('📉', 'Bajada'),
    ('🧾', 'Recibo'),
    ('🧮', 'Cálculo'),
    ('🧑‍💻', 'Soporte'),
    ('👨‍💻', 'Dev'),
    ('👩‍💻', 'Deva'),
    ('🤝', 'Acuerdo'),
    ('🙌', 'Listo'),
    ('👋', 'Hola'),
    ('💪', 'Fuerte'),
    ('🧠', 'Mente'),
    ('❤️', 'Corazón'),
    ('💙', 'Azul'),
    ('💚', 'Verde'),
    ('🧡', 'Naranja'),
    ('🆗', 'OK badge'),
    ('🆕', 'Nuevo'),
    ('🆙', 'Up'),
    ('🆓', 'Gratis'),
    ('🆔', 'ID'),
    ('🆘', 'SOS'),
    ('💯', 'Cien'),
    ('🔢', 'Números'),
    ('🕐', '1h'),
    ('🌙', 'Noche'),
    ('☀️', 'Día'),
    ('⛅', 'Nube'),
    ('❄️', 'Frío'),
    ('🏠', 'Casa'),
    ('🏢', 'Oficina'),
    ('🏫', 'Escuela'),
    ('🛏️', 'Descanso'),
    ('🧹', 'Limpieza'),
    ('🧴', 'Botella'),
    ('🧪', 'Prueba'),
    ('🧯', 'Extintor'),
    # Font Awesome solid
    ('fa:tools', 'Herramientas FA'),
    ('fa:wrench', 'Llave inglesa'),
    ('fa:screwdriver-wrench', 'Kit herramientas'),
    ('fa:hammer', 'Martillo'),
    ('fa:phone', 'Teléfono'),
    ('fa:phone-slash', 'Sin teléfono'),
    ('fa:phone-volume', 'Llamada fuerte'),
    ('fa:mobile-alt', 'Móvil'),
    ('fa:mobile-screen', 'Pantalla móvil'),
    ('fa:comments', 'Chats'),
    ('fa:comment', 'Comentario'),
    ('fa:comment-dots', 'Mensaje'),
    ('fa:comment-slash', 'Sin chat'),
    ('fa:search', 'Buscar FA'),
    ('fa:magnifying-glass', 'Lupa'),
    ('fa:magnifying-glass-plus', 'Zoom +'),
    ('fa:shield-alt', 'Escudo'),
    ('fa:shield-halved', 'Escudo mitad'),
    ('fa:user-shield', 'Usuario protegido'),
    ('fa:shield-virus', 'Antivirus'),
    ('fa:file-alt', 'Archivo'),
    ('fa:file-lines', 'Documento'),
    ('fa:file-circle-check', 'Archivo OK'),
    ('fa:file-circle-xmark', 'Archivo error'),
    ('fa:clipboard-list', 'Portapapeles'),
    ('fa:clipboard-check', 'Portapapeles OK'),
    ('fa:list-check', 'Lista check'),
    ('fa:list-ul', 'Lista'),
    ('fa:list-ol', 'Lista num'),
    ('fa:pen', 'Lápiz'),
    ('fa:pen-to-square', 'Editar'),
    ('fa:pencil', 'Lápiz 2'),
    ('fa:eraser', 'Borrar'),
    ('fa:sync-alt', 'Sincronizar'),
    ('fa:arrows-rotate', 'Rotar'),
    ('fa:rotate', 'Girar'),
    ('fa:redo', 'Rehacer'),
    ('fa:undo', 'Deshacer'),
    ('fa:rotate-left', 'Rotar izq'),
    ('fa:rotate-right', 'Rotar der'),
    ('fa:exclamation-triangle', 'Alerta'),
    ('fa:exclamation-circle', 'Exclamación'),
    ('fa:circle-exclamation', 'Círculo alerta'),
    ('fa:triangle-exclamation', 'Triángulo'),
    ('fa:info-circle', 'Info FA'),
    ('fa:question-circle', 'Pregunta FA'),
    ('fa:circle-question', 'Ayuda'),
    ('fa:circle-info', 'Info círculo'),
    ('fa:puzzle-piece', 'Pieza'),
    ('fa:tags', 'Etiquetas'),
    ('fa:tag', 'Etiqueta'),
    ('fa:calendar', 'Calendario FA'),
    ('fa:calendar-days', 'Días'),
    ('fa:calendar-check', 'Agenda OK'),
    ('fa:calendar-xmark', 'Agenda no'),
    ('fa:clock', 'Reloj FA'),
    ('fa:stopwatch', 'Cronómetro FA'),
    ('fa:hourglass-half', 'Reloj arena'),
    ('fa:palette', 'Paleta'),
    ('fa:paint-brush', 'Pincel'),
    ('fa:brush', 'Brocha'),
    ('fa:check', 'Check'),
    ('fa:check-double', 'Doble check'),
    ('fa:check-circle', 'Check círculo'),
    ('fa:circle-check', 'OK círculo'),
    ('fa:times', 'Cerrar'),
    ('fa:xmark', 'X'),
    ('fa:ban', 'Prohibido FA'),
    ('fa:circle-xmark', 'No círculo'),
    ('fa:thumbs-up', 'Pulgar arriba'),
    ('fa:thumbs-down', 'Pulgar abajo'),
    ('fa:hand', 'Mano'),
    ('fa:handshake', 'Apretón'),
    ('fa:eye', 'Ojo'),
    ('fa:eye-slash', 'Oculto'),
    ('fa:lock', 'Candado FA'),
    ('fa:unlock', 'Abrir'),
    ('fa:lock-open', 'Abierto FA'),
    ('fa:key', 'Llave FA'),
    ('fa:envelope', 'Correo FA'),
    ('fa:envelope-open', 'Correo abierto'),
    ('fa:envelope-circle-check', 'Correo OK'),
    ('fa:bell', 'Campana FA'),
    ('fa:bell-slash', 'Sin campana'),
    ('fa:bullhorn', 'Megáfono'),
    ('fa:lightbulb', 'Bombilla'),
    ('fa:bolt', 'Rayo'),
    ('fa:fire', 'Fuego'),
    ('fa:fire-extinguisher', 'Extintor'),
    ('fa:bullseye', 'Diana'),
    ('fa:crosshairs', 'Mira'),
    ('fa:box', 'Caja FA'),
    ('fa:boxes-stacked', 'Cajas'),
    ('fa:gift', 'Regalo FA'),
    ('fa:shopping-cart', 'Carrito FA'),
    ('fa:cart-shopping', 'Carrito 2'),
    ('fa:bag-shopping', 'Bolsa'),
    ('fa:store', 'Tienda FA'),
    ('fa:shop', 'Shop'),
    ('fa:truck', 'Camión'),
    ('fa:truck-fast', 'Envío rápido'),
    ('fa:plane', 'Avión'),
    ('fa:rocket', 'Cohete FA'),
    ('fa:desktop', 'Escritorio'),
    ('fa:laptop', 'Portátil'),
    ('fa:computer', 'PC FA'),
    ('fa:tv', 'Televisor'),
    ('fa:display', 'Monitor'),
    ('fa:camera', 'Cámara'),
    ('fa:video', 'Video FA'),
    ('fa:wifi', 'WiFi'),
    ('fa:signal', 'Señal FA'),
    ('fa:globe', 'Globo'),
    ('fa:earth-americas', 'Tierra'),
    ('fa:link', 'Link'),
    ('fa:unlink', 'Sin link'),
    ('fa:paperclip', 'Clip'),
    ('fa:folder', 'Carpeta FA'),
    ('fa:folder-open', 'Carpeta abierta'),
    ('fa:folder-plus', 'Carpeta +'),
    ('fa:receipt', 'Recibo FA'),
    ('fa:file-invoice', 'Factura'),
    ('fa:file-invoice-dollar', 'Factura $'),
    ('fa:headset', 'Audífonos'),
    ('fa:headphones', 'Auriculares'),
    ('fa:user', 'Usuario'),
    ('fa:users', 'Usuarios'),
    ('fa:user-check', 'Usuario OK'),
    ('fa:user-clock', 'Usuario espera'),
    ('fa:user-plus', 'Usuario +'),
    ('fa:user-xmark', 'Usuario x'),
    ('fa:user-gear', 'Usuario config'),
    ('fa:life-ring', 'Ayuda flotador'),
    ('fa:circle-plus', 'Agregar'),
    ('fa:circle-minus', 'Quitar'),
    ('fa:plus', 'Más'),
    ('fa:minus', 'Menos'),
    ('fa:arrow-right', 'Flecha der.'),
    ('fa:arrow-left', 'Flecha izq.'),
    ('fa:arrow-up', 'Flecha arriba'),
    ('fa:arrow-down', 'Flecha abajo'),
    ('fa:circle-right', 'Siguiente'),
    ('fa:circle-left', 'Anterior'),
    ('fa:house', 'Inicio'),
    ('fa:home', 'Casa'),
    ('fa:building', 'Edificio'),
    ('fa:gear', 'Engranaje'),
    ('fa:cog', 'Config'),
    ('fa:gears', 'Engranajes'),
    ('fa:sliders', 'Ajustes'),
    ('fa:filter', 'Filtro'),
    ('fa:download', 'Descargar'),
    ('fa:upload', 'Subir'),
    ('fa:cloud-arrow-up', 'Nube subir'),
    ('fa:cloud-arrow-down', 'Nube bajar'),
    ('fa:copy', 'Copiar'),
    ('fa:paste', 'Pegar'),
    ('fa:scissors', 'Cortar'),
    ('fa:share', 'Compartir'),
    ('fa:share-nodes', 'Compartir red'),
    ('fa:reply', 'Responder'),
    ('fa:reply-all', 'Responder todos'),
    ('fa:paper-plane', 'Enviar'),
    ('fa:heart', 'Corazón'),
    ('fa:star', 'Estrella FA'),
    ('fa:bookmark', 'Marcador'),
    ('fa:flag', 'Bandera'),
    ('fa:ticket', 'Ticket'),
    ('fa:ticket-simple', 'Ticket 2'),
    ('fa:id-card', 'ID'),
    ('fa:address-card', 'Tarjeta contacto'),
    ('fa:credit-card', 'Tarjeta FA'),
    ('fa:money-bill', 'Billete FA'),
    ('fa:money-bill-wave', 'Billete onda'),
    ('fa:money-check-dollar', 'Cheque'),
    ('fa:coins', 'Monedas FA'),
    ('fa:wallet', 'Billetera FA'),
    ('fa:piggy-bank', 'Alcancía'),
    ('fa:circle-dollar-to-slot', 'Donar'),
    ('fa:chart-line', 'Gráfico línea'),
    ('fa:chart-bar', 'Barras'),
    ('fa:chart-pie', 'Torta'),
    ('fa:percent', 'Porcentaje'),
    ('fa:calculator', 'Calculadora'),
    ('fa:database', 'Base datos'),
    ('fa:server', 'Servidor'),
    ('fa:code', 'Código'),
    ('fa:terminal', 'Terminal'),
    ('fa:bug', 'Bug'),
    ('fa:spider', 'Araña'),
    ('fa:robot', 'Robot'),
    ('fa:magic', 'Magia'),
    ('fa:wand-magic-sparkles', 'Varita'),
    ('fa:moon', 'Luna'),
    ('fa:sun', 'Sol'),
    ('fa:cloud', 'Nube'),
    ('fa:snowflake', 'Nieve'),
    ('fa:mug-hot', 'Café'),
    ('fa:utensils', 'Comida'),
    ('fa:bed', 'Cama'),
    ('fa:bath', 'Baño'),
    ('fa:dumbbell', 'Gimnasio'),
    ('fa:book', 'Libro'),
    ('fa:book-open', 'Libro abierto'),
    ('fa:graduation-cap', 'Estudio'),
    ('fa:chalkboard-user', 'Clase'),
    ('fa:language', 'Idioma'),
    ('fa:map', 'Mapa'),
    ('fa:map-location-dot', 'Ubicación FA'),
    ('fa:location-dot', 'Punto'),
    ('fa:compass', 'Brújula'),
    ('fa:qrcode', 'QR'),
    ('fa:barcode', 'Barras código'),
    ('fa:print', 'Imprimir'),
    ('fa:image', 'Imagen FA'),
    ('fa:images', 'Imágenes'),
    ('fa:photo-film', 'Foto film'),
    ('fa:play', 'Play'),
    ('fa:pause', 'Pausa'),
    ('fa:stop', 'Stop FA'),
    ('fa:forward', 'Adelante'),
    ('fa:backward', 'Atrás'),
    ('fa:power-off', 'Apagar'),
    ('fa:plug', 'Enchufe'),
    ('fa:battery-full', 'Batería'),
)

def _dedupe_icons(items: tuple[tuple[str, str], ...]) -> tuple[tuple[str, str], ...]:
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for value, label in items:
        if value in seen:
            continue
        seen.add(value)
        out.append((value, label))
    return tuple(out)


COMO_TRABAJO_ICONS: tuple[tuple[str, str], ...] = _dedupe_icons(
    (('none', 'Ninguno'),) + _COMO_TRABAJO_EXTRA_ICONS + MEDIOS_PAGO_MAIN_ICONS
)

COMO_TRABAJO_ICON_VALUES = frozenset(value for value, _ in COMO_TRABAJO_ICONS)

COMO_TRABAJO_DEFAULT: dict = {
    'main_title': _COMO_TITLE_DEFAULT,
    'main_icon': _COMO_ICON_DEFAULT,
    'sections': [
        {
            'icon': '📵',
            'title': 'Comunicación',
            'color': '#1e88e5',
            'subtitles': [
                'No atiendo llamadas. Toda atención es por chat/WhatsApp.',
            ],
            'description': '',
        },
        {
            'icon': '💳',
            'title': 'Pagos y solicitudes',
            'color': '#00acc1',
            'subtitles': [
                'Para evitar estafas, solo entrego cuentas con pago confirmado.',
                'Por favor, evita pedir cuentas si aún no has pagado.',
            ],
            'description': '',
        },
        {
            'icon': '🔍',
            'title': 'Revisión antes de reportar',
            'color': '#2e9d57',
            'subtitles': [
                'Verifica si realmente hay un problema antes de reportar.',
                'Prueba en modo incógnito.',
                'En celular, activa “vista de escritorio” si necesitas crear perfiles.',
                'Si una app pide código o marca error de contraseña, pero igual entra, haz esto',
                'Celular: desinstala y vuelve a instalar la app en ocaciones es mejor reiniciar tambien.',
                'PC: elimina historial/cache del navegador.',
            ],
            'description': '',
        },
        {
            'icon': '🛡️',
            'title': 'Garantía y “barridas”',
            'color': '#f04436',
            'subtitles': [
                'Garantía hasta la fecha de caducidad: 30 días.',
                'Febrero: garantía de 28 días (mes corto).',
                'Si ocurre una barrida de cuentas, la garantía aplica dentro de esos plazos',
                'les recuerdo que todos los febreros los 28 se quitan las cuentas del 28,29,30 y 31, al ser el único mes con menos días siempre se hace de esta manera',
            ],
            'description': '',
        },
        {
            'icon': '📝',
            'title': 'Cómo reportar un problema (en un solo párrafo)',
            'color': '#7e57c2',
            'subtitles': [
                'Formatos:',
                'correo · contraseña · problema',
                'correo · contraseña · cambio de contraseña',
                'correo · contraseña · problema principal',
                'Ejemplos (copiar/pegar):',
                'Disney.ejb@yopmail.com 123456 cambio de contraseña',
                'Disney.ejb@yopmail.com 123456 código',
                'Disney.ejb@yopmail.com 123456 caida',
                'Disney.ejb@yopmail.com 123456 suspendida',
            ],
            'description': '',
        },
        {
            'icon': '🔄',
            'title': 'Renovaciones',
            'color': '#fb8c00',
            'subtitles': [
                'Si quieres renovar mes a mes hasta nuevo aviso, dímelo y la dejo anotada como “sigue mes a mes”.',
                'Si no estás seguro , avísame unos días antes (o un día antes) del vencimiento para confirmar si renueva .',
            ],
            'description': '',
        },
        {
            'icon': '⚠️',
            'title': 'Disponibilidad',
            'color': '#1e88e5',
            'subtitles': [
                'A veces pasan cosas inevitables: puede que no se pueda renovar una cuenta que venía mes a mes.',
                'No es lo común; si sucede, explicare el motivo .',
            ],
            'description': '',
        },
        {
            'icon': '🧩',
            'title': 'Fallas comunes de plataformas',
            'color': '#00acc1',
            'subtitles': [
                'Las plataformas fallan a veces. La solución más rápida suele ser reinstalar la aplicación (celular/PC).',
                'En TV es más complejo desinstalar; en la mayoría de los casos, se puede ingresar normal .',
            ],
            'description': '',
        },
        {
            'icon': '🏷️',
            'title': 'Precios, stock y avisos',
            'color': '#2e9d57',
            'subtitles': [
                'Actualizo precios y ventas en mi perfil de WhatsApp y aquí.',
                'Si ves una plataforma tachada (p. ej., Netflix) pero con precio, significa que está solo para renovaciones (sin stock para venta nueva).',
            ],
            'description': '',
        },
        {
            'icon': '📅',
            'title': 'Regla especial de febrero',
            'color': '#f04436',
            'subtitles': [
                'Como febrero tiene 28 días , las cuentas con vencimiento 29/30/31 se ajustan al día 28',
            ],
            'description': '',
        },
        {
            'icon': '🎨',
            'title': 'Sobre Canva',
            'color': '#7e57c2',
            'subtitles': [
                'Manejo Canva Estudiantil (cumple como Pro para la mayoría de usos).',
                'No doy soporte para Canva: debes enviarme el correo y aceptar el enlace de invitación.',
                'Si el cliente no puede ubicar el correo/aceptar el enlace, prefiero cancelar la venta (salvo caídas generales).',
            ],
            'description': '',
        },
    ],
}
_FA_ICON_NAME = re.compile(r'^[\w-]+$')

MEDIOS_DE_PAGO_DEFAULT: dict = {
    'main_title': _MAIN_TITLE_DEFAULT,
    'main_icon': _MAIN_ICON_DEFAULT,
    'sections': [
        {
            'title': 'PAGOS INTERNACIONALES',
            'color': '#1e88e5',
            'subtitles': [
                'Criptomonedas (preferiblemente Binance)',
                'PayPal',
            ],
            'description': 'Ambos métodos son ideales para clientes fuera de Colombia.',
            'url': '',
        },
        {
            'title': 'PAGOS EN COLOMBIA',
            'color': '#00acc1',
            'subtitles': [
                'Nequí',
                'Bancolombia',
                'Daviplata (disponible según el monto)',
            ],
            'description': 'Si no cuentas con estos medios, puedes pagar fácilmente con PSE - Nequí:',
            'url': 'https://clientes.nequi.com.co/recargas',
        },
        {
            'title': 'TRANSFERENCIAS POR LLAVE',
            'color': '#2e9d57',
            'subtitles': [
                'Acepto pagos por llave desde cualquier banco colombiano, llegan rápido y sin costo adicional.',
            ],
            'description': '',
            'url': '',
        },
    ],
}


def html_preset_label(key: str | None) -> str | None:
    if not key:
        return None
    for k, label in HTML_PRESET_CHOICES:
        if k == key:
            return label
    return None


def _clean_color(raw: str | None, fallback: str = '#1e88e5') -> str:
    value = (raw or '').strip()
    if not _HEX_COLOR.fullmatch(value):
        return fallback
    if len(value) == 4:
        return '#' + ''.join(ch * 2 for ch in value[1:])
    return value.lower()


def _clip(raw: str | None, limit: int) -> str:
    return (raw or '').strip()[:limit]


def _tv_shorthand_href(text: str) -> str | None:
    """Convierte marca/ruta sin TLD (primevideo/mytv) en URL https."""
    s = (text or '').strip()
    if not s or any(ch.isspace() for ch in s):
        return None
    if s.lower().startswith(('http://', 'https://', 'javascript:', 'data:', 'vbscript:')):
        return None
    if '.' in s.split('/')[0]:
        return None
    if '/' not in s:
        return None
    brand, _, tail = s.partition('/')
    host = _TV_BRAND_SHORTCUTS.get(brand.lower())
    if not host or not tail.strip():
        return None
    path = '/' + tail.lstrip('/')
    if any(ch in path for ch in (' ', '<', '>', '"', '\n', '\r')):
        return None
    return 'https://' + host + path


def _safe_href(raw: str | None) -> str | None:
    text = (raw or '').strip()
    if not text or any(ch.isspace() for ch in text):
        return None
    lower = text.lower()
    if lower.startswith(('javascript:', 'data:', 'vbscript:')):
        return None
    if lower.startswith(('http://', 'https://')):
        return text
    if _DOMAIN_RE.fullmatch(text):
        return 'https://' + text
    shorthand = _tv_shorthand_href(text)
    if shorthand:
        return shorthand
    return None


def favicon_url_for(raw: str | None) -> str | None:
    """Favicon actual del dominio de la página oficial."""
    href = _safe_href(raw)
    if not href:
        return None
    from urllib.parse import quote, urlparse

    host = (urlparse(href).hostname or '').strip().lower()
    if not host or '.' not in host:
        return None
    page = quote(href, safe='')
    return (
        'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON'
        '&fallback_opts=TYPE,SIZE,URL&url=' + page + '&size=128'
    )


_FAVICON_LOGIN_LABELS = frozenset({
    'id', 'auth', 'login', 'account', 'accounts', 'signin', 'sso', 'myaccount',
})


def favicon_lookup_hosts(raw: str | None) -> list[str]:
    """Dominios a consultar. Un login (id.youtube.com) usa primero el sitio principal."""
    href = _safe_href(raw)
    if not href:
        return []
    from urllib.parse import urlparse

    host = (urlparse(href).hostname or '').strip('.').lower()
    if not host or '.' not in host:
        return []
    labels = host.split('.')
    hosts: list[str] = []

    def add(value: str) -> None:
        value = (value or '').strip('.').lower()
        if value and '.' in value and value not in hosts:
            hosts.append(value)

    if len(labels) >= 3 and labels[0] in _FAVICON_LOGIN_LABELS:
        apex = '.'.join(labels[1:])
        add(apex)
        add('www.' + apex)
    add(host)
    if host.startswith('www.') and len(labels) > 2:
        add('.'.join(labels[1:]))
    else:
        add('www.' + host)
    return hosts


def favicon_source_urls(raw: str | None) -> list[str]:
    """Servicios de iconos, en el orden en que hay que probarlos."""
    urls: list[str] = []
    for host in favicon_lookup_hosts(raw):
        gstatic = favicon_url_for('https://' + host + '/')
        if gstatic and gstatic not in urls:
            urls.append(gstatic)
        s2 = 'https://www.google.com/s2/favicons?domain=' + host + '&sz=128'
        if s2 not in urls:
            urls.append(s2)
        if len(urls) >= 4:
            break
    return urls


def favicon_source_page(row: dict) -> str:
    """Página de la que sale el favicon: la oficial, o la de activación si la oficial no es web."""
    for key in ('pagina', 'activacion'):
        value = (row.get(key) or '').strip()
        if value and favicon_url_for(value):
            return value
    return ''


def _url_label(raw: str, href: str) -> str:
    label = (raw or href).strip()
    lower = label.lower()
    if lower.startswith('https://'):
        label = label[8:]
    elif lower.startswith('http://'):
        label = label[7:]
    return label


def _linkify_text(text: str) -> Markup:
    """Convierte URLs sueltas en enlaces azules y escapa el resto."""
    if not text:
        return Markup('')
    parts: list[Markup] = []
    cursor = 0
    for match in _LINKIFY_RE.finditer(text):
        token = match.group(0)
        end = match.end()
        trailing = ''
        while token and token[-1] in '.,;:!?)]\'"':
            trailing = token[-1] + trailing
            token = token[:-1]
            end -= 1
        parts.append(escape(text[cursor:match.start()]))
        href = _safe_href(token)
        if href:
            parts.append(
                Markup('<a class="mdp-url" href="')
                + escape(href)
                + Markup('" target="_blank" rel="noopener noreferrer">')
                + escape(_url_label(token, href))
                + Markup('</a>')
            )
        else:
            parts.append(escape(token))
        parts.append(escape(trailing))
        cursor = end + len(trailing)
    parts.append(escape(text[cursor:]))
    return Markup('').join(parts)


def _normalize_section(raw: dict | None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    title = _clip(str(raw.get('title') or ''), 160)
    description = _clip(str(raw.get('description') or ''), 2000)
    url = _clip(str(raw.get('url') or ''), 400)
    subs_raw = raw.get('subtitles') or []
    subtitles: list[str] = []
    if isinstance(subs_raw, str):
        subs_raw = subs_raw.splitlines()
    if isinstance(subs_raw, list):
        for item in subs_raw:
            line = _clip(str(item or ''), 300)
            if line:
                subtitles.append(line)
            if len(subtitles) >= _MAX_SUBTITLES:
                break
    if not any((title, description, url, subtitles)):
        return None
    return {
        'title': title,
        'color': _clean_color(str(raw.get('color') or '')),
        'subtitles': subtitles,
        'description': description,
        'url': url,
    }


def _normalize_main_icon(raw: str | None) -> str:
    value = (raw or '').strip()
    if value in MEDIOS_PAGO_MAIN_ICON_VALUES:
        return value
    return _MAIN_ICON_DEFAULT


def render_medios_pago_main_icon_markup(icon: str | None) -> Markup:
    value = _normalize_main_icon(icon)
    if value.startswith('fa:'):
        name = value[3:].strip()
        if _FA_ICON_NAME.fullmatch(name):
            return (
                Markup('<span class="mdp-main-icon" aria-hidden="true"><i class="fas fa-')
                + escape(name)
                + Markup('"></i></span>')
            )
    return Markup('<span class="mdp-main-icon" aria-hidden="true">') + escape(value) + Markup('</span>')


def normalize_medios_pago(data: dict | None) -> dict:
    source = data if isinstance(data, dict) else {}
    main = _clip(str(source.get('main_title') or ''), 160) or _MAIN_TITLE_DEFAULT
    main_icon = _normalize_main_icon(str(source.get('main_icon') or ''))
    sections: list[dict] = []
    raw_sections = source.get('sections') or []
    if isinstance(raw_sections, list):
        for raw in raw_sections[:_MAX_SECTIONS]:
            section = _normalize_section(raw if isinstance(raw, dict) else None)
            if section:
                sections.append(section)
    return {'main_title': main, 'main_icon': main_icon, 'sections': sections}


def parse_medios_pago_payload(text: str | None) -> dict | None:
    raw = (text or '').strip()
    if not raw.startswith('{'):
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    if 'main_title' not in data and 'sections' not in data:
        return None
    return normalize_medios_pago(data)


def medios_pago_editor_data(text: str | None) -> dict:
    parsed = parse_medios_pago_payload(text)
    if parsed is None:
        return copy.deepcopy(MEDIOS_DE_PAGO_DEFAULT)
    return parsed


def medios_pago_from_form(form) -> dict:
    titles = form.getlist('mdp_title')
    colors = form.getlist('mdp_color')
    subtitles = form.getlist('mdp_subtitles')
    descriptions = form.getlist('mdp_description')
    urls = form.getlist('mdp_url')
    count = max(len(titles), len(colors), len(subtitles), len(descriptions), len(urls), 0)
    sections = []
    for index in range(min(count, _MAX_SECTIONS)):
        section = _normalize_section({
            'title': titles[index] if index < len(titles) else '',
            'color': colors[index] if index < len(colors) else '',
            'subtitles': subtitles[index] if index < len(subtitles) else '',
            'description': descriptions[index] if index < len(descriptions) else '',
            'url': urls[index] if index < len(urls) else '',
        })
        if section:
            sections.append(section)
    return normalize_medios_pago({
        'main_title': form.get('mdp_main_title') or '',
        'main_icon': form.get('mdp_main_icon') or '',
        'sections': sections,
    })


def render_medios_pago_html(data: dict | None) -> Markup:
    payload = normalize_medios_pago(data or {})
    parts: list[Markup] = [
        Markup('<div class="mdp-wrap"><article class="mdp-card">'),
        Markup('<div class="mdp-main"><span class="mdp-main-text">'),
        escape(payload['main_title']),
        Markup('</span>'),
        render_medios_pago_main_icon_markup(payload.get('main_icon')),
        Markup('</div>'),
    ]
    for section in payload['sections']:
        color = section['color']
        parts.append(Markup('<section class="mdp-section" style="--mdp-color:') + escape(color) + Markup('">'))
        if section['title']:
            parts.append(Markup('<div class="mdp-section-title">') + escape(section['title']) + Markup('</div>'))
        if section['subtitles']:
            parts.append(Markup('<ul class="mdp-subs">'))
            for line in section['subtitles']:
                parts.append(Markup('<li>') + escape(line) + Markup('</li>'))
            parts.append(Markup('</ul>'))
        if section['description']:
            parts.append(Markup('<p class="mdp-desc">') + _linkify_text(section['description']) + Markup('</p>'))
        href = _safe_href(section['url'])
        if href:
            parts.append(
                Markup('<a class="mdp-url mdp-url-line" href="')
                + escape(href)
                + Markup('" target="_blank" rel="noopener noreferrer">')
                + escape(_url_label(section['url'], href))
                + Markup('</a>')
            )
        parts.append(Markup('</section>'))
    parts.append(Markup('</article></div>'))
    return Markup('').join(parts)


def _visible_code_buttons() -> list[dict]:
    """Botones visibles de la página de códigos y el texto de su icono de información."""
    from app.models.service import ServiceModel

    services = (
        ServiceModel.query
        .filter(
            ServiceModel.enabled.is_(True),
            ServiceModel.visibility_mode.in_(('on-usuarios', 'on-no-usuarios', 'sms')),
        )
        .order_by(ServiceModel.position.asc(), ServiceModel.id.asc())
        .all()
    )
    buttons = []
    for index, service in enumerate(services):
        aliases = []
        for alias in sorted(service.aliases or [], key=lambda item: item.id or 0):
            if getattr(alias, 'enabled', True) is False:
                continue
            name = _clip(str(alias.alias_name or ''), 300)
            if name:
                aliases.append(name)
        fallback = _CODIGOS_PALETTE[index % len(_CODIGOS_PALETTE)]
        if (service.visibility_mode or '') == 'on-no-usuarios':
            default_color = _CODIGOS_GUEST_COLOR
        else:
            default_color = _clean_color(str(service.border_color or ''), fallback)
        buttons.append({
            'id': service.id,
            'title': _clip(str(service.name or ''), 160) or 'Botón',
            'subtitles': aliases,
            'default_color': default_color,
        })
    return buttons


def parse_codigos_payload(text: str | None) -> dict:
    title = _CODIGOS_TITLE_DEFAULT
    colors: dict[str, str] = {}
    raw = (text or '').strip()
    if raw.startswith('{'):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            title = _clip(str(data.get('main_title') or ''), 160) or _CODIGOS_TITLE_DEFAULT
            raw_colors = data.get('colors') or {}
            if isinstance(raw_colors, dict):
                for key, value in list(raw_colors.items())[:_MAX_SECTIONS]:
                    cleaned = _clean_color(str(value or ''), '')
                    if cleaned:
                        colors[str(key)] = cleaned
    return {'main_title': title, 'colors': colors}


def codigos_editor_data(text: str | None) -> dict:
    saved = parse_codigos_payload(text)
    buttons = []
    for button in _visible_code_buttons():
        buttons.append({
            **button,
            'color': saved['colors'].get(str(button['id'])) or button['default_color'],
        })
    return {'main_title': saved['main_title'], 'buttons': buttons}


def codigos_from_form(form) -> dict:
    service_ids = form.getlist('codigos_service_id')
    colors = form.getlist('codigos_color')
    saved: dict[str, str] = {}
    for index, service_id in enumerate(service_ids[:_MAX_SECTIONS]):
        key = str(service_id or '').strip()
        if not key.isdigit():
            continue
        cleaned = _clean_color(colors[index] if index < len(colors) else '', '')
        if cleaned:
            saved[key] = cleaned
    return {
        'main_title': _clip(form.get('codigos_main_title') or '', 160) or _CODIGOS_TITLE_DEFAULT,
        'colors': saved,
    }


def render_codigos_html(saved: dict | None) -> Markup:
    payload = saved if isinstance(saved, dict) else parse_codigos_payload('')
    colors = payload.get('colors') or {}
    parts: list[Markup] = [
        Markup('<div class="mdp-wrap mdp-wrap-codigos"><article class="mdp-card mdp-card-codigos">'),
        Markup('<div class="mdp-main"><span class="mdp-main-text">'),
        escape(payload.get('main_title') or _CODIGOS_TITLE_DEFAULT),
        Markup('</span></div>'),
        Markup('<p class="mdp-desc mdp-intro">') + escape(_CODIGOS_INTRO) + Markup('</p>'),
    ]
    buttons = _visible_code_buttons()
    if not buttons:
        parts.append(Markup('<p class="mdp-desc">No hay botones visibles en la página de códigos.</p>'))
    for button in buttons:
        color = colors.get(str(button['id'])) or button['default_color']
        parts.append(Markup('<section class="mdp-section" style="--mdp-color:') + escape(color) + Markup('">'))
        parts.append(Markup('<div class="mdp-section-title">') + escape(button['title']) + Markup('</div>'))
        if button['subtitles']:
            parts.append(Markup('<ul class="mdp-subs">'))
            for line in button['subtitles']:
                parts.append(Markup('<li>') + escape(line) + Markup('</li>'))
            parts.append(Markup('</ul>'))
        parts.append(Markup('</section>'))
    parts.append(Markup('</article></div>'))
    return Markup('').join(parts)


_TV_EMPTY = '----------'
_TV_ICON_NAME = re.compile(r'^[\w.-]+$')
_TV_ICON_SKIP = frozenset({'favicon.svg', 'favicon.ico'})


def list_stream_icon_files() -> list[str]:
    """streamN.png que existen en static/images, en orden numérico."""
    import os
    import re

    from flask import current_app

    folder = os.path.join(current_app.static_folder or '', 'images')
    found: list[tuple[int, str]] = []
    if not os.path.isdir(folder):
        return []
    for filename in os.listdir(folder):
        match = re.fullmatch(r'stream(\d+)\.png', filename, re.IGNORECASE)
        if not match:
            continue
        if os.path.isfile(os.path.join(folder, filename)):
            found.append((int(match.group(1)), filename))
    found.sort(key=lambda item: item[0])
    return [name for _, name in found]


def screen_icon_choices() -> list[dict]:
    """Iconos de static/images, los mismos que el botón +Icon de servicios."""
    names = [name for name in list_stream_icon_files() if _clean_screen_icon(name)]
    return [
        {'name': name, 'url': '/static/images/' + name, 'dark_url': screen_icon_dark_url(name)}
        for name in names
    ]


def screen_icon_dark_url(name: str) -> str:
    """URL del icono adaptado a fondo oscuro."""
    from flask import url_for

    return url_for('store_bp.stream_icon', name=name, v='20261027-allblack3')


def _clean_screen_icon(raw: str | None) -> str:
    import os

    name = (raw or '').strip()
    if not name or name != os.path.basename(name) or not _TV_ICON_NAME.fullmatch(name):
        return ''
    if name.lower() in _TV_ICON_SKIP:
        return ''
    if not name.lower().endswith('.png') or not name.lower().startswith('stream'):
        return ''
    return name


# Dominio o texto de «Página oficial» → streamN.png (tabla clásica de pantallas/perfiles).
_TV_DOMAIN_ICON_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (('netflix.com', 'netflix.'), 'stream1.png'),
    (('tv.apple.com', 'apple.com/tv'), 'stream2.png'),
    (('youtube.com', 'youtu.be'), 'stream3.png'),
    (('primevideo.com', 'amazon.com/gp/video', 'amazon.prime'), 'stream11.png'),
    (('disneyplus.com', 'disney+', 'disney plus'), 'stream17.png'),
    (('vix.com', 'vix.'), 'stream15.png'),
    (('canva.com',), 'stream10.png'),
    (('crunchyroll.com',), 'stream16.png'),
    (('max.com', 'hbomax', 'hbo.com', 'hbo.'), 'stream13.png'),
    (('paramountplus.com', 'paramount+', 'paramount plus'), 'stream14.png'),
    (('plex.tv', 'plex.'), 'stream7.png'),
    (('spotify.com',), 'stream12.png'),
    (('viki.com', 'rakuten viki'), 'stream9.png'),
    (('deezer.com',), 'stream20.png'),
    (('winplay.co', 'winplay', 'win sport', 'winsport'), 'stream25.png'),
    (('m365.cloud.microsoft', 'office.com', 'office365', 'microsoft365', 'microsoft.com/office'), 'stream23.png'),
    (('surfshark.com',), 'stream40.png'),
    (('xbox.com', 'gamepass', 'game pass'), 'stream24.png'),
    (('directvgo.com', 'directv go', 'directvgo'), 'stream27.png'),
    (('mcafee.com', 'id.mcafee'), 'stream37.png'),
    (('protonvpn', 'account.proton'), 'stream39.png'),
    (('duolingo.com',), 'stream33.png'),
    (('universalplus.com', 'universal+', 'universal plus'), 'stream28.png'),
    (('pornhub.com',), 'stream29.png'),
    (('chatgpt.com', 'openai.com'), 'stream30.png'),
    (('gemini.google', 'google.com/gemini'), 'stream38.png'),
    (('photoshop.adobe', 'adobe.com/photoshop'), 'stream41.png'),
    (('perplexity.ai',), 'stream31.png'),
    (('emby.media', 'emby.'), 'stream34.png'),
    (('jellyfin',), 'stream35.png'),
    (('hulu.com',), 'stream26.png'),
    (('mubi.com',), 'stream22.png'),
)


def _page_icon_match_blob(row: dict) -> str:
    from urllib.parse import urlparse

    chunks: list[str] = []
    for key in ('pagina', 'activacion'):
        raw = (row.get(key) or '').strip()
        if not raw:
            continue
        chunks.append(raw.lower())
        href = _safe_href(raw)
        if not href:
            continue
        parsed = urlparse(href)
        host = (parsed.hostname or '').lower()
        if host:
            chunks.append(host)
        if parsed.path:
            chunks.append(parsed.path.lower())
    return ' '.join(chunks)


def stream_icon_name_for_page(raw: str | None) -> str:
    """streamN.png del dominio, para cuando el favicon público no existe."""
    text = (raw or '').strip()
    if not text:
        return ''
    found = _detect_stream_icons_from_row({'pagina': text, 'activacion': ''}, limit=1)
    return found[0] if found else ''


def _detect_stream_icons_from_row(row: dict, limit: int = 2) -> list[str]:
    blob = _page_icon_match_blob(row)
    if not blob.strip():
        return []
    found: list[str] = []
    for patterns, icon in _TV_DOMAIN_ICON_RULES:
        if not _clean_screen_icon(icon):
            continue
        if any(pat in blob for pat in patterns):
            if icon not in found:
                found.append(icon)
            if len(found) >= limit:
                break
    return found


def _enrich_row_auto_icons(row: dict) -> None:
    """Si no hay iconos manuales, asigna streamN.png según página oficial / activación."""
    if (row.get('icons') or [])[:2]:
        return
    auto = _detect_stream_icons_from_row(row)
    if auto:
        row['icons'] = auto


def row_manual_screen_icons(row: dict) -> list[str]:
    """Iconos stream elegidos en el editor (no los detectados solo al renderizar)."""
    icons: list[str] = []
    for icon in (row.get('icons') or [])[:2]:
        cleaned = _clean_screen_icon(str(icon or ''))
        if cleaned and cleaned not in icons:
            icons.append(cleaned)
    return icons


def resolve_row_screen_icons(row: dict) -> list[str]:
    icons = row_manual_screen_icons(row)
    if icons:
        return icons
    return _detect_stream_icons_from_row(row)


def stream_icon_fallback_for_row(row: dict) -> str:
    """URL del logo stream detectado por dominio (respaldo si falla el favicon)."""
    detected = _detect_stream_icons_from_row(row, limit=1)
    if not detected:
        return ''
    return screen_icon_dark_url(detected[0])


def _tv_platform_favicon_img(page: str, row: dict) -> Markup:
    """Favicon del dominio, servido por el sitio para cumplir img-src 'self'."""
    if not favicon_url_for(page):
        return Markup('')
    from flask import url_for

    src = url_for('store_bp.site_favicon', page=page)
    fallback = stream_icon_fallback_for_row(row)
    parts: list[Markup] = [
        Markup('<img class="tv-favicon tv-favicon-title" src="'),
        escape(src),
        Markup(
            '" alt="" width="60" height="60" decoding="async" '
            'referrerpolicy="no-referrer"'
        ),
    ]
    if fallback:
        parts.extend(
            [
                Markup(' data-fallback="'),
                escape(fallback),
            ]
        )
    parts.append(Markup('">'))
    return Markup('').join(parts)


_PERFIL_RE = re.compile(r'^(\d{1,2})(?:\s*perfiles?)?$', re.IGNORECASE)


def _tv_perfiles_number(raw: str | None) -> str:
    match = _PERFIL_RE.fullmatch((raw or '').strip())
    if not match:
        return ''
    number = int(match.group(1))
    if 1 <= number <= 31:
        return str(number)
    return ''


def _tv_perfiles_label(raw: str | None) -> str:
    number = _tv_perfiles_number(raw)
    if not number:
        return ''
    if number == '1':
        return '1 perfil'
    return f'{number} perfiles'


def _tv_empty_row() -> dict:
    return {
        'icons': [],
        'pantallas': '',
        'perfiles': '',
        'pagina': '',
        'activacion': '',
    }


def parse_pantallas_payload(text: str | None) -> dict:
    rows: list[dict] = []
    raw = (text or '').strip()
    data = None
    if raw.startswith('{'):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
    items = data.get('rows') if isinstance(data, dict) else None
    if isinstance(items, list):
        for item in items[:_MAX_SECTIONS]:
            if not isinstance(item, dict):
                continue
            icons = []
            for icon in (item.get('icons') or [])[:2]:
                cleaned = _clean_screen_icon(str(icon or ''))
                if cleaned and cleaned not in icons:
                    icons.append(cleaned)
            row = {
                'icons': icons,
                'pantallas': _clip(str(item.get('pantallas') or ''), 240),
                'perfiles': _tv_perfiles_number(str(item.get('perfiles') or '')),
                'pagina': _clip(str(item.get('pagina') or ''), 240),
                'activacion': _clip(str(item.get('activacion') or ''), 240),
            }
            if row['pantallas']:
                _enrich_row_auto_icons(row)
                rows.append(row)
    return {'rows': rows}


def pantallas_editor_data(text: str | None) -> dict:
    data = parse_pantallas_payload(text)
    if not data['rows']:
        data['rows'] = [_tv_empty_row()]
    return data


def pantallas_from_form(form) -> dict:
    pantallas = form.getlist('tv_pantallas')
    perfiles = form.getlist('tv_perfiles')
    paginas = form.getlist('tv_pagina')
    activaciones = form.getlist('tv_activacion')
    icon_a = form.getlist('tv_icon_1')
    icon_b = form.getlist('tv_icon_2')
    count = max(len(pantallas), len(perfiles), len(paginas), len(activaciones), 0)
    rows = []
    for index in range(min(count, _MAX_SECTIONS)):
        icons = []
        for source in (icon_a, icon_b):
            cleaned = _clean_screen_icon(source[index] if index < len(source) else '')
            if cleaned and cleaned not in icons:
                icons.append(cleaned)
        row = {
            'icons': icons[:2],
            'pantallas': _clip(pantallas[index] if index < len(pantallas) else '', 240),
            'perfiles': _tv_perfiles_number(perfiles[index] if index < len(perfiles) else ''),
            'pagina': _clip(paginas[index] if index < len(paginas) else '', 240),
            'activacion': _clip(activaciones[index] if index < len(activaciones) else '', 240),
        }
        if row['pantallas']:
            _enrich_row_auto_icons(row)
            rows.append(row)
    return {'rows': rows}


def _tv_plain(value: str) -> Markup:
    text = (value or '').strip()
    if not text:
        return Markup('<span class="tv-empty">') + escape(_TV_EMPTY) + Markup('</span>')
    return escape(text)


def _tv_anchor(label: str, href: str) -> Markup:
    return (
        Markup('<a class="tv-link" href="')
        + escape(href)
        + Markup('" target="_blank" rel="noopener noreferrer">')
        + escape(label)
        + Markup('</a>')
    )


def _tv_urls_in_text(text: str) -> tuple[list[tuple[str, str]], str]:
    """Enlaces encontrados y el texto que queda entre ellos."""
    links: list[tuple[str, str]] = []
    leftover: list[str] = []
    cursor = 0
    for match in _LINKIFY_RE.finditer(text):
        token = match.group(0)
        end = match.end()
        while token and token[-1] in '.,;:!?)]\'"':
            token = token[:-1]
            end -= 1
        href = _safe_href(token)
        if not href:
            continue
        leftover.append(text[cursor:match.start()])
        links.append((_url_label(token, href), href))
        cursor = end
    leftover.append(text[cursor:])
    return links, ' '.join(bit.strip() for bit in leftover if bit.strip())


def _tv_cell(value: str) -> Markup:
    text = (value or '').strip()
    if not text:
        return Markup('<span class="tv-empty">') + escape(_TV_EMPTY) + Markup('</span>')
    href = _safe_href(text)
    if href:
        return _tv_anchor(_url_label(text, href), href)
    links, glue = _tv_urls_in_text(text)
    if len(links) >= 2 and _TV_JOIN_ONLY.fullmatch(glue or ''):
        parts: list[Markup] = [Markup('<span class="tv-links">')]
        for label, link_href in links:
            parts.append(_tv_anchor(label, link_href))
        parts.append(Markup('</span>'))
        return Markup('').join(parts)
    if links:
        return Markup(str(_linkify_text(text)).replace('class="mdp-url"', 'class="tv-link"'))
    return escape(text)


def render_pantallas_html(saved: dict | None, heading: str = '') -> Markup:
    del heading
    payload = saved if isinstance(saved, dict) else {'rows': []}
    parts: list[Markup] = [
        Markup('<div class="tv-wrap"><article class="tv-card"><div class="tv-table-scroll"><table class="tv-table"><thead><tr>'),
        Markup('<th class="tv-th-icon" scope="col">Plataforma</th>'),
        Markup(
            '<th scope="col" class="tv-th-pantallas">Pantallas</th>'
            '<th scope="col" class="tv-th-perfiles">Perfiles</th>'
            '<th scope="col" class="tv-th-pagina" title="Página oficial">Página oficial</th>'
            '<th scope="col" class="tv-th-activacion" title="Activación televisor">Activación televisor</th>'
        ),
        Markup('</tr></thead><tbody>'),
    ]
    rows = payload.get('rows') or []
    if not rows:
        parts.append(Markup('<tr><td colspan="5" class="tv-empty-note">Todavía no hay pantallas configuradas.</td></tr>'))

    for row in rows:
        parts.append(Markup('<tr><td class="tv-icons"><div class="tv-icon-stack">'))
        icons = resolve_row_screen_icons(row)
        # Si el link coincide con un stream local, ese icono manda. El favicon solo cubre lo que no tenemos.
        favicon_page = '' if icons else favicon_source_page(row)
        if favicon_page:
            parts.append(_tv_platform_favicon_img(favicon_page, row))
        if icons:
            parts.append(Markup('<div class="tv-logos">'))
            for icon in icons:
                parts.append(
                    Markup('<img class="tv-logo" src="')
                    + escape(screen_icon_dark_url(icon))
                    + Markup('" alt="" width="44" height="44">')
                )
            parts.append(Markup('</div>'))
        if not favicon_page and not icons:
            parts.append(Markup('<span class="tv-empty">') + escape(_TV_EMPTY) + Markup('</span>'))
        parts.append(Markup('</div></td><td>'))
        parts.append(_tv_plain(row.get('pantallas') or ''))
        parts.append(Markup('</td><td>'))
        parts.append(_tv_plain(_tv_perfiles_label(row.get('perfiles') or '')))
        parts.append(Markup('</td><td>'))
        parts.append(_tv_cell(row.get('pagina') or ''))
        parts.append(Markup('</td><td>'))
        parts.append(_tv_cell(row.get('activacion') or ''))
        parts.append(Markup('</td></tr>'))
    parts.append(Markup('</tbody></table></div></article></div>'))
    return Markup('').join(parts)


BUSQUEDA_MEDIOS_DEFAULT: dict = {'api_key': ''}


def parse_busqueda_medios_payload(text: str | None) -> dict:
    raw = (text or '').strip()
    if raw.startswith('{'):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            return {'api_key': _clip(str(data.get('api_key') or ''), 8000)}
    if raw:
        return {'api_key': _clip(raw, 8000)}
    return copy.deepcopy(BUSQUEDA_MEDIOS_DEFAULT)


def busqueda_medios_editor_data(text: str | None) -> dict:
    return parse_busqueda_medios_payload(text)


def busqueda_medios_from_form(form) -> dict:
    return {'api_key': _clip(form.get('bm_api_key') or '', 8000)}


def resolve_media_search_api_key(html_id: int | None = None) -> str:
    """Claves tmdb/… desde HtmlInfo busqueda_medios; respaldo ApiInfo legacy."""
    from app.store.models import ApiInfo, HtmlInfo

    query = HtmlInfo.query.filter_by(preset_key=BUSQUEDA_MEDIOS_KEY, enabled=True)
    if html_id:
        row = query.filter(HtmlInfo.id == int(html_id)).first()
        if row:
            return parse_busqueda_medios_payload(row.text).get('api_key') or ''
    row = query.order_by(HtmlInfo.id.desc()).first()
    if row:
        return parse_busqueda_medios_payload(row.text).get('api_key') or ''
    api = ApiInfo.query.filter_by(api_type='Búsqueda de Medios', enabled=True).first()
    return (api.api_key or '') if api else ''


def render_busqueda_medios_html(html_obj) -> Markup:
    from flask import render_template

    html_id = getattr(html_obj, 'id', 0) or 0
    return Markup(
        render_template(
            'includes/busqueda_medios_public_widget.html',
            html_id=html_id,
        )
    )


DRIVE_FOTOS_DEFAULT: dict = {
    'api_key': '',
    'api_url': '',
    'drive_subtitle_photos': '',
    'drive_subtitle_videos': '',
}


def parse_drive_fotos_payload(text: str | None) -> dict:
    raw = (text or '').strip()
    if raw.startswith('{'):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            return {
                'api_key': _clip(str(data.get('api_key') or ''), 12000),
                'api_url': _clip(str(data.get('api_url') or ''), 240),
                'drive_subtitle_photos': _clip(str(data.get('drive_subtitle_photos') or ''), 100),
                'drive_subtitle_videos': _clip(str(data.get('drive_subtitle_videos') or ''), 100),
            }
    return copy.deepcopy(DRIVE_FOTOS_DEFAULT)


def drive_fotos_editor_data(text: str | None) -> dict:
    return parse_drive_fotos_payload(text)


def drive_fotos_from_form(form) -> dict:
    return {
        'api_key': _clip(form.get('df_api_key') or '', 12000),
        'api_url': _clip(form.get('df_api_url') or '', 240),
        'drive_subtitle_photos': _clip(form.get('df_drive_subtitle_photos') or '', 100),
        'drive_subtitle_videos': _clip(form.get('df_drive_subtitle_videos') or '', 100),
    }


def drive_gallery_public_row(html_obj) -> dict | None:
    """Fila de galería pública (id + subtítulos) desde HtmlInfo."""
    if not html_obj or getattr(html_obj, 'preset_key', None) != DRIVE_FOTOS_PELICULAS_KEY:
        return None
    payload = parse_drive_fotos_payload(getattr(html_obj, 'text', None))
    return {
        'id': getattr(html_obj, 'id', 0),
        'drive_subtitle_photos': payload.get('drive_subtitle_photos') or '',
        'drive_subtitle_videos': payload.get('drive_subtitle_videos') or '',
    }


def resolve_drive_gallery_credentials(entry_id: int | str | None) -> tuple[dict | None, str | None]:
    """
    Credenciales Drive para galería pública.
    Devuelve (payload_dict, error_message).
    """
    from app.store.models import ApiInfo, HtmlInfo

    if entry_id not in (None, ''):
        try:
            eid = int(entry_id)
        except (TypeError, ValueError):
            return None, 'ID no válido'
        html = HtmlInfo.query.get(eid)
        if html and html.enabled and html.preset_key == DRIVE_FOTOS_PELICULAS_KEY:
            payload = parse_drive_fotos_payload(html.text)
            if payload.get('api_key') and payload.get('api_url'):
                return payload, None
            return None, 'Faltan credenciales o ID de carpeta en HTML Drive.'
        api = ApiInfo.query.get(eid)
        if api and api.enabled and api.api_type == 'Drive':
            payload = {
                'api_key': api.api_key or '',
                'api_url': api.api_url or '',
                'drive_subtitle_photos': api.drive_subtitle_photos or '',
                'drive_subtitle_videos': api.drive_subtitle_videos or '',
            }
            if payload.get('api_key') and payload.get('api_url'):
                return payload, None
            return None, 'Faltan credenciales o ID de carpeta.'
        return None, 'Drive no encontrado o no habilitado.'

    html = (
        HtmlInfo.query.filter_by(preset_key=DRIVE_FOTOS_PELICULAS_KEY, enabled=True)
        .order_by(HtmlInfo.id.desc())
        .first()
    )
    if html:
        payload = parse_drive_fotos_payload(html.text)
        if payload.get('api_key') and payload.get('api_url'):
            return payload, None
    api = ApiInfo.query.filter_by(api_type='Drive', enabled=True).first()
    if api:
        payload = {
            'api_key': api.api_key or '',
            'api_url': api.api_url or '',
            'drive_subtitle_photos': api.drive_subtitle_photos or '',
            'drive_subtitle_videos': api.drive_subtitle_videos or '',
        }
        if payload.get('api_key') and payload.get('api_url'):
            return payload, None
    return None, 'No hay Drive configurado.'


def _normalize_ct_icon(raw: str | None, default: str = '') -> str:
    value = (raw or '').strip()
    if value == 'none':
        return 'none'
    if not value:
        return default
    if value in COMO_TRABAJO_ICON_VALUES:
        return value
    if value.startswith('fa:'):
        name = value[3:].strip()
        if _FA_ICON_NAME.fullmatch(name):
            return value
        return default
    if len(value) <= 8:
        return value
    return default


def _render_ct_icon(icon: str | None, css_class: str) -> Markup:
    value = (icon or '').strip()
    if not value or value == 'none':
        return Markup('')
    if value.startswith('fa:'):
        name = value[3:].strip()
        if not _FA_ICON_NAME.fullmatch(name):
            return Markup('')
        return (
            Markup('<span class="')
            + css_class
            + Markup('" aria-hidden="true"><i class="fas fa-')
            + escape(name)
            + Markup('"></i></span>')
        )
    return Markup('<span class="') + css_class + Markup('" aria-hidden="true">') + escape(value) + Markup('</span>')


def _normalize_ct_section(raw: dict | None, index: int = 0) -> dict | None:
    if not isinstance(raw, dict):
        return None
    title = _clip(str(raw.get('title') or ''), 160)
    description = _clip(str(raw.get('description') or ''), 2000)
    subs_raw = raw.get('subtitles') or []
    subtitles: list[str] = []
    if isinstance(subs_raw, str):
        subs_raw = subs_raw.splitlines()
    if isinstance(subs_raw, list):
        for item in subs_raw:
            line = _clip(str(item or ''), 300)
            line = re.sub(r'^[\s\u00a0]*[⬤●•\u25cf\u25b6\u27a4➡▶➤]+\s*', '', line).strip()
            if line:
                subtitles.append(line)
            if len(subtitles) >= _MAX_SUBTITLES:
                break
    icon = _normalize_ct_icon(str(raw.get('icon') or ''))
    has_icon = bool(icon) and icon != 'none'
    if not any((title, description, subtitles, has_icon)):
        return None
    fallback = _CODIGOS_PALETTE[index % len(_CODIGOS_PALETTE)]
    return {
        'icon': icon,
        'title': title,
        'color': _clean_color(str(raw.get('color') or ''), fallback),
        'subtitles': subtitles,
        'description': description,
    }


def normalize_como_trabajo(data: dict | None) -> dict:
    source = data if isinstance(data, dict) else {}
    main = _clip(str(source.get('main_title') or ''), 160) or _COMO_TITLE_DEFAULT
    main_icon = _normalize_ct_icon(str(source.get('main_icon') or ''), _COMO_ICON_DEFAULT)
    sections: list[dict] = []
    raw_sections = source.get('sections') or []
    if isinstance(raw_sections, list):
        for index, raw in enumerate(raw_sections[:_MAX_SECTIONS]):
            section = _normalize_ct_section(raw if isinstance(raw, dict) else None, index)
            if section:
                sections.append(section)
    return {'main_title': main, 'main_icon': main_icon, 'sections': sections}


def parse_como_trabajo_payload(text: str | None) -> dict | None:
    raw = (text or '').strip()
    if not raw.startswith('{'):
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or 'sections' not in data:
        return None
    return normalize_como_trabajo(data)


def como_trabajo_editor_data(text: str | None) -> dict:
    parsed = parse_como_trabajo_payload(text)
    if parsed is None:
        return copy.deepcopy(COMO_TRABAJO_DEFAULT)
    return parsed


def como_trabajo_from_form(form) -> dict:
    icons = form.getlist('ct_icon')
    titles = form.getlist('ct_title')
    colors = form.getlist('ct_color')
    subtitles = form.getlist('ct_subtitles')
    descriptions = form.getlist('ct_description')
    count = max(len(icons), len(titles), len(colors), len(subtitles), len(descriptions), 0)
    sections = []
    for index in range(min(count, _MAX_SECTIONS)):
        section = _normalize_ct_section({
            'icon': icons[index] if index < len(icons) else '',
            'title': titles[index] if index < len(titles) else '',
            'color': colors[index] if index < len(colors) else '',
            'subtitles': subtitles[index] if index < len(subtitles) else '',
            'description': descriptions[index] if index < len(descriptions) else '',
        }, index)
        if section and (section['title'] or section['subtitles'] or section['description']):
            sections.append(section)
    return normalize_como_trabajo({
        'main_title': form.get('ct_main_title') or '',
        'main_icon': form.get('ct_main_icon') or '',
        'sections': sections,
    })


def render_como_trabajo_html(data: dict | None) -> Markup:
    payload = normalize_como_trabajo(data or {})
    parts: list[Markup] = [
        Markup('<div class="mdp-wrap ct-wrap"><article class="mdp-card ct-card">'),
        Markup('<div class="mdp-main"><span class="mdp-main-text">'),
        escape(payload['main_title']),
        Markup('</span>'),
        _render_ct_icon(payload.get('main_icon'), 'mdp-main-icon'),
        Markup('</div>'),
    ]
    for section in payload['sections']:
        color = section['color']
        parts.append(Markup('<section class="mdp-section ct-section" style="--mdp-color:') + escape(color) + Markup('">'))
        parts.append(Markup('<div class="mdp-section-title ct-section-title"><span class="ct-arrow" aria-hidden="true"></span>'))
        parts.append(_render_ct_icon(section.get('icon'), 'ct-title-icon'))
        if section['title']:
            parts.append(Markup('<span class="ct-title-text">') + escape(section['title']) + Markup('</span>'))
        parts.append(Markup('</div>'))
        if section['subtitles']:
            parts.append(Markup('<ul class="ct-subs">'))
            for line in section['subtitles']:
                parts.append(Markup('<li>') + escape(line) + Markup('</li>'))
            parts.append(Markup('</ul>'))
        if section['description']:
            parts.append(Markup('<p class="mdp-desc">') + _linkify_text(section['description']) + Markup('</p>'))
        parts.append(Markup('</section>'))
    parts.append(Markup('</article></div>'))
    return Markup('').join(parts)


def html_info_body(html_obj) -> Markup | str:
    """HTML público: la plantilla de medios de pago se dibuja desde sus campos."""
    if html_obj is None:
        return ''
    if isinstance(html_obj, str):
        return html_obj
    preset = getattr(html_obj, 'preset_key', None) or ''
    text = getattr(html_obj, 'text', None) or ''
    if preset == MEDIOS_DE_PAGO_KEY:
        parsed = parse_medios_pago_payload(text)
        if parsed is None and str(text).strip():
            return text
        return render_medios_pago_html(parsed or copy.deepcopy(MEDIOS_DE_PAGO_DEFAULT))
    if preset == COMO_TRABAJO_KEY:
        parsed = parse_como_trabajo_payload(text)
        if parsed is None and str(text).strip() and not str(text).strip().startswith('{'):
            return text
        return render_como_trabajo_html(parsed or copy.deepcopy(COMO_TRABAJO_DEFAULT))
    if preset == RESUMEN_CODIGOS_KEY:
        return render_codigos_html(parse_codigos_payload(text))
    if preset == FOTO_PANTALLAS_KEY:
        return render_pantallas_html(parse_pantallas_payload(text), getattr(html_obj, 'title', '') or '')
    if preset == BUSQUEDA_MEDIOS_KEY:
        return render_busqueda_medios_html(html_obj)
    if preset == DRIVE_FOTOS_PELICULAS_KEY:
        return Markup('')
    return text


def parse_html_form_fields(form) -> tuple[dict | None, str | None]:
    """Valida título, texto y preset del formulario crear/editar HTML."""
    preset_key = (form.get('preset_key') or '').strip() or None
    title = (form.get('title') or '').strip()
    text = (form.get('text') or '').strip()

    if preset_key:
        if preset_key not in HTML_PRESET_KEYS:
            return None, 'La plantilla HTML seleccionada no es válida.'
        if not title:
            title = html_preset_label(preset_key) or title
        if not title:
            return None, 'El título es requerido.'
        if preset_key == MEDIOS_DE_PAGO_KEY and form.get('mdp_main_title') is not None:
            text = json.dumps(medios_pago_from_form(form), ensure_ascii=False)
        if preset_key == COMO_TRABAJO_KEY and form.get('ct_main_title') is not None:
            text = json.dumps(como_trabajo_from_form(form), ensure_ascii=False)
        if preset_key == RESUMEN_CODIGOS_KEY and form.get('codigos_main_title') is not None:
            text = json.dumps(codigos_from_form(form), ensure_ascii=False)
        if preset_key == FOTO_PANTALLAS_KEY and form.get('tv_pantallas') is not None:
            text = json.dumps(pantallas_from_form(form), ensure_ascii=False)
        if preset_key == BUSQUEDA_MEDIOS_KEY:
            if form.get('bm_api_key') is not None:
                key = busqueda_medios_from_form(form).get('api_key') or ''
                if not key.strip():
                    return None, 'Las claves de búsqueda de medios (tmdb:, etc.) son obligatorias.'
                text = json.dumps(busqueda_medios_from_form(form), ensure_ascii=False)
            elif not text:
                text = json.dumps(copy.deepcopy(BUSQUEDA_MEDIOS_DEFAULT), ensure_ascii=False)
        if preset_key == DRIVE_FOTOS_PELICULAS_KEY:
            if form.get('df_api_key') is not None:
                data = drive_fotos_from_form(form)
                if not (data.get('api_key') or '').strip():
                    return None, 'El JSON de la cuenta de servicio Google (Drive) es obligatorio.'
                if not (data.get('api_url') or '').strip():
                    return None, 'El ID de carpeta de Drive es obligatorio.'
                photos = (data.get('drive_subtitle_photos') or '').strip()
                videos = (data.get('drive_subtitle_videos') or '').strip()
                if not photos and not videos:
                    return None, 'Indica al menos un subtítulo para fotos o para videos.'
                text = json.dumps(data, ensure_ascii=False)
            elif not text:
                text = json.dumps(copy.deepcopy(DRIVE_FOTOS_DEFAULT), ensure_ascii=False)
        return {'title': title, 'text': text, 'preset_key': preset_key}, None

    if not title or not text:
        return None, 'Título y contenido HTML son requeridos (o elige un HTML ya configurado).'
    return {'title': title, 'text': text, 'preset_key': None}, None
