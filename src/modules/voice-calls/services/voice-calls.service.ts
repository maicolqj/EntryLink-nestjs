import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import { CallLog } from '../../call-logs/entities/call-log.entity';
import { CallChannel } from '../../call-logs/enums/call-channel.enum';
import { CallDirection } from '../../call-logs/enums/call-direction.enum';
import { CallOutcome } from '../../call-logs/enums/call-outcome.enum';
import { VoiceCallState } from '../../call-logs/enums/voice-call-state.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { IntercomMode } from '../../residential-complex/enums/intercom-mode.enum';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { User } from '../../users/entities/user.entity';
import { PushSubscription } from '../../notifications/entities/push-subscription.entity';
import { PushPlatform } from '../../notifications/enums/push-platform.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AuditService } from '../../audit/services/audit.service';
import { AuditAction } from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  IntercomErrorCode,
} from '../../shared/constans/error-codes.constants';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';

import { IceServersService } from './ice-servers.service';
import { StartResidentIntercomCallInput } from '../dto/inputs/start-resident-call.input';
import { StartSecurityIntercomCallInput } from '../dto/inputs/start-security-call.input';
import { AnswerIntercomCallInput } from '../dto/inputs/answer-call.input';
import { IntercomSignalInput } from '../dto/inputs/intercom-signal.input';
import { UpdateIntercomSettingsInput } from '../dto/inputs/intercom-settings.input';
import { IntercomCallSession } from '../dto/responses/intercom-call-session.response';
import {
  IntercomAdoption,
  IntercomUnitAdoption,
} from '../dto/responses/intercom-adoption.response';

/** Lo que suena una llamada antes de darse por perdida. */
export const RING_TIMEOUT_MS = 30_000;
/** El barrido cierra lo que el temporizador no alcanzó (reinicio del servidor). */
export const STALE_RINGING_MS = 45_000;
/** Una llamada "en curso" de más de esto quedó colgada: se cierra. */
export const STALE_ACTIVE_MS = 4 * 60 * 60 * 1000;

/** Por qué terminó la llamada; viaja en el evento para que la app lo diga. */
export enum IntercomEndReason {
  HANGUP = 'HANGUP',
  REJECTED = 'REJECTED',
  MISSED = 'MISSED',
  CANCELLED = 'CANCELLED',
  LOST = 'LOST',
}

/** Tipos del push data-only; la app los distingue de los avisos normales. */
export const INTERCOM_PUSH = {
  INCOMING: 'INTERCOM_CALL_INCOMING',
  ANSWERED: 'INTERCOM_CALL_ANSWERED',
  ENDED: 'INTERCOM_CALL_ENDED',
} as const;

const SECURITY_LABEL = 'Portería';
const MOBILE_PLATFORMS = [PushPlatform.ANDROID, PushPlatform.IOS];

type Side = 'agent' | 'resident';

/**
 * Citofonía por internet.
 *
 * Portería → residente: se llama a UNA persona (la elegida en la unidad) y solo
 * a ella le suena, igual que con la SIM. Residente → portería (opcional por
 * conjunto): suena en todos los equipos de portería y el primero que contesta
 * se queda con la llamada.
 *
 * La llamada vive en `call_logs` (canal INTERNET) desde que empieza a sonar:
 * el historial es uno solo y los cambios de estado son un UPDATE condicionado
 * al estado anterior, así dos equipos que contestan a la vez no se pisan
 * aunque haya varias instancias del servidor.
 *
 * El audio no pasa por aquí: WebRTC entre los equipos (o por el TURN). El
 * servidor solo reparte la señalización por socket.
 */
