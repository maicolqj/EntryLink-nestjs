import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';

/**
 * Resuelve en qué complejo entra alguien cuando inicia sesión como residente.
 *
 * Existe porque el `complexId` del JWT sale de `users.complex_id`, y ese campo
 * no describe dónde vive una persona: describe a qué conjunto pertenece su
 * cuenta de trabajo. Para quien administra —o para el super administrador, que
 * no pertenece a ningún conjunto— viene vacío, aunque tenga su apartamento
 * registrado. Con el campo vacío, cada consulta que acota por complejo devuelve
 * nada: la unidad no aparece en la app y la bandeja de notificaciones sale
 * vacía, las dos en silencio y sin error.
 *
 * Desde que RESIDENT_ROL es un rol base, esto dejó de ser un caso raro: toda
 * cuenta con cargo puede además vivir en un conjunto.
 */
@Injectable()
export class ResidentTenancyService {
  private readonly logger = new Logger(ResidentTenancyService.name);

  constructor(
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
  ) {}

  /**
   * El complejo donde el usuario es residente activo, o `undefined` si no lo es
   * en ninguno.
   *
   * Cuando hay varias residencias activas —la entidad lo permite, el índice es
   * `userId + complexId + status`— manda la marcada como principal; a igualdad,
   * la de ingreso más reciente. Elegir sola evita pedirle al residente que
   * escoja un conjunto justo cuando está tratando de entrar; si algún día hace
   * falta cambiar de conjunto sin cerrar sesión, ese es el lugar donde
   * engancharlo.
   */
  async resolveComplexId(userId: string): Promise<string | undefined> {
    const residence = await this.residentRepo.findOne({
      where: {
        userId,
        status: ResidentStatus.ACTIVE,
        deletedAt: IsNull(),
      },
      order: { isMainResident: 'DESC', startDate: 'DESC' },
      select: { id: true, complexId: true },
    });

    if (!residence) {
      // No es un error: un miembro del personal sin apartamento entra sin
      // complejo de residencia, igual que antes.
      this.logger.debug(`Sin residencia activa — userId: ${userId}`);
      return undefined;
    }

    return residence.complexId;
  }
}
