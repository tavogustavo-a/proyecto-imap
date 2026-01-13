# Configuración de Nginx para Múltiples Dominios

## 📋 Resumen

**DNS**: Solo necesitas crear registros A que apunten todos al mismo IP de tu servidor.

**Nginx**: Es el servidor web que recibe las peticiones HTTP/HTTPS y las reenvía a Flask. Necesitas configurar un "server block" por cada dominio.

---

## 🌐 Parte 1: DNS (Muy Fácil)

En tu proveedor de DNS (Cloudflare, Namecheap, GoDaddy, etc.), crea registros A:

```
tupremium.com     → A → 192.168.1.100  (tu IP del servidor)
tudominio.com     → A → 192.168.1.100  (misma IP)
otrodominio.com   → A → 192.168.1.100  (misma IP)
```

**Eso es todo para DNS.** Todos los dominios apuntan al mismo servidor.

---

## ⚙️ Parte 2: Nginx (Configuración)

### ¿Qué es Nginx?

Nginx es un servidor web que:
1. **Escucha** en el puerto 80 (HTTP) y 443 (HTTPS)
2. **Recibe** las peticiones de los usuarios
3. **Reenvía** esas peticiones a Flask (que corre en otro puerto, ej: 5000 o 8000)
4. **Devuelve** la respuesta de Flask al usuario

### Estructura de Archivos de Nginx

En Linux, los archivos de configuración de Nginx están en:
- `/etc/nginx/nginx.conf` - Configuración principal
- `/etc/nginx/sites-available/` - Configuraciones de sitios (uno por dominio)
- `/etc/nginx/sites-enabled/` - Enlaces simbólicos a los sitios activos

---

## 📝 Configuración Paso a Paso

### Paso 1: Configuración Principal (`/etc/nginx/nginx.conf`)

Este archivo generalmente ya está configurado. Solo asegúrate de que incluya:

```nginx
http {
    # ... otras configuraciones ...
    
    # Incluir configuraciones de sitios
    include /etc/nginx/sites-enabled/*;
}
```

---

### Paso 2: Crear Configuración para el Dominio Principal (`tupremium.com`)

Crea el archivo `/etc/nginx/sites-available/tupremium.com`:

```nginx
server {
    # Escuchar en puerto 80 (HTTP) y redirigir a HTTPS
    listen 80;
    listen [::]:80;
    server_name tupremium.com www.tupremium.com;
    
    # Redirigir todo el tráfico HTTP a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    # Escuchar en puerto 443 (HTTPS)
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name tupremium.com www.tupremium.com;
    
    # Certificados SSL (generados por certbot)
    ssl_certificate /etc/letsencrypt/live/tupremium.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tupremium.com/privkey.pem;
    
    # Configuraciones SSL recomendadas
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Tamaño máximo de archivos subidos
    client_max_body_size 20M;
    
    # Archivos estáticos (CSS, JS, imágenes)
    location /static {
        alias /ruta/a/tu/proyecto/app/static;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # Reenviar todo lo demás a Flask
    location / {
        proxy_pass http://127.0.0.1:5000;  # Puerto donde corre Flask
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}
```

**Activar el sitio:**
```bash
sudo ln -s /etc/nginx/sites-available/tupremium.com /etc/nginx/sites-enabled/
sudo nginx -t  # Verificar que la configuración es correcta
sudo systemctl reload nginx
```

---

### Paso 3: Crear Configuración para Dominio Adicional (`tudominio.com`)

Crea el archivo `/etc/nginx/sites-available/tudominio.com`:

```nginx
server {
    # Escuchar en puerto 80 (HTTP) y redirigir a HTTPS
    listen 80;
    listen [::]:80;
    server_name tudominio.com www.tudominio.com;
    
    # Redirigir todo el tráfico HTTP a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    # Escuchar en puerto 443 (HTTPS)
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name tudominio.com www.tudominio.com;
    
    # Certificados SSL (generados por certbot)
    ssl_certificate /etc/letsencrypt/live/tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tudominio.com/privkey.pem;
    
    # Configuraciones SSL recomendadas
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Tamaño máximo de archivos subidos
    client_max_body_size 20M;
    
    # Archivos estáticos (CSS, JS, imágenes)
    location /static {
        alias /ruta/a/tu/proyecto/app/static;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # Reenviar todo lo demás a Flask
    location / {
        proxy_pass http://127.0.0.1:5000;  # MISMO puerto que el dominio principal
        proxy_set_header Host $host;  # ⚠️ IMPORTANTE: Esto pasa el dominio al Flask
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}
```

**Activar el sitio:**
```bash
sudo ln -s /etc/nginx/sites-available/tudominio.com /etc/nginx/sites-enabled/
sudo nginx -t  # Verificar que la configuración es correcta
sudo systemctl reload nginx
```

---

## 🔐 Generar Certificados SSL con Certbot

Para cada dominio adicional, necesitas generar un certificado SSL:

```bash
# Para tudominio.com
sudo certbot --nginx -d tudominio.com -d www.tudominio.com

# Para otrodominio.com
sudo certbot --nginx -d otrodominio.com -d www.otrodominio.com
```

Certbot automáticamente:
1. Genera el certificado SSL
2. Modifica la configuración de Nginx para incluir las rutas de los certificados
3. Configura la renovación automática

---

## 🎯 Puntos Clave

### 1. **Todos los dominios apuntan al mismo Flask**
   - Todos usan `proxy_pass http://127.0.0.1:5000;`
   - Flask recibe todas las peticiones en el mismo puerto

### 2. **Flask detecta el dominio**
   - La línea `proxy_set_header Host $host;` es **CRÍTICA**
   - Esto le dice a Flask desde qué dominio llegó la petición
   - Flask puede leer esto con `request.host` o `request.headers.get('Host')`

### 3. **Cada dominio necesita su propio certificado SSL**
   - Certbot genera un certificado por dominio
   - Los certificados se renuevan automáticamente

### 4. **Archivos estáticos compartidos**
   - Todos los dominios pueden usar los mismos archivos estáticos
   - O puedes tener archivos estáticos diferentes por dominio (más complejo)

---

## 🔍 Verificar que Funciona

Después de configurar todo:

1. **Verificar DNS:**
   ```bash
   dig tudominio.com
   # Debe mostrar tu IP del servidor
   ```

2. **Verificar Nginx:**
   ```bash
   sudo nginx -t  # Debe decir "syntax is ok"
   sudo systemctl status nginx  # Debe estar "active (running)"
   ```

3. **Probar desde el navegador:**
   - `https://tupremium.com` → Debe mostrar tu app Flask
   - `https://tudominio.com` → Debe mostrar tu app Flask (pero Flask detectará el dominio diferente)

---

## 📌 Resumen Visual

```
Usuario → DNS → IP del Servidor (192.168.1.100)
                ↓
            Nginx (puerto 80/443)
                ↓
        Detecta dominio (tudominio.com)
                ↓
        Reenvía a Flask (puerto 5000)
                ↓
        Flask detecta dominio y muestra página correcta
```

---

## ⚠️ Notas Importantes

1. **Puerto de Flask**: Asegúrate de que Flask esté corriendo en el puerto que especificaste en `proxy_pass` (ej: 5000, 8000, etc.)

2. **Firewall**: Asegúrate de que los puertos 80 y 443 estén abiertos:
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

3. **Renovación SSL**: Certbot configura automáticamente la renovación, pero puedes verificar con:
   ```bash
   sudo certbot renew --dry-run
   ```

4. **Logs de Nginx**: Si algo no funciona, revisa los logs:
   ```bash
   sudo tail -f /var/log/nginx/error.log
   sudo tail -f /var/log/nginx/access.log
   ```

---

## 🚀 Siguiente Paso

Una vez que Nginx esté configurado, Flask recibirá el dominio en `request.host` y podrás implementar la lógica para mostrar diferentes páginas según el dominio.
