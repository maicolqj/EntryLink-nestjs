# Contrato de API — Autenticación de residentes

Referencia para el equipo de frontend (web y móvil). Cubre los flujos de inicio de sesión de residentes que **no consumen mensajes de pago**.

Versión backend: `0.0.15` · Endpoint: `POST /graphql`

---

## 0. Requisito transversal: `x-device-id`

Todas las peticiones deben enviar un identificador de dispositivo estable.

```http
x-device-id: 550e8400-e29b-41d4-a716-446655440000
x-app-version: 1.4.2            # opcional, útil para soporte
Authorization: Bearer <accessToken>   # solo en operaciones autenticadas
```

Se genera **una vez** en la primera apertura y se persiste:

| Plataforma | Dónde guardarlo |
| --- | --- |
| iOS | Keychain |
| Android | Keystore / EncryptedSharedPreferences |
| Web | `localStorage` |

Debe sobrevivir a cierres de sesión. Solo cambia si el usuario reinstala o borra los datos de la app.

> **Por qué importa.** El servidor calcula un fingerprint como `HMAC(userAgent | deviceId)`. Sin el header, el login por PIN devuelve `DEVICE_ID_REQUIRED`, y en los flujos de aprobación todos los navegadores con la misma versión comparten fingerprint, lo que debilita la atadura al dispositivo. **También hay que enviarlo desde web.**

---

## 1. Clave de acceso del residente

Una sola clave por **cuenta**, alfanumérica de 6 caracteres, elegida por el residente. Reemplaza al código `RES-xxxxx` que antes emitía el sistema.

Dos reglas gobiernan todo lo demás:

1. **La clave no basta sola.** Solo abre sesión desde un dispositivo ya vinculado. Entrar en un equipo prestado exige pasar antes por WhatsApp entrante (§2) o por la aprobación desde otro equipo del residente (§3).
2. **La clave no se pide de nuevo por cada equipo.** Al vincular un dispositivo nuevo, este hereda la clave que la cuenta ya tenía.

### 1.1 Saber si la cuenta ya tiene clave

Requiere sesión activa. Se consulta apenas se abre sesión: si devuelve `false`, hay que exigir su creación antes de dejar usar la app.

```graphql
query ResidentHasAccessCode {
  residentHasAccessCode
}
```

### 1.2 Crear o cambiar la clave

Requiere sesión activa (`RESIDENT_ROL`). Vincula además el dispositivo actual.

```graphql
mutation SetAccessCode($input: SetAccessCodeInput!) {
  setResidentAccessCode(input: $input) {
    id
    deviceId
    label
    platform
    createdAt
  }
}
```

```json
{ "input": { "code": "K7M2Q4", "label": "iPhone de Juan" } }
```

`code`: 6 caracteres alfanuméricos, con al menos una letra y un número. Se normaliza a mayúsculas, así que `k7m2q4` y `K7M2Q4` son la misma clave. `label`: opcional, máx. 120 caracteres.

El servidor rechaza claves obvias (`AAAAAA`, `123456`, `ABCDEF`, secuencias ascendentes y descendentes, y las que son solo letras o solo números). Conviene validar lo mismo en el cliente para dar retroalimentación inmediata, pero **la validación del servidor es la que manda**.

Cambiar la clave limpia el bloqueo por intentos fallidos: quien llega hasta aquí ya probó su identidad con una sesión válida.

### 1.3 Iniciar sesión con la clave

Público. Requiere `x-device-id`.

```graphql
mutation LoginWithAccessCode($input: LoginAccessCodeInput!) {
  loginWithAccessCode(input: $input) {
    accessToken
    refreshToken
    expiresIn
    sessionId
  }
}
```

```json
{ "input": { "code": "K7M2Q4", "identity": "1234567890", "label": "Mi Android" } }
```

El dispositivo **no viaja en el input**: se toma del header.

`identity` solo hace falta cuando ese equipo todavía **no está vinculado**; desde uno vinculado el servidor lo ignora. Como el cliente no puede saber con certeza si el vínculo sigue vivo del lado del servidor, lo más simple es **enviarlo siempre**.

