# Supervisor Self-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el supervisor se auto-registre en la plataforma y solicite acceso a complejos residenciales mediante validación GPS y notificaciones push bidireccionales.

**Architecture:** Se extrae la lógica GPS a un utilitario compartido, se agrega GPS a la solicitud de acceso, se wiran notificaciones push al flujo de aprobación/rechazo, y se agrega un mutation público `registerSupervisor` en `AuthService`/`AuthResolver`.

**Tech Stack:** NestJS 11, GraphQL Code-First, TypeORM, PostgreSQL, BullMQ, FCM/Web Push, Jest (sin archivos `.spec.ts` preexistentes)

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/shared/utils/gps.utils.ts` | Crear | Lógica Haversine y validación GPS compartida |
| `src/modules/supervisor-visits/services/supervisor-visit.service.ts` | Modificar | Usar utilidad GPS compartida |
| `src/modules/supervisor-visits/entities/supervisor-access-request.entity.ts` | Modificar | Columnas `requestLat`, `requestLng` |
| `src/modules/supervisor-visits/dto/inputs/request-complex-access.input.ts` | Modificar | Agregar `lat`, `lng` |
| `src/modules/supervisor-visits/services/supervisor-access-request.service.ts` | Modificar | GPS validation + notify admin/supervisor |
| `src/modules/supervisor-visits/resolvers/supervisor-visit.resolver.ts` | Modificar | Nueva query `pendingAccessRequestsCount` |
| `src/modules/supervisor-visits/supervisor-visits.module.ts` | Modificar | Importar `NotificationsModule` |
| `src/modules/auth/dto/inputs/register-supervisor.input.ts` | Crear | DTO de auto-registro del supervisor |
| `src/modules/auth/dto/inputs/login-email.input.ts` | Modificar | Agregar `SUPERVISOR_ROL` a `EMAIL_PASSWORD_USER_ROLES` |
| `src/modules/auth/services/auth.service.ts` | Modificar | Nuevo método `registerSupervisor()` |
| `src/modules/auth/auth.module.ts` | Modificar | Agregar `UserRole`, `DataSource` |
| `src/modules/auth/auth.resolver.ts` | Modificar | Nuevo mutation `registerSupervisor` |
| `src/modules/users/dto/inputs/create-staff-member.input.ts` | Modificar | Remover `SUPERVISOR_ROL` de `STAFF_ROLES` |
| `src/shared/constans/error-codes.constants.ts` | Modificar | Agregar `SUPERVISOR_ALREADY_REGISTERED` |
| Migración TypeORM | Generar | Columnas `request_lat`, `request_lng` |

---

## Task 1: Extraer utilidades GPS a módulo compartido

**Files:**
- Create: `src/shared/utils/gps.utils.ts`
- Modify: `src/modules/supervisor-visits/services/supervisor-visit.service.ts`
- Create: `src/shared/utils/gps.utils.spec.ts`

- [ ] **Step 1.1: Escribir los tests (failing)**

Crear `src/shared/utils/gps.utils.spec.ts`:

```typescript
import { assertGpsWithinComplex, calculateHaversineDistance } from './gps.utils';
import { CustomError } from '../utils/errors.utils';

