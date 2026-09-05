import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, MoreThan, Repository, SelectQueryBuilder } from 'typeorm';

import { Pqrf } from '../entities/pqrf.entity';
import { PqrfAcknowledgement } from '../entities/pqrf-acknowledgement.entity';
import { PqrfStatus } from '../enums/pqrf-status.enum';
import {
  PqrfAddressee, isForAdministration, isForCouncil,
} from '../enums/pqrf-addressee.enum';

import { CreatePqrfInput } from '../dto/inputs/create-pqrf.input';
import { FilterPqrfInput } from '../dto/inputs/filter-pqrf.input';
import { PaginatedPqrfResponse } from '../dto/responses/paginated-pqrf.response';

import { PaginationInput }  from '../../shared/dto/inputs/pagination.input';
import { CustomError }      from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService }          from '../../residents/services/residents.service';
import { NotificationsService }      from '../../notifications/services/notifications.service';
import { NotificationType }          from '../../notifications/enums/notification-type.enum';
import { NotificationPriority }      from '../../notifications/enums/notification-priority.enum';
import { AuditService }              from '../../audit/services/audit.service';
import { AuditAction }               from '../../audit/enums/audit-action.enum';
import { AuditEntityType }           from '../../audit/enums/audit-entity-type.enum';
import { SocketService }             from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent }               from '../../../core/infrastructure/socket/socket.events';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

/** Roles que leen los radicados dirigidos a la administración. */
const ADMIN_ROLES: ValidRoles[] = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,
];

const TYPE_LABEL: Record<string, string> = {
  PETICION:     'Petición',
  QUEJA:        'Queja',
  RECLAMO:      'Reclamo',
  SUGERENCIA:   'Sugerencia',
  FELICITACION: 'Felicitación',
};

@Injectable()
export class PqrfService {
  private readonly logger = new Logger(PqrfService.name);

