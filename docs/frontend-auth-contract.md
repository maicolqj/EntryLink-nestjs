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

## 1. Login por PIN de dispositivo

El residente autentica una vez con documento + código, vincula el dispositivo, y a partir de ahí entra con un PIN de 6 dígitos.

### 1.1 Vincular el dispositivo y fijar el PIN

Requiere sesión activa (`RESIDENT_ROL`).

```graphql
mutation SetDevicePin($input: SetDevicePinInput!) {
  setResidentDevicePin(input: $input) {
    id
    deviceId
    label
    platform
    createdAt
  }
}
```

```json
{ "input": { "pin": "482913", "label": "iPhone de Juan" } }
```

`pin`: exactamente 6 dígitos. `label`: opcional, máx. 120 caracteres.

El servidor rechaza PINs con patrones obvios (`000000`, `123456`, `121212`, `123123`, secuencias ascendentes y descendentes). Conviene validar lo mismo en el cliente para dar retroalimentación inmediata, pero **la validación del servidor es la que manda**.

### 1.2 Iniciar sesión con el PIN

Público. Requiere `x-device-id`.

```graphql
mutation LoginWithDevicePin($input: LoginDevicePinInput!) {
  loginWithDevicePin(input: $input) {
    accessToken
    refreshToken
    expiresIn
    sessionId
  }
}
```

```json
{ "input": { "pin": "482913" } }
```

El dispositivo **no viaja en el input**: se toma del header.

### 1.3 Gestionar dispositivos

```graphql
query MyDevices {
  myResidentDevices {
    id
    deviceId
    label
    platform
    lastUsedAt
    lockedUntil
    createdAt
  }
}

mutation RevokeDevice($deviceId: ID!) {
  revokeResidentDevice(deviceId: $deviceId)   # usa el campo `id`, no `deviceId`
}
```

Revocar cierra únicamente la sesión de ese equipo. Los demás dispositivos siguen operando.

### 1.4 Errores

| `extensions.code` | Significado | Qué hacer en la UI |
| --- | --- | --- |
| `DEVICE_ID_REQUIRED` | Falta el header | Bug del cliente: revisar el interceptor |
| `DEVICE_PIN_INVALID` | PIN incorrecto | Mostrar intentos restantes (vienen en `message`) |
| `DEVICE_LOCKED` | Bloqueado 15 min | Cuenta regresiva; ofrecer login con documento |
| `DEVICE_NOT_LINKED` | Dispositivo sin vincular o navegador distinto | Enviar al login con documento + código |
| `DEVICE_REVOKED` | Desvinculado por fuerza bruta | Igual que el anterior, con aviso de seguridad |
| `DEVICE_PIN_TOO_WEAK` | PIN obvio | Mostrar al crear el PIN |
| `USER_SUSPENDED` / `ACCOUNT_LOCKED` | Cuenta no activa | Mensaje de contactar al administrador |

---

## 2. Login por WhatsApp entrante (reverse-OTP)

El residente **envía** un mensaje desde su WhatsApp en lugar de recibir un código. Recuperación de acceso sin costo.

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
mutation RedeemWaLogin($challengeId: ID!) {
  redeemWhatsAppLoginChallenge(challengeId: $challengeId) {
    accessToken
    refreshToken
    expiresIn
    sessionId
  }
}
```

Solo funciona desde el mismo dispositivo que solicitó el intento, y una sola vez.

### 2.4 Errores

| `extensions.code` | Qué hacer |
| --- | --- |
| `WA_LOGIN_CHALLENGE_PENDING` | Aún no llega el mensaje; seguir esperando |
| `WA_LOGIN_CHALLENGE_EXPIRED` | Ofrecer solicitar uno nuevo |
| `WA_LOGIN_CHALLENGE_CONSUMED` | Ya se usó; volver al inicio |
| `WA_LOGIN_CHALLENGE_NOT_FOUND` | No existe o es otro dispositivo; volver al inicio |
| `WA_LOGIN_RATE_LIMIT` | 3 intentos por documento cada 10 min |
| `WA_LOGIN_NOT_CONFIGURED` | Canal deshabilitado en el servidor; ocultar la opción |

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

mutation RedeemApproval($challengeId: ID!) {
  redeemDeviceApproval(challengeId: $challengeId) {
    accessToken
    refreshToken
    expiresIn
    sessionId
  }
}
```

Mostrar `approvalCode` en grande. Polling cada 2–3 s, con corte a los **5 minutos**.

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
- `WHATSAPP_BUSINESS_NUMBER` → sin esta variable, `requestWhatsAppLoginChallenge` responde `WA_LOGIN_NOT_CONFIGURED`.
- FCM y VAPID configurados → aprobación por push.
- Migraciones ejecutadas (`resident_devices`, `whatsapp_login_challenges`, `device_approval_requests`).
