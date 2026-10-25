# Módulo IoT — dispositivos (matera Niko Smart Plant / NEXUS v5)

Rama `feature/iot-devices`, creada desde `main`. **No se ha propuesto merge.**

> **Confirmación:** no modifiqué ningún archivo existente, salvo el import condicional en `AppModule`. Además se tocaron, como pide el prompt, `.env.example` (variables nuevas, comentadas, al final), `package.json` y `yarn.lock` (una sola dependencia nueva, `aedes`, sin cambiar las versiones de las demás).

El contrato con el firmware está en [`CONTRATO_REAL.md`](./CONTRATO_REAL.md), copia del repo del firmware (`nexus-firmware/CONTRATO_REAL.md`). Cuando no coincide con el prompt original, **manda el firmware**.

---

## 1. Activar y desactivar

| | |
|---|---|
| Activar | `IOT_ENABLED=true` en el entorno (local o staging) y reiniciar |
| Desactivar | quitar la variable (o cualquier valor distinto de `true`) y reiniciar |
| Producción | **no definirla**: el módulo no se carga |

La única línea añadida en `src/app.module.ts`, al final de `imports`:

```ts
// IoT (matera Niko): solo con IOT_ENABLED=true. `require` y no `import` → sin el flag no se carga ningún archivo del módulo (README_IOT.md)
...(process.env.IOT_ENABLED === 'true' ? [(require('./modules/iot-devices/iot-devices.module') as typeof import('./modules/iot-devices/iot-devices.module')).IotDevicesModule] : []), // eslint-disable-line @typescript-eslint/no-require-imports, prettier/prettier
```

**Qué garantiza tenerlo apagado:**
- Se usa `require` dentro de la condición, y no un `import` arriba. Con el flag apagado no se ejecuta ningún archivo del módulo: no se registran tipos GraphQL ni enums, no hay rutas, no se abre el puerto MQTT, no hay colas, ni cron, ni suscriptor. El `typeof import()` es solo un tipo: no carga nada.
- Las entidades se llaman `*.iot-entity.ts` y no `*.entity.ts`. El glob global de TypeORM (`**/*.entity.ts`) no las ve, y solo se registran con `forFeature` cuando el módulo se carga. Una entidad mal definida no puede tumbar el arranque de producción.
- `IOT_ENABLED` funciona también desde el `.env`: `ConfigModule.forRoot` (el primer elemento de `imports`) lo copia a `process.env` de forma síncrona, antes de que se evalúe esta línea.

Variables (todas opcionales; ver `.env.example`): `IOT_MQTT_PORT` (8883), `IOT_MQTT_HOST`, `IOT_MQTT_TLS_CERT`, `IOT_MQTT_TLS_KEY`, `IOT_PAIRING_CODE_TTL_S` (600), `IOT_OFFLINE_AFTER_MIN` (120), `IOT_DEFAULT_TZ` (America/Bogota) e `IOT_PLANT_CATALOG`. No pasan por el `envValidationSchema` global, para no cambiar la validación de producción.

## 2. Migraciones (staging)

Son **solo aditivas**: 7 tablas nuevas con prefijo `iot_`, más la semilla del catálogo de avisos dentro de su propia tabla nueva. No hay ningún `ALTER`, `DROP` ni `RENAME` sobre lo existente; las únicas referencias a lo existente son claves foráneas **desde** las tablas nuevas hacia `users`, `units` y `residential_complexes`.

Viven en `database/migrations/` y tienen **su propio data-source**, con su tabla de control `iot_migrations`. El `yarn migration:run` de siempre **no las ve**: el próximo despliegue de otra funcionalidad no creará estas tablas por accidente.

```bash
# aplicar
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js -d src/modules/iot-devices/database/iot-data-source.ts migration:run
# revertir (borra SOLO las tablas iot_*)
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js -d src/modules/iot-devices/database/iot-data-source.ts migration:revert
# ver estado
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js -d src/modules/iot-devices/database/iot-data-source.ts migration:show
```
Usa las mismas variables `DB_*` que `src/core/database/data-source.ts`. **No las ejecuté contra ninguna base de datos.**

