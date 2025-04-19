import os
import sys

# Extensiones que consideras "texto/código"
EXTENSIONES_TEXTO = {
    ".txt", ".md", ".py", ".html", ".htm", ".css", ".js", ".json",
    ".ini", ".cfg", ".yaml", ".yml", ".sql", ".dockerfile",
    ".bat", ".sh", ".log", ".java", ".c", ".cpp", ".cs",
    ".rb", ".go", ".php", ".phtml", ".vue", ".ts",
    ".tsx", ".rs", ".swift", ".toml", ".conf",
}

# Archivos sin extensión que quieres tratar como texto
ARCHIVOS_SIN_EXTENSION = {
    "Dockerfile",
    ".env",
    ".gitignore",
    ".dockerignore", 
}

# Comentarios especiales para ciertos archivos
COMENTARIOS_ESPECIALES = {
    "Dockerfile": "# Dockerfile",
    "docker-compose.yml": "# Orquestación de contenedores: web y DB PostgreSQL",
    "README.md": "# Documentación principal (instalación, uso, despliegue)",
    ".gitignore": "# Ignora archivos innecesarios (pyc, env, logs, etc.)",
    "run.py": "# Punto de entrada de Flask en modo dev; Gunicorn en Docker",
    "config.py": "# Config base (SECRET_KEY, DB URI, 2FA, etc.)",
    "config_prod.py": "# Config prod (DEBUG=False, etc.)",
    "config_dev.py": "# Config dev (DEBUG=True, etc.)",
    "requirements.txt": "# Dependencias (Flask, SQLAlchemy, cryptography, etc.)",
    ".env": "# Variables de entorno"
}

SEPARADOR = "--------------------------------------------------------"

ARCHIVO_LINEAL = "salida.txt"  # Nombre del único archivo de salida

def es_archivo_texto(nombre_archivo: str) -> bool:
    """
    Devuelve True si la extensión está en EXTENSIONES_TEXTO
    o si el nombre completo aparece en ARCHIVOS_SIN_EXTENSION.
    """
    base, extension = os.path.splitext(nombre_archivo)
    if extension.lower() in EXTENSIONES_TEXTO:
        return True
    if nombre_archivo in ARCHIVOS_SIN_EXTENSION:
        return True
    return False

def generar_salida_lineal(ruta_base: str):
    """Crea `salida.txt` con el listado lineal y el contenido de archivos de texto."""
    script_en_ejecucion = os.path.abspath(sys.argv[0])
    ruta_salida_lineal = os.path.join(ruta_base, ARCHIVO_LINEAL)

    with open(ruta_salida_lineal, "w", encoding="utf-8") as salida:
        for raiz, dirs, files in os.walk(ruta_base):
            dirs.sort()
            files.sort()

            # (Opcional) Mostrar la subcarpeta cuando no es la raíz
            if raiz != ruta_base:
                nombre_carpeta = os.path.relpath(raiz, ruta_base)
                salida.write(f"{nombre_carpeta}/\n")
                salida.write(SEPARADOR + "\n")

            for f in files:
                ruta_completa = os.path.join(raiz, f)

                # Ignora el propio script (sea .py o .exe)
                if os.path.abspath(ruta_completa) == script_en_ejecucion:
                    continue
                # Ignora el archivo de salida
                if os.path.abspath(ruta_completa) == os.path.abspath(ruta_salida_lineal):
                    continue

                # 1) Escribe el nombre del archivo
                salida.write(f"{f}\n")

                # 2) Si hay un comentario especial
                if f in COMENTARIOS_ESPECIALES:
                    salida.write(COMENTARIOS_ESPECIALES[f] + "\n")

                # 3) Si es un archivo de texto, extraer contenido
                if es_archivo_texto(f):
                    try:
                        with open(ruta_completa, "r", encoding="utf-8") as arch:
                            contenido = arch.read()
                        if contenido.strip():
                            salida.write(contenido + "\n")
                    except Exception as e:
                        salida.write(f"[Error al leer el archivo: {e}]\n")

                # 4) Separador
                salida.write(SEPARADOR + "\n")

def main():
    if len(sys.argv) > 1:
        ruta_objetivo = sys.argv[1]
    else:
        ruta_objetivo = os.path.dirname(os.path.abspath(__file__))

    generar_salida_lineal(ruta_objetivo)
    print("Proceso finalizado. Revisa 'salida.txt'.")

if __name__ == "__main__":
    main()