  constructor(
    @InjectRepository(Pqrf)
    private readonly pqrfRepo: Repository<Pqrf>,
    @InjectRepository(PqrfAcknowledgement)
    private readonly ackRepo: Repository<PqrfAcknowledgement>,
    private readonly complexService: ResidentialComplexService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly socketService: SocketService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // RADICAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Radica un PQRF a nombre del residente autenticado.
   *
   * El consecutivo se calcula dentro de la transacción y con bloqueo del
   * complejo: dos residentes radicando a la vez no pueden llevarse el mismo
   * número, que es lo único que el residente tiene para reclamar después.
   */
  async create(input: CreatePqrfInput, currentUser: JwtAccessPayload): Promise<Pqrf> {
    const complex = await this.complexService.findById(input.complexId, currentUser);

    const resident = await this.residentsService.findMyProfile(currentUser.sub, input.complexId);

    const saved = await this.dataSource.transaction(async manager => {
      // El bloqueo serializa solo a quienes radican en ESTE complejo y se
      // libera al terminar la transacción.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`pqrf:${input.complexId}`],
      );

      const last = await manager
        .createQueryBuilder(Pqrf, 'p')
        .select('MAX(p.consecutive)', 'max')
        .where('p.complexId = :complexId', { complexId: input.complexId })
        .getRawOne<{ max: number | null }>();

      const consecutive = (last?.max ?? 0) + 1;

      return manager.save(manager.create(Pqrf, {
        complexId:   input.complexId,
        consecutive,
        code:        `PQRF-${String(consecutive).padStart(6, '0')}`,
        type:        input.type,
        addressee:   input.addressee,
        status:      PqrfStatus.RADICADO,
        // El plazo se congela con la configuración vigente hoy: cambiarla
        // mañana no puede correrle la fecha a un radicado ya en curso.
        dueAt:       this.deadlineFrom(new Date(), complex.pqrfResolutionDays),
        subject:     input.subject.trim(),
        description: input.description.trim(),
        residentId:  resident?.id ?? null,
        unitId:      resident?.unitId ?? null,
        requestedByUserId: currentUser.entityType === 'user' ? currentUser.sub : null,
        requestedByName: resident?.user
          ? `${resident.user.name ?? ''} ${resident.user.lastName ?? ''}`.trim() || null
          : null,
      }));
    });

    this.notifyAddressees(saved)
      .catch(err => this.logger.warn(`Error al notificar el radicado ${saved.code}: ${err?.message}`));

    void this.auditService.log({
      entityType: AuditEntityType.Pqrf,
      entityId: saved.id,
      action: AuditAction.CREATE,
      newValue: {
        code: saved.code, type: saved.type, addressee: saved.addressee, subject: saved.subject,
      },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: saved.complexId,
      description: `PQRF radicado ${saved.code}: ${saved.subject}`,
    });

    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSULTAS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bandeja de quien consulta.
   *
   * La administración ve lo dirigido a ella; el consejo, lo dirigido al consejo.
   * Un radicado dirigido SOLO al consejo no le aparece a la administración: es
   * la razón de ser de `addressee` y la única forma de que un residente pueda
   * quejarse del administrador.
   */
  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterPqrfInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedPqrfResponse> {
    await this.complexService.findById(complexId, currentUser);

    const roles = currentUser.roles ?? [];
    const isAdmin   = roles.some(role => ADMIN_ROLES.includes(role));
    const isCouncil = roles.includes(ValidRoles.COUNCIL_ROL)
      || await this.residentsService.isCouncilUser(currentUser.sub);

    if (!isAdmin && !isCouncil) {
      throw new CustomError({
        message: 'No tienes acceso a los radicados del complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    // Lo que puede leer según su instancia. Quien es las dos cosas ve todo.
    const visible: PqrfAddressee[] = [];
    if (isAdmin)   visible.push(PqrfAddressee.ADMINISTRACION, PqrfAddressee.AMBOS);
    if (isCouncil) visible.push(PqrfAddressee.CONSEJO, PqrfAddressee.AMBOS);

    return this.query(complexId, pagination, filters, qb =>
      qb.andWhere('p.addressee IN (:...visible)', { visible: [...new Set(visible)] }),
    );
  }

  /** Radicados que puso el residente autenticado. */
  async findMine(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterPqrfInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedPqrfResponse> {
    await this.complexService.findById(complexId, currentUser);

    return this.query(complexId, pagination, filters, qb =>
      qb.andWhere('p.requestedByUserId = :userId', { userId: currentUser.sub }),
    );
  }

  async findById(pqrfId: string, currentUser: JwtAccessPayload): Promise<Pqrf> {
    const pqrf = await this.pqrfRepo.findOne({
      where: { id: pqrfId, deletedAt: IsNull() },
      relations: ['unit'],
    });

    if (!pqrf) {
      throw new CustomError({
        message: 'El radicado no existe o fue eliminado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    await this.complexService.findById(pqrf.complexId, currentUser);
    await this.assertCanRead(pqrf, currentUser);

    return pqrf;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEGUIMIENTO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Deja constancia de que un destinatario abrió el radicado.
   *
   * Lo llama la ficha al abrirse, no un botón: el residente merece saber que
   * alguien ya lo leyó, y pedirle a quien atiende que además pulse "marcar como
   * abierto" sería inventar un trámite que nadie haría. Es idempotente —abrirlo
   * diez veces deja una sola huella— y quien lo radicó no la deja: leer lo
   * propio no es atenderlo.
   */
  async open(pqrfId: string, currentUser: JwtAccessPayload): Promise<Pqrf> {
    const pqrf = await this.findById(pqrfId, currentUser);

    const instance = await this.instanceOf(pqrf, currentUser);
    if (!instance) return pqrf;

    const existing = await this.ackRepo.findOne({
      where: { pqrfId: pqrf.id, userId: currentUser.sub },
    });

    if (!existing) {
      await this.ackRepo.save(this.ackRepo.create({
        pqrfId:   pqrf.id,
        userId:   currentUser.sub,
        userName: currentUser.email ?? null,
        instance,
      }));
    }

    if (pqrf.status === PqrfStatus.RADICADO) {
      pqrf.status = PqrfStatus.EN_TRAMITE;
      await this.pqrfRepo.save(pqrf);
      this.emitUpdated(pqrf);
    }

    // Abrirlo NO lo resuelve: se puede abrir solo para leerlo y no hacer nada.
    // Lo que evita que un radicado quede abierto para siempre es el plazo del
    // complejo, no el hecho de que alguien lo mirara.
    return this.findByIdOrFail(pqrf.id);
  }

  /**
   * Un destinatario da el radicado por resuelto.
   *
   * Solo cuando TODOS los destinatarios lo han marcado el radicado pasa a
   * RESUELTO: si fue dirigido a las dos instancias, una no puede cerrarlo en
   * nombre de la otra. Al completarse se le avisa al residente.
   */
  async markResolved(pqrfId: string, currentUser: JwtAccessPayload): Promise<Pqrf> {
    const pqrf = await this.findById(pqrfId, currentUser);

    const instance = await this.instanceOf(pqrf, currentUser);
    if (!instance) {
      throw new CustomError({
        message: 'Solo quien atiende el radicado puede marcarlo como resuelto',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: GeneralErrorCode.FORBIDDEN,
      });
    }

    if (pqrf.status === PqrfStatus.RESUELTO) return this.findByIdOrFail(pqrf.id);

    const existing = await this.ackRepo.findOne({
      where: { pqrfId: pqrf.id, userId: currentUser.sub },
    });

    await this.ackRepo.save({
      ...(existing ?? this.ackRepo.create({
        pqrfId: pqrf.id, userId: currentUser.sub, userName: currentUser.email ?? null, instance,
      })),
      resolvedAt: existing?.resolvedAt ?? new Date(),
    });

    const closed = await this.closeIfComplete(pqrf);

    void this.auditService.log({
      entityType: AuditEntityType.Pqrf,
      entityId: pqrf.id,
      action: AuditAction.UPDATE,
      newValue: { code: closed.code, status: closed.status },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId: pqrf.complexId,
      description: closed.status === PqrfStatus.RESUELTO
        ? `PQRF ${closed.code} resuelto`
        : `PQRF ${closed.code} marcado como resuelto por un destinatario`,
    });

    const updated = await this.findByIdOrFail(pqrf.id);
    this.emitUpdated(updated);
    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAZO Y SILENCIO ADMINISTRATIVO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cierra los radicados a los que ya no les falta ninguna instancia.
   *
   * Existe porque el cierre no siempre coincide con el último clic: si un
   * consejero deja el consejo cuando los demás ya marcaron, o si cambian las
   * reglas de quién debe responder, el radicado se queda esperando un botón que
   * nadie va a pulsar —quien ya marcó no vuelve a ver el botón—. Abrir la ficha
   * no puede hacer este trabajo: se abre para leer, no para resolver.
   */
  async closeFullyAnswered(): Promise<number> {
    const open = await this.pqrfRepo.find({
      where: {
        status: In([PqrfStatus.RADICADO, PqrfStatus.EN_TRAMITE]),
        deletedAt: IsNull(),
      },
      take: 200,
    });

    let closed = 0;

    for (const pqrf of open) {
      const before = pqrf.status;
      const result = await this.closeIfComplete(pqrf);
      if (result.status === PqrfStatus.RESUELTO && before !== PqrfStatus.RESUELTO) {
        this.emitUpdated(result);
        closed += 1;
      }
    }

    return closed;
  }

  /**
   * Resuelve solo los radicados a los que se les venció el plazo sin respuesta.
   *
   * Es el silencio administrativo positivo: pasado el término, la ley resuelve
   * a favor de quien radicó. Queda marcado como tal —y no como una respuesta—
   * porque el residente tiene derecho a saber cuál de las dos cosas recibió, y
   * la administración a saber que se le venció.
   */
  async resolveExpiredBySilence(): Promise<number> {
    const expired = await this.pqrfRepo.find({
      where: {
        status: In([PqrfStatus.RADICADO, PqrfStatus.EN_TRAMITE]),
        deletedAt: IsNull(),
        dueAt: LessThan(new Date()),
      },
      take: 200,
    });

    for (const pqrf of expired) {
      pqrf.status            = PqrfStatus.RESUELTO;
      pqrf.resolvedAt        = new Date();
      pqrf.resolvedBySilence = true;
      const saved = await this.pqrfRepo.save(pqrf);

      this.emitUpdated(saved);

      await this.notifySilence(saved)
        .catch(err => this.logger.warn(`Error al avisar el silencio de ${saved.code}: ${err?.message}`));

      void this.auditService.log({
        entityType: AuditEntityType.Pqrf,
        entityId: saved.id,
        action: AuditAction.UPDATE,
        newValue: { code: saved.code, status: saved.status, resolvedBySilence: true },
        performedById: null,
        performedByName: 'sistema',
        performedByRole: '',
        complexId: saved.complexId,
        description: `PQRF ${saved.code} resuelto por silencio administrativo positivo`,
      });
    }

    return expired.length;
  }

  /**
   * Insiste con los radicados que están por vencerse.
   *
   * Solo dentro de la ventana previa que configuró el complejo y respetando el
   * intervalo: recordar cada hora un plazo de quince días convierte el aviso en
   * ruido y nadie lo vuelve a mirar.
   */
  async sendDueReminders(): Promise<number> {
    const now = new Date();

    const open = await this.pqrfRepo.find({
      where: {
        status: In([PqrfStatus.RADICADO, PqrfStatus.EN_TRAMITE]),
        deletedAt: IsNull(),
        dueAt: MoreThan(now),
      },
      relations: ['complex'],
      take: 200,
    });

    let sent = 0;

    for (const pqrf of open) {
      const leadDays = pqrf.complex?.pqrfReminderLeadDays ?? 0;
      const everyHours = pqrf.complex?.pqrfReminderIntervalHours ?? 0;
      if (leadDays <= 0 || everyHours <= 0) continue;

      const windowStart = new Date(pqrf.dueAt.getTime() - leadDays * DAY_MS);
      if (now < windowStart) continue;

      const lastSent = pqrf.lastReminderAt?.getTime() ?? 0;
      if (now.getTime() - lastSent < everyHours * HOUR_MS) continue;

      const recipients = await this.pendingRecipients(pqrf);
      if (recipients.length === 0) continue;

      const hoursLeft = Math.max(0, Math.round((pqrf.dueAt.getTime() - now.getTime()) / HOUR_MS));

      await this.notificationsService.notify({
        complexId: pqrf.complexId,
        userIds: recipients,
        type: NotificationType.PQRF_REMINDER,
        priority: NotificationPriority.HIGH,
        title: `⏰ ${pqrf.code} por vencerse`,
        body: `Quedan ${hoursLeft} h para resolver "${pqrf.subject}". Si se vence, queda resuelto a favor del residente por silencio administrativo positivo.`,
        entityId: pqrf.id,
        entityType: 'pqrf',
        isActionable: true,
        metadata: { pqrfId: pqrf.id, code: pqrf.code, subject: pqrf.subject },
      });

      pqrf.lastReminderAt = now;
      await this.pqrfRepo.save(pqrf);
      sent += 1;
    }

    return sent;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNOS
  // ═══════════════════════════════════════════════════════════════════════════

  /** El radicado con su rastro de destinatarios, sin control de acceso. */
  async findByIdOrFail(pqrfId: string): Promise<Pqrf> {
    const pqrf = await this.pqrfRepo.findOne({
      where: { id: pqrfId, deletedAt: IsNull() },
      relations: ['unit', 'acknowledgements'],
    });

    if (!pqrf) {
      throw new CustomError({
        message: 'El radicado no existe o fue eliminado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    return pqrf;
  }

  /**
   * Con qué sombrero atiende esta persona el radicado, o null si no le
   * corresponde. Quien lo radicó no atiende lo suyo, aunque sea del consejo.
   *
   * Es público porque la UI necesita saberlo para mostrar —o no— el botón de
   * resolver, y deducirlo de si existe una huella de apertura no sirve: si la
   * huella no se pudo crear, el botón desaparecería sin explicación.
   */
  async instanceOf(
    pqrf: Pqrf,
    currentUser: JwtAccessPayload,
  ): Promise<PqrfAddressee | null> {
    if (pqrf.requestedByUserId && pqrf.requestedByUserId === currentUser.sub) return null;

    const roles = currentUser.roles ?? [];
    if (roles.some(role => ADMIN_ROLES.includes(role)) && isForAdministration(pqrf.addressee)) {
      return PqrfAddressee.ADMINISTRACION;
    }

    if (isForCouncil(pqrf.addressee) && await this.residentsService.isCouncilUser(currentUser.sub)) {
      return PqrfAddressee.CONSEJO;
    }

    return null;
  }

  /**
   * Qué falta para dar el radicado por resuelto. Se cuenta POR INSTANCIA, no
   * por persona suelta:
   *
   * - La ADMINISTRACIÓN es una oficina: con que una persona suya lo marque, esa
   *   instancia ya respondió. Exigirle además a cada supervisor que lo marque
   *   dejaría el radicado abierto para siempre, porque el supervisor de
   *   portería no tiene por qué opinar sobre una petición de cuentas.
   * - El CONSEJO es un cuerpo colegiado: responde cuando responden todos sus
   *   miembros, que es como toma sus decisiones.
   *
   * Se mide contra los miembros de HOY: si nombraron a un consejero mientras el
   * radicado estaba abierto, también le corresponde; y si uno se fue, deja de
   * faltar. Una vez RESUELTO ya no se recalcula, así que los cambios
   * posteriores no reabren lo cerrado.
   */
  private async pendingResolvers(pqrf: Pqrf): Promise<string[]> {
    const acks = await this.ackRepo.find({ where: { pqrfId: pqrf.id } });
    const resolved = acks.filter(ack => ack.resolvedAt);
    const pending: string[] = [];

    if (isForAdministration(pqrf.addressee)
      && !resolved.some(ack => ack.instance === PqrfAddressee.ADMINISTRACION)) {
      pending.push(PqrfAddressee.ADMINISTRACION);
    }

    if (isForCouncil(pqrf.addressee)) {
      // Quien radicó no se debe a sí mismo una respuesta, aunque sea consejero.
      const members = (await this.residentsService.findCouncilUserIds(pqrf.complexId))
        .filter(userId => userId !== pqrf.requestedByUserId);

      const done = new Set(
        resolved.filter(ack => ack.instance === PqrfAddressee.CONSEJO).map(ack => ack.userId),
      );

      pending.push(...members.filter(userId => !done.has(userId)));
    }

    return pending;
  }

  /**
   * Cierra el radicado si ya no falta nadie, y avisa al residente.
   *
   * Se llama al marcar y también al abrir la ficha porque el conjunto de quien
   * debe responder cambia solo: si el último consejero que faltaba deja el
   * consejo, nadie va a volver a pulsar el botón y el radicado se quedaría
   * abierto para siempre.
   */
  private async closeIfComplete(pqrf: Pqrf): Promise<Pqrf> {
    if (pqrf.status === PqrfStatus.RESUELTO) return pqrf;

    const pending = await this.pendingResolvers(pqrf);
    if (pending.length > 0) {
      this.logger.debug(`${pqrf.code}: faltan ${pending.length} por marcar como resuelto`);
      return pqrf;
    }

    // Sin ninguna marca no hay nada que cerrar: un radicado recién puesto no
    // tiene pendientes porque nadie lo ha atendido todavía.
    const hasAnyMark = await this.ackRepo.count({ where: { pqrfId: pqrf.id } });
    if (hasAnyMark === 0) return pqrf;

    pqrf.status     = PqrfStatus.RESUELTO;
    pqrf.resolvedAt = new Date();
    const saved = await this.pqrfRepo.save(pqrf);

    this.notifyResolved(saved)
      .catch(err => this.logger.warn(`Error al avisar la resolución de ${saved.code}: ${err?.message}`));

    return saved;
  }

  /**
   * El cambio de estado viaja por socket para que la app lo pinte sin que el
   * residente recargue: va al complejo —donde escuchan administración y
   * consejo— y al residente por su propio canal, que no está en esa sala.
   */
  private emitUpdated(pqrf: Pqrf): void {
    const payload = {
      pqrfId: pqrf.id,
      code: pqrf.code,
      status: pqrf.status,
      addressee: pqrf.addressee,
      complexId: pqrf.complexId,
      resolvedAt: pqrf.resolvedAt ?? null,
    };

    this.socketService.emitToComplex(pqrf.complexId, SocketEvent.PQRF_UPDATED, payload);
    if (pqrf.requestedByUserId) {
      this.socketService.emitToUser(pqrf.requestedByUserId, SocketEvent.PQRF_UPDATED, payload);
    }
  }

  /** Fecha límite a partir del plazo del complejo, en días calendario. */
  private deadlineFrom(from: Date, days: number): Date {
    return new Date(from.getTime() + Math.max(1, days) * DAY_MS);
  }

  /**
   * A quién hay que insistirle: solo las instancias que todavía no respondieron.
   * Recordarle a quien ya cumplió su parte es la forma más rápida de que deje
   * de leer los avisos.
   */
  private async pendingRecipients(pqrf: Pqrf): Promise<string[]> {
    const pending = await this.pendingResolvers(pqrf);
    if (pending.length === 0) return [];

    const userIds: string[] = [];

    if (pending.includes(PqrfAddressee.ADMINISTRACION)) {
      userIds.push(...await this.notificationsService.findUserIdsByRoles(pqrf.complexId, [
        ValidRoles.COMPLEX_ROL,
        ValidRoles.SUPERVISOR_ROL,
      ]));
    }

    // El resto de pendientes son ids de consejeros: se les avisa directamente.
    userIds.push(...pending.filter(entry => entry !== PqrfAddressee.ADMINISTRACION));

    return [...new Set(userIds)].filter(id => id !== pqrf.requestedByUserId);
  }

  /**
   * Le avisa al residente que su radicado se resolvió a su favor porque nadie
   * respondió a tiempo, y a la administración que se le venció. Las dos partes
   * necesitan enterarse: una gana algo, la otra tiene un incumplimiento.
   */
  private async notifySilence(pqrf: Pqrf): Promise<void> {
    if (pqrf.requestedByUserId) {
      await this.notificationsService.notify({
        complexId: pqrf.complexId,
        userIds: [pqrf.requestedByUserId],
        type: NotificationType.PQRF_RESOLVED,
        priority: NotificationPriority.HIGH,
        title: `✅ ${pqrf.code} resuelto a tu favor`,
        body: `Se venció el plazo para responder tu radicado "${pqrf.subject}" y quedó resuelto a tu favor por silencio administrativo positivo.`,
        entityId: pqrf.id,
        entityType: 'pqrf',
        isActionable: false,
        metadata: { pqrfId: pqrf.id, code: pqrf.code, resolvedBySilence: true },
      });
    }

    const staff = await this.notificationsService.findUserIdsByRoles(pqrf.complexId, [
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ]);

    if (staff.length > 0) {
      await this.notificationsService.notify({
        complexId: pqrf.complexId,
        userIds: staff,
        type: NotificationType.PQRF_RESOLVED,
        priority: NotificationPriority.HIGH,
        title: `⚠️ ${pqrf.code} venció sin respuesta`,
        body: `El radicado "${pqrf.subject}" se venció y quedó resuelto a favor del residente por silencio administrativo positivo.`,
        entityId: pqrf.id,
        entityType: 'pqrf',
        isActionable: false,
        metadata: { pqrfId: pqrf.id, code: pqrf.code, resolvedBySilence: true },
      });
    }
  }

  /**
   * Le avisa al residente que su radicado quedó resuelto.
 La respuesta formal
   * viaja por correo desde la administración, así que el aviso lo dice: sin esa
   * frase el residente se queda esperando una respuesta dentro de la app.
   */
  private async notifyResolved(pqrf: Pqrf): Promise<void> {
    if (!pqrf.requestedByUserId) return;

    await this.notificationsService.notify({
      complexId: pqrf.complexId,
      userIds: [pqrf.requestedByUserId],
      type: NotificationType.PQRF_RESOLVED,
      priority: NotificationPriority.NORMAL,
      title: `✅ ${pqrf.code} resuelto`,
      body: `Tu radicado "${pqrf.subject}" fue marcado como resuelto. La respuesta debió llegar al correo que tienes registrado en la administración.`,
      entityId: pqrf.id,
      entityType: 'pqrf',
      isActionable: false,
      metadata: { pqrfId: pqrf.id, code: pqrf.code, subject: pqrf.subject },
    });
  }

  /** Quien lo radicó siempre puede leerlo; los demás, solo si les fue dirigido. */
  private async assertCanRead(pqrf: Pqrf, currentUser: JwtAccessPayload): Promise<void> {
    if (pqrf.requestedByUserId && pqrf.requestedByUserId === currentUser.sub) return;

    const roles = currentUser.roles ?? [];
    if (roles.some(role => ADMIN_ROLES.includes(role)) && isForAdministration(pqrf.addressee)) return;

    if (isForCouncil(pqrf.addressee)) {
      const isCouncil = roles.includes(ValidRoles.COUNCIL_ROL)
        || await this.residentsService.isCouncilUser(currentUser.sub);
      if (isCouncil) return;
    }

    throw new CustomError({
      message: 'Este radicado no está dirigido a ti',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: GeneralErrorCode.FORBIDDEN,
    });
  }

  private async query(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterPqrfInput,
    scope: (qb: SelectQueryBuilder<Pqrf>) => unknown,
  ): Promise<PaginatedPqrfResponse> {
    const { page, limit } = pagination;

    // Las condiciones usan nombres de PROPIEDAD y no de columna: al paginar con
    // joins, TypeORM arma una subconsulta de ids y resuelve el orden contra los
    // metadatos de la entidad.
    const qb = this.pqrfRepo
      .createQueryBuilder('p')
      .where('p.complexId = :complexId', { complexId })
      .andWhere('p.deletedAt IS NULL');

    scope(qb);

    if (filters?.type)      qb.andWhere('p.type = :type',           { type: filters.type });
    if (filters?.status)    qb.andWhere('p.status = :status',       { status: filters.status });
    if (filters?.addressee) qb.andWhere('p.addressee = :addressee', { addressee: filters.addressee });
    if (filters?.search) {
      qb.andWhere('(p.code ILIKE :search OR p.subject ILIKE :search)', {
        search: `%${filters.search.trim()}%`,
      });
    }

    qb.leftJoinAndSelect('p.unit', 'unit').orderBy('p.createdAt', 'DESC');

    const totalItems = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Avisa a la instancia a la que se dirigió el radicado, y solo a ella: si el
   * residente lo mandó al consejo, la administración no se entera.
   */
  private async notifyAddressees(pqrf: Pqrf): Promise<void> {
    const userIds: string[] = [];

    if (isForAdministration(pqrf.addressee)) {
      userIds.push(...await this.notificationsService.findUserIdsByRoles(pqrf.complexId, [
        ValidRoles.COMPLEX_ROL,
        ValidRoles.SUPERVISOR_ROL,
      ]));
    }

    if (isForCouncil(pqrf.addressee)) {
      userIds.push(...await this.residentsService.findCouncilUserIds(pqrf.complexId));
    }

    const recipients = [...new Set(userIds)];
    if (recipients.length === 0) {
      this.logger.warn(`El radicado ${pqrf.code} no tiene a quién notificar (${pqrf.addressee})`);
      return;
    }

    const label = TYPE_LABEL[pqrf.type] ?? 'Radicado';

    await this.notificationsService.notify({
      complexId: pqrf.complexId,
      userIds: recipients,
      type: NotificationType.PQRF_RECEIVED,
      priority: NotificationPriority.NORMAL,
      title: `📨 ${label} ${pqrf.code}`,
      body: `${pqrf.requestedByName ?? 'Un residente'} radicó: ${pqrf.subject}`,
      entityId: pqrf.id,
      entityType: 'pqrf',
      isActionable: true,
      metadata: {
        pqrfId: pqrf.id,
        code: pqrf.code,
        subject: pqrf.subject,
      },
    });
  }
}