## 3. Archivos nuevos

Todo está en `src/modules/iot-devices/`:

| Carpeta | Contenido |
|---|---|
| `iot-devices.module.ts`, `iot.config.ts` | Módulo y configuración por variables de entorno |
| `entities/` | `Device`, `PlanterReading`, `DeviceAlert`, `DeviceOutboxMessage`, `DeviceNotificationType`, `DeviceNotificationRule`, `DeviceNotificationPref` (`*.iot-entity.ts`) |
| `enums/` | `DeviceType` (`SMART_PLANTER`, `SMART_LOCK`, `SENSOR`, `CAMERA`), `DeviceStatus` |
| `mqtt/` | `IotMqttBroker` (aedes embebido, TLS, auth bcrypt, ACL), `DevicePublisher`, topics |
| `services/` | `DevicesService` (alta, vincular, reset, ajustes, planta, OTA, consultas), `DeviceIngressService` (telemetría, presencia y ack de MQTT y REST), `DeviceOutboxService` (cmd/notify ahora o al conectar), `DeviceCredentialsService` |
| `telemetry/` | Parser único de la telemetría del firmware (MQTT y REST) |
| `alerts/` | Reglas puras (sed, depósito, riego, exceso, calor/frío sostenidos, sin conexión, throttling, horas de silencio) y despachador (push, socket, WhatsApp pendiente) |
| `notifications/` | Catálogo, reglas del conjunto, preferencias, política de entrega y suscriptor de `notifications` |
| `queues/` | Colas BullMQ `device-alerts` y `device-notify` con sus workers |
| `cron/` | Sin conexión cada hora (+ limpieza de la outbox) |
| `plants/` | Catálogo de plantas (Potus incluido; las 60 especies con `IOT_PLANT_CATALOG`) |
| `controllers/`, `guards/` | REST de los aparatos y `DeviceKeyGuard` (X-Device-Id/Key, sin JWT) |
| `resolvers/`, `dto/` | GraphQL para RemoteLink |
| `socket/` | Eventos `device:*` sobre el gateway existente |
| `database/` | Migración y data-source propios |
| `*.spec.ts` | 9 suites, 62 tests |

## 4. Arquitectura

```
Matera ──MQTT/TLS 8883 (deviceId + deviceKey)──► IotMqttBroker (aedes, dentro del backend)
   │                                                 │ publish → DeviceIngressService → iot_planter_readings
   │                                                 │                               → Socket.io device:telemetry → RemoteLink
   │                                                 │                               → BullMQ device-alerts → push / socket
   └──HTTPS /api/v1/iot/devices/* (cola, respaldo, código, estado, planta)──► mismo DeviceIngressService

EntryLink crea una Notification ──► EntrylinkNotificationSubscriber (afterInsert) ──► BullMQ device-notify
   ──► DeviceNotificationsService (tipo, prefs, silencio) ──► DeviceOutboxService ──► .../notify (aro + buzzer + icono)
```

**Decisiones:**
- **Canal = MQTT**, como el firmware. El broker es un *provider* del módulo (regla 6): nace y muere con el flag. El backend no es un cliente MQTT: escucha el evento `publish` de aedes (equivale a estar suscrito a `entrylink/devices/#`) y publica con `broker.publish`.
- **Telemetría con el formato real del firmware** (`tank` "ok"/"empty", `face` como ánimo, `ts`, `queued`, `power`, `faults`…). REST y MQTT pasan por el mismo parser.
- **Cola propia (`iot_device_outbox`)** en lugar de la persistencia en memoria de aedes, que se pierde al reiniciar. Cada mensaje caduca a su tiempo y lo caducado no se entrega.
- **Permisos con los roles existentes** (no se toca `ValidPermissions`): el residente opera sobre sus aparatos por ser el dueño, `COMPLEX_ROL` sobre los de su conjunto, `SUPER_ADMIN_ROL` sobre todo, y solo él lanza un OTA. Portería (`SECURITY_ROL`) no recibe alertas de aparatos.
- **Avisos de EntryLink sin tocar su módulo:** suscriptor de TypeORM sobre `notifications`. Todas se guardan con `notifRepo.save()` (lo comprobé, también las de pánico). El suscriptor solo encola, sin esperar a Redis, así que no alarga la transacción original.
- **Eventos de socket** en un enum propio (`IotSocketEvent`): el `SocketEvent` global no se toca.

