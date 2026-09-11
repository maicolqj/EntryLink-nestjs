import { VotingService } from './voting.service';
import { VotingQuestion } from '../entities/voting-question.entity';
import {
  VoteSecrecy, VoteWeighting, VotingAudience, VotingMeetingKind, VotingQuestionStatus,
} from '../enums/voting.enums';

import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Las reglas que sostienen el módulo: un voto por unidad, el peso correcto, el
 * consejo solo para consejeros y la reserva del voto en los resultados.
 */

const userOf = (roles: ValidRoles[], sub = 'user-1'): JwtAccessPayload => ({
  sub, email: 'quien@test.com', type: 'access', entityType: 'user',
  tokenVersion: 1, sessionId: 's1', roles, permissions: [], complexId: 'complex-1',
} as JwtAccessPayload);

const resident = (sub = 'res-user') => userOf([ValidRoles.RESIDENT_ROL], sub);
const admin = () => userOf([ValidRoles.COMPLEX_ROL], 'complex-1');

const questionOf = (partial: Partial<VotingQuestion> = {}): VotingQuestion => ({
  id: 'q-1',
  meetingId: 'm-1',
  complexId: 'complex-1',
  position: 0,
  text: '¿Aprueba el presupuesto 2027?',
  weighting: VoteWeighting.COEFFICIENT,
  secrecy: VoteSecrecy.NOMINAL,
  status: VotingQuestionStatus.OPEN,
  meeting: { id: 'm-1', kind: VotingMeetingKind.ASAMBLEA, title: 'Asamblea ordinaria' },
  options: [
    { id: 'opt-si', questionId: 'q-1', position: 0, text: 'Sí' },
    { id: 'opt-no', questionId: 'q-1', position: 1, text: 'No' },
  ],
  ...partial,
} as VotingQuestion);

interface BuildOpts {
  /** Asambleas visibles para los residentes. */
  enabled?: boolean;
  /** Reuniones del consejo visibles para el consejo. */
  councilEnabled?: boolean;
  isCouncil?: boolean;
  councilIds?: string[];
  /** Residente activo de quien vota; null = no es residente. */
  resident?: { id: string; unitId: string; unit: { coefficient: number | null } } | null;
  ballots?: { optionId: string; weight: number; voterKey?: string }[];
  units?: { id: string; coefficient: number | null }[];
  insertError?: unknown;
  /** Módulos habilitados por el SUPER_ADMIN; null = todos. */
  modules?: string[] | null;
  /** Consejeros con voz pero sin voto. */
  voiceOnly?: string[];
}

const build = (question: VotingQuestion | null, opts: BuildOpts = {}) => {
  const inserted: Record<string, unknown>[] = [];
  const saved: Record<string, unknown>[] = [];

  const questionRepo = {
    findOne: jest.fn().mockResolvedValue(question),
    save: jest.fn(async (row: Record<string, unknown>) => { saved.push(row); return row; }),
    softDelete: jest.fn(),
  };

  const ballotRepo = {
    insert: jest.fn(async (row: Record<string, unknown>) => {
      if (opts.insertError) throw opts.insertError;
      inserted.push(row);
    }),
    find: jest.fn().mockResolvedValue(opts.ballots ?? []),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const missingQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(
      (opts.units ?? []).filter(u => !u.coefficient).length,
    ),
  };

  const unitRepo = {
    find: jest.fn().mockResolvedValue(opts.units ?? []),
    createQueryBuilder: jest.fn(() => missingQb),
  };

  const notify = jest.fn().mockResolvedValue(undefined);
  const socket = { emitToComplex: jest.fn(), emitToUser: jest.fn(), emitToUsers: jest.fn() };
  const meetingRepo = { find: jest.fn().mockResolvedValue([]) };

  const service = new VotingService(
    meetingRepo as never,
    questionRepo as never,
    {} as never,
    ballotRepo as never,
    unitRepo as never,
    {
      findOne: jest.fn().mockResolvedValue({
        votingEnabled: opts.enabled ?? true,
        votingCouncilEnabled: opts.councilEnabled ?? false,
        enabledModules: opts.modules ?? null,
        votingCouncilVoiceOnlyUserIds: opts.voiceOnly ?? [],
      }),
      update: jest.fn(),
    } as never,
    { findById: jest.fn().mockResolvedValue({ id: 'complex-1' }) } as never,
    {
      isCouncilUser: jest.fn().mockResolvedValue(opts.isCouncil ?? false),
      findCouncilUserIds: jest.fn().mockResolvedValue(opts.councilIds ?? []),
      findActiveUserIdsByComplexInternal: jest.fn().mockResolvedValue(['res-user']),
      findActiveResidentByUserIdInternal: jest.fn().mockResolvedValue(
        opts.resident === undefined
          ? { id: 'resident-1', unitId: 'unit-301', unit: { coefficient: 0.0125 } }
          : opts.resident,
      ),
    } as never,
    { notify } as never,
    { log: jest.fn() } as never,
    socket as never,
    { transaction: jest.fn() } as never,
  );

  return { service, inserted, saved, notify, ballotRepo, socket, meetingRepo };
};

