import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Resident } from '../entities/resident.entity';
import { ResidentStatus } from '../enums/resident-status.enum';
import { MyResidence } from '../dto/responses/my-residence.response';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { JwtAccessPayload } from '../../auth/interfaces/jwt-payload.interface';

/**
 * Conjuntos donde vive quien pregunta, para el selector de RemoteLink.
 *
 * Solo residencias ACTIVE: a una suspendida no se puede cambiar (el token
 * lo rechaza), así que no se ofrece. Los avisos sin leer se cuentan con la
 * misma regla del badge de la app, conjunto por conjunto.
 */
@Injectable()
export class MyResidencesService {
  constructor(
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  async findMine(currentUser: JwtAccessPayload): Promise<MyResidence[]> {
    const rows = await this.residentRepo.find({
      where: {
        userId: currentUser.sub,
        status: ResidentStatus.ACTIVE,
        deletedAt: IsNull(),
      },
      relations: ['complex', 'unit', 'unit.building'],
      order: { isMainResident: 'DESC', startDate: 'DESC' },
    });

    // Varias fichas en un mismo conjunto (dos unidades) son una sola opción:
    // el selector cambia de conjunto, no de unidad.
    const byComplex = new Map<string, Resident>();
    for (const row of rows) {
      if (!byComplex.has(row.complexId)) byComplex.set(row.complexId, row);
    }

    const list = await Promise.all(
      [...byComplex.values()].map(async (row) => {
        const { count } = await this.notificationsService.getUnreadCount(
          row.complexId,
          currentUser,
          NotificationChannel.APP,
        );
        return {
          complexId: row.complexId,
          complexName: row.complex?.name ?? '',
          buildingName: row.unit?.building?.name ?? null,
          unitNumber: row.unit?.number ?? null,
          isCurrent: row.complexId === currentUser.complexId,
          unreadCount: count,
        };
      }),
    );

    return list.sort((a, b) =>
      a.isCurrent !== b.isCurrent
        ? a.isCurrent
          ? -1
          : 1
        : a.complexName.localeCompare(b.complexName, 'es'),
    );
  }
}
