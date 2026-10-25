# Contrato real matera ↔ backend (firmware 0.4.x)

Extraído del código del firmware (`lib/Mqtt`, `lib/Notify`, `lib/Provisioning`, `lib/Ota`, `lib/Config`, `src/main.cpp`) el 2026-10-24.
**El firmware es la fuente de verdad**: el backend (`IotDevicesModule` de EntryLink) se construye contra este documento.
Si cambia el firmware, se actualiza aquí en el mismo commit.

---

## 1. Identidad y transporte

| Qué | Valor |
|---|---|
| Identidad | `deviceId` (p. ej. `NEXUS-TEST01`) + `deviceKey` (secreto de fábrica, 48 caracteres en las pruebas). Se graban en la NVS (`identity`) con `tools/flash_identity.py`; sobreviven a cualquier reset |
| MQTT | broker TLS (8883 en producción). **Usuario = `deviceId`, contraseña = `deviceKey`**. `clientId = deviceId` |
| Sesión | `cleanSession = false` (persistente). Suscripciones con **QoS 1** → el broker guarda `cmd`/`notify` mientras la matera duerme y se los entrega al despertar |
| Publicación | QoS 0 (límite de PubSubClient). Payload máximo **512 bytes** (entrada y salida) |
| Keepalive | 30 s |
| LWT | `.../status` = `"offline"`, QoS 1, **retenido** |
| HTTP | `BACKEND_URL` (HTTPS en producción; CA en `include/certs.h`, por defecto ISRG Root X1). Cabeceras `X-Device-Id` y `X-Device-Key`. Para vincular, para la telemetría de respaldo/cola y para el perfil (sección 6) |
| Producción | MQTT siempre TLS y solo `https://`; el servidor se verifica con el CA de `certs.h`. mbedTLS 2.28: el certificado debe llevar el host como SAN **DNS** (si es una IP, también `DNS:<IP>`) |

---

## 2. Topics MQTT

Prefijo: `entrylink/devices/<deviceId>/`

| Topic | Sentido | Retenido | Contenido |
|---|---|---|---|
| `status` | matera → | sí | `"online"` al conectar · `"offline"` al despedirse antes de dormir o por LWT (texto plano, no JSON) |
| `telemetry` | matera → | no | JSON de la sección 3 |
| `ack` | matera → | no | respuesta a cada `cmd` (sección 4) |
| `cmd` | → matera (QoS 1) | no | comandos (sección 4) |
| `notify` | → matera (QoS 1) | no | avisos de EntryLink ya resueltos (sección 5) |

El backend debe impedir (ACL) que una matera publique o se suscriba fuera de `entrylink/devices/<su deviceId>/#`.

---

## 3. Telemetría (`.../telemetry`)

```json
{"type":"SMART_PLANTER","fw":"0.4.0","ts":1792887738,"soil":42,"soilRaw":24,"tank":"ok","lux":350,
 "tempC":24.6,"hum":58,"battery":4.30,"batteryPct":100,"power":"usb","face":"Happy / Satisfied",
 "motion":false,"tilt":4,"plantId":"epipremnum-aureum","plantProfile":"species","rssi":-60,
 "faults":["light_sensor"],"queued_pending":3}
```