describe('VotingService — votar', () => {

  it('en asamblea vota la unidad, con el coeficiente como peso', async () => {
    const { service, inserted } = build(questionOf());

    await service.castVote('q-1', 'opt-si', resident());

    expect(inserted[0]).toMatchObject({ voterKey: 'unit:unit-301', weight: 0.0125, optionId: 'opt-si' });
  });

  it('una unidad, un voto: con peso 1 aunque tenga coeficiente', async () => {
    const { service, inserted } = build(questionOf({ weighting: VoteWeighting.UNIT }));

    await service.castVote('q-1', 'opt-no', resident());

    expect(inserted[0]).toMatchObject({ voterKey: 'unit:unit-301', weight: 1 });
  });

  it('el segundo residente de la misma unidad no puede votar', async () => {
    // Lo rechaza el índice único de la base: así no hay carrera posible.
    const { service } = build(questionOf(), { insertError: { code: '23505' } });

    await expect(service.castVote('q-1', 'opt-si', resident('otro-de-la-unidad')))
      .rejects.toThrow('Tu unidad ya votó en esta pregunta');
  });

  it('no se vota en una pregunta cerrada', async () => {
    const { service } = build(questionOf({ status: VotingQuestionStatus.CLOSED }));

    await expect(service.castVote('q-1', 'opt-si', resident()))
      .rejects.toThrow('Esta votación no está abierta');
  });

  it('una opción de otra pregunta no vale', async () => {
    const { service } = build(questionOf());

    await expect(service.castVote('q-1', 'opt-ajena', resident()))
      .rejects.toThrow('Esa opción no pertenece a la pregunta');
  });

  it('sin el módulo habilitado, el residente no vota', async () => {
    const { service } = build(questionOf(), { enabled: false });

    await expect(service.castVote('q-1', 'opt-si', resident()))
      .rejects.toThrow('Las votaciones no están habilitadas en tu conjunto');
  });

  it('si el SUPER_ADMIN no habilitó el módulo, tampoco se vota aunque el interruptor esté encendido', async () => {
    const { service } = build(questionOf(), { enabled: true, modules: ['PQRF', 'FINANZAS'] });

    await expect(service.castVote('q-1', 'opt-si', resident()))
      .rejects.toThrow('Las votaciones no están habilitadas en tu conjunto');
  });

  it('el consejero con voz pero sin voto no vota', async () => {
    const consejo = questionOf({
      weighting: VoteWeighting.MEMBER,
      meeting: { id: 'm-1', kind: VotingMeetingKind.CONSEJO, title: 'Consejo' } as never,
    });
    const { service } = build(consejo, {
      isCouncil: true, councilIds: ['c-1', 'c-2'], voiceOnly: ['c-2'], councilEnabled: true,
    });

    await expect(service.castVote('q-1', 'opt-si', resident('c-2')))
      .rejects.toThrow('En el consejo tienes voz pero no voto');
    await expect(service.isVoiceOnly(consejo, resident('c-2'))).resolves.toBe(true);
    await expect(service.viewerBallot(consejo, resident('c-2'))).resolves.toEqual({ eligible: false, optionId: null });
  });

  it('en el consejo solo votan consejeros, uno por persona', async () => {
    const consejo = questionOf({
      weighting: VoteWeighting.MEMBER,
      meeting: { id: 'm-1', kind: VotingMeetingKind.CONSEJO, title: 'Consejo' } as never,
    });

    const { service: noCouncil } = build(consejo, { isCouncil: false });
    await expect(noCouncil.castVote('q-1', 'opt-si', resident()))
      .rejects.toThrow('Esta votación es del consejo de administración');

    const { service, inserted } = build(consejo, { isCouncil: true, councilIds: ['consejero-1'], councilEnabled: true });
    await service.castVote('q-1', 'opt-si', resident('consejero-1'));
    expect(inserted[0]).toMatchObject({ voterKey: 'user:consejero-1', weight: 1, unitId: null });
  });
});

