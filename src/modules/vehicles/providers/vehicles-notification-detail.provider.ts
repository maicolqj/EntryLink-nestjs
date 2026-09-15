import { Injectable, OnModuleInit } from '@nestjs/common';

import { VehiclesService } from '../services/vehicles.service';
import { VehicleStatus } from '../enums/vehicle-status.enum';

import { NotificationDetailRegistry } from '../../notifications/services/notification-detail.registry';
import {
  NotificationDetailProvider,
  NotificationSnapshotContext,
} from '../../notifications/interfaces/notification-detail-provider.interface';
import {
  NotificationEntitySnapshot,
  NotificationFieldKind,
  NotificationSnapshotSource,
  NotificationSnapshotTone,
} from '../../notifications/dto/responses/notification-snapshot.response';
import {
  field,
  image,
  section,
  snapshot,
  unitLabel,
} from '../../notifications/utils/notification-snapshot.util';

/**
 * Qué se ve cuando llega un aviso de vehículo.
 *
 * Quien aprueba está asignando un parqueadero y autorizando una placa en la
 * talanquera: necesita ver la foto y la placa juntas. Con el aviso pelado había
 * que abrir el módulo de vehículos y buscar la placa a mano.
 */

const TYPE: Record<string, string> = {
  CAR: 'Automóvil',
  MOTORCYCLE: 'Motocicleta',
  TRUCK: 'Camión',
  CAMIONETA: 'Camioneta',
  BICYCLE: 'Bicicleta',
  ELECTRIC_SCOOTER: 'Patineta eléctrica',
  OTHER: 'Otro',
};

const STATUS: Record<
  string,
  { label: string; tone: NotificationSnapshotTone }
> = {
  [VehicleStatus.PENDING_APPROVAL]: {
    label: 'Pendiente de aprobación',
    tone: NotificationSnapshotTone.WARNING,
  },
  [VehicleStatus.ACTIVE]: {
    label: 'Autorizado',
    tone: NotificationSnapshotTone.POSITIVE,
  },
  [VehicleStatus.SUSPENDED]: {
    label: 'Suspendido',
    tone: NotificationSnapshotTone.DANGER,
  },
  [VehicleStatus.REJECTED]: {
    label: 'Rechazado',
    tone: NotificationSnapshotTone.DANGER,
  },
  [VehicleStatus.REMOVED]: {
    label: 'Retirado',
    tone: NotificationSnapshotTone.NEUTRAL,
  },
};

@Injectable()
export class VehiclesNotificationDetailProvider
  implements NotificationDetailProvider, OnModuleInit
{
  readonly entityTypes = ['vehicle'];

  constructor(
    private readonly registry: NotificationDetailRegistry,
    private readonly vehiclesService: VehiclesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async build({
    notification,
    currentUser,
  }: NotificationSnapshotContext): Promise<NotificationEntitySnapshot | null> {
    if (!notification.entityId) return null;

    const vehicle = await this.vehiclesService.findById(
      notification.entityId,
      currentUser,
    );

    const status = STATUS[vehicle.status] ?? {
      label: String(vehicle.status),
      tone: NotificationSnapshotTone.NEUTRAL,
    };

    return snapshot({
      entityType: 'vehicle',
      entityId: vehicle.id,
      statusCode: vehicle.status,
      headline: [vehicle.plate, TYPE[vehicle.type] ?? vehicle.type]
        .filter(Boolean)
        .join(' · '),
      statusLabel: status.label,
      statusTone: status.tone,
      sections: [
        section('El vehículo', [
          field('Placa', vehicle.plate, NotificationFieldKind.BADGE),
          field('Tipo', TYPE[vehicle.type] ?? vehicle.type),
          field('Marca', vehicle.brand),
          field('Modelo', vehicle.model),
          field('Año', vehicle.year ? `${vehicle.year}` : null),
          field('Color', vehicle.color),
        ]),
        section('En el complejo', [
          field('Unidad', unitLabel(vehicle.unit)),
          field('Parqueadero', vehicle.parkingSpot),
          field('Estado', status.label, NotificationFieldKind.BADGE),
          field('Registrado', vehicle.createdAt, NotificationFieldKind.DATE),
        ]),
      ],
      images: [image(vehicle.photoUrl, vehicle.plate)],
      source: NotificationSnapshotSource.LIVE,
    });
  }
}
