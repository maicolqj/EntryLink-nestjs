import { NotificationSnapshotService } from './notification-snapshot.service';
import { NotificationDetailRegistry } from './notification-detail.registry';
import { Notification } from '../entities/notification.entity';
import {
  NotificationEntitySnapshot,
  NotificationFieldKind,
  NotificationSnapshotSource,
  NotificationSnapshotTone,
} from '../dto/responses/notification-snapshot.response';
import {
  NotificationActionTone,
  NotificationSnapshotAction,
} from '../dto/responses/notification-action.response';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * El expediente es lo que convierte un aviso en algo sobre lo que se puede
 * decidir. Lo que estos specs sostienen:
 *
 *   1. Un módulo sin proveedor no se ve vacío: se muestra lo que quedó en
 *      `metadata`, con nombres en palabras y con las fotos aparte.
 *   2. Un proveedor que revienta no se lleva por delante la notificación. El
 *      detalle es un complemento; el aviso es lo que no se puede perder.
 */

const user: JwtAccessPayload = {
  sub: 'user-1',
  email: 'admin@test.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles: [ValidRoles.COMPLEX_ROL],
  permissions: [],
  complexId: 'complex-1',
};

const notificationOf = (partial: Partial<Notification> = {}): Notification =>
  ({
    id: 'notif-1',
    complexId: 'complex-1',
    title: 'Nueva mascota por validar',
    body: 'Se registró KODA y está pendiente de validación.',
    entityType: 'pet',
    entityId: 'pet-1',
    metadata: {},
    ...partial,
  }) as Notification;

describe('NotificationSnapshotService — sin proveedor registrado', () => {
  const service = new NotificationSnapshotService(
    new NotificationDetailRegistry(),
  );

  it('traduce las claves de metadata a nombres legibles', async () => {
    const result = await service.build(
      notificationOf({ metadata: { petName: 'KODA', unitNumber: '101' } }),
      user,
    );

    const labels = result.sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(labels).toContain('Mascota');
    expect(labels).toContain('Unidad');
    expect(result.source).toBe(NotificationSnapshotSource.METADATA);
  });

  it('a lo que nadie tradujo le da al menos una forma legible', async () => {
    const result = await service.build(
      notificationOf({ metadata: { arrivalDate: '2026-09-11' } }),
      user,
    );

    const labels = result.sections.flatMap((s) => s.fields.map((f) => f.label));
    expect(labels).toContain('Arrival date');
  });

  it('saca las fotos de metadata y las devuelve como imágenes, no como texto', async () => {
    const result = await service.build(
      notificationOf({
        metadata: {
          photoUrl: 'https://files.alternaqj.com/koda.jpg',
          photoUrls: [
            'https://files.alternaqj.com/e1.png',
            'https://files.alternaqj.com/e2.webp',
          ],
        },
      }),
      user,
    );

    expect(result.images.map((i) => i.url)).toEqual([
      'https://files.alternaqj.com/koda.jpg',
      'https://files.alternaqj.com/e1.png',
      'https://files.alternaqj.com/e2.webp',
    ]);

    const values = result.sections.flatMap((s) => s.fields.map((f) => f.value));
    expect(values.join(' ')).not.toContain('koda.jpg');
  });

  it('los PDF se ofrecen como archivo', async () => {
    const result = await service.build(
      notificationOf({
        metadata: { fileUrl: 'https://files.alternaqj.com/dpa.pdf' },
      }),
      user,
    );

    expect(result.files).toHaveLength(1);
  });

  it('no muestra identificadores: no le dicen nada a quien lee', async () => {
    const result = await service.build(
      notificationOf({
        metadata: {
          petId: '0b5c4e2a-6d1f-4a2b-9c3d-7e8f0a1b2c3d',
          unitId: '1b5c4e2a-6d1f-4a2b-9c3d-7e8f0a1b2c3d',
          petName: 'KODA',
        },
      }),
      user,
    );

    const values = result.sections.flatMap((s) => s.fields.map((f) => f.value));
    expect(values).toEqual(['KODA']);
  });

  it('unas coordenadas sueltas se vuelven un enlace al mapa', async () => {
    const result = await service.build(
      notificationOf({
        entityType: 'ACCESS_REQUEST',
        metadata: { requestLat: 4.65, requestLng: -74.05 },
      }),
      user,
    );

    const location = result.sections
      .flatMap((s) => s.fields)
      .find((f) => f.kind === NotificationFieldKind.LOCATION);

    expect(location?.href).toContain('4.65,-74.05');
  });
});

