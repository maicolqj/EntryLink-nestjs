import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';

import { VotingMeeting }  from '../entities/voting-meeting.entity';
import { VotingQuestion } from '../entities/voting-question.entity';
import { VotingOption }   from '../entities/voting-option.entity';
import { VotingBallot }   from '../entities/voting-ballot.entity';
import {
  VoteSecrecy, VoteWeighting, VotingAudience, VotingMeetingKind, VotingQuestionStatus,
} from '../enums/voting.enums';
import { VotingSettingsResponse } from '../dto/responses/voting-settings.response';
import {
  CreateVotingMeetingInput, CreateVotingQuestionInput, UpdateVotingQuestionInput,
} from '../dto/inputs/voting.inputs';
import { VotingResults }       from '../dto/responses/voting-results.response';
import { VotingCouncilMember } from '../dto/responses/voting-council-member.response';

import { CustomError }      from '../../shared/utils/errors.utils';
import { GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentialComplex }        from '../../residential-complex/entities/residential-complex.entity';
import { Unit }                      from '../../residential-complex/entities/unit.entity';
import { ComplexModule }             from '../../residential-complex/enums/complex-module.enum';
import { User }                      from '../../users/entities/user.entity';
import { ResidentsService }          from '../../residents/services/residents.service';
import { NotificationsService }      from '../../notifications/services/notifications.service';
import { NotificationType }          from '../../notifications/enums/notification-type.enum';
import { NotificationPriority }      from '../../notifications/enums/notification-priority.enum';
import { AuditService }              from '../../audit/services/audit.service';
import { AuditAction }               from '../../audit/enums/audit-action.enum';
import { AuditEntityType }           from '../../audit/enums/audit-entity-type.enum';
import { SocketService }             from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent }               from '../../../core/infrastructure/socket/socket.events';

/** Quienes administran las votaciones del complejo. */
const ADMIN_ROLES: ValidRoles[] = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];

/** Código de Postgres para una fila que viola un índice único. */
const UNIQUE_VIOLATION = '23505';

const isAdmin = (user: JwtAccessPayload): boolean =>
  (user.roles ?? []).some(role => ADMIN_ROLES.includes(role));

const fullName = (user?: User | null): string | null =>
  user ? `${user.name ?? ''} ${user.lastName ?? ''}`.trim() || null : null;

/** "Torre 2 · 301"; a la torre que se llama solo "2" se le antepone la palabra. */
const unitLabel = (unit?: Unit | null): string | null => {
  if (!unit) return null;
  const building = unit.building?.name?.trim();
  if (!building) return unit.number;
  const tower = /^\d+[a-z]?$/i.test(building) ? `Torre ${building}` : building;
  return `${tower} · ${unit.number}`;
};

const sum = (values: number[]): number => values.reduce((acc, value) => acc + value, 0);

/** Quién vota a efectos del conteo, y con qué peso. */
interface Voter {
  voterKey: string;
  unitId: string | null;
  residentId: string | null;
  weight: number;
}

/** Lo que el complejo tiene configurado sobre votaciones. */
interface VotingSettings {
  /** El SUPER_ADMIN le habilitó el módulo al complejo. */
  moduleEnabled: boolean;
  /** La administración les muestra las asambleas a los residentes. */
  switchOn: boolean;
  /** La administración le muestra al consejo sus reuniones. */
  councilSwitch: boolean;
  /** Consejeros con voz pero sin voto. */
  voiceOnly: string[];
}

@Injectable()
export class VotingService implements OnModuleInit {
  private readonly logger = new Logger(VotingService.name);