## 5. Contrato con el aparato

### MQTT (detalle en CONTRATO_REAL.md)
`entrylink/devices/<deviceId>/{telemetry,status,ack}` (matera →) y `{cmd,notify}` (→ matera, QoS 1). Usuario = deviceId, contraseña = deviceKey, clientId = deviceId. Si las credenciales son malas, CONNACK 4 y la matera muestra el fallo `mqtt_auth`.

Comandos que envía el backend: `linked`, `factory_reset` (con `wipe_calib` opcional), `set_plant`, `ota`, `identify`.

### REST (prefijo global `/api/v1`)
En el firmware: `BACKEND_URL = "https://api.alternaqj.com/api/v1"`.

```bash
H='-H "X-Device-Id: NEXUS-7F3A9C" -H "X-Device-Key: <deviceKey>"'
# Telemetría (cola sin red y respaldo): MISMO JSON que por MQTT → 200 {"ok":true} · 400 si no es válida · 401 credenciales
curl -X POST https://api.alternaqj.com/api/v1/iot/devices/telemetry \
  -H "X-Device-Id: NEXUS-7F3A9C" -H "X-Device-Key: <deviceKey>" -H "Content-Type: application/json" \
  -d '{"type":"SMART_PLANTER","fw":"0.4.0","ts":1792892603,"soil":24,"tank":"ok","lux":350,"tempC":24.6,"hum":58,"battery":4.1,"batteryPct":90,"power":"usb","face":"Thirsty","motion":false,"tilt":3,"plantId":null,"plantProfile":"generic","rssi":-60}'
# Código de vinculación (QR #2) → {"code":"7F3A9C","expiresAt":<epoch s>,"expiresIn":600}
curl -X POST https://api.alternaqj.com/api/v1/iot/devices/pairing-code -H "X-Device-Id: ..." -H "X-Device-Key: ..." -d '{}'
# Estado (respaldo sin MQTT) → {"deviceId":"NEXUS-7F3A9C","linked":true,"owner":"Ana"}
curl https://api.alternaqj.com/api/v1/iot/devices/NEXUS-7F3A9C/status -H "X-Device-Id: ..." -H "X-Device-Key: ..."
# Perfil de planta → 200 {"plantId","nombre","thresholds"} · 204 sin planta
curl https://api.alternaqj.com/api/v1/iot/devices/NEXUS-7F3A9C/plant -H "X-Device-Id: ..." -H "X-Device-Key: ..."
```
La telemetría responde rápido: guarda la lectura, actualiza el aparato, emite el socket y **encola** las alertas, sin esperar ni al push ni a WhatsApp. La misma lectura que llegue dos veces (por MQTT y por REST) se descarta gracias al índice único (aparato, `measuredAt`).

## 6. Para RemoteLink

### GraphQL
`deviceId` admite el uuid o el id público (`NEXUS-7F3A9C`).