describe('NotificationSnapshotService — con proveedor', () => {
  const buildWith = (
    build: () => Promise<NotificationEntitySnapshot | null>,
  ) => {
    const registry = new NotificationDetailRegistry();
    registry.register({ entityTypes: ['pet'], build });
    return new NotificationSnapshotService(registry);
  };

  it('usa lo que arma el módulo dueño del asunto', async () => {
    const service = buildWith(() =>
      Promise.resolve({
        entityType: 'pet',
        entityId: 'pet-1',
        headline: 'KODA · Perro',
        statusLabel: 'Pendiente de validación',
        statusTone: NotificationSnapshotTone.WARNING,
        sections: [],
        images: [{ url: 'https://files.alternaqj.com/koda.jpg' }],
        files: [],
        source: NotificationSnapshotSource.LIVE,
        isMissing: false,
      } as NotificationEntitySnapshot),
    );

    const result = await service.build(notificationOf(), user);

    expect(result.headline).toBe('KODA · Perro');
    expect(result.source).toBe(NotificationSnapshotSource.LIVE);
  });

  it('si el proveedor falla, el aviso se abre igual con lo que haya', async () => {
    const service = buildWith(() =>
      Promise.reject(new Error('la ficha ya no existe')),
    );

    const result = await service.build(
      notificationOf({ metadata: { petName: 'KODA' } }),
      user,
    );

    expect(result.source).toBe(NotificationSnapshotSource.METADATA);
    expect(result.sections[0].fields[0].value).toBe('KODA');
  });

  it('si el proveedor no puede armarlo, tampoco se queda en blanco', async () => {
    const service = buildWith(() => Promise.resolve(null));

    const result = await service.build(
      notificationOf({ metadata: { petName: 'KODA' } }),
      user,
    );

    expect(result.source).toBe(NotificationSnapshotSource.METADATA);
  });
});

/**
 * Los descriptores de acciones son para PINTAR botones. Lo que estos specs
 * sostienen es que la decisión se vuelve a tomar en el servidor: entre que el
 * administrador abre el aviso y pulsa, el caso pudo cambiar de manos o de
 * estado, y el trámite no puede depender de lo que la pantalla tenga dibujado.
 */
describe('NotificationSnapshotService — ejecutar acciones', () => {
  const actionOf = (
    partial: Partial<NotificationSnapshotAction> = {},
  ): NotificationSnapshotAction => ({
    code: 'PET_INCIDENT_FINE',
    label: 'Multar',
    description: null,
    tone: NotificationActionTone.DANGER,
    isEnabled: true,
    disabledReason: null,
    confirmText: null,
    fields: [],
    ...partial,
  });

  const serviceWith = (
    actions: NotificationSnapshotAction[],
    execute = jest.fn(() => Promise.resolve()),
  ) => {
    const registry = new NotificationDetailRegistry();
    registry.register({
      entityTypes: ['pet_incident'],
      build: () =>
        Promise.resolve({
          entityType: 'pet_incident',
          entityId: 'incident-1',
          statusTone: NotificationSnapshotTone.WARNING,
          sections: [],
          images: [],
          files: [],
          actions,
          source: NotificationSnapshotSource.LIVE,
          isMissing: false,
        } as NotificationEntitySnapshot),
      execute,
    });

    return {
      service: new NotificationSnapshotService(registry),
      execute,
      notification: notificationOf({
        entityType: 'pet_incident',
        entityId: 'incident-1',
      }),
    };
  };

  it('ejecuta la acción y devuelve el expediente ya actualizado', async () => {
    const h = serviceWith([actionOf()]);

    const result = await h.service.execute(
      h.notification,
      user,
      'PET_INCIDENT_FINE',
      { fineAmount: 50000 },
    );

    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(NotificationSnapshotSource.LIVE);
  });

  it('no ejecuta una acción que el módulo devuelve deshabilitada', async () => {
    const h = serviceWith([
      actionOf({
        isEnabled: false,
        disabledReason: 'La unidad tiene plazo hasta el 18/09/2026',
      }),
    ]);

    await expect(
      h.service.execute(h.notification, user, 'PET_INCIDENT_FINE', {}),
    ).rejects.toMatchObject({
      errorCode: 'NOTIFICATION_ACTION_BLOCKED',
    });

    expect(h.execute).not.toHaveBeenCalled();
  });

  it('rechaza un código que el módulo no ofrece hoy', async () => {
    const h = serviceWith([actionOf({ code: 'PET_INCIDENT_WARN' })]);

    await expect(
      h.service.execute(h.notification, user, 'PET_INCIDENT_FINE', {}),
    ).rejects.toMatchObject({
      errorCode: 'NOTIFICATION_ACTION_UNAVAILABLE',
    });

    expect(h.execute).not.toHaveBeenCalled();
  });

  it('exige los campos que la propia acción declaró obligatorios', async () => {
    const h = serviceWith([
      actionOf({
        fields: [
          {
            name: 'resolutionNotes',
            label: 'Motivación de la decisión',
            kind: 'TEXTAREA' as never,
            required: true,
            helpText: null,
            placeholder: null,
            defaultValue: null,
            options: null,
            minLength: 10,
            min: null,
            max: null,
          },
        ],
      }),
    ]);

    await expect(
      h.service.execute(h.notification, user, 'PET_INCIDENT_FINE', {
        resolutionNotes: '   ',
      }),
    ).rejects.toMatchObject({
      errorCode: 'NOTIFICATION_ACTION_FIELD_REQUIRED',
    });

    expect(h.execute).not.toHaveBeenCalled();
  });

  it('un módulo que solo sabe mostrar no acepta acciones', async () => {
    const registry = new NotificationDetailRegistry();
    registry.register({
      entityTypes: ['pet_incident'],
      build: () => Promise.resolve(null),
    });
    const service = new NotificationSnapshotService(registry);

    await expect(
      service.execute(
        notificationOf({ entityType: 'pet_incident' }),
        user,
        'PET_INCIDENT_FINE',
        {},
      ),
    ).rejects.toMatchObject({
      errorCode: 'NOTIFICATION_ACTION_UNSUPPORTED',
    });
  });
});