@Injectable()
export class VoiceCallsService implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceCallsService.name);
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(CallLog)
    private readonly callRepo: Repository<CallLog>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PushSubscription)
    private readonly pushSubRepo: Repository<PushSubscription>,
    private readonly complexService: ResidentialComplexService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly socketService: SocketService,
    private readonly cacheService: CacheService,
    private readonly iceServers: IceServersService,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.ringTimers.values()) clearTimeout(timer);
    this.ringTimers.clear();
  }

  // ================================================================
  // INICIAR
  // ================================================================

  /** Portería llama a un residente. */
  async startResidentCall(
    input: StartResidentIntercomCallInput,
    currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession> {
    await this.complexService.assertComplexAccess(input.complexId, currentUser);
    await this.requireInternetComplex(input.complexId);

    if (input.residentUserId === currentUser.sub) {
      throw this.error(
        'No puedes llamarte a ti mismo',
        HttpStatus.BAD_REQUEST,
        GeneralErrorCode.BAD_REQUEST,
      );
    }

    const resident = await this.findActiveResident(
      input.residentUserId,
      input.complexId,
      input.unitId,
    );
    const residentUser = await this.userRepo.findOne({
      where: { id: input.residentUserId },
      select: ['id', 'name', 'lastName', 'phoneNumber'],
    });

    // Sin la app no hay dónde sonar. Mejor decírselo a portería ahora, que
    // dejarla esperando 30 segundos una llamada que nunca va a timbrar.
    if (!(await this.hasMobileApp([input.residentUserId]))) {
      throw this.error(
        'El residente no tiene la app instalada; llámalo por la línea del celular',
        HttpStatus.CONFLICT,
        IntercomErrorCode.INTERCOM_RESIDENT_NO_APP,
      );
    }

    await this.assertNotBusy(currentUser.sub);
    await this.assertNotBusy(input.residentUserId);

    const call = await this.callRepo.save(
      this.callRepo.create({
        complexId: input.complexId,
        channel: CallChannel.INTERNET,
        voiceState: VoiceCallState.RINGING,
        direction: CallDirection.OUTGOING,
        // Provisional: si nadie contesta, así queda.
        outcome: CallOutcome.MISSED,
        phoneNumber: residentUser?.phoneNumber ?? '',
        agentUserId: currentUser.sub,
        agentName: await this.displayName(currentUser),
        residentId: resident.id,
        residentUserId: input.residentUserId,
        residentName: this.fullName(residentUser),
        unitId: resident.unitId,
        unitNumber: resident.unit?.number ?? null,
        buildingName: resident.unit?.building?.name ?? null,
        startedAt: new Date(),
        durationSeconds: 0,
      }),
    );

    const payload = this.incomingPayload(call, call.agentName);
    this.socketService.emitToUser(
      input.residentUserId,
      SocketEvent.INTERCOM_CALL_INCOMING,
      payload,
    );
    void this.notificationsService.sendCallPush(
      [input.residentUserId],
      { type: INTERCOM_PUSH.INCOMING, ...payload },
      RING_TIMEOUT_MS,
    );

    this.scheduleRingTimeout(call.id);
    this.logger.log(
      `Citofonía: portería ${currentUser.sub} → residente ${input.residentUserId} | llamada ${call.id}`,
    );

    return this.session(call, currentUser.sub);
  }

  /** El residente llama a portería (si el conjunto lo permite). */
  async startSecurityCall(
    input: StartSecurityIntercomCallInput,
    currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession> {
    const complex = await this.requireInternetComplex(input.complexId);
    if (!complex.residentIntercomCallsEnabled) {
      throw this.error(
        'Este conjunto no recibe llamadas a portería por la app',
        HttpStatus.FORBIDDEN,
        IntercomErrorCode.INTERCOM_RESIDENT_CALLS_DISABLED,
      );
    }

    const resident = await this.findActiveResident(
      currentUser.sub,
      input.complexId,
      input.unitId,
    );

    const securityIds = (
      await this.findSecurityUserIds(input.complexId)
    ).filter((id) => id !== currentUser.sub);
    if (securityIds.length === 0) {
      throw this.error(
        'La portería no tiene la app activa en este momento',
        HttpStatus.CONFLICT,
        IntercomErrorCode.INTERCOM_NO_SECURITY,
      );
    }

    await this.assertNotBusy(currentUser.sub);

    const residentUser = await this.userRepo.findOne({
      where: { id: currentUser.sub },
      select: ['id', 'name', 'lastName', 'phoneNumber'],
    });

    const call = await this.callRepo.save(
      this.callRepo.create({
        complexId: input.complexId,
        channel: CallChannel.INTERNET,
        voiceState: VoiceCallState.RINGING,
        direction: CallDirection.INCOMING,
        outcome: CallOutcome.MISSED,
        phoneNumber: residentUser?.phoneNumber ?? '',
        // Quién atiende se sabe al contestar.
        agentUserId: null,
        agentName: SECURITY_LABEL,
        residentId: resident.id,
        residentUserId: currentUser.sub,
        residentName: this.fullName(residentUser),
        unitId: resident.unitId,
        unitNumber: resident.unit?.number ?? null,
        buildingName: resident.unit?.building?.name ?? null,
        startedAt: new Date(),
        durationSeconds: 0,
      }),
    );

    const payload = this.incomingPayload(call, call.residentName ?? '');
    this.socketService.emitToRole(
      ValidRoles.SECURITY_ROL,
      input.complexId,
      SocketEvent.INTERCOM_CALL_INCOMING,
      payload,
    );
    void this.notificationsService.sendCallPush(
      securityIds,
      { type: INTERCOM_PUSH.INCOMING, ...payload },
      RING_TIMEOUT_MS,
    );

    this.scheduleRingTimeout(call.id);
    this.logger.log(
      `Citofonía: residente ${currentUser.sub} → portería ${input.complexId} | llamada ${call.id}`,
    );

    return this.session(call, currentUser.sub);
  }

  // ================================================================
  // CONTESTAR / RECHAZAR / COLGAR
  // ================================================================

  async answer(
    input: AnswerIntercomCallInput,
    currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession> {
    const call = await this.findCall(input.callId);
    if (!this.isCallee(call, currentUser)) throw this.callNotFound();

    const now = new Date();
    const patch: Partial<CallLog> = {
      voiceState: VoiceCallState.ACTIVE,
      outcome: CallOutcome.ANSWERED,
      answeredAt: now,
    };
    // Residente → portería: el vigilante que contesta queda como el agente.
    if (call.direction === CallDirection.INCOMING) {
      patch.agentUserId = currentUser.sub;
      patch.agentName = await this.displayName(currentUser);
    }

    const result = await this.callRepo.update(
      { id: call.id, voiceState: VoiceCallState.RINGING },
      patch,
    );
    if (!result.affected) {
      throw this.error(
        'La llamada ya no está disponible',
        HttpStatus.CONFLICT,
        IntercomErrorCode.INTERCOM_CALL_NOT_AVAILABLE,
      );
    }
    this.clearRingTimeout(call.id);

    const answered: CallLog = { ...call, ...patch };
    const data = {
      callId: call.id,
      answeredByUserId: currentUser.sub,
      deviceId: input.deviceId ?? '',
    };
    this.emitToParties(answered, SocketEvent.INTERCOM_CALL_ACCEPTED, data);
    // Los otros equipos que estaban sonando (otro celular de la misma cuenta u
    // otro vigilante) pueden tener la app cerrada: el socket no les llega.
    void this.notificationsService.sendCallPush(
      await this.calleeUserIds(call),
      { type: INTERCOM_PUSH.ANSWERED, ...data },
      RING_TIMEOUT_MS,
    );

    return this.session(answered, currentUser.sub);
  }

  async reject(
    callId: string,
    currentUser: JwtAccessPayload,
  ): Promise<CallLog> {
    const call = await this.findCall(callId);
    if (!this.isCallee(call, currentUser)) throw this.callNotFound();
    if (call.voiceState !== VoiceCallState.RINGING) return call;

    return this.finish(
      call,
      {
        outcome: CallOutcome.REJECTED,
        ...(call.direction === CallDirection.INCOMING && {
          agentUserId: currentUser.sub,
          agentName: await this.displayName(currentUser),
        }),
      },
      IntercomEndReason.REJECTED,
      currentUser.sub,
    );
  }

  async end(callId: string, currentUser: JwtAccessPayload): Promise<CallLog> {
    const call = await this.findCall(callId);
    const side = this.sideOf(call, currentUser);
    if (!side) throw this.callNotFound();

    if (call.voiceState === VoiceCallState.RINGING) {
      // Colgar mientras suena: si es quien llama, la canceló; si es quien
      // recibe, la rechazó.
      return this.isCaller(call, side)
        ? this.finish(
            call,
            { outcome: CallOutcome.MISSED },
            IntercomEndReason.CANCELLED,
            currentUser.sub,
          )
        : this.reject(callId, currentUser);
    }

    if (call.voiceState === VoiceCallState.ACTIVE) {
      return this.finish(
        call,
        { outcome: CallOutcome.ANSWERED },
        IntercomEndReason.HANGUP,
        currentUser.sub,
      );
    }

    return call;
  }

  // ================================================================
  // SEÑALIZACIÓN
  // ================================================================

  /** Pasa la oferta/respuesta/candidato a la otra parte de la llamada. */
  async relaySignal(
    input: IntercomSignalInput,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    const call = await this.findCall(input.callId);
    const side = this.sideOf(call, currentUser);
    if (!side || call.voiceState !== VoiceCallState.ACTIVE) {
      throw this.callNotFound();
    }

    const target = side === 'agent' ? call.residentUserId : call.agentUserId;
    if (!target) throw this.callNotFound();

    this.socketService.emitToUser(target, SocketEvent.INTERCOM_SIGNAL, {
      callId: call.id,
      kind: input.kind,
      payload: input.payload,
      fromUserId: currentUser.sub,
    });
    return true;
  }

  // ================================================================
  // CONSULTAS
  // ================================================================

  /**
   * La llamada en curso (sonando o hablando) de quien pregunta. La app la pide
   * al abrirse desde el push, porque el socket no estaba conectado cuando se
   * emitió el evento.
   */
  async currentCall(
    currentUser: JwtAccessPayload,
  ): Promise<IntercomCallSession | null> {
    const live = [VoiceCallState.RINGING, VoiceCallState.ACTIVE];
    const qb = this.callRepo
      .createQueryBuilder('cl')
      .where('cl.voiceState IN (:...live)', { live })
      .andWhere(
        currentUser.roles?.includes(ValidRoles.SECURITY_ROL) &&
          currentUser.complexId
          ? `(cl.residentUserId = :me OR cl.agentUserId = :me
              OR (cl.direction = :incoming AND cl.voiceState = :ringing
                  AND cl.agentUserId IS NULL AND cl.complexId = :complexId))`
          : '(cl.residentUserId = :me OR cl.agentUserId = :me)',
        {
          me: currentUser.sub,
          incoming: CallDirection.INCOMING,
          ringing: VoiceCallState.RINGING,
          complexId: currentUser.complexId,
        },
      )
      .orderBy('cl.startedAt', 'DESC');

    const call = await qb.getOne();
    return call ? this.session(call, currentUser.sub) : null;
  }

  /** Unidades que quedarían sin citofonía al pasar el conjunto a INTERNET. */
  async adoption(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<IntercomAdoption> {
    await this.complexService.assertComplexAccess(complexId, currentUser);

    const rows: Array<{
      unit_id: string;
      unit_number: string;
      building_name: string | null;
      residents: string;
      with_app: string;
    }> = await this.callRepo.manager.query(
      `SELECT u.id AS unit_id,
              u.number AS unit_number,
              b.name AS building_name,
              COUNT(DISTINCT r.user_id) AS residents,
              COUNT(DISTINCT r.user_id) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM push_subscriptions ps
                   WHERE ps.user_id::text = r.user_id::text
                     AND ps.is_active = true
                     AND ps.platform::text IN ('ANDROID', 'IOS'))
              ) AS with_app
         FROM residents r
         JOIN units u ON u.id = r.unit_id AND u.deleted_at IS NULL
         LEFT JOIN buildings b ON b.id = u."buildingId"
        WHERE r.complex_id = $1
          AND r.status = 'ACTIVE'
          AND r.deleted_at IS NULL
        GROUP BY u.id, u.number, b.name
        ORDER BY b.name NULLS FIRST, u.number`,
      [complexId],
    );

    const units: IntercomUnitAdoption[] = rows.map((row) => ({
      unitId: row.unit_id,
      unitNumber: row.unit_number,
      buildingName: row.building_name,
      residents: Number(row.residents),
      residentsWithApp: Number(row.with_app),
    }));

    const withoutApp = units.filter((u) => u.residentsWithApp === 0);
    return {
      totalUnits: units.length,
      unitsWithApp: units.length - withoutApp.length,
      unitsWithoutApp: withoutApp,
    };
  }

  // ================================================================
  // AJUSTES DEL CONJUNTO (SUPER_ADMIN)
  // ================================================================

  async updateSettings(
    input: UpdateIntercomSettingsInput,
    currentUser: JwtAccessPayload,
  ): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOne({
      where: { id: input.complexId, deletedAt: IsNull() },
    });
    if (!complex) {
      throw this.error(
        'Conjunto no encontrado',
        HttpStatus.NOT_FOUND,
        GeneralErrorCode.NOT_FOUND,
      );
    }

    const previous = {
      intercomMode: complex.intercomMode,
      residentIntercomCallsEnabled: complex.residentIntercomCallsEnabled,
    };
    const next = {
      intercomMode: input.mode,
      // Sin internet no hay llamadas por la app, en ninguna dirección.
      residentIntercomCallsEnabled:
        input.mode === IntercomMode.INTERNET && input.residentCallsEnabled,
    };

    await this.complexRepo.update({ id: complex.id }, next);
    Object.assign(complex, next);

    // Las apps leen el modo con `complex(id)`, que sale de esta caché.
    await this.cacheService.delete({ key: BK.complex.one(complex.id) });
    this.socketService.emitToComplex(
      complex.id,
      SocketEvent.INTERCOM_SETTINGS_UPDATED,
      { complexId: complex.id, ...next },
    );

    void this.auditService.log({
      entityType: AuditEntityType.ResidentialComplex,
      entityId: complex.id,
      action: AuditAction.UPDATE,
      previousValue: previous,
      newValue: next,
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: ValidRoles.SUPER_ADMIN_ROL,
      complexId: complex.id,
      description: `Citofonía: ${next.intercomMode}${next.residentIntercomCallsEnabled ? ' + residente→portería' : ''}`,
    });

    return complex;
  }

  // ================================================================
  // VENCIMIENTOS
  // ================================================================

  /**
   * Cierra lo que quedó abierto: llamadas que sonaron sin que el temporizador
   * las cerrara (reinicio, otra instancia) y llamadas "en curso" de horas que
   * nadie colgó (se cayó la app de los dos lados).
   */
  async sweepStaleCalls(now: Date = new Date()): Promise<number> {
    const stale = await this.callRepo.find({
      where: [
        {
          voiceState: VoiceCallState.RINGING,
          startedAt: LessThan(new Date(now.getTime() - STALE_RINGING_MS)),
        },
        {
          voiceState: VoiceCallState.ACTIVE,
          startedAt: LessThan(new Date(now.getTime() - STALE_ACTIVE_MS)),
        },
      ],
      take: 200,
    });

    for (const call of stale) {
      await this.finish(
        call,
        {
          outcome:
            call.voiceState === VoiceCallState.ACTIVE
              ? CallOutcome.ANSWERED
              : CallOutcome.MISSED,
        },
        call.voiceState === VoiceCallState.ACTIVE
          ? IntercomEndReason.LOST
          : IntercomEndReason.MISSED,
        null,
      );
    }
    return stale.length;
  }

  /** Lo llama el temporizador de cada llamada al cumplirse el timbre. */
  async expireIfRinging(callId: string): Promise<void> {
    this.ringTimers.delete(callId);
    const call = await this.callRepo.findOne({ where: { id: callId } });
    if (call?.voiceState !== VoiceCallState.RINGING) return;
    await this.finish(
      call,
      { outcome: CallOutcome.MISSED },
      IntercomEndReason.MISSED,
      null,
    );
  }

  // ================================================================
  // INTERNOS
  // ================================================================

  /**
   * Cierra la llamada solo si sigue en el estado en que se leyó: si otro
   * equipo la cerró primero, se devuelve como quedó y no se avisa dos veces.
   */
  private async finish(
    call: CallLog,
    patch: Partial<CallLog>,
    reason: IntercomEndReason,
    endedByUserId: string | null,
  ): Promise<CallLog> {
    const endedAt = new Date();
    const durationSeconds =
      call.voiceState === VoiceCallState.ACTIVE && call.answeredAt
        ? Math.max(
            0,
            Math.round(
              (endedAt.getTime() - new Date(call.answeredAt).getTime()) / 1000,
            ),
          )
        : 0;

    const update: Partial<CallLog> = {
      ...patch,
      voiceState: VoiceCallState.ENDED,
      endedAt,
      durationSeconds,
    };
    const result = await this.callRepo.update(
      { id: call.id, voiceState: call.voiceState ?? undefined },
      update,
    );
    this.clearRingTimeout(call.id);

    if (!result.affected) {
      return (await this.callRepo.findOne({ where: { id: call.id } })) ?? call;
    }

    const ended: CallLog = { ...call, ...update };
    const data = {
      callId: call.id,
      reason,
      outcome: ended.outcome,
      endedByUserId: endedByUserId ?? '',
      durationSeconds,
    };
    this.emitToParties(ended, SocketEvent.INTERCOM_CALL_ENDED, data);

    // Si estaba sonando, los equipos con la app cerrada siguen timbrando hasta
    // que algo les diga que paren.
    if (call.voiceState === VoiceCallState.RINGING) {
      void this.notificationsService.sendCallPush(
        await this.calleeUserIds(call),
        { type: INTERCOM_PUSH.ENDED, ...this.stringify(data) },
        RING_TIMEOUT_MS,
      );
    }

    // Como las de SIM: queda en la auditoría del vigilante. Una llamada a
    // portería que nadie tomó no tiene vigilante; queda en el historial.
    if (ended.agentUserId) {
      void this.auditService.log({
        entityType: AuditEntityType.CallLog,
        entityId: ended.id,
        action: this.auditAction(ended),
        newValue: {
          id: ended.id,
          channel: ended.channel,
          direction: ended.direction,
          outcome: ended.outcome,
          reason,
          durationSeconds,
        },
        performedById: ended.agentUserId,
        performedByName: ended.agentName,
        performedByRole: ValidRoles.SECURITY_ROL,
        complexId: ended.complexId,
        description: `Llamada por internet ${ended.direction} ${ended.outcome} (${reason}) | ${ended.residentName ?? ''} | ${durationSeconds}s`,
      });
    }

    return ended;
  }

  /** Avisa a las dos partes. En residente→portería, a toda la portería. */
  private emitToParties(call: CallLog, event: SocketEvent, data: unknown) {
    if (call.residentUserId) {
      this.socketService.emitToUser(call.residentUserId, event, data);
    }
    if (call.direction === CallDirection.INCOMING) {
      this.socketService.emitToRole(
        ValidRoles.SECURITY_ROL,
        call.complexId,
        event,
        data,
      );
    } else if (call.agentUserId) {
      this.socketService.emitToUser(call.agentUserId, event, data);
    }
  }

  /** Quienes tenían la llamada sonando. */
  private async calleeUserIds(call: CallLog): Promise<string[]> {
    if (call.direction === CallDirection.OUTGOING) {
      return call.residentUserId ? [call.residentUserId] : [];
    }
    return this.findSecurityUserIds(call.complexId);
  }

  private sideOf(call: CallLog, user: JwtAccessPayload): Side | null {
    if (call.residentUserId === user.sub) return 'resident';
    if (call.agentUserId === user.sub) return 'agent';
    // Residente → portería que nadie ha contestado: cualquier vigilante del
    // conjunto puede tomarla.
    if (
      call.direction === CallDirection.INCOMING &&
      call.voiceState === VoiceCallState.RINGING &&
      !call.agentUserId &&
      user.complexId === call.complexId &&
      user.roles?.includes(ValidRoles.SECURITY_ROL)
    ) {
      return 'agent';
    }
    return null;
  }

  private isCaller(call: CallLog, side: Side): boolean {
    return call.direction === CallDirection.OUTGOING
      ? side === 'agent'
      : side === 'resident';
  }

  private isCallee(call: CallLog, user: JwtAccessPayload): boolean {
    const side = this.sideOf(call, user);
    return !!side && !this.isCaller(call, side);
  }

  private async findCall(callId: string): Promise<CallLog> {
    const call = await this.callRepo.findOne({
      where: { id: callId, channel: CallChannel.INTERNET },
    });
    if (!call) throw this.callNotFound();
    return call;
  }

  private async requireInternetComplex(
    complexId: string,
  ): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId, deletedAt: IsNull() },
      select: ['id', 'intercomMode', 'residentIntercomCallsEnabled'],
    });
    if (!complex || complex.intercomMode !== IntercomMode.INTERNET) {
      throw this.error(
        'La citofonía de este conjunto es por la línea del celular',
        HttpStatus.CONFLICT,
        IntercomErrorCode.INTERCOM_NOT_INTERNET,
      );
    }
    return complex;
  }

  private async findActiveResident(
    userId: string,
    complexId: string,
    unitId?: string,
  ): Promise<Resident> {
    const resident = await this.residentRepo.findOne({
      where: {
        userId,
        complexId,
        status: ResidentStatus.ACTIVE,
        deletedAt: IsNull(),
        ...(unitId ? { unitId } : {}),
      },
      relations: ['unit', 'unit.building'],
    });
    if (!resident) {
      throw this.error(
        'El residente no está activo en este conjunto',
        HttpStatus.NOT_FOUND,
        IntercomErrorCode.INTERCOM_RESIDENT_NOT_FOUND,
      );
    }
    return resident;
  }

  /** Vigilantes del conjunto con la app de portería instalada. */
  private async findSecurityUserIds(complexId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.callRepo.manager.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_has_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.complex_id = $1
          AND u.deleted_at IS NULL
          AND r.name::text = $2
          AND r.status = true
          AND EXISTS (
            SELECT 1 FROM push_subscriptions ps
             WHERE ps.user_id::text = u.id::text
               AND ps.is_active = true
               AND ps.platform::text IN ('ANDROID', 'IOS'))`,
      [complexId, ValidRoles.SECURITY_ROL],
    );
    return rows.map((row) => String(row.id));
  }

  private async hasMobileApp(userIds: string[]): Promise<boolean> {
    const count = await this.pushSubRepo.count({
      where: {
        userId: In(userIds),
        platform: In(MOBILE_PLATFORMS),
        isActive: true,
      },
    });
    return count > 0;
  }

  private async assertNotBusy(userId: string): Promise<void> {
    const busy = await this.callRepo.count({
      where: [
        {
          residentUserId: userId,
          voiceState: In([VoiceCallState.RINGING, VoiceCallState.ACTIVE]),
        },
        {
          agentUserId: userId,
          voiceState: In([VoiceCallState.RINGING, VoiceCallState.ACTIVE]),
        },
      ],
    });
    if (busy > 0) {
      throw this.error(
        'Está en otra llamada',
        HttpStatus.CONFLICT,
        IntercomErrorCode.INTERCOM_BUSY,
      );
    }
  }

  private scheduleRingTimeout(callId: string): void {
    const timer = setTimeout(() => {
      this.expireIfRinging(callId).catch((err: Error) =>
        this.logger.warn(
          `No se pudo vencer la llamada ${callId}: ${err.message}`,
        ),
      );
    }, RING_TIMEOUT_MS);
    timer.unref?.();
    this.ringTimers.set(callId, timer);
  }

  private clearRingTimeout(callId: string): void {
    const timer = this.ringTimers.get(callId);
    if (timer) clearTimeout(timer);
    this.ringTimers.delete(callId);
  }

  private session(call: CallLog, userId: string): IntercomCallSession {
    return { call, iceServers: this.iceServers.forUser(userId) };
  }

  /** Lo que la pantalla de llamada entrante necesita. Todo string (FCM). */
  private incomingPayload(call: CallLog, callerName: string) {
    const unitLabel = [call.buildingName, call.unitNumber]
      .filter(Boolean)
      .join(' - ');
    return {
      callId: call.id,
      complexId: call.complexId,
      direction: call.direction,
      callerName,
      unitLabel,
      startedAt: call.startedAt.toISOString(),
      expiresAt: new Date(
        call.startedAt.getTime() + RING_TIMEOUT_MS,
      ).toISOString(),
    };
  }

  private stringify(
    data: Record<string, string | number | null | undefined>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value === null || value === undefined ? '' : String(value),
      ]),
    );
  }

  private async displayName(user: JwtAccessPayload): Promise<string> {
    const found = await this.userRepo.findOne({
      where: { id: user.sub },
      select: ['id', 'name', 'lastName'],
    });
    return this.fullName(found) || user.email;
  }

  private fullName(
    user: Pick<User, 'name' | 'lastName'> | null | undefined,
  ): string {
    return user ? `${user.name ?? ''} ${user.lastName ?? ''}`.trim() : '';
  }

  private auditAction(call: CallLog): AuditAction {
    if (call.outcome === CallOutcome.MISSED) return AuditAction.CALL_MISSED;
    if (call.outcome === CallOutcome.REJECTED) return AuditAction.CALL_REJECTED;
    return call.direction === CallDirection.INCOMING
      ? AuditAction.CALL_INCOMING
      : AuditAction.CALL_OUTGOING;
  }

  private callNotFound(): CustomError {
    return this.error(
      'Llamada no encontrada',
      HttpStatus.NOT_FOUND,
      IntercomErrorCode.INTERCOM_CALL_NOT_FOUND,
    );
  }

  private error(
    message: string,
    statusCode: HttpStatus,
    errorCode: string,
  ): CustomError {
    return new CustomError({ message, statusCode, errorCode });
  }
}