| Operación | Quién | Qué |
|---|---|---|
| `createIotDevice(input:{type, complexId})` | COMPLEX_ROL de ese conjunto, SUPER_ADMIN | `{device, deviceKey (UNA vez), pairingCode, csvLine}`. `csvLine` es la fila para `tools/flash_identity.py` |
| `regenerateDevicePairingCode(deviceId)` | admin | código nuevo |
| `linkDeviceByCode(code)` | residente | Errores en español: código inválido (404), caducado (410), ya vinculado a otra cuenta (409), otro conjunto (403), ya usado (409) |
| `factoryResetDevice(input:{deviceId, wipeCalibration?})` | dueño o admin | sin dueño, `UNPROVISIONED`, código nuevo, config vacía; orden `factory_reset` |
| `renameDevice`, `updateDeviceConfig(input:{deviceId, config})` | dueño | `config`: `whatsappEnabled`, `notifyComplexAdmins`, `quietHours {start,end,timeZone?}` |
| `setDevicePlant(deviceId, plantId)`, `clearDevicePlant` | dueño | `set_plant` por MQTT y perfil para `GET /plant` |
| `identifyDevice(deviceId)` | dueño o admin | LEDs blancos 5 s. `true` = ya, `false` = al despertar |
| `startDeviceOta(input:{deviceId,url,sha256,version})` | SUPER_ADMIN | El ack llega en `lastAck` y como `device:ack` |
| `myDevices`, `device(deviceId)`, `deviceReadings(deviceId, from, to, pagination)`, `devicesByComplex(complexId)`, `plantCatalog` | | `IotDevice.lastTelemetry` es la última telemetría tal como la mandó la matera |
| `deviceNotificationTypes(complexId)`, `deviceNotificationPrefs(deviceId)`, `updateDeviceNotificationPrefs(deviceId, prefs)`, `setComplexMandatoryDeviceNotifications(complexId, typeKeys)`, `sendTestDeviceNotification(deviceId, typeKey)` | | Avisos en el aparato |

> En producción el middleware de *trusted documents* rechaza las operaciones que no están en el manifiesto. Añádelas con `POST /graphql-manifest/sync`, como cualquier operación nueva de la app.

### Socket.io
Sobre el gateway y las salas que ya existen.

| Evento | Sala | Payload |
|---|---|---|
| `device:telemetry` | `user:<dueño>` | `{ id, deviceId, readingId, reading: { soil, tankHasWater, lux, tempC, hum, battery, batteryPct, power, mood, motion, tilt, plantId, faults, rssi, queued, measuredAt, … } }` |
| `device:alert` | `user:<dueño>` (+ `role:COMPLEX_ROL:complex:<id>` si `notifyComplexAdmins`) | `{ id, deviceId, kind, title, body, at }`. `kind`: thirsty, tank_empty, watering, overwatered, hot, cold, offline |
| `device:linked` | `user:<dueño>` | `{ id, deviceId }` |
| `device:factory_reset` | `user:<dueño anterior>` | `{ id, deviceId }` |
| `device:ack` | `user:<dueño>` | `{ id, deviceId, ack: { cmd, ok, error?, …, at } }` |
| `device:presence` | `user:<dueño>` | `{ id, deviceId, connected }` |

### Push
Las alertas de la matera salen con `data.type = "DEVICE_ALERT"`, `entityType = "IotDevice"`, `entityId = <uuid>` y `metadata {deviceId, kind}`. No entran en el buzón (`dispatchPushOnly`). RemoteLink tiene que reconocer ese `type` para abrir la pantalla del aparato.

## 7. Reglas de alertas y de avisos

- **Alertas de la matera.** Usan el perfil de la planta o, si no hay, los umbrales genéricos del firmware:
  - sed: `soil < suelo_sed`;
  - depósito vacío: `tank:"empty"`;
  - "gracias por regar": el suelo sube 15 puntos o más (prioridad baja);
  - exceso de agua: `soil > suelo_exceso`;
  - calor o frío: solo si se sostiene en 3 lecturas seguidas.