describe('VotingService — abrir', () => {

  it('por coeficiente no abre si a alguna unidad le falta el coeficiente', async () => {
    const { service } = build(questionOf({ status: VotingQuestionStatus.DRAFT }), {
      units: [{ id: 'u1', coefficient: 0.5 }, { id: 'u2', coefficient: null }],
    });

    await expect(service.openQuestion('q-1', admin()))
      .rejects.toThrow('1 unidad(es) no tienen coeficiente');
  });

  it('no abre si los residentes no pueden ver el módulo', async () => {
    const { service } = build(questionOf({ status: VotingQuestionStatus.DRAFT }), { enabled: false });

    await expect(service.openQuestion('q-1', admin()))
      .rejects.toThrow('Activa las asambleas para los residentes');
  });

  it('una pregunta del consejo exige el interruptor del consejo, no el de residentes', async () => {
    const consejo = {
      status: VotingQuestionStatus.DRAFT,
      weighting: VoteWeighting.MEMBER,
      meeting: { id: 'm-1', kind: VotingMeetingKind.CONSEJO, title: 'Consejo' } as never,
    };

    const { service: off } = build(questionOf(consejo), { enabled: true, councilEnabled: false, councilIds: ['c-1'] });
    await expect(off.openQuestion('q-1', admin()))
      .rejects.toThrow('Activa las reuniones del consejo');

    // Solo el consejo encendido basta: los residentes no tienen que ver nada.
    const { service: on } = build(questionOf(consejo), { enabled: false, councilEnabled: true, councilIds: ['c-1'] });
    await expect(on.openQuestion('q-1', admin())).resolves.toBeDefined();
  });

  it('la administración no gestiona votaciones si el módulo no está habilitado', async () => {
    const { service } = build(questionOf({ status: VotingQuestionStatus.DRAFT }), { modules: ['PQRF'] });

    await expect(service.openQuestion('q-1', admin()))
      .rejects.toThrow('El módulo de votaciones no está habilitado para este complejo');
  });

  it('no abre una pregunta del consejo si nadie del consejo tiene voto', async () => {
    const { service } = build(questionOf({
      status: VotingQuestionStatus.DRAFT,
      weighting: VoteWeighting.MEMBER,
      meeting: { id: 'm-1', kind: VotingMeetingKind.CONSEJO, title: 'Consejo' } as never,
    }), { councilIds: ['c-1'], voiceOnly: ['c-1'], councilEnabled: true });

    await expect(service.openQuestion('q-1', admin()))
      .rejects.toThrow('Ningún consejero tiene voto');
  });

  it('en el consejo solo cuentan como habilitados quienes tienen voto', async () => {
    const { service } = build(null, { councilIds: ['c-1', 'c-2', 'c-3'], voiceOnly: ['c-3'] });

    const results = await service.results(questionOf({
      weighting: VoteWeighting.MEMBER,
      meeting: { id: 'm-1', kind: VotingMeetingKind.CONSEJO, title: 'Consejo' } as never,
    }), admin());

    expect(results!.eligibleCount).toBe(2);
  });

  it('abrir le avisa a la app de los residentes en tiempo real', async () => {
    const { service, socket } = build(
      questionOf({ status: VotingQuestionStatus.DRAFT, weighting: VoteWeighting.UNIT }),
    );

    await service.openQuestion('q-1', admin());
    await new Promise(resolve => setImmediate(resolve));

    expect(socket.emitToUsers).toHaveBeenCalledWith(
      ['res-user'], 'voting:updated', expect.objectContaining({ status: VotingQuestionStatus.OPEN }),
    );
  });

  it('encender el módulo le llega a los residentes al instante', async () => {
    const { service, socket } = build(null, { enabled: true });

    await service.setEnabled('complex-1', VotingAudience.RESIDENTS, true, admin());
    await new Promise(resolve => setImmediate(resolve));

    expect(socket.emitToUsers).toHaveBeenCalledWith(
      ['res-user'], 'voting:availability', expect.objectContaining({ complexId: 'complex-1', residentsEnabled: true }),
    );
  });

  describe('interruptores separados', () => {

    it('con solo el consejo encendido, un residente que no es del consejo no ve el módulo', async () => {
      const { service } = build(null, { enabled: false, councilEnabled: true, isCouncil: false });

      await expect(service.isEnabled('complex-1', resident())).resolves.toBe(false);
      await expect(service.findMyMeetings('complex-1', resident()))
        .rejects.toThrow('Las votaciones no están habilitadas en tu conjunto');
    });

    it('con solo el consejo encendido, el consejero ve únicamente las reuniones del consejo', async () => {
      const { service, meetingRepo } = build(null, { enabled: false, councilEnabled: true, isCouncil: true });

      await expect(service.isEnabled('complex-1', resident('c-1'))).resolves.toBe(true);
      await service.findMyMeetings('complex-1', resident('c-1'));

      expect(meetingRepo.find.mock.calls[0][0].where.kind.value).toEqual([VotingMeetingKind.CONSEJO]);
    });

    it('con las asambleas apagadas, la pregunta de una asamblea no se alcanza', async () => {
      const { service } = build(questionOf(), { enabled: false, councilEnabled: true, isCouncil: true });

      await expect(service.castVote('q-1', 'opt-si', resident('c-1')))
        .rejects.toThrow('Las votaciones no están habilitadas en tu conjunto');
    });
  });

  it('al abrir avisa a los residentes', async () => {
    const { service, notify } = build(
      questionOf({ status: VotingQuestionStatus.DRAFT, weighting: VoteWeighting.UNIT }),
    );

    await service.openQuestion('q-1', admin());
    await new Promise(resolve => setImmediate(resolve));

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['res-user'], entityType: 'voting' }));
  });
});

