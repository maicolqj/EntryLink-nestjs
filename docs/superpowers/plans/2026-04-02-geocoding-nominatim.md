# Geocodificación automática con Nominatim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poblar automáticamente `latitude` y `longitude` de `ResidentialComplex` llamando a la API pública de Nominatim al crear o actualizar un complejo, respetando coords manuales si el admin las provee.

**Architecture:** Un nuevo `GeocodingService` encapsula la llamada HTTP a Nominatim y lanza errores controlados si la dirección no se encuentra o el servicio no responde. `ResidentialComplexService` lo inyecta y lo invoca en `create()` y `update()` antes del `save()`.

**Tech Stack:** `@nestjs/axios`, `rxjs/firstValueFrom`, Jest (unit tests con mocks de HttpService)

---

## File Map

| Acción | Archivo |
|--------|---------|
| INSTALAR | `@nestjs/axios axios` |
| MODIFICAR | `src/modules/shared/constans/error-codes.constants.ts` |
| CREAR | `src/modules/residential-complex/services/geocoding.service.ts` |
| CREAR | `src/modules/residential-complex/services/geocoding.service.spec.ts` |
| MODIFICAR | `src/modules/residential-complex/residential-complex.module.ts` |
| MODIFICAR | `src/modules/residential-complex/services/residential-complex.service.ts` |

---

## Task 1: Instalar dependencias

**Files:**
- No files modified — solo instalación de paquetes

- [ ] **Step 1: Instalar `@nestjs/axios` y `axios`**

```bash
npm i @nestjs/axios axios
```

Expected output: `added X packages` sin errores.

- [ ] **Step 2: Verificar que compila**

```bash
npm run build
```