| Campo | Tipo | Notas |
|---|---|---|
| `type` | string | siempre `"SMART_PLANTER"` |
| `fw` | string | versión del firmware (`FW_VERSION`) |
| `ts` | int \| null | epoch UTC en segundos (NTP). `null` si aún no hay hora (primeros segundos tras encender) |
| `queued` | `true` | **solo** en lecturas que salen de la cola sin red. Su `ts` es el de cuándo se midió |
| `soil` | int | humedad del suelo, 0-100 % |
| `soilRaw` | int | lectura cruda del electrodo. **No viene** en las lecturas de la cola |
| `tank` | string | `"ok"` o `"empty"` (flotador del depósito) |
| `lux` | int \| null | `null` si el BH1750 no responde |
| `tempC` | float (1 decimal) \| null | `null` si el AHT20 no responde |
| `hum` | int \| null | humedad del aire, % |
| `battery` | float (2 decimales) | voltios. Sin calibrar con `B` puede leer hasta ~10 % de más |
| `batteryPct` | int | 0-100 |
| `power` | string | `"usb"` o `"battery"` |
| `face` | string | nombre de la cara mostrada (lista en la sección 7). Es el "estado de ánimo" |
| `motion` | bool | PIR |
| `tilt` | int \| null | inclinación en grados; `null` si el IMU no responde |
| `plantId` | string \| null | perfil aplicado con `set_plant`; `null` = perfil genérico |
| `plantProfile` | string | `"species"` o `"generic"` |
| `soilIdeal` | [int, int] | `suelo_ideal_min`/`max` del perfil. Solo con perfil y no en las de la cola |
| `theme` | string | tema de caras activo (`classic`, `minimal`…). Ver README_temas.md |
| `rssi` | int | dBm. **No viene** en las lecturas de la cola |
| `faults` | string[] | solo si hay fallos: `temp_humidity_sensor`, `light_sensor`, `imu`, `mqtt_auth`, `battery_sensor` |
| `queued_pending` | int | solo si quedan lecturas en la cola |

**Cuándo se envía:**
- USB: al conectar, cada 60 s, y por cambio de cara (mínimo 5 s entre envíos).
- Batería (vinculada): una por despertar (cada 30 min o por PIR/toque); luego escucha `cmd`/`notify` ~3 s, publica `offline` y duerme.
- Sin red: hasta 20 lecturas en la cola (RTC RAM). Al volver salen con `"queued":true` **por `POST /iot/devices/telemetry`** (si el backend no responde, por MQTT), intercaladas con la actual → el backend ordena por `ts`, no por llegada. Puede llegar la misma lectura dos veces si se corta la red justo al enviarla: el backend debe deduplicar por (`deviceId`, `ts`).
- Respaldo: si MQTT no conecta pero hay WiFi, la lectura sale por `POST /iot/devices/telemetry` en lugar de ir a la cola.
- **El JSON es idéntico por los dos transportes** (una sola función en el firmware). El backend procesa igual lo que llega por MQTT y por REST.

---

## 4. Comandos (`.../cmd`) y respuestas (`.../ack`)

Formato del ack: `{"cmd":"<cmd>","ok":true|false,"error":"<código>"}` (+ campos propios de cada comando).
JSON roto → `{"cmd":"?","ok":false,"error":"invalid_json"}`. Comando desconocido → `"error":"unknown_cmd"`.