**Equipo ya vinculado** → basta la clave. Un fallo cuenta contra el bloqueo de la cuenta (5 intentos → 15 minutos).

**Equipo sin vincular** → documento + clave correctos emiten los tokens **y vinculan el equipo** en el mismo paso, además de avisar por push (`NEW_DEVICE_LINKED`) a los equipos que ya estaban vinculados. Este camino existe porque los otros dos fallan justo para quien más los necesita: el residente que reinstaló la app en su único celular no tiene otro equipo desde donde aprobar, y el canal de WhatsApp puede estar apagado.

Como el documento no es secreto, ese camino se compensa con tres cosas que la UI no debe interpretar como el caso vinculado:

- **Respuesta uniforme.** Documento inexistente, cuenta sin clave y clave incorrecta devuelven todos `ACCESS_CODE_INVALID` con el mismo texto: el endpoint no puede volverse un oráculo de qué cédulas están registradas.
- **Los fallos NO bloquean la cuenta.** Se frenan aparte, por documento y por IP (`DEVICE_ENROLLMENT_THROTTLED`, 15 minutos). Bloquear la cuenta desde aquí convertiría el endpoint en un DoS: bastaría una lista de cédulas para dejar sin acceso a todo el conjunto. Agotar el freno cierra **solo** el alta de equipos nuevos; los ya vinculados siguen entrando.
- **Aviso al residente.** Es la señal que hace visible un robo de cuenta. La app debe mostrar la notificación con el camino a "Dispositivos vinculados".

### 1.4 Gestionar dispositivos

```graphql
query MyDevices {
  myResidentDevices {
    id
    deviceId
    label
    platform
    lastUsedAt
    createdAt
  }
}

mutation RevokeDevice($deviceId: ID!) {
  revokeResidentDevice(deviceId: $deviceId)   # usa el campo `id`, no `deviceId`
}

mutation RevokeMyOtherDevices {
  revokeMyOtherDevices   # devuelve cuántos equipos se desvincularon
}
```

`revokeMyOtherDevices` es la respuesta al celular perdido: se entra desde el equipo nuevo y se corta el acceso de todos los demás sin tener que identificarlos uno por uno. Ofrecerlo justo después de vincular un dispositivo en un flujo de recuperación.

Revocar un equipo puntual cierra únicamente la sesión de ese equipo.

### 1.5 Errores

| `extensions.code` | Significado | Qué hacer en la UI |
| --- | --- | --- |
| `DEVICE_ID_REQUIRED` | Falta el header | Bug del cliente: revisar el interceptor |
| `ACCESS_CODE_INVALID` | Clave incorrecta. Desde un equipo sin vincular cubre además "documento inexistente" y "cuenta sin clave" | Mostrar el `message` tal cual: desde un equipo vinculado trae los intentos restantes |
| `ACCESS_CODE_LOCKED` | Cuenta bloqueada 15 min | Cuenta regresiva; ofrecer ingreso por WhatsApp |
| `ACCESS_CODE_NOT_SET` | La cuenta todavía no tiene clave | Enviar al ingreso por WhatsApp para crearla |
| `ACCESS_CODE_TOO_WEAK` | Clave obvia o mal formada | Mostrar al crearla |
| `ACCESS_CODE_REQUIRED` | Falta la clave al vincular un equipo nuevo | Pedirla en el canje (§2.3 y §3.1) |
| `DEVICE_NOT_LINKED` | Equipo sin vincular y **sin** `identity` en el input | Pedir el documento y reintentar; solo lo ven clientes viejos |
| `DEVICE_ENROLLMENT_THROTTLED` | Demasiados intentos de vincular un equipo nuevo (por documento o por IP) | Aviso de espera; **no** es bloqueo de cuenta: los equipos ya vinculados siguen entrando |
| `USER_SUSPENDED` / `ACCOUNT_LOCKED` | Cuenta no activa | Mensaje de contactar al administrador |