  constructor(
    @InjectRepository(VotingMeeting)
    private readonly meetingRepo: Repository<VotingMeeting>,
    @InjectRepository(VotingQuestion)
    private readonly questionRepo: Repository<VotingQuestion>,
    @InjectRepository(VotingOption)
    private readonly optionRepo: Repository<VotingOption>,
    @InjectRepository(VotingBallot)
    private readonly ballotRepo: Repository<VotingBallot>,
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    private readonly complexService: ResidentialComplexService,
    private readonly residentsService: ResidentsService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly socketService: SocketService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Cuando el SUPER_ADMIN cambia los módulos del complejo, la app de los
   * residentes se entera al instante: el menú de votaciones aparece o se va.
   */
  onModuleInit(): void {
    this.complexService.onModulesUpdated(complexId => {
      this.broadcastAvailability(complexId)
        .catch(err => this.logger.warn(`Error avisando la disponibilidad de votaciones: ${err?.message}`));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPONIBILIDAD DEL MÓDULO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ¿Quien consulta ve el módulo en la app? El residente, si están encendidas
   * las asambleas; el consejero, también si están encendidas las reuniones del
   * consejo. Siempre hace falta el módulo del SUPER_ADMIN.
   */
  async isEnabled(complexId: string, currentUser: JwtAccessPayload): Promise<boolean> {
    await this.complexService.findById(complexId, currentUser);
    return (await this.allowedKinds(complexId, currentUser)).length > 0;
  }

  /** Módulo e interruptores del complejo, para la pantalla de la administración. */
  async getSettings(complexId: string, currentUser: JwtAccessPayload): Promise<VotingSettingsResponse> {
    await this.complexService.findById(complexId, currentUser);
    const settings = await this.settingsOf(complexId);
    return {
      moduleEnabled:    settings.moduleEnabled,
      residentsEnabled: settings.switchOn,
      councilEnabled:   settings.councilSwitch,
    };
  }

  /**
   * Muestra —u oculta— las asambleas a los residentes o las reuniones del
   * consejo al consejo. Son independientes: votar algo solo en el consejo no
   * obliga a abrirle el módulo a toda la copropiedad. Llega al instante por
   * socket. Apagarlo no borra nada.
   */
  async setEnabled(
    complexId: string,
    audience: VotingAudience,
    enabled: boolean,
    currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    await this.complexService.findById(complexId, currentUser);
    await this.assertModule(complexId);

    const isCouncil = audience === VotingAudience.COUNCIL;
    await this.complexRepo.update(
      complexId,
      isCouncil ? { votingCouncilEnabled: enabled } : { votingEnabled: enabled },
    );

    this.broadcastAvailability(complexId)
      .catch(err => this.logger.warn(`Error avisando la disponibilidad de votaciones: ${err?.message}`));

    const what = isCouncil ? 'Reuniones del consejo' : 'Asambleas';
    this.audit(currentUser, complexId, AuditEntityType.VotingMeeting, complexId,
      `${what} ${enabled ? 'visibles' : 'ocultas'} en la app`,
      isCouncil ? { votingCouncilEnabled: enabled } : { votingEnabled: enabled });

    return enabled;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSULTAS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Todas las reuniones del complejo, con borradores. Solo la administración. */
  async findMeetings(complexId: string, currentUser: JwtAccessPayload): Promise<VotingMeeting[]> {
    await this.complexService.findById(complexId, currentUser);
    await this.assertModule(complexId);

    const meetings = await this.meetingRepo.find({
      where: { complexId },
      relations: ['questions', 'questions.options'],
      order: { scheduledAt: 'DESC' },
    });

    return meetings.map(meeting => this.sortMeeting(meeting));
  }

  /**
   * Lo que un residente puede votar o consultar: las asambleas y, si es del
   * consejo, sus reuniones. Nunca los borradores —una pregunta en preparación
   * no es de nadie todavía— ni una reunión que solo tenga borradores.
   */
  async findMyMeetings(complexId: string, currentUser: JwtAccessPayload): Promise<VotingMeeting[]> {
    await this.complexService.findById(complexId, currentUser);

    const kinds = await this.allowedKinds(complexId, currentUser);
    if (kinds.length === 0) {
      this.fail('Las votaciones no están habilitadas en tu conjunto', HttpStatus.FORBIDDEN, GeneralErrorCode.FORBIDDEN);
    }

    const meetings = await this.meetingRepo.find({
      where: { complexId, kind: In(kinds) },
      relations: ['questions', 'questions.options'],
      order: { scheduledAt: 'DESC' },
    });

    return meetings
      .map(meeting => this.sortMeeting(meeting))
      .map(meeting => {
        meeting.questions = (meeting.questions ?? [])
          .filter(question => question.status !== VotingQuestionStatus.DRAFT);
        return meeting;
      })
      .filter(meeting => meeting.questions!.length > 0);
  }

  /**
   * Una pregunta, con control de acceso: la administración ve todo; el
   * residente, lo publicado de su instancia y solo si el módulo está activo.
   */
  async findQuestion(questionId: string, currentUser: JwtAccessPayload): Promise<VotingQuestion> {
    const question = await this.findQuestionOrFail(questionId);
    await this.complexService.findById(question.complexId, currentUser);

    if (isAdmin(currentUser)) {
      await this.assertModule(question.complexId);
      return question;
    }

    if (question.status === VotingQuestionStatus.DRAFT) {
      this.fail('La votación no existe o todavía no se ha publicado', HttpStatus.NOT_FOUND, GeneralErrorCode.NOT_FOUND);
    }

    const kind = question.meeting?.kind ?? VotingMeetingKind.ASAMBLEA;

    if (kind === VotingMeetingKind.CONSEJO
      && !await this.residentsService.isCouncilUser(currentUser.sub)) {
      this.fail('Esta votación es del consejo de administración', HttpStatus.FORBIDDEN, GeneralErrorCode.FORBIDDEN);
    }

    // Cada tipo de reunión tiene su interruptor: con las asambleas apagadas, la
    // pregunta de una asamblea no se alcanza aunque las del consejo estén abiertas.
    if (!(await this.allowedKinds(question.complexId, currentUser)).includes(kind)) {
      this.fail('Las votaciones no están habilitadas en tu conjunto', HttpStatus.FORBIDDEN, GeneralErrorCode.FORBIDDEN);
    }

    return question;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REUNIONES Y PREGUNTAS (ADMINISTRACIÓN)
  // ═══════════════════════════════════════════════════════════════════════════

  async createMeeting(
    input: CreateVotingMeetingInput,
    currentUser: JwtAccessPayload,
  ): Promise<VotingMeeting> {
    await this.complexService.findById(input.complexId, currentUser);
    await this.assertModule(input.complexId);

    const saved = await this.meetingRepo.save(this.meetingRepo.create({
      complexId:       input.complexId,
      kind:            input.kind,
      title:           input.title.trim(),
      description:     input.description?.trim() || null,
      scheduledAt:     input.scheduledAt,
      createdByUserId: currentUser.entityType === 'user' ? currentUser.sub : null,
    }));

    this.audit(currentUser, saved.complexId, AuditEntityType.VotingMeeting, saved.id,
      `Reunión de votación creada: ${saved.title}`, { kind: saved.kind, title: saved.title });

    saved.questions = [];
    return saved;
  }

  /**
   * Solo se borra una reunión en la que nadie ha votado: con votos, es la
   * constancia de una decisión de la copropiedad.
   */
  async deleteMeeting(meetingId: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const meeting = await this.findMeetingForAdmin(meetingId, currentUser);

    if ((meeting.questions ?? []).some(question => question.status !== VotingQuestionStatus.DRAFT)) {
      this.fail(
        'Esta reunión ya tiene votaciones abiertas o cerradas y queda como constancia: no se puede eliminar',
        HttpStatus.CONFLICT,
        GeneralErrorCode.CONFLICT,
      );
    }

    await this.questionRepo.softDelete({ meetingId: meeting.id });
    await this.meetingRepo.softDelete(meeting.id);

    this.audit(currentUser, meeting.complexId, AuditEntityType.VotingMeeting, meeting.id,
      `Reunión de votación eliminada: ${meeting.title}`, { title: meeting.title });

    return true;
  }

  async createQuestion(
    input: CreateVotingQuestionInput,
    currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    const meeting = await this.findMeetingForAdmin(input.meetingId, currentUser);
    const options = this.cleanOptions(input.options);
    const weighting = this.weightingFor(meeting.kind, input.weighting);
    const position = (meeting.questions ?? []).length;

    const saved = await this.dataSource.transaction(async manager => {
      const question = await manager.save(manager.create(VotingQuestion, {
        meetingId:   meeting.id,
        complexId:   meeting.complexId,
        position,
        text:        input.text.trim(),
        description: input.description?.trim() || null,
        weighting,
        secrecy:     input.secrecy ?? VoteSecrecy.NOMINAL,
        status:      VotingQuestionStatus.DRAFT,
      }));

      await manager.save(options.map((text, index) =>
        manager.create(VotingOption, { questionId: question.id, position: index, text }),
      ));

      return question;
    });

    this.audit(currentUser, meeting.complexId, AuditEntityType.VotingQuestion, saved.id,
      `Pregunta creada en "${meeting.title}": ${saved.text}`, { text: saved.text, options });

    return this.findQuestionOrFail(saved.id);
  }

  /** Solo en borrador: abierta, cambiarla alteraría lo que alguien ya votó. */
  async updateQuestion(
    input: UpdateVotingQuestionInput,
    currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    const question = await this.findQuestionForAdmin(input.questionId, currentUser);
    this.assertDraft(question);

    const options = input.options ? this.cleanOptions(input.options) : null;

    if (input.text !== undefined)        question.text = input.text.trim();
    if (input.description !== undefined) question.description = input.description?.trim() || null;
    if (input.secrecy)                   question.secrecy = input.secrecy;
    if (input.weighting) {
      question.weighting = this.weightingFor(question.meeting!.kind, input.weighting);
    }

    await this.dataSource.transaction(async manager => {
      // Sin las opciones: si viajan con la entidad, TypeORM intenta
      // desvincularlas en vez de dejarlas a la transacción.
      const { options: _options, meeting: _meeting, ...row } = question;
      await manager.save(VotingQuestion, row);

      if (options) {
        await manager.delete(VotingOption, { questionId: question.id });
        await manager.save(options.map((text, index) =>
          manager.create(VotingOption, { questionId: question.id, position: index, text }),
        ));
      }
    });

    return this.findQuestionOrFail(question.id);
  }

  async deleteQuestion(questionId: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const question = await this.findQuestionForAdmin(questionId, currentUser);
    this.assertDraft(question);

    await this.questionRepo.softDelete(question.id);
    return true;
  }

  /**
   * Abre la pregunta a votos y avisa a quienes pueden votar.
   *
   * Por coeficiente no se abre si falta el coeficiente de alguna unidad: esa
   * unidad votaría con peso cero y el porcentaje del acta saldría mal sin que
   * nadie lo note. En el consejo, no se abre si ningún consejero tiene voto.
   */
  async openQuestion(questionId: string, currentUser: JwtAccessPayload): Promise<VotingQuestion> {
    const question = await this.findQuestionForAdmin(questionId, currentUser);
    this.assertDraft(question);

    if ((question.options ?? []).length < 2) {
      this.fail('La pregunta necesita al menos dos opciones de respuesta');
    }

    // Cada tipo de reunión exige su propio interruptor: sin él, nadie la ve.
    const settings = await this.settingsOf(question.complexId);
    const isCouncilMeeting = question.meeting?.kind === VotingMeetingKind.CONSEJO;

    if (isCouncilMeeting ? !settings.councilSwitch : !settings.switchOn) {
      this.fail(
        isCouncilMeeting
          ? 'Activa las reuniones del consejo antes de abrir una pregunta: si no, el consejo no la ve en la app'
          : 'Activa las asambleas para los residentes antes de abrir una pregunta: si no, nadie la ve en la app',
        HttpStatus.CONFLICT,
        GeneralErrorCode.CONFLICT,
      );
    }

    if (question.weighting === VoteWeighting.COEFFICIENT) {
      const missing = await this.unitRepo
        .createQueryBuilder('u')
        .where('u.complexId = :complexId', { complexId: question.complexId })
        .andWhere('u.deletedAt IS NULL')
        .andWhere('(u.coefficient IS NULL OR u.coefficient <= 0)')
        .getCount();

      if (missing > 0) {
        this.fail(
          `${missing} unidad(es) no tienen coeficiente de copropiedad cargado. Cárgalos o vota "una unidad, un voto".`,
          HttpStatus.CONFLICT,
          GeneralErrorCode.CONFLICT,
        );
      }
    }

    if (question.weighting === VoteWeighting.MEMBER
      && (await this.councilVoters(question.complexId)).length === 0) {
      this.fail(
        'Ningún consejero tiene voto. Configúralo en "Consejo: voz y voto".',
        HttpStatus.CONFLICT,
        GeneralErrorCode.CONFLICT,
      );
    }

    question.status   = VotingQuestionStatus.OPEN;
    question.openedAt = new Date();
    await this.saveQuestion(question);

    this.emitUpdated(question, true);
    this.notifyOpened(question)
      .catch(err => this.logger.warn(`Error al avisar la votación ${question.id}: ${err?.message}`));

    this.audit(currentUser, question.complexId, AuditEntityType.VotingQuestion, question.id,
      `Votación abierta: ${question.text}`, { status: question.status });

    return this.findQuestionOrFail(question.id);
  }

  /**
   * Cierra la pregunta. Es definitivo: el resultado va al acta. Aquí se congela
   * quiénes podían votar, para que la participación no cambie después.
   */
  async closeQuestion(questionId: string, currentUser: JwtAccessPayload): Promise<VotingQuestion> {
    const question = await this.findQuestionForAdmin(questionId, currentUser);

    if (question.status !== VotingQuestionStatus.OPEN) {
      this.fail('Solo se puede cerrar una votación abierta', HttpStatus.CONFLICT, GeneralErrorCode.CONFLICT);
    }

    const eligible = await this.computeEligible(question);

    question.status         = VotingQuestionStatus.CLOSED;
    question.closedAt       = new Date();
    question.eligibleCount  = eligible.count;
    question.eligibleWeight = eligible.weight;
    await this.saveQuestion(question);

    this.emitUpdated(question, true);

    this.audit(currentUser, question.complexId, AuditEntityType.VotingQuestion, question.id,
      `Votación cerrada: ${question.text}`, { status: question.status });

    return this.findQuestionOrFail(question.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSEJO: VOZ Y VOTO
  // ═══════════════════════════════════════════════════════════════════════════

  /** El consejo del complejo, marcando quién vota y quién solo tiene voz. */
  async findCouncilMembers(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<VotingCouncilMember[]> {
    await this.complexService.findById(complexId, currentUser);
    await this.assertModule(complexId);

    const [residents, settings] = await Promise.all([
      this.residentsService.findCouncilMembers(complexId),
      this.settingsOf(complexId),
    ]);

    return residents.map(resident => ({
      userId:    resident.userId,
      name:      fullName(resident.user) ?? resident.user?.email ?? 'Consejero',
      unitLabel: unitLabel(resident.unit),
      hasVote:   !settings.voiceOnly.includes(resident.userId),
    }));
  }

  /**
   * Quiénes del consejo tienen voz pero no voto. Aplica también a las
   * preguntas abiertas: quien pasa a "solo voz" ya no puede votar lo que falta,
   * aunque un voto que ya emitió queda.
   */
  async updateCouncilVoiceOnly(
    complexId: string,
    voiceOnlyUserIds: string[],
    currentUser: JwtAccessPayload,
  ): Promise<VotingCouncilMember[]> {
    await this.complexService.findById(complexId, currentUser);
    await this.assertModule(complexId);

    const members = await this.residentsService.findCouncilUserIds(complexId);
    const chosen = [...new Set(voiceOnlyUserIds)];

    if (chosen.some(userId => !members.includes(userId))) {
      this.fail('Solo puedes marcar a miembros actuales del consejo');
    }

    await this.complexRepo.update(complexId, { votingCouncilVoiceOnlyUserIds: chosen });

    this.audit(currentUser, complexId, AuditEntityType.VotingMeeting, complexId,
      chosen.length === 0
        ? 'Todo el consejo tiene voz y voto'
        : `${chosen.length} consejero(s) con voz pero sin voto`,
      { votingCouncilVoiceOnlyUserIds: chosen });

    return this.findCouncilMembers(complexId, currentUser);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VOTAR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra un voto. En asamblea vota la UNIDAD: el primer residente que vota
   * lo hace por todo el apartamento, y el índice único de la base rechaza el
   * segundo aunque lleguen en el mismo instante. El voto no se cambia.
   */
  async castVote(
    questionId: string,
    optionId: string,
    currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    const question = await this.findQuestion(questionId, currentUser);

    if (question.status !== VotingQuestionStatus.OPEN) {
      this.fail('Esta votación no está abierta', HttpStatus.CONFLICT, GeneralErrorCode.CONFLICT);
    }

    if (!(question.options ?? []).some(option => option.id === optionId)) {
      this.fail('Esa opción no pertenece a la pregunta');
    }

    const voter = await this.voterFor(question, currentUser);

    try {
      await this.ballotRepo.insert({
        questionId: question.id,
        optionId,
        complexId:  question.complexId,
        voterKey:   voter.voterKey,
        unitId:     voter.unitId,
        residentId: voter.residentId,
        userId:     currentUser.sub,
        weight:     voter.weight,
      });
    } catch (err: any) {
      if ((err?.code ?? err?.driverError?.code) === UNIQUE_VIOLATION) {
        this.fail(
          question.weighting === VoteWeighting.MEMBER
            ? 'Ya votaste en esta pregunta'
            : 'Tu unidad ya votó en esta pregunta. Solo se admite un voto por unidad.',
          HttpStatus.CONFLICT,
          GeneralErrorCode.CONFLICT,
        );
      }
      throw err;
    }

    this.emitUpdated(question);
    return question;
  }

  /**
   * El voto de quien consulta (el de su unidad, en asamblea) y si todavía puede
   * votar. Nunca lanza: si no le toca votar, simplemente no hay voto.
   */
  async viewerBallot(
    question: VotingQuestion,
    currentUser: JwtAccessPayload,
  ): Promise<{ eligible: boolean; optionId: string | null }> {
    const voterKey = await this.voterKeyOf(question, currentUser);
    if (!voterKey) return { eligible: false, optionId: null };

    const ballot = await this.ballotRepo.findOne({
      where: { questionId: question.id, voterKey },
      select: { id: true, optionId: true },
    });

    return { eligible: true, optionId: ballot?.optionId ?? null };
  }

  /**
   * ¿Es del consejo pero solo tiene voz? La app lo usa para explicar por qué
   * no le aparecen las opciones, en vez de dejarlo adivinando.
   */
  async isVoiceOnly(question: VotingQuestion, currentUser: JwtAccessPayload): Promise<boolean> {
    if (question.weighting !== VoteWeighting.MEMBER || currentUser.entityType !== 'user') return false;
    if (!await this.residentsService.isCouncilUser(currentUser.sub)) return false;

    return !(await this.councilVoters(question.complexId)).includes(currentUser.sub);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTADOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resultados respetando la reserva del voto.
   *
   * El residente los ve cuando la pregunta se cierra: verlos en vivo mientras
   * se vota empuja a votar por lo que va ganando. La administración los ve
   * siempre; en una pregunta nominal, además, qué votó cada unidad; en una
   * secreta, solo quiénes participaron.
   */
  async results(question: VotingQuestion, currentUser: JwtAccessPayload): Promise<VotingResults | null> {
    const admin = isAdmin(currentUser);
    if (!admin && question.status !== VotingQuestionStatus.CLOSED) return null;

    const ballots = await this.ballotRepo.find({
      where: { questionId: question.id },
      relations: admin ? ['unit', 'unit.building', 'user'] : [],
      order: { createdAt: 'ASC' },
    });

    const eligible = question.status === VotingQuestionStatus.CLOSED && question.eligibleCount != null
      ? { count: question.eligibleCount, weight: Number(question.eligibleWeight ?? 0) }
      : await this.computeEligible(question);

    const votedWeight = sum(ballots.map(ballot => Number(ballot.weight)));
    const options = [...(question.options ?? [])].sort((a, b) => a.position - b.position);
    const optionText = new Map(options.map(option => [option.id, option.text]));

    const labelOf = (ballot: VotingBallot): string =>
      unitLabel(ballot.unit) ?? fullName(ballot.user) ?? 'Votante';

    return {
      weighting:      question.weighting,
      eligibleCount:  eligible.count,
      eligibleWeight: eligible.weight,
      votedCount:     ballots.length,
      votedWeight,
      participation:  eligible.weight > 0 ? votedWeight / eligible.weight : 0,
      options: options.map(option => {
        const chosen = ballots.filter(ballot => ballot.optionId === option.id);
        const weight = sum(chosen.map(ballot => Number(ballot.weight)));
        return {
          optionId: option.id,
          text:     option.text,
          votes:    chosen.length,
          weight,
          share:           votedWeight > 0 ? weight / votedWeight : 0,
          shareOfEligible: eligible.weight > 0 ? weight / eligible.weight : 0,
        };
      }),
      ballots: admin && question.secrecy === VoteSecrecy.NOMINAL
        ? ballots.map(ballot => ({
            voterLabel: labelOf(ballot),
            voterName:  fullName(ballot.user),
            optionText: optionText.get(ballot.optionId) ?? '—',
            weight:     Number(ballot.weight),
            votedAt:    ballot.createdAt,
          }))
        : null,
      participants: admin && question.secrecy === VoteSecrecy.SECRET
        ? ballots.map(labelOf).sort((a, b) => a.localeCompare(b, 'es'))
        : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configuración de votaciones del complejo. `enabledModules` vacío o nulo
   * significa "todos los módulos", la misma regla del resto de la plataforma.
   */
  private async settingsOf(complexId: string): Promise<VotingSettings> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
      select: {
        id: true,
        votingEnabled: true,
        votingCouncilEnabled: true,
        enabledModules: true,
        votingCouncilVoiceOnlyUserIds: true,
      },
    });

    const modules = complex?.enabledModules;
    return {
      moduleEnabled: !modules || modules.length === 0 || modules.includes(ComplexModule.VOTACIONES),
      switchOn:      !!complex?.votingEnabled,
      councilSwitch: !!complex?.votingCouncilEnabled,
      voiceOnly:     complex?.votingCouncilVoiceOnlyUserIds ?? [],
    };
  }

  /**
   * Qué reuniones puede ver quien consulta: las asambleas si están encendidas
   * para los residentes, y las del consejo si es consejero y están encendidas
   * para el consejo. Vacío = el módulo no existe para esta persona.
   */
  private async allowedKinds(complexId: string, currentUser: JwtAccessPayload): Promise<VotingMeetingKind[]> {
    const settings = await this.settingsOf(complexId);
    if (!settings.moduleEnabled) return [];

    const kinds: VotingMeetingKind[] = [];
    if (settings.switchOn) kinds.push(VotingMeetingKind.ASAMBLEA);

    if (settings.councilSwitch
      && currentUser.entityType === 'user'
      && await this.residentsService.isCouncilUser(currentUser.sub)) {
      kinds.push(VotingMeetingKind.CONSEJO);
    }

    return kinds;
  }

  /** El SUPER_ADMIN no le habilitó el módulo al complejo: nadie lo usa. */
  private async assertModule(complexId: string): Promise<void> {
    if (!(await this.settingsOf(complexId)).moduleEnabled) {
      this.fail(
        'El módulo de votaciones no está habilitado para este complejo',
        HttpStatus.FORBIDDEN,
        GeneralErrorCode.FORBIDDEN,
      );
    }
  }

  /**
   * Avisa a la app que cambió qué se puede votar. Lleva los tres interruptores,
   * pero la app no decide con ellos: qué ve cada quien depende de si es del
   * consejo, así que vuelve a preguntar `votingEnabled` y el servidor responde
   * por persona.
   *
   * Va a la sala del complejo y además a cada residente por su canal propio:
   * no todos los tokens de residente traen el complejo, y sin eso no estarían
   * en esa sala. El evento es raro —se enciende una vez por reunión—, así que
   * el reparto no pesa.
   */
  private async broadcastAvailability(complexId: string): Promise<void> {
    const settings = await this.settingsOf(complexId);
    const payload = {
      complexId,
      moduleEnabled:    settings.moduleEnabled,
      residentsEnabled: settings.switchOn,
      councilEnabled:   settings.councilSwitch,
    };

    this.socketService.emitToComplex(complexId, SocketEvent.VOTING_AVAILABILITY, payload);

    const [residents, council] = await Promise.all([
      this.residentsService.findActiveUserIdsByComplexInternal(complexId),
      this.residentsService.findCouncilUserIds(complexId),
    ]);
    this.socketService.emitToUsers(
      [...new Set([...residents, ...council])], SocketEvent.VOTING_AVAILABILITY, payload,
    );
  }

  /** Consejeros que votan: todo el consejo menos quienes solo tienen voz. */
  private async councilVoters(complexId: string): Promise<string[]> {
    const [members, settings] = await Promise.all([
      this.residentsService.findCouncilUserIds(complexId),
      this.settingsOf(complexId),
    ]);
    return members.filter(userId => !settings.voiceOnly.includes(userId));
  }

  /**
   * Quién vota y con qué peso. En asamblea, la unidad del residente con su
   * coeficiente (o 1); en el consejo, el consejero con voto, con 1.
   */
  private async voterFor(question: VotingQuestion, currentUser: JwtAccessPayload): Promise<Voter> {
    if (question.weighting === VoteWeighting.MEMBER) {
      if (!await this.residentsService.isCouncilUser(currentUser.sub)) {
        this.fail('Solo los miembros del consejo votan en sus reuniones', HttpStatus.FORBIDDEN, GeneralErrorCode.FORBIDDEN);
      }
      if (!(await this.councilVoters(question.complexId)).includes(currentUser.sub)) {
        this.fail('En el consejo tienes voz pero no voto', HttpStatus.FORBIDDEN, GeneralErrorCode.FORBIDDEN);
      }
      return { voterKey: `user:${currentUser.sub}`, unitId: null, residentId: null, weight: 1 };
    }

    const resident = await this.residentsService
      .findActiveResidentByUserIdInternal(currentUser.sub, question.complexId);

    if (!resident?.unitId) {
      this.fail('Para votar tienes que ser residente activo de una unidad', HttpStatus.FORBIDDEN, GeneralErrorCode.FORBIDDEN);
    }

    const weight = question.weighting === VoteWeighting.COEFFICIENT
      ? Number(resident!.unit?.coefficient ?? 0)
      : 1;

    if (weight <= 0) {
      this.fail('Tu unidad no tiene coeficiente de copropiedad cargado. Avísale a la administración.');
    }

    return {
      voterKey:   `unit:${resident!.unitId}`,
      unitId:     resident!.unitId,
      residentId: resident!.id,
      weight,
    };
  }

  /** Como `voterFor`, sin lanzar: null si a esta persona no le toca votar. */
  private async voterKeyOf(question: VotingQuestion, currentUser: JwtAccessPayload): Promise<string | null> {
    if (currentUser.entityType !== 'user') return null;

    if (question.weighting === VoteWeighting.MEMBER) {
      return (await this.councilVoters(question.complexId)).includes(currentUser.sub)
        ? `user:${currentUser.sub}`
        : null;
    }

    const resident = await this.residentsService
      .findActiveResidentByUserIdInternal(currentUser.sub, question.complexId);
    return resident?.unitId ? `unit:${resident.unitId}` : null;
  }

  /**
   * Quiénes pueden votar: todas las unidades del complejo (vivan o no
   * residentes en ellas: el derecho es del propietario) o los consejeros con
   * voto.
   */
  private async computeEligible(question: VotingQuestion): Promise<{ count: number; weight: number }> {
    if (question.weighting === VoteWeighting.MEMBER) {
      const voters = await this.councilVoters(question.complexId);
      return { count: voters.length, weight: voters.length };
    }

    const units = await this.unitRepo.find({
      where: { complexId: question.complexId, deletedAt: IsNull() },
      select: { id: true, coefficient: true },
    });

    return {
      count: units.length,
      weight: question.weighting === VoteWeighting.COEFFICIENT
        ? sum(units.map(unit => Number(unit.coefficient ?? 0)))
        : units.length,
    };
  }

  /** En el consejo vota cada miembro; en asamblea, por coeficiente salvo que pidan lo contrario. */
  private weightingFor(kind: VotingMeetingKind, requested?: VoteWeighting | null): VoteWeighting {
    if (kind === VotingMeetingKind.CONSEJO) return VoteWeighting.MEMBER;

    if (requested === VoteWeighting.MEMBER) {
      this.fail('En una asamblea el voto es por coeficiente o por unidad, no por consejero');
    }
    return requested ?? VoteWeighting.COEFFICIENT;
  }

  /** Sin vacías ni repetidas: dos "Sí" partirían los votos de la misma respuesta. */
  private cleanOptions(options: string[]): string[] {
    const seen = new Set<string>();
    const clean: string[] = [];

    for (const raw of options) {
      const text = raw.trim();
      const key = text.toLocaleLowerCase('es');
      if (!text || seen.has(key)) continue;
      seen.add(key);
      clean.push(text);
    }

    if (clean.length < 2) this.fail('La pregunta necesita al menos dos opciones distintas');
    return clean;
  }

  private assertDraft(question: VotingQuestion): void {
    if (question.status !== VotingQuestionStatus.DRAFT) {
      this.fail(
        'La votación ya se abrió: no se puede modificar ni eliminar',
        HttpStatus.CONFLICT,
        GeneralErrorCode.CONFLICT,
      );
    }
  }

  private async findMeetingForAdmin(meetingId: string, currentUser: JwtAccessPayload): Promise<VotingMeeting> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
      relations: ['questions'],
    });

    if (!meeting) {
      this.fail('La reunión no existe o fue eliminada', HttpStatus.NOT_FOUND, GeneralErrorCode.NOT_FOUND);
    }

    await this.complexService.findById(meeting!.complexId, currentUser);
    await this.assertModule(meeting!.complexId);
    return meeting!;
  }

  private async findQuestionForAdmin(questionId: string, currentUser: JwtAccessPayload): Promise<VotingQuestion> {
    const question = await this.findQuestionOrFail(questionId);
    await this.complexService.findById(question.complexId, currentUser);
    await this.assertModule(question.complexId);
    return question;
  }

  async findQuestionOrFail(questionId: string): Promise<VotingQuestion> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId },
      relations: ['meeting', 'options'],
    });

    if (!question) {
      this.fail('La votación no existe o fue eliminada', HttpStatus.NOT_FOUND, GeneralErrorCode.NOT_FOUND);
    }

    question!.options = [...(question!.options ?? [])].sort((a, b) => a.position - b.position);
    return question!;
  }

  /** Guarda solo las columnas de la pregunta, sin arrastrar opciones ni reunión. */
  private async saveQuestion(question: VotingQuestion): Promise<void> {
    const { options: _options, meeting: _meeting, ...row } = question;
    await this.questionRepo.save(row);
  }

  private sortMeeting(meeting: VotingMeeting): VotingMeeting {
    meeting.questions = (meeting.questions ?? [])
      .filter(question => !question.deletedAt)
      .sort((a, b) => a.position - b.position)
      .map(question => {
        question.options = [...(question.options ?? [])].sort((a, b) => a.position - b.position);
        return question;
      });
    return meeting;
  }

  /**
   * Cada voto y cada cambio de estado viaja a la sala del complejo, donde
   * escucha la administración: las gráficas de la web se repintan solas.
   *
   * Abrir y cerrar además llega a quienes votan, para que la app muestre la
   * pregunta —o sus resultados— sin recargar. Los votos sueltos no: en plena
   * asamblea serían cientos de avisos a cada teléfono.
   */
  private emitUpdated(question: VotingQuestion, toVoters = false): void {
    const payload = {
      questionId: question.id,
      meetingId:  question.meetingId,
      complexId:  question.complexId,
      status:     question.status,
      // La app solo recarga con 'status'; con cada 'vote' repinta la web.
      change:     toVoters ? 'status' : 'vote',
    };

    this.socketService.emitToComplex(question.complexId, SocketEvent.VOTING_UPDATED, payload);

    if (toVoters) {
      this.audienceOf(question)
        .then(userIds => this.socketService.emitToUsers(userIds, SocketEvent.VOTING_UPDATED, payload))
        .catch(err => this.logger.warn(`Error avisando el cambio de ${question.id}: ${err?.message}`));
    }
  }

  /**
   * A quién le concierne la pregunta: toda la copropiedad o el consejo entero
   * (también quien solo tiene voz: asiste a la reunión aunque no vote).
   */
  private async audienceOf(question: VotingQuestion): Promise<string[]> {
    const userIds = question.meeting?.kind === VotingMeetingKind.CONSEJO
      ? await this.residentsService.findCouncilUserIds(question.complexId)
      : await this.residentsService.findActiveUserIdsByComplexInternal(question.complexId);
    return [...new Set(userIds)];
  }

  private async notifyOpened(question: VotingQuestion): Promise<void> {
    const meeting = question.meeting;
    const recipients = await this.audienceOf(question);
    if (recipients.length === 0) return;

    await this.notificationsService.notify({
      complexId: question.complexId,
      userIds: recipients,
      type: NotificationType.VOTING_OPENED,
      priority: NotificationPriority.HIGH,
      title: `🗳️ Votación abierta${meeting ? `: ${meeting.title}` : ''}`,
      body: question.text,
      entityId: question.id,
      entityType: 'voting',
      isActionable: true,
      metadata: { questionId: question.id, meetingId: question.meetingId },
    });
  }

  private audit(
    currentUser: JwtAccessPayload,
    complexId: string,
    entityType: AuditEntityType,
    entityId: string,
    description: string,
    newValue: Record<string, unknown>,
  ): void {
    void this.auditService.log({
      entityType,
      entityId,
      action: AuditAction.UPDATE,
      newValue,
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId,
      description,
    });
  }

  private fail(
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    errorCode: GeneralErrorCode = GeneralErrorCode.BAD_REQUEST,
  ): never {
    throw new CustomError({ message, statusCode, errorCode });
  }
}