- **Throttling.** Un aviso por (aparato, tipo) cada 6 h; el de sin conexión, uno cada 24 h. Las lecturas de la cola no generan alertas, y un aparato sin dueño no avisa a nadie.
- **Horas de silencio.** No hay push y no se registra, así que el aviso sale con la primera lectura después del silencio.
- **Avisos de EntryLink en el aparato.** El catálogo inicial es este:

  | Tipo | Viene de | Comportamiento |
  |---|---|---|
  | PANIC | `PANIC_ALERT` | Obligatorio y urgente; ignora las horas de silencio |
  | PACKAGE | `PACKAGE_RECEIVED` y `PACKAGE_READY` | |
  | VISITOR | `VISITOR_WALK_IN` y `VISITOR_ARRIVED` | |
  | ADMIN_NOTICE | `SYSTEM_ANNOUNCEMENT` y `COMPLEX_ALERT` | Discreto: no pausa la cara |

  - Si la matera está conectada (USB), el aviso llega al instante. Si no (batería), va a la cola con `deliveryTtlSec` y llega al despertar si no caducó. PANIC caduca a los 5 min: con batería no se promete en tiempo real.
  - Un broadcast llega a los aparatos del conjunto solo si va a residentes.

## 8. Pendiente y limitaciones

1. **WhatsApp:** el repo no tiene servicio de Twilio (ni dependencia ni código), así que `tank_empty` + `whatsappEnabled` solo queda registrado. Hay que conectarlo en `DeviceAlertDispatcher.sendWhatsapp` cuando exista.
2. **Un solo proceso:** el broker está embebido. Con varias réplicas, cada una tendría su broker y su lista de aparatos conectados. Para escalar habría que usar un broker externo, o aedes con `mqemitter-redis` y persistencia compartida, y el `connected` en Redis.
3. **Certificado del broker:** en producción hace falta un certificado para el host MQTT (p. ej. `mqtt.alternaqj.com`). Si es de Let's Encrypt, el firmware ya trae ISRG Root X1. Si el host es una IP, el certificado debe incluir también `DNS:<IP>` (mbedTLS 2.28 ignora los SAN de tipo IP).
4. **El puerto 8883** debe estar abierto en el servidor (firewall o docker-compose).
5. **Firmware, detección de USB con la batería llena:** con la batería llena, la matera puede tomarse por alimentada a batería aunque esté enchufada (pendiente de hardware: divisor desde VBUS). Mientras tanto, el backend ve `power:"battery"` y trata los avisos urgentes como no garantizados en tiempo real.
6. **Catálogo de 60 especies:** se carga con `IOT_PLANT_CATALOG`. En el repo solo está el Potus.
7. **Tests:** 62 en `src/modules/iot-devices` (`npx jest src/modules/iot-devices`). Cubren las reglas, el throttling (10 lecturas = 1 push), las horas de silencio, la decisión de entrega (USB frente a batería), el guard de dispositivo, el flujo vincular → reset → volver a vincular, los obligatorios y el parser.

## 9. Probado con la matera real (2026-10-24)

`IotMqttBroker` real (aedes + TLS + autenticación + ACL + enrutado), con la BD simulada, contra la placa NEXUS-TEST01 (firmware 0.4.0, `env:nexus`, CA propio):

| Prueba | Resultado |
|---|---|
| Matera con su deviceId + deviceKey | `AUTH aceptada` → conectada, suscrita a cmd/notify |
| Al suscribirse recibe lo pendiente | `identify` (LEDs blancos) y `notify` PACKAGE: aviso "Paquete en porteria" en pantalla, aro azul y dos pitidos |
| Telemetría por MQTT | parseada sin errores (suelo, depósito, `Dehydrated`, `battery`, Potus) |
| Ack | `{"cmd":"identify","ok":true}` |
| Batería | se despide y se duerme a los ~3 s (`desconectada`) |
| Clave mala | CONNACK 4 `bad user name or password` |
| clientId distinto del usuario | CONNACK 5 `not authorised` |
| Cliente sin TLS | rechazado (`Protocol error`) |

Sin probar todavía (necesita PostgreSQL + Redis en staging): migración `up`/`down`, el flujo completo con BD, los workers de BullMQ, el push y el suscriptor de `notifications`.