El bloqueo por intentos es **de la cuenta**, no del dispositivo: cambiar de equipo no regala intentos nuevos. Y agotar los intentos ya no desvincula nada — antes lo hacía, y eso permitía a un tercero dejar al residente sin acceso rápido solo tecleando mal.

Ese bloqueo de cuenta lo alimentan únicamente los fallos desde un equipo **ya vinculado**. Los del alta con documento + clave van al contador aparte de `DEVICE_ENROLLMENT_THROTTLED`, por la razón explicada en §1.3.

---

## 2. Login por WhatsApp entrante (reverse-OTP)

El residente **envía** un mensaje desde su WhatsApp en lugar de recibir un código. Recuperación de acceso sin costo.

### 2.0 Disponibilidad del canal

```graphql
query WaLoginAvailable {
  whatsAppLoginAvailable
}
```

Pública, sin argumentos. Devuelve `false` cuando el servidor no tiene configurado `WHATSAPP_BUSINESS_NUMBER`.

Consultarla antes de ofrecer la opción, en vez de deducir la disponibilidad de un `WA_LOGIN_NOT_CONFIGURED` anterior. **No persistir un `false` en disco**: cuando el servidor habilita el canal, una marca guardada deja el método de recuperación oculto justo para el usuario que ya perdió el acceso. Si la consulta falla por red, mostrar la opción — es preferible un intento fallido con mensaje claro que un camino invisible.

### 2.1 Solicitar

```graphql
mutation RequestWaLogin($identity: String!) {
  requestWhatsAppLoginChallenge(identity: $identity) {
    challengeId
    nonce
    whatsappUrl
    messageText
    expiresAt
    warning
  }
}
```

```json
{
  "challengeId": "9f1c...e4",
  "nonce": "K7P3MQ2X",
  "whatsappUrl": "https://wa.me/573009998877?text=INGRESAR%20K7P3MQ2X",
  "messageText": "INGRESAR K7P3MQ2X",
  "expiresAt": "2026-07-30T21:45:00.000Z",
  "warning": "Enviar este mensaje inicia sesión en el dispositivo donde lo solicitaste. Si alguien más te pidió enviarlo, no lo hagas."
}
```

**Requisitos de interfaz:**

1. Mostrar `warning` **antes** del botón de enviar, no después. Es la única mitigación contra que a un residente le hagan enviar un nonce ajeno.
2. Botón principal → abrir `whatsappUrl`.
3. Fallback visible → mostrar `messageText` para copiar y pegar, por si el deep link no abre.
4. Guardar `challengeId` **en memoria**. Nunca mostrarlo en pantalla ni persistirlo.

### 2.2 Esperar confirmación

```graphql
query WaLoginStatus($challengeId: ID!) {
  whatsAppLoginChallengeStatus(challengeId: $challengeId) {
    status      # PENDING | CONFIRMED | CONSUMED | EXPIRED
    expiresAt
  }
}
```

Polling cada 2–3 s. Cortar a los **2 minutos** (vigencia del intento).

### 2.3 Canjear

```graphql
mutation RedeemWaLogin($challengeId: ID!, $accessCode: String) {
  redeemWhatsAppLoginChallenge(challengeId: $challengeId, accessCode: $accessCode) {
    accessToken
    refreshToken
    expiresIn
    sessionId
  }
}
```

Solo funciona desde el mismo dispositivo que solicitó el intento, y una sola vez.

**`accessCode` es obligatorio cuando la cuenta ya tiene clave.** Si se omite, el servidor responde `ACCESS_CODE_REQUIRED` y la UI debe pedirla ahí mismo, sin reiniciar el flujo.

La razón: quien roba el teléfono se lleva también la línea de WhatsApp, así que podría enviarse el mensaje a sí mismo desde el equipo robado. Exigir además la clave convierte el vínculo en dos factores —posesión y conocimiento— y el ladrón solo tiene el primero.

En el **primer ingreso** no aplica: la cuenta todavía no tiene clave, y es justo el momento en que se crea (§1.2).

### 2.4 Errores