Expected: sin errores de compilación.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @nestjs/axios for geocoding"
```

---

## Task 2: Agregar error codes de geocodificación

**Files:**
- Modify: `src/modules/shared/constans/error-codes.constants.ts`

- [ ] **Step 1: Agregar dos nuevos valores al enum `ComplexErrorCode`**

Abrir `src/modules/shared/constans/error-codes.constants.ts` y añadir al final del enum `ComplexErrorCode` (después de `PLAN_LIMIT_EXCEEDED`):

```ts
export enum ComplexErrorCode {
  COMPLEX_NOT_FOUND            = 'COMPLEX_NOT_FOUND',
  COMPLEX_ALREADY_EXISTS       = 'COMPLEX_ALREADY_EXISTS',
  COMPLEX_SUBSCRIPTION_EXPIRED = 'COMPLEX_SUBSCRIPTION_EXPIRED',
  BUILDING_NOT_FOUND           = 'BUILDING_NOT_FOUND',
  BUILDING_ALREADY_EXISTS      = 'BUILDING_ALREADY_EXISTS',
  BUILDING_HAS_ACTIVE_UNITS    = 'BUILDING_HAS_ACTIVE_UNITS',
  UNIT_NOT_FOUND               = 'UNIT_NOT_FOUND',
  UNIT_ALREADY_EXISTS          = 'UNIT_ALREADY_EXISTS',
  UNIT_IS_OCCUPIED             = 'UNIT_IS_OCCUPIED',
  INVALID_UNIT_FORMAT          = 'INVALID_UNIT_FORMAT',
  MAX_RESIDENTS_REACHED        = 'MAX_RESIDENTS_REACHED',
  PLAN_LIMIT_EXCEEDED          = 'PLAN_LIMIT_EXCEEDED',
  GEOCODING_ADDRESS_NOT_FOUND  = 'GEOCODING_ADDRESS_NOT_FOUND',
  GEOCODING_SERVICE_UNAVAILABLE = 'GEOCODING_SERVICE_UNAVAILABLE',
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/shared/constans/error-codes.constants.ts
git commit -m "feat: add geocoding error codes to ComplexErrorCode"
```

---

## Task 3: Crear `GeocodingService` con tests

**Files:**
- Create: `src/modules/residential-complex/services/geocoding.service.ts`
- Create: `src/modules/residential-complex/services/geocoding.service.spec.ts`

- [ ] **Step 1: Escribir el test fallido**

Crear `src/modules/residential-complex/services/geocoding.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { GeocodingService } from './geocoding.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';

const mockHttpService = () => ({
  get: jest.fn(),
});

describe('GeocodingService.geocodeAddress', () => {
  let service: GeocodingService;
  let httpService: ReturnType<typeof mockHttpService>;

  beforeEach(async () => {
    httpService = mockHttpService();

    const module = await Test.createTestingModule({
      providers: [
        GeocodingService,
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get(GeocodingService);
  });

  it('retorna lat/lng cuando Nominatim encuentra la dirección', async () => {
    httpService.get.mockReturnValue(
      of({ data: [{ lat: '4.711', lon: '-74.072' }] }),
    );

    const result = await service.geocodeAddress(
      'Calle 100 # 15-20', 'Bogotá', 'Cundinamarca', 'Colombia',
    );

    expect(result).toEqual({ lat: 4.711, lng: -74.072 });
  });

  it('lanza GEOCODING_ADDRESS_NOT_FOUND cuando Nominatim retorna array vacío', async () => {
    httpService.get.mockReturnValue(of({ data: [] }));

    const err = await service
      .geocodeAddress('Dirección Inexistente', 'Ciudad', 'Depto', 'Colombia')
      .catch(e => e);

    expect(err).toBeInstanceOf(CustomError);
    expect((err as CustomError).errorCode).toBe(ComplexErrorCode.GEOCODING_ADDRESS_NOT_FOUND);
    expect((err as CustomError).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('lanza GEOCODING_SERVICE_UNAVAILABLE cuando Nominatim falla con error de red', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('timeout')));

    const err = await service
      .geocodeAddress('Calle 1', 'Bogotá', 'Cundinamarca', 'Colombia')
      .catch(e => e);

    expect(err).toBeInstanceOf(CustomError);
    expect((err as CustomError).errorCode).toBe(ComplexErrorCode.GEOCODING_SERVICE_UNAVAILABLE);
    expect((err as CustomError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
```

- [ ] **Step 2: Ejecutar el test para confirmar que falla**

```bash
npx jest geocoding.service.spec --no-coverage
```

Expected: FAIL — `Cannot find module './geocoding.service'`

- [ ] **Step 3: Implementar `GeocodingService`**

Crear `src/modules/residential-complex/services/geocoding.service.ts`:

```ts
import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';

interface NominatimResult {
  lat: string;
  lon: string;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

  constructor(private readonly httpService: HttpService) {}

  async geocodeAddress(
    address: string,
    city: string,
    state: string,
    country: string,
  ): Promise<{ lat: number; lng: number }> {
    const query = `${address}, ${city}, ${state}, ${country}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<NominatimResult[]>(this.NOMINATIM_URL, {
          params: {
            q: query,
            format: 'json',
            limit: 1,
            countrycodes: 'co',
          },
          headers: { 'User-Agent': 'entrylink/1.0' },
        }),
      );

      const results = response.data;

      if (!results || results.length === 0) {
        throw new CustomError({
          message: `No se encontraron coordenadas para la dirección: "${query}". Verifica la dirección o ingresa las coordenadas manualmente.`,
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          errorCode: ComplexErrorCode.GEOCODING_ADDRESS_NOT_FOUND,
        });
      }

      const { lat, lon } = results[0];
      this.logger.log(`Geocodificado "${query}" → (${lat}, ${lon})`);
      return { lat: parseFloat(lat), lng: parseFloat(lon) };

    } catch (err) {
      if (err instanceof CustomError) throw err;

      this.logger.error(`Nominatim no disponible para "${query}": ${err.message}`);
      throw new CustomError({
        message: 'El servicio de geocodificación no está disponible en este momento. Intenta de nuevo o ingresa las coordenadas manualmente.',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: ComplexErrorCode.GEOCODING_SERVICE_UNAVAILABLE,
      });
    }
  }
}
```

- [ ] **Step 4: Ejecutar los tests para confirmar que pasan**

```bash
npx jest geocoding.service.spec --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/residential-complex/services/geocoding.service.ts \
        src/modules/residential-complex/services/geocoding.service.spec.ts
git commit -m "feat: implement GeocodingService with Nominatim"
```

---

## Task 4: Registrar `HttpModule` y `GeocodingService` en el módulo

**Files:**
- Modify: `src/modules/residential-complex/residential-complex.module.ts`

- [ ] **Step 1: Actualizar el módulo**

Reemplazar el contenido de `src/modules/residential-complex/residential-complex.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { ResidentialComplex }           from './entities/residential-complex.entity';
import { Building }                     from './entities/building.entity';
import { Unit }                         from './entities/unit.entity';

import { ResidentialComplexService }    from './services/residential-complex.service';
import { BuildingService }              from './services/building.service';
import { UnitService }                  from './services/unit.service';
import { GeocodingService }             from './services/geocoding.service';

import { ResidentialComplexResolver }   from './resolvers/residential-complex.resolver';
import { BuildingResolver }             from './resolvers/building.resolver';
import { UnitResolver }                 from './resolvers/unit.resolver';
import { User }        from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResidentialComplex, Building, Unit, User]),
    AuditModule,
    HttpModule.register({
      timeout: 5000,
      headers: { 'User-Agent': 'entrylink/1.0' },
    }),
  ],
  providers: [
    ResidentialComplexService,
    BuildingService,
    UnitService,
    GeocodingService,
    ResidentialComplexResolver,
    BuildingResolver,
    UnitResolver,
  ],
  exports: [
    ResidentialComplexService,
    BuildingService,
    UnitService,
  ],
})
export class ResidentialComplexModule {}
```

- [ ] **Step 2: Verificar que compila**

```bash
npm run build
```

Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/modules/residential-complex/residential-complex.module.ts
git commit -m "feat: register HttpModule and GeocodingService in ResidentialComplexModule"
```

---

## Task 5: Integrar geocoding en `create()`

**Files:**
- Modify: `src/modules/residential-complex/services/residential-complex.service.ts`

- [ ] **Step 1: Inyectar `GeocodingService` en el constructor**

En `residential-complex.service.ts`, agregar la importación y el parámetro al constructor:

```ts
// Añadir import
import { GeocodingService } from './geocoding.service';

// Constructor actualizado
constructor(
  @InjectRepository(ResidentialComplex)
  private readonly complexRepo: Repository<ResidentialComplex>,

  @InjectRepository(User)
  private readonly userRepo: Repository<User>,

  private readonly dataSource: DataSource,
  private readonly auditService: AuditService,
  private readonly geocodingService: GeocodingService,
) {}
```

- [ ] **Step 2: Agregar lógica de geocoding en `create()`**

Dentro del método `create()`, justo antes de `const saved = await this.complexRepo.save(complex);`, insertar:

```ts
// Geocodificar si el admin no proveyó coordenadas manualmente
if (input.latitude == null || input.longitude == null) {
  const coords = await this.geocodingService.geocodeAddress(
    complex.address,
    complex.city,
    complex.state,
    complex.country ?? 'Colombia',
  );
  complex.latitude  = coords.lat;
  complex.longitude = coords.lng;
}
```

El método `create()` completo queda así (sección relevante):

```ts
const complex = this.complexRepo.create({
  ...restInput,
  plan,
  maxUnits,
  status: ComplexStatus.PENDING_SETUP,
  ownerId: currentUser.sub,
  ...(hashedPassword && { password: hashedPassword, passwordSet: true }),
});

// Geocodificar si el admin no proveyó coordenadas manualmente
if (input.latitude == null || input.longitude == null) {
  const coords = await this.geocodingService.geocodeAddress(
    complex.address,
    complex.city,
    complex.state,
    complex.country ?? 'Colombia',
  );
  complex.latitude  = coords.lat;
  complex.longitude = coords.lng;
}

const saved = await this.complexRepo.save(complex);
```

- [ ] **Step 3: Verificar que compila**

```bash
npm run build
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/modules/residential-complex/services/residential-complex.service.ts
git commit -m "feat: auto-geocode on complex create using Nominatim"
```

---

## Task 6: Integrar geocoding en `update()`

**Files:**
- Modify: `src/modules/residential-complex/services/residential-complex.service.ts`

- [ ] **Step 1: Agregar lógica de geocoding en `update()`**

Dentro del método `update()`, justo antes de `const saved = await this.complexRepo.save(complex);`, insertar:

```ts
// Re-geocodificar si cambió algún campo de dirección y el admin no proveyó coords manuales
const addressChanged = input.address != null || input.city != null || input.state != null;
if (addressChanged && input.latitude == null && input.longitude == null) {
  const coords = await this.geocodingService.geocodeAddress(
    complex.address,
    complex.city,
    complex.state,
    complex.country ?? 'Colombia',
  );
  complex.latitude  = coords.lat;
  complex.longitude = coords.lng;
}
```

El método `update()` completo queda así (sección relevante):

```ts
Object.assign(complex, restInput);

// Re-geocodificar si cambió algún campo de dirección y el admin no proveyó coords manuales
const addressChanged = input.address != null || input.city != null || input.state != null;
if (addressChanged && input.latitude == null && input.longitude == null) {
  const coords = await this.geocodingService.geocodeAddress(
    complex.address,
    complex.city,
    complex.state,
    complex.country ?? 'Colombia',
  );
  complex.latitude  = coords.lat;
  complex.longitude = coords.lng;
}

const saved = await this.complexRepo.save(complex);
```

- [ ] **Step 2: Verificar que compila**

```bash
npm run build
```

Expected: sin errores.

- [ ] **Step 3: Ejecutar todos los tests del proyecto**

```bash
npx jest --no-coverage
```

Expected: todos los tests existentes siguen pasando.

- [ ] **Step 4: Commit**

```bash
git add src/modules/residential-complex/services/residential-complex.service.ts
git commit -m "feat: auto-geocode on complex update when address changes"
```

---

## Verificación final manual (opcional)

Con el servidor corriendo (`npm run start:dev`), ejecutar la mutation `createComplex` en GraphQL Playground sin proveer `latitude`/`longitude`. Verificar que:
1. Si la dirección existe → el complejo se crea con `latitude` y `longitude` poblados
2. Si la dirección no existe → respuesta de error con `GEOCODING_ADDRESS_NOT_FOUND`
3. Ejecutar `nearbyComplexes(lat, lng, radiusMeters)` con coordenadas cercanas → el complejo recién creado aparece en los resultados
