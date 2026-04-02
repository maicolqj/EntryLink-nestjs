# Geocodificación automática con Nominatim

**Fecha:** 2026-04-02  
**Módulo:** `ResidentialComplexModule`  
**Estado:** Aprobado

---

## Objetivo

Poblar automáticamente los campos `latitude` y `longitude` de un `ResidentialComplex` a partir de su dirección (`address`, `city`, `state`, `country`) usando la API pública de Nominatim (OpenStreetMap), sin costo ni API key.

---

## Contexto

- La entidad `ResidentialComplex` ya tiene campos `latitude`, `longitude`, `gpsRadius` (nullable).
- El query `nearbyComplexes(lat, lng, radiusMeters)` ya está implementado — filtra complejos con `latitude IS NOT NULL AND longitude IS NOT NULL`.
- `CreateComplexInput` y `UpdateComplexInput` ya aceptan `latitude`/`longitude` opcionales (entrada manual).
- La función `calculateHaversineDistance` ya existe en `gps.utils.ts`.

---

## Arquitectura

### Nuevo servicio: `GeocodingService`

**Archivo:** `src/modules/residential-complex/services/geocoding.service.ts`

Responsabilidad única: traducir una dirección textual a coordenadas GPS vía Nominatim.

```
geocodeAddress(address, city, state, country): Promise<{ lat: number; lng: number }>
```

**Comportamiento:**
- Construye query: `"address, city, state, country"`
- Llama a: `https://nominatim.openstreetmap.org/search?q=<query>&format=json&limit=1&countrycodes=co`
- Header obligatorio: `User-Agent: Residash/1.0` (requerido por ToS de Nominatim)
- Timeout: 5 segundos
- Si el array de respuesta está vacío → lanza `CustomError` con `GEOCODING_ADDRESS_NOT_FOUND` (HTTP 422)
- Si Nominatim no responde en 5s → lanza `CustomError` con `GEOCODING_SERVICE_UNAVAILABLE` (HTTP 503)
- Retorna `{ lat: parseFloat(result.lat), lng: parseFloat(result.lon) }`

### Nuevos error codes

En `src/modules/shared/constans/error-codes.constants.ts`:

```ts
GEOCODING_ADDRESS_NOT_FOUND = 'GEOCODING_ADDRESS_NOT_FOUND'
GEOCODING_SERVICE_UNAVAILABLE = 'GEOCODING_SERVICE_UNAVAILABLE'
```

### Módulo: `ResidentialComplexModule`

Agregar `HttpModule.register({ timeout: 5000, headers: { 'User-Agent': 'Residash/1.0' } })` a `imports`.  
Agregar `GeocodingService` a `providers` (no exportar — uso interno únicamente).

---

## Integración en `ResidentialComplexService`

### `create(input, currentUser)`

Antes del `this.complexRepo.save(complex)`:

```
si input.latitude == null Y input.longitude == null:
  coords = await geocodingService.geocodeAddress(
    input.address, input.city, input.state, input.country ?? 'Colombia'
  )
  complex.latitude  = coords.lat
  complex.longitude = coords.lng
```

Si el admin provee `latitude` y `longitude` → se respetan sin geocodificar.

### `update(input, currentUser)`

Tras `Object.assign(complex, restInput)` y antes del `save()`:

```
si input.latitude == null Y input.longitude == null:
  Y (input.address != null O input.city != null O input.state != null):
    coords = await geocodingService.geocodeAddress(
      complex.address, complex.city, complex.state, complex.country
    )
    complex.latitude  = coords.lat
    complex.longitude = coords.lng
```

Condición: solo re-geocodifica si el admin cambió algún campo de dirección Y no envió coords manuales.  
Si solo cambia nombre, teléfono u otro campo no relacionado con la dirección → no re-geocodifica.

---

## Reglas de negocio

| Escenario | Comportamiento |
|---|---|
| Create sin lat/lng | Geocodificar → error si no encuentra |
| Create con lat/lng | Usar coords manuales, omitir geocoding |
| Update cambia dirección, sin lat/lng | Re-geocodificar → error si no encuentra |
| Update cambia dirección, con lat/lng | Usar coords manuales, omitir geocoding |
| Update sin cambios de dirección | No re-geocodificar |
| Nominatim no responde (timeout) | Error 503 GEOCODING_SERVICE_UNAVAILABLE |
| Nominatim responde vacío | Error 422 GEOCODING_ADDRESS_NOT_FOUND |

---

## Archivos a crear/modificar

| Acción | Archivo |
|---|---|
| CREAR | `src/modules/residential-complex/services/geocoding.service.ts` |
| MODIFICAR | `src/modules/residential-complex/residential-complex.module.ts` |
| MODIFICAR | `src/modules/residential-complex/services/residential-complex.service.ts` |
| MODIFICAR | `src/modules/shared/constans/error-codes.constants.ts` |

---

## Dependencias

- `@nestjs/axios` — ya disponible en NestJS 11 (verificar si está instalado, si no: `npm i @nestjs/axios axios`)
- Sin variables de entorno nuevas
- Sin API key