| `extensions.code` | Qué hacer |
| --- | --- |
| `WA_LOGIN_CHALLENGE_PENDING` | Aún no llega el mensaje; seguir esperando |
| `WA_LOGIN_CHALLENGE_EXPIRED` | Ofrecer solicitar uno nuevo |
| `WA_LOGIN_CHALLENGE_CONSUMED` | Ya se usó; volver al inicio |
| `WA_LOGIN_CHALLENGE_NOT_FOUND` | No existe o es otro dispositivo; volver al inicio |
| `WA_LOGIN_RATE_LIMIT` | 3 intentos por documento cada 10 min |
| `WA_LOGIN_NOT_CONFIGURED` | Canal deshabilitado en el servidor; ocultar la opción |
| `ACCESS_CODE_REQUIRED` | Falta la clave de la cuenta; pedirla sin reiniciar el flujo |
| `ACCESS_CODE_INVALID` | Clave incorrecta; reintentar en la misma pantalla |

---

## 3. Aprobación de ingreso por push

Para el residente que cambió de equipo o perdió su PIN pero conserva la app instalada en otro dispositivo. Involucra **dos pantallas en dos dispositivos**.

```
Equipo nuevo                            Dispositivo confiable
────────────                            ─────────────────────
requestDeviceApproval("1020304050")
  → challengeId  (memoria)
  → approvalCode "K7P3"  ← en pantalla
                                        📲 push LOGIN_APPROVAL_REQUEST
                                           metadata.approvalCode = "K7P3"

                                        El residente COMPARA los códigos
                                        approveDeviceApproval(approvalId)

deviceApprovalStatus → APPROVED
redeemDeviceApproval(challengeId) → tokens
```

### 3.1 Dispositivo que pide entrar

```graphql
mutation RequestApproval($identity: String!) {
  requestDeviceApproval(identity: $identity) {
    challengeId
    approvalCode
    expiresAt
    instructions
  }
}

query ApprovalStatus($challengeId: ID!) {
  deviceApprovalStatus(challengeId: $challengeId) {
    status      # PENDING | APPROVED | DENIED | CONSUMED | EXPIRED
    expiresAt
  }
}

mutation RedeemApproval($challengeId: ID!, $accessCode: String) {
  redeemDeviceApproval(challengeId: $challengeId, accessCode: $accessCode) {
    accessToken
    refreshToken
    expiresIn
    sessionId
  }
}
```

Mostrar `approvalCode` en grande. Polling cada 2–3 s, con corte a los **5 minutos**.

Igual que en el canje por WhatsApp (§2.3), **`accessCode` es obligatorio cuando la cuenta ya tiene clave**: aprobar desde el otro equipo no alcanza por sí solo para vincular este. Si falta, llega `ACCESS_CODE_REQUIRED` y hay que pedirla en la misma pantalla.

### 3.2 Dispositivo confiable

Llega un push con:

```json
{
  "type": "LOGIN_APPROVAL_REQUEST",
  "priority": "URGENT",
  "title": "Solicitud de ingreso a tu cuenta",
  "body": "Alguien intenta entrar desde Chrome en Windows. Código: K7P3. Si no eres tú, recházalo.",
  "metadata": "{\"approvalId\":\"...\",\"approvalCode\":\"K7P3\",\"requestedFromLabel\":\"Chrome en Windows\",\"requestedFromIp\":\"190.1.2.3\",\"expiresAt\":\"...\"}"
}
```

`metadata` llega **serializado como string** (requisito de FCM): hay que parsearlo.

```graphql
query PendingApprovals {
  pendingDeviceApprovals {
    approvalId
    approvalCode
    requestedFromLabel
    requestedFromIp
    expiresAt
    createdAt
  }
}

mutation Approve($approvalId: ID!) { approveDeviceApproval(approvalId: $approvalId) }
mutation Deny($approvalId: ID!)    { denyDeviceApproval(approvalId: $approvalId) }
```

`pendingDeviceApprovals` es el respaldo para cuando el push no llega. Conviene consultarlo al abrir la app.