describe('calculateHaversineDistance', () => {
  it('retorna 0 cuando los puntos son idénticos', () => {
    expect(calculateHaversineDistance(4.711, -74.072, 4.711, -74.072)).toBe(0);
  });

  it('calcula distancia aproximada entre dos puntos conocidos', () => {
    // ~111 km por grado de latitud
    const dist = calculateHaversineDistance(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });
});

describe('assertGpsWithinComplex', () => {
  const complex = { id: 'c1', latitude: 4.711, longitude: -74.072, gpsRadius: 200 };

  it('no lanza error cuando el supervisor está dentro del radio', () => {
    expect(() => assertGpsWithinComplex(complex, 4.711, -74.072)).not.toThrow();
  });

  it('lanza CustomError cuando el supervisor está fuera del radio', () => {
    // ~1.1 km al norte
    expect(() => assertGpsWithinComplex(complex, 4.721, -74.072)).toThrow(CustomError);
  });

  it('no lanza error cuando el complejo no tiene coordenadas', () => {
    const noGps = { id: 'c2', latitude: null, longitude: null, gpsRadius: 200 };
    expect(() => assertGpsWithinComplex(noGps as any, 0, 0)).not.toThrow();
  });
});
```

- [ ] **Step 1.2: Correr tests — verificar que fallan**

```bash
cd C:\Users\maico\Apps\BACKEND\phone-dialer-nestjs
npx jest gps.utils.spec --no-coverage
```

Resultado esperado: `FAIL — Cannot find module './gps.utils'`

- [ ] **Step 1.3: Crear `src/shared/utils/gps.utils.ts`**

```typescript
import { HttpStatus } from '@nestjs/common';
import { CustomError } from './errors.utils';
import { SupervisorErrorCode } from '../constans/error-codes.constants';

export interface GpsComplexReference {
  id: string;
  latitude: number | null;
  longitude: number | null;
  gpsRadius: number | null;
}

/**
 * Fórmula de Haversine — distancia en metros entre dos puntos GPS.
 */
export function calculateHaversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Valida que (lat, lng) estén dentro del radio GPS del complejo.
 * Si el complejo no tiene coordenadas configuradas, la validación se omite.
 */
export function assertGpsWithinComplex(
  complex: GpsComplexReference,
  lat: number,
  lng: number,
): void {
  if (complex.latitude == null || complex.longitude == null) return;

  const radius = complex.gpsRadius ?? 200;
  const distance = calculateHaversineDistance(
    Number(complex.latitude),
    Number(complex.longitude),
    lat,
    lng,
  );

  if (distance > radius) {
    throw new CustomError({
      message: `Estás demasiado lejos del complejo (${Math.round(distance)} m). Debes estar dentro de un radio de ${radius} m`,
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: SupervisorErrorCode.SUPERVISOR_OUT_OF_RANGE,
    });
  }
}
```

- [ ] **Step 1.4: Correr tests — verificar que pasan**

```bash
npx jest gps.utils.spec --no-coverage
```

Resultado esperado: `PASS — 5 tests`

- [ ] **Step 1.5: Actualizar `SupervisorVisitService` para usar la utilidad compartida**

En `src/modules/supervisor-visits/services/supervisor-visit.service.ts`:

Agregar import al inicio del archivo (después de los imports existentes):
```typescript
import { assertGpsWithinComplex, calculateHaversineDistance } from '../../../shared/utils/gps.utils';
```

Reemplazar el método privado `assertGpsWithinComplex` y `calculateHaversineDistance` del servicio por llamadas a los importados:

```typescript
// ================================================================
// GPS HELPERS — delegados a shared/utils/gps.utils.ts
// ================================================================

private validateGps(
  complex: Pick<ResidentialComplex, 'id' | 'latitude' | 'longitude' | 'gpsRadius'>,
  lat: number,
  lng: number,
): void {
  assertGpsWithinComplex(complex, lat, lng);
}
```

Y en los lugares donde se llama `this.assertGpsWithinComplex(complex, lat, lng)`, cambiar a `this.validateGps(complex, lat, lng)`.

También eliminar los dos métodos privados `assertGpsWithinComplex` y `calculateHaversineDistance` del servicio (líneas ~268-311).

- [ ] **Step 1.6: Verificar que el servidor compila sin errores**

```bash
npx tsc --noEmit
```

Resultado esperado: sin errores de tipos.

- [ ] **Step 1.7: Commit**

```bash
git add src/shared/utils/gps.utils.ts src/shared/utils/gps.utils.spec.ts src/modules/supervisor-visits/services/supervisor-visit.service.ts
git commit -m "refactor: extract GPS Haversine utils to shared/utils/gps.utils.ts"
```

---

## Task 2: Agregar columnas GPS a `SupervisorAccessRequest` + migración

**Files:**
- Modify: `src/modules/supervisor-visits/entities/supervisor-access-request.entity.ts`
- Generate: migración TypeORM

- [ ] **Step 2.1: Agregar columnas a la entidad**

En `src/modules/supervisor-visits/entities/supervisor-access-request.entity.ts`, agregar después del bloque `// ==================== ESTADO ====================` (después del campo `rejectionReason`):

```typescript
// ==================== UBICACIÓN GPS DE LA SOLICITUD ====================

@Field(() => Float, { nullable: true, description: 'Latitud GPS del supervisor al solicitar acceso' })
@Column({ name: 'request_lat', type: 'decimal', precision: 10, scale: 8, nullable: true })
requestLat?: number;

@Field(() => Float, { nullable: true, description: 'Longitud GPS del supervisor al solicitar acceso' })
@Column({ name: 'request_lng', type: 'decimal', precision: 11, scale: 8, nullable: true })
requestLng?: number;
```

Agregar `Float` al import de `@nestjs/graphql` si no existe:
```typescript
import { ObjectType, Field, Float } from '@nestjs/graphql';
```

- [ ] **Step 2.2: Generar la migración**

```bash
npx typeorm-ts-node-commonjs migration:generate src/core/database/migrations/AddGpsToSupervisorAccessRequest -d src/core/database/data-source.ts
```

Verificar que el archivo generado contiene `ALTER TABLE "supervisor_access_requests" ADD "request_lat"` y `ADD "request_lng"`.

- [ ] **Step 2.3: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 2.4: Commit**

```bash
git add src/modules/supervisor-visits/entities/supervisor-access-request.entity.ts
git add src/core/database/migrations/
git commit -m "feat: add requestLat/requestLng columns to supervisor_access_requests"
```

---

## Task 3: Actualizar `RequestComplexAccessInput` (agregar lat/lng)

**Files:**
- Modify: `src/modules/supervisor-visits/dto/inputs/request-complex-access.input.ts`

- [ ] **Step 3.1: Agregar campos `lat` y `lng`**

Reemplazar el contenido completo del archivo:

```typescript
import { InputType, Field, Float } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString, MaxLength, IsNumber, Min, Max } from 'class-validator';

@InputType()
export class RequestComplexAccessInput {

  @Field(() => String, { description: 'ID del complejo al que el supervisor solicita acceso' })
  @IsUUID()
  complexId: string;

  @Field(() => Float, { description: 'Latitud GPS actual del supervisor (-90 a 90)' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Field(() => Float, { description: 'Longitud GPS actual del supervisor (-180 a 180)' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @Field(() => String, { nullable: true, description: 'Mensaje opcional para el administrador del complejo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
```

- [ ] **Step 3.2: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 3.3: Commit**

```bash
git add src/modules/supervisor-visits/dto/inputs/request-complex-access.input.ts
git commit -m "feat: add lat/lng to RequestComplexAccessInput for GPS validation"
```

---

## Task 4: Importar `NotificationsModule` en `SupervisorVisitsModule`

**Files:**
- Modify: `src/modules/supervisor-visits/supervisor-visits.module.ts`

- [ ] **Step 4.1: Agregar `NotificationsModule` al módulo**

Reemplazar el contenido de `supervisor-visits.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SupervisorVisit } from './entities/supervisor-visit.entity';
import { SupervisorAccessRequest } from './entities/supervisor-access-request.entity';
import { SupervisorVisitService } from './services/supervisor-visit.service';
import { SupervisorAccessRequestService } from './services/supervisor-access-request.service';
import { SupervisorVisitResolver } from './resolvers/supervisor-visit.resolver';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { UserComplexAssignment } from '../users/entities/user-complex-assignment.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupervisorVisit,
      SupervisorAccessRequest,
      ResidentialComplex,
      UserComplexAssignment,
      User,
    ]),
    NotificationsModule,
  ],
  providers: [
    SupervisorVisitService,
    SupervisorAccessRequestService,
    SupervisorVisitResolver,
  ],
  exports: [SupervisorVisitService, SupervisorAccessRequestService],
})
export class SupervisorVisitsModule {}
```

- [ ] **Step 4.2: Verificar que la app compila**

```bash
npx tsc --noEmit
```

- [ ] **Step 4.3: Commit**

```bash
git add src/modules/supervisor-visits/supervisor-visits.module.ts
git commit -m "feat: import NotificationsModule in SupervisorVisitsModule"
```

---

## Task 5: Actualizar `requestAccess` — GPS validation + notificar admin

**Files:**
- Modify: `src/modules/supervisor-visits/services/supervisor-access-request.service.ts`
- Create: `src/modules/supervisor-visits/services/supervisor-access-request.service.spec.ts`

- [ ] **Step 5.1: Escribir tests (failing)**

Crear `src/modules/supervisor-visits/services/supervisor-access-request.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { SupervisorAccessRequestService } from './supervisor-access-request.service';
import { SupervisorAccessRequest } from '../entities/supervisor-access-request.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { UserComplexAssignment, AssignmentStatus } from '../../users/entities/user-complex-assignment.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AccessRequestStatus } from '../enums/access-request-status.enum';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

describe('SupervisorAccessRequestService.requestAccess', () => {
  let service: SupervisorAccessRequestService;
  let requestRepo: ReturnType<typeof mockRepo>;
  let complexRepo: ReturnType<typeof mockRepo>;
  let assignmentRepo: ReturnType<typeof mockRepo>;
  let userRepo: ReturnType<typeof mockRepo>;
  let notificationsService: { notify: jest.Mock };

  const supervisor = { sub: 'sup-1', email: 'sup@test.com', roles: [ValidRoles.SUPERVISOR_ROL] } as any;

  beforeEach(async () => {
    requestRepo = mockRepo();
    complexRepo = mockRepo();
    assignmentRepo = mockRepo();
    userRepo = mockRepo();
    notificationsService = { notify: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        SupervisorAccessRequestService,
        { provide: getRepositoryToken(SupervisorAccessRequest), useValue: requestRepo },
        { provide: getRepositoryToken(ResidentialComplex),       useValue: complexRepo },
        { provide: getRepositoryToken(UserComplexAssignment),    useValue: assignmentRepo },
        { provide: getRepositoryToken(User),                     useValue: userRepo },
        { provide: NotificationsService,                         useValue: notificationsService },
      ],
    }).compile();

    service = module.get(SupervisorAccessRequestService);
  });

  it('lanza ALREADY_ASSIGNED cuando el supervisor ya tiene asignación activa', async () => {
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: null, longitude: null, gpsRadius: null });
    assignmentRepo.findOne.mockResolvedValue({ id: 'a1', status: AssignmentStatus.ACTIVE });
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    await expect(service.requestAccess({ complexId: 'c1', lat: 4.7, lng: -74.0 }, supervisor))
      .rejects.toBeInstanceOf(CustomError);
  });

  it('lanza REQUEST_ALREADY_PENDING cuando ya hay solicitud pendiente', async () => {
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: null, longitude: null, gpsRadius: null });
    assignmentRepo.findOne.mockResolvedValue(null);
    requestRepo.findOne.mockResolvedValue({ id: 'r1', status: AccessRequestStatus.PENDING });
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    await expect(service.requestAccess({ complexId: 'c1', lat: 4.7, lng: -74.0 }, supervisor))
      .rejects.toBeInstanceOf(CustomError);
  });

  it('lanza SUPERVISOR_OUT_OF_RANGE cuando el GPS está fuera del radio', async () => {
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: 4.711, longitude: -74.072, gpsRadius: 200 });
    assignmentRepo.findOne.mockResolvedValue(null);
    requestRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    // 4.721 está ~1.1 km al norte → fuera de 200 m
    await expect(service.requestAccess({ complexId: 'c1', lat: 4.721, lng: -74.072 }, supervisor))
      .rejects.toBeInstanceOf(CustomError);
  });

  it('crea la solicitud y notifica al admin cuando todo es válido', async () => {
    const savedRequest = { id: 'req-1', supervisorId: 'sup-1', complexId: 'c1', status: AccessRequestStatus.PENDING };
    complexRepo.findOne.mockResolvedValue({ id: 'c1', name: 'Complejo A', ownerId: 'admin-1', latitude: null, longitude: null, gpsRadius: null });
    assignmentRepo.findOne.mockResolvedValue(null);
    requestRepo.findOne
      .mockResolvedValueOnce(null)   // no pending
      .mockResolvedValueOnce({ ...savedRequest, supervisor: {}, complex: {}, resolvedBy: null }); // loadRelations
    requestRepo.create.mockReturnValue(savedRequest);
    requestRepo.save.mockResolvedValue(savedRequest);
    userRepo.findOne.mockResolvedValue({ id: 'sup-1', name: 'JUAN', lastName: 'PEREZ' });

    await service.requestAccess({ complexId: 'c1', lat: 4.711, lng: -74.072 }, supervisor);

    expect(notificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['admin-1'], title: 'Nueva solicitud de acceso' }),
    );
  });
});
```

- [ ] **Step 5.2: Correr tests — verificar que fallan**

```bash
npx jest supervisor-access-request.service.spec --no-coverage
```

Resultado esperado: `FAIL — SupervisorAccessRequestService is not a constructor` (módulo no modificado aún)

- [ ] **Step 5.3: Actualizar `supervisor-access-request.service.ts`**

Reemplazar el contenido completo del archivo:

```typescript
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SupervisorAccessRequest } from '../entities/supervisor-access-request.entity';
import { AccessRequestStatus } from '../enums/access-request-status.enum';
import { RequestComplexAccessInput } from '../dto/inputs/request-complex-access.input';
import { RejectAccessRequestInput } from '../dto/inputs/resolve-access-request.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import { assertGpsWithinComplex } from '../../../shared/utils/gps.utils';
import { AccessRequestErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import {
  UserComplexAssignment,
  AssignmentStatus,
} from '../../users/entities/user-complex-assignment.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { User } from '../../users/entities/user.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';

@Injectable()
export class SupervisorAccessRequestService {
  private readonly logger = new Logger(SupervisorAccessRequestService.name);

  constructor(
    @InjectRepository(SupervisorAccessRequest)
    private readonly requestRepo: Repository<SupervisorAccessRequest>,

    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,

    @InjectRepository(UserComplexAssignment)
    private readonly assignmentRepo: Repository<UserComplexAssignment>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly notificationsService: NotificationsService,
  ) {}

  // ================================================================
  // SUPERVISOR: solicitar acceso a un complejo
  // ================================================================

  async requestAccess(
    input: RequestComplexAccessInput,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const { complexId, lat, lng, message } = input;
    const supervisorId = currentUser.sub;

    // 1. Verificar que el complejo existe
    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
      select: ['id', 'name', 'ownerId', 'latitude', 'longitude', 'gpsRadius'],
    });
    if (!complex) {
      throw new CustomError({
        message: `Complejo con ID "${complexId}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    // 2. Si ya tiene asignación ACTIVA → no necesita solicitar
    const existingAssignment = await this.assignmentRepo.findOne({
      where: {
        userId:    supervisorId,
        complexId,
        role:      ValidRoles.SUPERVISOR_ROL,
        status:    AssignmentStatus.ACTIVE,
      },
    });
    if (existingAssignment) {
      throw new CustomError({
        message: 'Ya tienes acceso activo a este complejo',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AccessRequestErrorCode.ALREADY_ASSIGNED,
      });
    }

    // 3. Si ya existe una solicitud PENDING → no crear duplicado
    const pendingRequest = await this.requestRepo.findOne({
      where: { supervisorId, complexId, status: AccessRequestStatus.PENDING },
    });
    if (pendingRequest) {
      throw new CustomError({
        message: 'Ya tienes una solicitud pendiente para este complejo. Espera a que el administrador la revise',
        statusCode: HttpStatus.CONFLICT,
        errorCode: AccessRequestErrorCode.REQUEST_ALREADY_PENDING,
      });
    }

    // 4. Validación GPS — reutiliza assertGpsWithinComplex del utilitario compartido
    assertGpsWithinComplex(complex, lat, lng);

    // 5. Crear la solicitud
    const request = this.requestRepo.create({
      supervisorId,
      complexId,
      message,
      requestLat: lat,
      requestLng: lng,
      status: AccessRequestStatus.PENDING,
    });

    const saved = await this.requestRepo.save(request);
    this.logger.log(
      `Solicitud de acceso creada: requestId=${saved.id} | supervisor=${supervisorId} | complejo=${complexId}`,
    );

    // 6. Cargar nombre del supervisor para la notificación
    const supervisor = await this.userRepo.findOne({
      where: { id: supervisorId },
      select: ['id', 'name', 'lastName'],
    });
    const supervisorName = supervisor
      ? `${supervisor.name} ${supervisor.lastName}`.trim()
      : currentUser.email;

    // 7. Notificar al admin del complejo
    void this.notificationsService.notify({
      complexId,
      userIds:    [complex.ownerId],
      type:       NotificationType.SYSTEM_ANNOUNCEMENT,
      priority:   NotificationPriority.HIGH,
      title:      'Nueva solicitud de acceso',
      body:       `${supervisorName} solicita acceso al complejo`,
      entityId:   saved.id,
      entityType: 'SupervisorAccessRequest',
      metadata:   {
        requestId:      saved.id,
        supervisorId,
        supervisorName,
        requestLat:     lat,
        requestLng:     lng,
      },
    });

    return this.loadRequestRelations(saved.id);
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: aprobar solicitud
  // ================================================================

  async approveRequest(
    requestId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const request = await this.findPendingRequestWithAccess(requestId, currentUser);

    const existingAssignment = await this.assignmentRepo.findOne({
      where: {
        userId:    request.supervisorId,
        complexId: request.complexId,
        role:      ValidRoles.SUPERVISOR_ROL,
        status:    AssignmentStatus.ACTIVE,
      },
    });

    if (!existingAssignment) {
      await this.assignmentRepo.save(
        this.assignmentRepo.create({
          userId:    request.supervisorId,
          complexId: request.complexId,
          role:      ValidRoles.SUPERVISOR_ROL,
          status:    AssignmentStatus.ACTIVE,
        }),
      );
    }

    await this.requestRepo.update(requestId, {
      status:       AccessRequestStatus.APPROVED,
      resolvedById: currentUser.sub,
      resolvedAt:   new Date(),
    });

    this.logger.log(
      `Solicitud aprobada: requestId=${requestId} | por=${currentUser.sub} | supervisor=${request.supervisorId} | complejo=${request.complexId}`,
    );

    // Cargar nombre del complejo para la notificación
    const complex = await this.complexRepo.findOne({
      where: { id: request.complexId },
      select: ['id', 'name'],
    });
    const complexName = complex?.name ?? 'el complejo';

    void this.notificationsService.notify({
      complexId:  request.complexId,
      userIds:    [request.supervisorId],
      type:       NotificationType.SYSTEM_ANNOUNCEMENT,
      priority:   NotificationPriority.HIGH,
      title:      'Acceso aprobado',
      body:       `Tu solicitud de acceso a ${complexName} fue aprobada. Ya puedes hacer check-in`,
      entityId:   requestId,
      entityType: 'SupervisorAccessRequest',
      metadata:   { requestId, complexId: request.complexId, status: 'APPROVED' },
    });

    return this.loadRequestRelations(requestId);
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: rechazar solicitud
  // ================================================================

  async rejectRequest(
    input: RejectAccessRequestInput,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const { requestId, reason } = input;
    const request = await this.findPendingRequestWithAccess(requestId, currentUser);

    await this.requestRepo.update(requestId, {
      status:          AccessRequestStatus.REJECTED,
      rejectionReason: reason,
      resolvedById:    currentUser.sub,
      resolvedAt:      new Date(),
    });

    this.logger.log(
      `Solicitud rechazada: requestId=${requestId} | por=${currentUser.sub} | complejo=${request.complexId}`,
    );

    const complex = await this.complexRepo.findOne({
      where: { id: request.complexId },
      select: ['id', 'name'],
    });
    const complexName = complex?.name ?? 'el complejo';

    void this.notificationsService.notify({
      complexId:  request.complexId,
      userIds:    [request.supervisorId],
      type:       NotificationType.SYSTEM,
      priority:   NotificationPriority.NORMAL,
      title:      'Solicitud rechazada',
      body:       `Tu solicitud de acceso a ${complexName} fue rechazada. Motivo: ${reason ?? 'Sin motivo'}`,
      entityId:   requestId,
      entityType: 'SupervisorAccessRequest',
      metadata:   { requestId, complexId: request.complexId, status: 'REJECTED', reason },
    });

    return this.loadRequestRelations(requestId);
  }

  // ================================================================
  // SUPERVISOR: ver mis solicitudes
  // ================================================================

  async findMyRequests(supervisorId: string): Promise<SupervisorAccessRequest[]> {
    return this.requestRepo.find({
      where: { supervisorId },
      relations: ['complex'],
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: ver solicitudes pendientes del complejo
  // ================================================================

  async findPendingForComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest[]> {
    await this.assertComplexAccess(complexId, currentUser);

    return this.requestRepo.find({
      where: { complexId, status: AccessRequestStatus.PENDING },
      relations: ['supervisor'],
      order: { createdAt: 'ASC' },
    });
  }

  // ================================================================
  // COMPLEX_ROL / SUPER_ADMIN: contador de solicitudes pendientes
  // ================================================================

  async countPendingRequests(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<number> {
    await this.assertComplexAccess(complexId, currentUser);
    return this.requestRepo.count({
      where: { complexId, status: AccessRequestStatus.PENDING },
    });
  }

  // ================================================================
  // HELPERS PRIVADOS
  // ================================================================

  private async findPendingRequestWithAccess(
    requestId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SupervisorAccessRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new CustomError({
        message: 'Solicitud de acceso no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AccessRequestErrorCode.REQUEST_NOT_FOUND,
      });
    }

    if (request.status !== AccessRequestStatus.PENDING) {
      throw new CustomError({
        message: `Esta solicitud ya fue ${request.status === AccessRequestStatus.APPROVED ? 'aprobada' : 'rechazada'}`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: AccessRequestErrorCode.REQUEST_ALREADY_RESOLVED,
      });
    }

    await this.assertComplexAccess(request.complexId, currentUser);
    return request;
  }

  private async assertComplexAccess(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    if (currentUser.roles?.includes(ValidRoles.SUPER_ADMIN_ROL)) return;

    if (currentUser.roles?.includes(ValidRoles.COMPLEX_ROL)) {
      const complex = await this.complexRepo.findOne({
        where: { id: complexId },
        select: ['id', 'ownerId'],
      });
      if (complex && (complex.id === currentUser.sub || complex.ownerId === currentUser.sub)) {
        return;
      }
    }

    throw new CustomError({
      message: 'No tienes permiso para gestionar solicitudes de este complejo',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: GeneralErrorCode.FORBIDDEN,
    });
  }

  private async loadRequestRelations(id: string): Promise<SupervisorAccessRequest> {
    return this.requestRepo.findOne({
      where: { id },
      relations: ['supervisor', 'complex', 'resolvedBy'],
    });
  }
}
```

- [ ] **Step 5.4: Correr tests — verificar que pasan**

```bash
npx jest supervisor-access-request.service.spec --no-coverage
```

Resultado esperado: `PASS — 4 tests`

- [ ] **Step 5.5: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 5.6: Commit**

```bash
git add src/modules/supervisor-visits/services/supervisor-access-request.service.ts
git add src/modules/supervisor-visits/services/supervisor-access-request.service.spec.ts
git commit -m "feat: add GPS validation and push notifications to requestComplexAccess flow"
```

---

## Task 6: Agregar query `pendingAccessRequestsCount` al resolver

**Files:**
- Modify: `src/modules/supervisor-visits/resolvers/supervisor-visit.resolver.ts`

- [ ] **Step 6.1: Agregar la query al resolver**

Al final del bloque `// ════ SOLICITUDES DE ACCESO — COMPLEX_ROL / SUPER_ADMIN ════`, agregar después del mutation `rejectAccessRequest`:

```typescript
@Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
@Query(() => Int, {
  name: 'pendingAccessRequestsCount',
  description:
    'Retorna el número de solicitudes de acceso PENDIENTES para un complejo. ' +
    'Úsalo para mostrar el badge numérico en la sección Supervisores del panel.',
})
countPendingAccessRequests(
  @Args('complexId', { type: () => String }) complexId: string,
  @CurrentUser() currentUser: JwtAccessPayload,
): Promise<number> {
  return this.accessRequestService.countPendingRequests(complexId, currentUser);
}
```

Agregar `Int` al import de `@nestjs/graphql`:
```typescript
import { Resolver, Mutation, Query, Args, Int } from '@nestjs/graphql';
```

- [ ] **Step 6.2: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 6.3: Commit**

```bash
git add src/modules/supervisor-visits/resolvers/supervisor-visit.resolver.ts
git commit -m "feat: add pendingAccessRequestsCount query for admin badge counter"
```

---

## Task 7: Agregar `SUPERVISOR_ROL` a `EMAIL_PASSWORD_USER_ROLES`

**Files:**
- Modify: `src/modules/auth/dto/inputs/login-email.input.ts`

Los supervisores auto-registrados usan contraseña (no systemCode), por lo que deben poder autenticarse con `loginWithEmail`.

- [ ] **Step 7.1: Actualizar `EMAIL_PASSWORD_USER_ROLES`**

En `src/modules/auth/dto/inputs/login-email.input.ts`, cambiar:

```typescript
export const EMAIL_PASSWORD_USER_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
  ValidRoles.ACCOUNTANT_ROL,
  ValidRoles.SUPERVISOR_ROL,    // ← agregar
] as const;
```

- [ ] **Step 7.2: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 7.3: Commit**

```bash
git add src/modules/auth/dto/inputs/login-email.input.ts
git commit -m "feat: allow SUPERVISOR_ROL to login with email and password"
```

---

## Task 8: Crear `RegisterSupervisorInput` DTO

**Files:**
- Create: `src/modules/auth/dto/inputs/register-supervisor.input.ts`

- [ ] **Step 8.1: Crear el DTO**

```typescript
import { InputType, Field } from '@nestjs/graphql';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

@InputType({ description: 'Datos para el auto-registro de un supervisor en la plataforma' })
export class RegisterSupervisorInput {

  @Field(() => String, { description: 'Nombre completo del supervisor' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  @MaxLength(100)
  fullName: string;

  @Field(() => String, { description: 'Correo electrónico' })
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty()
  email: string;

  @Field(() => String, { description: 'Contraseña (mínimo 8 caracteres)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'La contraseña debe contener al menos una mayúscula, una minúscula y un número',
  })
  password: string;

  @Field(() => String, { description: 'Número de teléfono celular colombiano (ej: 3001234567)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^3\d{9}$/, { message: 'Número de celular colombiano inválido (ej: 3001234567)' })
  phone: string;

  @Field(() => String, { description: 'Número de documento de identidad' })
  @IsString()
  @IsNotEmpty({ message: 'El número de documento es obligatorio' })
  @MaxLength(20)
  documentNumber: string;
}
```

- [ ] **Step 8.2: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 8.3: Commit**

```bash
git add src/modules/auth/dto/inputs/register-supervisor.input.ts
git commit -m "feat: add RegisterSupervisorInput DTO"
```

---

## Task 9: Implementar `registerSupervisor` en `AuthService` + actualizar `AuthModule`

**Files:**
- Modify: `src/modules/auth/auth.module.ts`
- Modify: `src/modules/auth/services/auth.service.ts`
- Create: `src/modules/auth/services/auth-register-supervisor.service.spec.ts`

- [ ] **Step 9.1: Actualizar `AuthModule` para inyectar `UserRole` y `DataSource`**

En `src/modules/auth/auth.module.ts`, agregar `UserRole` a las entidades:

```typescript
import { UserRole } from '../users/entities/user_has_roles.entity';
```

Y en `TypeOrmModule.forFeature([...])`, agregar `UserRole`:

```typescript
TypeOrmModule.forFeature([User, ResidentialComplex, OtpCode, RefreshToken, UserSession, Role, UserRole]),
```

- [ ] **Step 9.2: Escribir test del método `registerSupervisor` (failing)**

Crear `src/modules/auth/services/auth-register-supervisor.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { Role } from '../../roles/entities/role.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { OtpCode } from '../entities/otp-code.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { UserSession } from '../entities/user-session.entity';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { OtpService } from './otp.service';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { UserStatus } from '../../users/enums/user.enums';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';

const mockRepo = () => ({ findOne: jest.fn(), create: jest.fn(), save: jest.fn() });

describe('AuthService.registerSupervisor', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockRepo>;
  let userRoleRepo: ReturnType<typeof mockRepo>;
  let roleRepo: ReturnType<typeof mockRepo>;
  let dataSource: { transaction: jest.Mock };
  let tokenService: { generateTokenPair: jest.Mock };
  let sessionService: { enforceSessionLimit: jest.Mock; createOrUpdateSession: jest.Mock };

  const input = {
    fullName: 'Juan Perez',
    email: 'juan@test.com',
    password: 'Password1',
    phone: '3001234567',
    documentNumber: '12345678',
  };

  beforeEach(async () => {
    userRepo     = mockRepo();
    userRoleRepo = mockRepo();
    roleRepo     = mockRepo();
    tokenService = { generateTokenPair: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900, sessionId: 's1' }) };
    sessionService = { enforceSessionLimit: jest.fn(), createOrUpdateSession: jest.fn() };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb) =>
        cb({
          create: jest.fn((Entity, data) => ({ ...data, id: 'new-user-id' })),
          save:   jest.fn().mockResolvedValue({ id: 'new-user-id', email: input.email, userRoles: [] }),
        }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User),               useValue: userRepo },
        { provide: getRepositoryToken(UserRole),           useValue: userRoleRepo },
        { provide: getRepositoryToken(Role),               useValue: roleRepo },
        { provide: getRepositoryToken(ResidentialComplex), useValue: mockRepo() },
        { provide: getRepositoryToken(OtpCode),            useValue: mockRepo() },
        { provide: getRepositoryToken(RefreshToken),       useValue: mockRepo() },
        { provide: getRepositoryToken(UserSession),        useValue: mockRepo() },
        { provide: DataSource,                             useValue: dataSource },
        { provide: TokenService,                           useValue: tokenService },
        { provide: SessionService,                         useValue: sessionService },
        { provide: OtpService,                             useValue: {} },
        { provide: CacheService,                           useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('lanza EMAIL_ALREADY_IN_USE cuando el email ya está registrado', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(service.registerSupervisor(input, {} as any)).rejects.toBeInstanceOf(CustomError);
  });

  it('crea el usuario con SUPERVISOR_ROL y devuelve AuthResponse', async () => {
    userRepo.findOne.mockResolvedValue(null); // email libre
    roleRepo.findOne.mockResolvedValue({ id: 'role-id', name: ValidRoles.SUPERVISOR_ROL });

    const result = await service.registerSupervisor(input, {} as any);
    expect(result).toHaveProperty('accessToken');
    expect(dataSource.transaction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 9.3: Correr tests — verificar que fallan**

```bash
npx jest auth-register-supervisor.service.spec --no-coverage
```

Resultado esperado: `FAIL — service.registerSupervisor is not a function`

- [ ] **Step 9.4: Agregar `registerSupervisor` a `AuthService`**

En `src/modules/auth/services/auth.service.ts`, agregar los siguientes imports al bloque existente:

```typescript
// Agregar HttpStatus a los imports de @nestjs/common:
import { Injectable, UnauthorizedException, Logger, NotFoundException, BadRequestException, HttpStatus } from '@nestjs/common';

// Agregar DataSource a los imports de typeorm:
import { Repository, DataSource } from 'typeorm';

// Nuevos imports:
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { RegisterSupervisorInput } from '../dto/inputs/register-supervisor.input';
import { UserErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { CustomError } from '../../shared/utils/errors.utils';
```

Agregar en el constructor de `AuthService` (después de `private readonly cacheService: CacheService`):
```typescript
@InjectRepository(Role)
private readonly roleRepo: Repository<Role>,

private readonly dataSource: DataSource,
```

> Nota: `Role` ya está registrado en `TypeOrmModule.forFeature` del `AuthModule`, solo falta inyectarlo en el constructor. `UserRole` lo usa el `DataSource` directamente dentro de la transacción sin necesidad de inyección explícita.

Agregar el método antes del bloque `// Métodos privados`:

```typescript
// ═══════════════════════════════════════════════════════════════
// REGISTRO PÚBLICO: Supervisor se auto-registra en la plataforma
// ═══════════════════════════════════════════════════════════════

async registerSupervisor(
  input: RegisterSupervisorInput,
  deviceInfo: DeviceInfo,
): Promise<AuthResponse> {
  // 1. Verificar que el email no esté en uso
  const existing = await this.userRepo.findOne({
    where: { email: input.email.toLowerCase().trim() },
  });
  if (existing) {
    throw new CustomError({
      message: 'Este correo electrónico ya está registrado',
      statusCode: HttpStatus.CONFLICT,
      errorCode: UserErrorCode.EMAIL_ALREADY_IN_USE,
    });
  }

  // 2. Obtener rol SUPERVISOR_ROL de la BD
  const supervisorRole = await this.roleRepo.findOne({
    where: { name: ValidRoles.SUPERVISOR_ROL },
  });
  if (!supervisorRole) {
    throw new CustomError({
      message: 'Rol SUPERVISOR_ROL no encontrado en la base de datos',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: GeneralErrorCode.INTERNAL_SERVER_ERROR,
    });
  }

  // 3. Crear usuario + asignación de rol en una transacción
  const [firstName, ...rest] = input.fullName.trim().split(' ');
  const lastName = rest.join(' ') || firstName;

  const user = await this.dataSource.transaction(async (manager) => {
    const newUser = manager.create(User, {
      name:         firstName,
      lastName:     lastName,
      email:        input.email,
      password:     input.password,    // BeforeInsert hashea automáticamente
      phoneNumber:  input.phone,
      identity:     input.documentNumber,
      status:       UserStatus.ACTIVE,
      passwordSet:  true,
      phoneVerified:    false,
      emailVerified:    false,
      identityVerified: false,
    });

    const savedUser = await manager.save(User, newUser);

    await manager.save(
      manager.create(UserRole, {
        user: { id: savedUser.id },
        role: { id: supervisorRole.id },
        isPrimary: true,
      }),
    );

    return savedUser;
  });

  this.logger.log(`Supervisor auto-registrado: userId=${user.id} | email=${user.email}`);

  // 4. Recargar el usuario con sus roles para generar el JWT correctamente
  const userWithRoles = await this.userRepo
    .createQueryBuilder('user')
    .leftJoinAndSelect('user.userRoles', 'userRoles')
    .leftJoinAndSelect('userRoles.role', 'role')
    .leftJoinAndSelect('role.permissions', 'permissions')
    .where('user.id = :id', { id: user.id })
    .getOne();

  return this.createUserSession(userWithRoles, deviceInfo, false);
}
```

También agregar `HttpStatus` al import de `@nestjs/common` si no está, y `GeneralErrorCode` a los imports de constantes, y `CustomError` al import de utils.

- [ ] **Step 9.5: Correr tests — verificar que pasan**

```bash
npx jest auth-register-supervisor.service.spec --no-coverage
```

Resultado esperado: `PASS — 2 tests`

- [ ] **Step 9.6: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 9.7: Commit**

```bash
git add src/modules/auth/auth.module.ts src/modules/auth/services/auth.service.ts
git add src/modules/auth/services/auth-register-supervisor.service.spec.ts
git commit -m "feat: implement registerSupervisor in AuthService with role assignment and session creation"
```

---

## Task 10: Agregar mutation `registerSupervisor` al `AuthResolver`

**Files:**
- Modify: `src/modules/auth/auth.resolver.ts`

- [ ] **Step 10.1: Agregar el mutation**

Agregar import:
```typescript
import { RegisterSupervisorInput } from './dto/inputs/register-supervisor.input';
```

Agregar el mutation justo después del cierre del método `loginWithSystemCode`:

```typescript
// ── Auto-registro del supervisor ─────────────────────────────────────────────

@Public()
@Mutation(() => AuthResponse, {
  name: 'registerSupervisor',
  description:
    'Auto-registro público para supervisores. ' +
    'Crea una cuenta con SUPERVISOR_ROL sin acceso operacional hasta ser aprobado por un complejo. ' +
    'Devuelve tokens JWT inmediatamente tras el registro.',
})
async registerSupervisor(
  @Args('input') input: RegisterSupervisorInput,
  @Context() context: any,
): Promise<AuthResponse> {
  const deviceInfo = this.extractDeviceInfo(context);
  return this.authService.registerSupervisor(input, deviceInfo);
}
```

- [ ] **Step 10.2: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 10.3: Commit**

```bash
git add src/modules/auth/auth.resolver.ts
git commit -m "feat: expose registerSupervisor as public GraphQL mutation"
```

---

## Task 11: Remover `SUPERVISOR_ROL` de `STAFF_ROLES` en `createStaffMember`

**Files:**
- Modify: `src/modules/users/dto/inputs/create-staff-member.input.ts`

- [ ] **Step 11.1: Actualizar `STAFF_ROLES`**

En `src/modules/users/dto/inputs/create-staff-member.input.ts`, cambiar:

```typescript
/** Roles que el administrador del complejo puede crear */
export const STAFF_ROLES = [
  ValidRoles.SECURITY_ROL,
  ValidRoles.ACCOUNTANT_ROL,
] as const;
```

Actualizar también el `@Field` description del campo `role`:

```typescript
@Field(() => ValidRoles, {
  description: 'Rol a asignar: SECURITY_ROL | ACCOUNTANT_ROL',
})
```

Y el `description` del `@InputType`:

```typescript
@InputType({ description: 'Datos para crear un miembro del personal del complejo (guardia o contador)' })
```

- [ ] **Step 11.2: Verificar compilación**

```bash
npx tsc --noEmit
```

- [ ] **Step 11.3: Commit**

```bash
git add src/modules/users/dto/inputs/create-staff-member.input.ts
git commit -m "feat: remove SUPERVISOR_ROL from createStaffMember — supervisors now self-register"
```

---

## Task 12: Smoke test end-to-end y verificación final

- [ ] **Step 12.1: Levantar la app**

```bash
npm run start:dev
```

Verificar que la app levanta sin errores en el log.

- [ ] **Step 12.2: Verificar que los nuevos tipos aparecen en el schema**

```bash
npx ts-node -e "
const fs = require('fs');
const schema = fs.readFileSync('./src/schema.gql', 'utf-8');
const checks = ['registerSupervisor', 'pendingAccessRequestsCount', 'RegisterSupervisorInput', 'requestLat', 'requestLng'];
checks.forEach(c => console.log(c + ':', schema.includes(c) ? 'OK' : 'MISSING'));
"
```

Todos deben mostrar `OK`.

- [ ] **Step 12.3: Ejecutar todos los tests del proyecto**

```bash
npx jest --no-coverage
```

- [ ] **Step 12.4: Correr la migración en la base de datos de desarrollo**

```bash
npm run typeorm:migration:run
```

Verificar que la migración `AddGpsToSupervisorAccessRequest` se ejecuta correctamente.

- [ ] **Step 12.5: Commit final**

```bash
git add .
git commit -m "chore: verify supervisor self-registration redesign end-to-end"
```

---

## Queries para probar el flujo completo

### 1. Auto-registro del supervisor
```graphql
mutation {
  registerSupervisor(input: {
    fullName:       "Carlos López"
    email:          "carlos@supervisor.com"
    password:       "SuperPass1"
    phone:          "3001234567"
    documentNumber: "1098765432"
  }) {
    accessToken
    refreshToken
  }
}
```

### 2. Intento de check-in sin asignación (debe fallar con SUPERVISOR_NOT_ASSIGNED_TO_COMPLEX)
```graphql
mutation {
  supervisorCheckIn(input: {
    complexId: "<uuid-del-complejo>"
    lat: 4.711
    lng: -74.072
  }) { id status }
}
```

### 3. Solicitar acceso al complejo
```graphql
mutation {
  requestComplexAccess(input: {
    complexId: "<uuid-del-complejo>"
    lat: 4.711
    lng: -74.072
    message: "Llegué al complejo para inspección"
  }) {
    id status requestLat requestLng createdAt
  }
}
```

### 4. Admin — ver badge counter
```graphql
query {
  pendingAccessRequestsCount(complexId: "<uuid-del-complejo>")
}
```

### 5. Admin — aprobar solicitud
```graphql
mutation {
  approveAccessRequest(requestId: "<uuid-de-la-solicitud>") {
    id status resolvedAt
  }
}
```

### 6. Supervisor — login con email (post-registro)
```graphql
mutation {
  loginWithEmail(input: {
    email:    "carlos@supervisor.com"
    password: "SuperPass1"
  }) {
    accessToken
    refreshToken
  }
}
```
