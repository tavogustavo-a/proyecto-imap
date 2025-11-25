#!/bin/bash
# Script para configurar la zona horaria del servidor a Colombia
# Ejecutar como root o con sudo

echo "Configurando zona horaria a Colombia (America/Bogota)..."

# Para sistemas basados en Debian/Ubuntu
if [ -f /etc/debian_version ]; then
    echo "Detectado sistema Debian/Ubuntu"
    sudo timedatectl set-timezone America/Bogota
    sudo dpkg-reconfigure -f noninteractive tzdata
fi

# Para sistemas basados en RedHat/CentOS
if [ -f /etc/redhat-release ]; then
    echo "Detectado sistema RedHat/CentOS"
    sudo timedatectl set-timezone America/Bogota
fi

# Verificar configuración
echo ""
echo "Zona horaria actual:"
timedatectl

echo ""
echo "Fecha y hora actual:"
date

echo ""
echo "✅ Configuración completada. La zona horaria del sistema ahora es Colombia (America/Bogota)"
echo "⚠️  Nota: Tu aplicación Flask seguirá usando las funciones de timezone.py para garantizar hora de Colombia"

