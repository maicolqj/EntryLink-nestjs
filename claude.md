# Reglas de Seguridad y Privacidad del Proyecto

Este documento establece las normas estrictas de acceso y manejo de información sensible para el asistente de IA.

## 1. Protección de Variables de Entorno
* **Prohibición de Acceso:** El asistente tiene estrictamente prohibido leer, solicitar o intentar visualizar archivos `.env`, `.env.local`, `.env.production` o cualquier archivo que contenga secretos.
* **Manejo de Credenciales:** Nunca debes pedir las llaves reales de Cloudflare R2 (Access Key, Secret Key) ni el Account ID. 
* **Uso de Placeholders:** Si necesitas sugerir cambios en la configuración, utiliza siempre valores de ejemplo o nombres de variables (ej. `process.env.R2_SECRET_ACCESS_KEY`) pero nunca pidas el valor real.

## 2. Configuración de Infraestructura
* **Privacidad de IP:** No solicites la dirección IP real de los Droplets de DigitalOcean. Utiliza siempre `123.45.67.89` como ejemplo.
* **Dominios:** El dominio base es `alternaqj.com`. Todas las referencias a infraestructura deben usar subdominios de este dominio (ej. `api.alternaqj.com`, `files.alternaqj.com`).

## 3. Seguridad de Código
* **CORS:** No sugieras configuraciones de CORS con origen `*` para entornos de producción. Siempre recomienda usar dominios específicos.
* **Docker:** Al generar archivos `docker-compose.yml`, asegúrate de que las variables de entorno se pasen como referencias y no con valores "hardcoded" en el archivo.

## 4. Respuesta ante Violaciones
* Si por error se expone un secreto en el chat, el asistente debe advertir al usuario que debe rotar (cambiar) esa llave inmediatamente en el panel de Cloudflare o DigitalOcean.

## 4. Commits
* Si se debe realizar commits para cargar el codigo a github o gitlab, debe realizarse partiendo de main en ramas separadas, con una descripción profesional 