describe('VotingService — resultados', () => {

  const ballots = [
    { optionId: 'opt-si', weight: 0.3 },
    { optionId: 'opt-si', weight: 0.2 },
    { optionId: 'opt-no', weight: 0.1 },
  ];

  it('el porcentaje es por peso, no por cantidad de votos', async () => {
    const { service } = build(null, { ballots });

    const results = await service.results(
      questionOf({ status: VotingQuestionStatus.CLOSED, eligibleCount: 10, eligibleWeight: 1 }),
      resident(),
    );

    const si = results!.options.find(o => o.optionId === 'opt-si')!;
    expect(si.votes).toBe(2);
    expect(si.share).toBeCloseTo(0.5 / 0.6);
    expect(si.shareOfEligible).toBeCloseTo(0.5);
    expect(results!.participation).toBeCloseTo(0.6);
  });

  it('el residente no ve resultados mientras se vota', async () => {
    const { service } = build(null, { ballots });

    await expect(service.results(questionOf(), resident())).resolves.toBeNull();
  });

  it('el residente nunca ve qué votó cada unidad', async () => {
    const { service } = build(null, { ballots });

    const results = await service.results(
      questionOf({ status: VotingQuestionStatus.CLOSED, eligibleCount: 10, eligibleWeight: 1 }),
      resident(),
    );

    expect(results!.ballots).toBeNull();
    expect(results!.participants).toBeNull();
  });

  it('en voto secreto la administración ve quién participó, no qué votó', async () => {
    const { service } = build(null, { ballots, units: [{ id: 'u1', coefficient: 1 }] });

    const results = await service.results(questionOf({ secrecy: VoteSecrecy.SECRET }), admin());

    expect(results!.ballots).toBeNull();
    expect(results!.participants).toHaveLength(3);
  });

  it('en voto nominal la administración ve qué votó cada unidad', async () => {
    const { service } = build(null, { ballots, units: [{ id: 'u1', coefficient: 1 }] });

    const results = await service.results(questionOf(), admin());

    expect(results!.ballots).toHaveLength(3);
    expect(results!.ballots![0].optionText).toBe('Sí');
  });
});