| Comando | Payload | Ack | Efecto |
|---|---|---|---|
| `linked` | `{"cmd":"linked","owner":"Maicol"}` | `ok:true` | confirma la vinculación: deja el QR #2 y pasa a la cara normal. `owner` = nombre visible (máx. ~32 car.) |
| `factory_reset` | `{"cmd":"factory_reset"}` (+ `"wipe_calib":true`) | `ok:true` **antes** de borrar | borra WiFi, vínculo, umbrales y perfil (NVS `user`); con `wipe_calib` también la calibración. **Nunca** la identidad. Reinicia en SETUP (QR #1) |
| `set_plant` | ver abajo | `ok`, `plantId` (+ `error`) | aplica el perfil de la especie a los umbrales del ánimo |
| `set_thresholds` | `{"cmd":"set_thresholds","values":{"sedOn":28,"sedOff":34}}` | `ok`, `applied` (+ `error`: `unknown_or_out_of_range`, `no_values`) | ajuste fino de umbrales (mantenimiento) |
| `ota` | `{"cmd":"ota","url":"https://…/nexus-0.4.1.bin","sha256":"<64 hex>","version":"0.4.1"}` | `ok:true,"status":"downloading","version"` o `ok:false,"error"` | descarga, verifica SHA-256 y reinicia. Confirma a los 60 s; si falla, vuelve sola a la versión anterior |
| `identify` | `{"cmd":"identify"}` | `ok:true` | LEDs blancos parpadeando 5 s + pío |
| `ping` | `{"cmd":"ping"}` | `ok:true` | publica una telemetría al momento |
| `set_theme` | `{"cmd":"set_theme","themeId":"minimal"}` | `ok`, `themeId`, `theme` (el activo tras el intento), `reason` si no (`unknown_theme`, `needs_sd`, `missing_assets`, `needs_psram`) | cambia el tema de caras; si no se puede, sigue el anterior. Una caída en caliente llega como ack `set_theme` con `"fallback":true` |
| `ping_themes` | `{"cmd":"ping_themes"}` | `{"cmd":"themes","ok":true,"theme","hasSD","hasPSRAM","themes":[{"id","kind","available","reason"?}]}` | informe de capacidades. También sale solo al conectar, una vez por encendido |

**`set_plant`:**
```json
{"cmd":"set_plant","plantId":"epipremnum-aureum","nombre":"Potus",
 "thresholds":{"suelo_sed":30,"suelo_ideal_min":40,"suelo_ideal_max":60,"suelo_exceso":75,
               "lux_min":1000,"lux_max":10000,"temp_min":18,"temp_max":29,"hr_min":40,"hr_max":70}}
```
Errores: `bad_plant_id`, `missing_thresholds`, `bad_soil_thresholds`, `bad_lux_thresholds`, `bad_temp_thresholds`, `bad_humidity_thresholds`. `nivel_mecha` se ignora. El reset de fábrica borra el perfil.

**Errores de `ota`:** antes de descargar: `bad_url`, `bad_sha256`, `bad_version`, `insecure_url`, `already_installed`, `needs_usb`, `battery_low` (≤ 30 %), `previous_update_unconfirmed`. Durante la descarga (el ack sale **al volver MQTT**, tras reconectar): `http_<código>`, `too_big`, `flash_begin_failed`, `download_timeout`, `flash_write_failed`, `download_incomplete`, `sha256_mismatch`, `invalid_image`. El éxito no tiene ack propio: se ve en la telemetría (`"fw"` nuevo).

**Con batería** el comando espera en el broker (QoS 1) hasta el siguiente despertar (≤ 30 min, o PIR/toque).

---

## 5. Avisos de EntryLink (`.../notify`)

```json
{"id":"pkg-8812","kind":"PACKAGE","title":"Paquete en portería","icon":"package",
 "led":{"color":"#2E7DFF","pattern":"pulse"},"sound":"two_beep","interrupts":true,"ttlSec":20}
```

| Campo | Por defecto | Notas |
|---|---|---|
| `id` | — | opcional. Si se repite el último `id`, se ignora (deduplicación ante reentregas QoS 1). **Recomendado siempre** |
| `kind` | `"INFO"` | texto libre (el firmware no conoce los tipos) |
| `title` | `""` | la pantalla no tiene tildes: se pasan a ASCII (`portería` → `porteria`) |
| `icon` | `"?"` | `package`, `panic`, `info`, … (los que dibuja `lib/Notify`; desconocido = `?`) |
| `led.color` | `#FFFFFF` | `#RRGGBB` |
| `led.pattern` | `solid` | `solid` \| `blink` \| `pulse` |
| `sound` | `beep` | `none` \| `beep` \| `two_beep` \| `alarm` |
| `interrupts` | `true` | `false` = aviso discreto (franja + LED, sin pausar la cara) |
| `ttlSec` | 20 | 1-300. Se descarta antes con un toque |

No hay ack para `notify`. Con batería llega al siguiente despertar: **PANIC no es tiempo real con batería** (el backend decide con el último `power` de la telemetría).

---

## 6. HTTP

Todas con `X-Device-Id` + `X-Device-Key`; credenciales malas → **401** (la matera reintenta más tarde). Timeouts del firmware: 3 s de conexión, 4 s de respuesta.

En el backend de EntryLink las rutas llevan el prefijo global `/api/v1`: en el firmware, `BACKEND_URL = "https://api.alternaqj.com/api/v1"` (sin barra final). El broker MQTT es el embebido del módulo IoT (`IOT_MQTT_PORT`, 8883 por defecto).

### `POST /iot/devices/telemetry`
Cuerpo: el JSON de la sección 3 (`Content-Type: application/json`). Respuesta 2xx (p. ej. `{"ok":true}`); cualquier otro código = no entregada (se queda en la cola). Debe responder rápido (< 200 ms): las alertas van por cola.

### `GET /iot/devices/<deviceId>/plant`
- **200** con el mismo JSON que `set_plant` sin `"cmd"`: `{"plantId":"epipremnum-aureum","nombre":"Potus","thresholds":{...}}`.
- **204** sin cuerpo: el dueño no ha elegido planta → la matera vuelve al perfil genérico.
- La matera lo pide al **encender** (no en cada despertar con batería) y **al vincularse**. Si falla, reintenta a los 60 s, 3 veces.

### `POST /iot/devices/pairing-code`
Cabeceras `X-Device-Id`, `X-Device-Key`, `Content-Type: application/json`; cuerpo `{}`.
Respuesta 200/201:
```json
{"code":"7F3A9C","expiresAt":1792888234,"expiresIn":600}
```
- `code`: corto (cabe en el QR #2 como `remotelink://link/<code>` y se muestra en grande).
- `expiresIn` (s) manda; si falta, usa `expiresAt` (epoch s o ms). Se acota a 30-3600 s. Sin ninguno: 600 s.
- Cualquier otro código HTTP → la matera reintenta cada 10 s (cara ERROR_FAULT).
- La matera lo pide al entrar en SIN_VINCULAR y cada vez que caduca.

### `GET /iot/devices/<deviceId>/status`
Mismas cabeceras. Respuesta 200: `{"deviceId":"NEXUS-TEST01","linked":true,"owner":"Maicol"}`.
Respaldo cada 5 s mientras muestra el QR #2 **si MQTT no está conectado**. Con `linked:true` vincula igual que el comando `linked`.

### Flujo de vinculación
1. Sin WiFi → SoftAP `Niko-Setup-XXXX` + QR #1 → portal `192.168.4.1` (el backend no interviene; la clave WiFi solo vive en la NVS).
2. Con WiFi y sin vínculo → `POST pairing-code` → QR #2.
3. RemoteLink vincula con el código → el backend publica `{"cmd":"linked","owner":"<nombre>"}` (y `status` devuelve `linked:true`).
4. Transferir = `factory_reset` → vuelve al paso 1.

---

## 7. Nombres de cara (`face`)

`Thirsty`, `Dehydrated`, `Happy / Satisfied`, `Overwatered`, `Drowning`, `Tank Empty`, `Sunny / Happy`, `Sunburnt / Overheated`, `Shadow Seeking`, `Dark / Lonely`, `Sleeping`, `Waking Up`, `Dazzled`, `Freezing`, `Chilly`, `Fever / Hot`, `Melting`, `Dry Air`, `Humid`, `Comfy`, `Shivering`, `Loved / Petted`, `Tickled`, `Surprised`, `Naughty / Wink`, `Purring`, `Annoyed`, `Shy`, `Kiss`, `Dizzy`, `Scared`, `Angry / Shaken`, `Upside Down`, `Tilted`, `Relieved`, `Sleepy Motion`, `Charging`, `Full Battery`, `Low Battery`, `Pairing Wi-Fi`, `Connected`, `Disconnected`, `Firmware Updating`, `Error / Fault`, `Plant Birthday`, `Halloween`, `Christmas / Winter`, `Idle / Curiosity`, `Bored` (49, `lib/Faces/Faces.cpp`).

Para alertas, mejor usar los datos que el nombre de la cara: `soil` contra el perfil, `tank:"empty"`, `tempC`. Varias caras son de interacción o fechas y no dicen nada de la planta.

---

## 8. Diferencias con el prompt original del backend

| Prompt | Real |
|---|---|
| `POST /iot/devices/telemetry` (REST) como canal | Canal principal MQTT; el REST solo para la cola y como respaldo (mismo JSON) |
| `"tank":true` | `"tank":"ok"/"empty"` |
| `"mood":"thirsty"` (enum) | `"face":"Thirsty"` (49 nombres) |
| Socket `device:factory_reset` hacia la placa | `cmd` MQTT `factory_reset` (el socket es solo hacia la app) |
| `"lux":35.0` (float) | entero |
| — | `ts`, `queued`, `power`, `plantId`, `faults`, `ack`, `set_plant`, `ota`, `identify`, `ping` |
| Detección de USB por VBUS | por divisor de VCC: con la batería llena falla (handOff_fase4 §4.12, pendiente de hardware) |