### 3.3 Requisito de seguridad no negociable

La pantalla de aprobación **debe** mostrar el `approvalCode`, el equipo y la IP de origen, y **exigir que el residente confirme que el código coincide** con el de la otra pantalla antes de habilitar el botón de aprobar.

> Un atacante puede disparar la solicitud con un documento ajeno; lo que no puede es hacer que el código de *su* pantalla aparezca en el teléfono de la víctima. Si el botón "Aprobar" se puede pulsar sin comparar, esta protección desaparece por completo. **No lo conviertas en un "¿Permitir? Sí / No".**

### 3.4 Errores

| `extensions.code` | Qué hacer |
| --- | --- |
| `APPROVAL_PENDING` | Aún sin respuesta; seguir esperando |
| `APPROVAL_DENIED` | El residente rechazó; mensaje claro y volver al inicio |
| `APPROVAL_EXPIRED` | Ofrecer solicitar de nuevo |
| `APPROVAL_CONSUMED` | Ya se usó |
| `APPROVAL_NOT_FOUND` | No existe, no es suya, o es otro dispositivo |
| `APPROVAL_ALREADY_RESOLVED` | Ya se aprobó o rechazó desde otro lado |
| `APPROVAL_RATE_LIMIT` | 3 solicitudes por documento cada 10 min |

---

## 4. Flujo existente sin cambios

Sigue siendo el fallback universal y el punto de entrada para vincular el primer dispositivo:

```graphql
mutation LoginResident($input: LoginResidentInput!) {
  loginResident(input: $input) {
    accessToken
    refreshToken
    expiresIn
    sessionId
  }
}
```

```json
{ "input": { "identity": "1020304050", "systemCode": "RES-K7P3M" } }
```

También sin cambios: `refreshToken`, `logout`, `resendResidentSystemCode`, `loginWithEmail`.

---

## 5. Manejo de errores

Todos los errores llegan con el código en `extensions.code`:

```json
{
  "errors": [{
    "message": "PIN incorrecto. Te quedan 3 intento(s)",
    "extensions": { "code": "DEVICE_PIN_INVALID" }
  }]
}
```

El `message` está redactado en español y es apto para mostrar al usuario. Ramificar la lógica **por `code`**, nunca por el texto del mensaje.

---

## 6. Orden de implementación sugerido

| # | Trabajo | Por qué en ese orden |
| --- | --- | --- |
| 1 | Header `x-device-id` | Desbloquea todo lo demás y no rompe nada existente |
| 2 | §1 Login por PIN | Elimina por sí sola la mayor parte del gasto en mensajes |
| 3 | §3 Aprobación por push | Reutiliza la infraestructura de notificaciones ya montada |
| 4 | §2 WhatsApp entrante | La menos usada y la que depende de configuración en Meta |

---

## 7. Dependencias del lado servidor

Estos flujos requieren configuración en el backend antes de poder probarse contra producción:

- `WHATSAPP_APP_SECRET` y suscripción al campo `messages` en el panel de Meta → login por WhatsApp entrante.
- `WHATSAPP_BUSINESS_NUMBER` → sin esta variable, `whatsAppLoginAvailable` devuelve `false` y `requestWhatsAppLoginChallenge` responde `WA_LOGIN_NOT_CONFIGURED`. El valor va en formato Meta: solo dígitos con indicativo país y sin `+` (ej. `573001234567`); es el número visible del negocio, no el `WHATSAPP_PHONE_NUMBER_ID`.
- FCM y VAPID configurados → aprobación por push.
- Migraciones ejecutadas (`resident_devices`, `whatsapp_login_challenges`, `device_approval_requests`).
- Migración `AddNewDeviceLinkedNotificationType` → agrega el label `NEW_DEVICE_LINKED` al enum nativo de Postgres. Sin ella el aviso de equipo nuevo falla al insertarse, y como el envío es best-effort el ingreso funciona igual **sin avisar a nadie**: el residente pierde la única señal de un robo de cuenta. Correrla antes de habilitar §1.3 desde equipos sin vincular.
