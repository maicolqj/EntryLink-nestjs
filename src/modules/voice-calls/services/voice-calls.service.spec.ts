import { createHmac } from 'crypto';

import {
  INTERCOM_PUSH,
  IntercomEndReason,
  RING_TIMEOUT_MS,
  VoiceCallsService,
} from './voice-calls.service';
import { IceServersService } from './ice-servers.service';
import { CallLog } from '../../call-logs/entities/call-log.entity';
import { CallChannel } from '../../call-logs/enums/call-channel.enum';
import { CallDirection } from '../../call-logs/enums/call-direction.enum';
import { CallOutcome } from '../../call-logs/enums/call-outcome.enum';
import { VoiceCallState } from '../../call-logs/enums/voice-call-state.enum';
import { IntercomMode } from '../../residential-complex/enums/intercom-mode.enum';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import {
  IntercomErrorCode,
  SecurityPostErrorCode,
} from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const COMPLEX_ID = '11111111-1111-1111-1111-111111111111';
const GUARD_ID = '22222222-2222-2222-2222-222222222222';
const GUARD_2_ID = '22222222-2222-2222-2222-999999999999';
const RESIDENT_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_ID = '44444444-4444-4444-4444-444444444444';
const CALL_ID = '55555555-5555-5555-5555-555555555555';

const user = (
  sub: string,
  roles: ValidRoles[],
  complexId: string | undefined = COMPLEX_ID,
): JwtAccessPayload => ({
  sub,
  email: `${sub}@example.com`,
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles,
  permissions: [],
  complexId,
});

const guard = (sub = GUARD_ID) => user(sub, [ValidRoles.SECURITY_ROL]);
const resident = (sub = RESIDENT_ID) => user(sub, [ValidRoles.RESIDENT_ROL]);

function liveCall(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: CALL_ID,
    complexId: COMPLEX_ID,
    channel: CallChannel.INTERNET,
    voiceState: VoiceCallState.RINGING,
    direction: CallDirection.OUTGOING,
    outcome: CallOutcome.MISSED,
    phoneNumber: '3000000000',
    agentUserId: GUARD_ID,
    agentName: 'PEDRO PÉREZ',
    residentId: 'res-1',
    residentUserId: RESIDENT_ID,
    residentName: 'ANA GÓMEZ',
    unitId: 'unit-1',
    unitNumber: '101',
    buildingName: 'Torre 1',
    securityPostId: null,
    securityPostName: null,
    startedAt: new Date('2026-11-10T15:00:00Z'),
    answeredAt: null,
    endedAt: null,
    durationSeconds: 0,
    notes: null,
    createdAt: new Date('2026-11-10T15:00:00Z'),
    ...overrides,
  };
}

function setup(options?: {
  mode?: IntercomMode;
  residentCallsEnabled?: boolean;
  call?: CallLog | null;
  hasApp?: boolean;
  busy?: number;
  updateAffected?: number;
  securityIds?: string[];
  posts?: Array<{ id: string; name: string }>;
  /** userId → portería en la que está */
  onDuty?: Record<string, string>;
}) {
  const securityIds = options?.securityIds ?? [GUARD_ID, GUARD_2_ID];
  const posts = options?.posts ?? [];
  const onDuty = options?.onDuty ?? {};
  // Responde cada consulta SQL del enrutamiento de porterías según su forma.
  const query = jest.fn((sql: string, params: string[]) => {
    if (sql.includes('FROM security_posts')) return Promise.resolve(posts);
    if (sql.includes('FROM security_post_guards spg')) {
      const post = posts.find((p) => p.id === onDuty[params[0]]);
      return Promise.resolve(post ? [post] : []);
    }
    if (sql.includes('FROM users u')) {
      const postId = params[2];
      return Promise.resolve(
        securityIds
          .filter((id) => !postId || onDuty[id] === postId)
          .map((id) => ({ id })),
      );
    }
    return Promise.resolve([]);
  });
  const callRepo = {
    findOne: jest.fn().mockResolvedValue(options?.call ?? null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(options?.busy ?? 0),
    create: jest.fn((data: Partial<CallLog>) => data),
    save: jest.fn((data: Partial<CallLog>) =>
      Promise.resolve({ id: CALL_ID, ...data }),
    ),
    update: jest
      .fn()
      .mockResolvedValue({ affected: options?.updateAffected ?? 1 }),
    manager: { query },
  };
  const complexRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: COMPLEX_ID,
      intercomMode: options?.mode ?? IntercomMode.INTERNET,
      residentIntercomCallsEnabled: options?.residentCallsEnabled ?? true,
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const residentRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 'res-1',
      unitId: 'unit-1',
      unit: { number: '101', building: { name: 'Torre 1' } },
    }),
  };
  const userRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        name: where.id === RESIDENT_ID ? 'ANA' : 'PEDRO',
        lastName: where.id === RESIDENT_ID ? 'GÓMEZ' : 'PÉREZ',
        phoneNumber: '3000000000',
      }),
    ),
  };
  const pushSubRepo = {
    count: jest.fn().mockResolvedValue(options?.hasApp === false ? 0 : 1),
    find: jest.fn(() =>
      Promise.resolve(
        options?.hasApp === false
          ? []
          : [...securityIds, RESIDENT_ID].map((userId) => ({ userId })),
      ),
    ),
  };
  const complexService = {
    assertComplexAccess: jest.fn().mockResolvedValue(undefined),
  };
  const notificationsService = {
    sendCallPush: jest.fn().mockResolvedValue(1),
  };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const socketService = {
    emitToUser: jest.fn(),
    emitToUsers: jest.fn(),
    emitToRole: jest.fn(),
    emitToComplex: jest.fn(),
  };
  const cacheService = { delete: jest.fn().mockResolvedValue(undefined) };
  const iceServers = { forUser: jest.fn().mockReturnValue([]) };

  const service = new VoiceCallsService(
    callRepo as never,
    complexRepo as never,
    residentRepo as never,
    userRepo as never,
    pushSubRepo as never,
    complexService as never,
    notificationsService as never,
    auditService as never,
    socketService as never,
    cacheService as never,
    iceServers as never,
  );

  return {
    service,
    callRepo,
    complexRepo,
    residentRepo,
    notificationsService,
    socketService,
    cacheService,
    auditService,
  };
}

describe('VoiceCallsService', () => {
  let toDestroy: VoiceCallsService[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-10T15:00:10Z'));
  });

  afterEach(() => {
    toDestroy.forEach((s) => s.onModuleDestroy());
    toDestroy = [];
    jest.useRealTimers();
  });

  const make = (options?: Parameters<typeof setup>[0]) => {
    const ctx = setup(options);
    toDestroy.push(ctx.service);
    return ctx;
  };

  describe('startResidentCall (portería → residente)', () => {
    const input = { complexId: COMPLEX_ID, residentUserId: RESIDENT_ID };

    it('suena solo en la cuenta del residente elegido', async () => {
      const { service, callRepo, socketService, notificationsService } = make();

      const session = await service.startResidentCall(input, guard());

      expect(callRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: CallChannel.INTERNET,
          voiceState: VoiceCallState.RINGING,
          direction: CallDirection.OUTGOING,
          agentUserId: GUARD_ID,
          residentUserId: RESIDENT_ID,
          unitNumber: '101',
        }),
      );
      expect(socketService.emitToUser).toHaveBeenCalledTimes(1);
      expect(socketService.emitToUser).toHaveBeenCalledWith(
        RESIDENT_ID,
        SocketEvent.INTERCOM_CALL_INCOMING,
        expect.objectContaining({
          callId: CALL_ID,
          unitLabel: 'Torre 1 - 101',
        }),
      );
      expect(socketService.emitToRole).not.toHaveBeenCalled();
      expect(notificationsService.sendCallPush).toHaveBeenCalledWith(
        [RESIDENT_ID],
        expect.objectContaining({ type: INTERCOM_PUSH.INCOMING }),
        RING_TIMEOUT_MS,
      );
      expect(session.call.id).toBe(CALL_ID);
    });

    it('rechaza si el conjunto está en SIM', async () => {
      const { service } = make({ mode: IntercomMode.SIM });
      await expect(
        service.startResidentCall(input, guard()),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_NOT_INTERNET,
      });
    });

    it('avisa a portería si el residente no tiene la app', async () => {
      const { service, callRepo } = make({ hasApp: false });
      await expect(
        service.startResidentCall(input, guard()),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_RESIDENT_NO_APP,
      });
      expect(callRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza si alguien ya está en otra llamada', async () => {
      const { service } = make({ busy: 1 });
      await expect(
        service.startResidentCall(input, guard()),
      ).rejects.toMatchObject({ errorCode: IntercomErrorCode.INTERCOM_BUSY });
    });

    it('a los 30 s sin respuesta queda perdida', async () => {
      const { service, callRepo, socketService } = make();
      await service.startResidentCall(input, guard());
      callRepo.findOne.mockResolvedValue(liveCall());

      await jest.advanceTimersByTimeAsync(RING_TIMEOUT_MS);

      expect(callRepo.update).toHaveBeenCalledWith(
        { id: CALL_ID, voiceState: VoiceCallState.RINGING },
        expect.objectContaining({
          voiceState: VoiceCallState.ENDED,
          outcome: CallOutcome.MISSED,
        }),
      );
      expect(socketService.emitToUsers).toHaveBeenCalledWith(
        expect.arrayContaining([GUARD_ID, RESIDENT_ID]),
        SocketEvent.INTERCOM_CALL_ENDED,
        expect.objectContaining({ reason: IntercomEndReason.MISSED }),
      );
    });
  });

  describe('startSecurityCall (residente → portería)', () => {
    const NORTE = { id: 'post-norte', name: 'PORTERÍA NORTE' };
    const SUR = { id: 'post-sur', name: 'PORTERÍA SUR' };
    const twoPosts = {
      posts: [NORTE, SUR],
      onDuty: { [GUARD_ID]: NORTE.id, [GUARD_2_ID]: SUR.id },
    };

    it('es opcional: apagado en el conjunto, no deja llamar', async () => {
      const { service } = make({ residentCallsEnabled: false });
      await expect(
        service.startSecurityCall({ complexId: COMPLEX_ID }, resident()),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_RESIDENT_CALLS_DISABLED,
      });
    });

    it('con varias porterías timbra solo en la elegida', async () => {
      const { service, callRepo, socketService, notificationsService } =
        make(twoPosts);

      await service.startSecurityCall(
        { complexId: COMPLEX_ID, securityPostId: SUR.id },
        resident(),
      );

      expect(callRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: CallDirection.INCOMING,
          agentUserId: null,
          securityPostId: SUR.id,
          securityPostName: SUR.name,
        }),
      );
      expect(socketService.emitToUsers).toHaveBeenCalledWith(
        [GUARD_2_ID],
        SocketEvent.INTERCOM_CALL_INCOMING,
        expect.objectContaining({ callerName: 'ANA GÓMEZ' }),
      );
      expect(notificationsService.sendCallPush).toHaveBeenCalledWith(
        [GUARD_2_ID],
        expect.anything(),
        RING_TIMEOUT_MS,
      );
    });

    it('con varias porterías hay que elegir', async () => {
      const { service } = make(twoPosts);
      await expect(
        service.startSecurityCall({ complexId: COMPLEX_ID }, resident()),
      ).rejects.toMatchObject({
        errorCode: SecurityPostErrorCode.SECURITY_POST_REQUIRED,
      });
    });

    it('una portería de otro conjunto no existe', async () => {
      const { service } = make(twoPosts);
      await expect(
        service.startSecurityCall(
          { complexId: COMPLEX_ID, securityPostId: 'post-ajena' },
          resident(),
        ),
      ).rejects.toMatchObject({
        errorCode: SecurityPostErrorCode.SECURITY_POST_NOT_FOUND,
      });
    });

    it('portería elegida sin nadie conectado: avisa en vez de sonar en otra', async () => {
      const { service, callRepo } = make({
        ...twoPosts,
        onDuty: { [GUARD_ID]: NORTE.id },
      });
      await expect(
        service.startSecurityCall(
          { complexId: COMPLEX_ID, securityPostId: SUR.id },
          resident(),
        ),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_NO_SECURITY,
      });
      expect(callRepo.save).not.toHaveBeenCalled();
    });

    it('sin porterías creadas: una sola, timbra en todo el personal', async () => {
      const { service, socketService } = make();
      await service.startSecurityCall({ complexId: COMPLEX_ID }, resident());
      expect(socketService.emitToUsers).toHaveBeenCalledWith(
        [GUARD_ID, GUARD_2_ID],
        SocketEvent.INTERCOM_CALL_INCOMING,
        expect.anything(),
      );
    });

    it('solo el vigilante de la portería elegida puede contestar', async () => {
      const call = liveCall({
        direction: CallDirection.INCOMING,
        agentUserId: null,
        agentName: SUR.name,
        securityPostId: SUR.id,
        securityPostName: SUR.name,
      });
      const { service, callRepo } = make({ ...twoPosts, call });

      await expect(
        service.answer({ callId: CALL_ID }, guard(GUARD_ID)),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_CALL_NOT_FOUND,
      });

      await service.answer({ callId: CALL_ID }, guard(GUARD_2_ID));
      expect(callRepo.update).toHaveBeenCalledWith(
        { id: CALL_ID, voiceState: VoiceCallState.RINGING },
        expect.objectContaining({ agentUserId: GUARD_2_ID }),
      );
    });
  });

  describe('answer', () => {
    it('solo contesta quien recibe', async () => {
      const { service } = make({ call: liveCall() });
      await expect(
        service.answer({ callId: CALL_ID }, guard()),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_CALL_NOT_FOUND,
      });
      await expect(
        service.answer({ callId: CALL_ID }, resident(OTHER_ID)),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_CALL_NOT_FOUND,
      });
    });

    it('el residente contesta y a portería le llega accepted', async () => {
      const { service, callRepo, socketService } = make({ call: liveCall() });

      const session = await service.answer(
        { callId: CALL_ID, deviceId: 'cel-1' },
        resident(),
      );

      expect(callRepo.update).toHaveBeenCalledWith(
        { id: CALL_ID, voiceState: VoiceCallState.RINGING },
        expect.objectContaining({
          voiceState: VoiceCallState.ACTIVE,
          outcome: CallOutcome.ANSWERED,
        }),
      );
      expect(socketService.emitToUsers).toHaveBeenCalledWith(
        expect.arrayContaining([GUARD_ID]),
        SocketEvent.INTERCOM_CALL_ACCEPTED,
        expect.objectContaining({ deviceId: 'cel-1' }),
      );
      expect(session.call.voiceState).toBe(VoiceCallState.ACTIVE);
    });

    it('si otro equipo contestó primero, no está disponible', async () => {
      const { service } = make({ call: liveCall(), updateAffected: 0 });
      await expect(
        service.answer({ callId: CALL_ID }, resident()),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_CALL_NOT_AVAILABLE,
      });
    });

    it('un vigilante de otro conjunto no puede tomarla', async () => {
      const call = liveCall({
        direction: CallDirection.INCOMING,
        agentUserId: null,
      });
      const { service } = make({ call });
      await expect(
        service.answer(
          { callId: CALL_ID },
          user(GUARD_2_ID, [ValidRoles.SECURITY_ROL], 'otro-conjunto'),
        ),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_CALL_NOT_FOUND,
      });
    });
  });

  describe('end', () => {
    it('quien llama cuelga mientras suena → cancelada (perdida)', async () => {
      const { service, callRepo, notificationsService } = make({
        call: liveCall(),
      });

      const ended = await service.end(CALL_ID, guard());

      expect(ended.outcome).toBe(CallOutcome.MISSED);
      expect(callRepo.update).toHaveBeenCalledWith(
        { id: CALL_ID, voiceState: VoiceCallState.RINGING },
        expect.objectContaining({ voiceState: VoiceCallState.ENDED }),
      );
      // El celular del residente puede tener la app cerrada: hay que callarlo.
      expect(notificationsService.sendCallPush).toHaveBeenCalledWith(
        [RESIDENT_ID],
        expect.objectContaining({
          type: INTERCOM_PUSH.ENDED,
          reason: IntercomEndReason.CANCELLED,
        }),
        RING_TIMEOUT_MS,
      );
    });

    it('quien recibe cuelga mientras suena → rechazada', async () => {
      const { service } = make({ call: liveCall() });
      const ended = await service.end(CALL_ID, resident());
      expect(ended.outcome).toBe(CallOutcome.REJECTED);
    });

    it('en curso → contestada con su duración', async () => {
      const { service, auditService } = make({
        call: liveCall({
          voiceState: VoiceCallState.ACTIVE,
          outcome: CallOutcome.ANSWERED,
          answeredAt: new Date('2026-11-10T15:00:05Z'),
        }),
      });
      jest.setSystemTime(new Date('2026-11-10T15:01:05Z'));

      const ended = await service.end(CALL_ID, resident());

      expect(ended.outcome).toBe(CallOutcome.ANSWERED);
      expect(ended.durationSeconds).toBe(60);
      expect(auditService.log).toHaveBeenCalled();
    });

    it('alguien ajeno no la puede colgar', async () => {
      const { service } = make({ call: liveCall() });
      await expect(
        service.end(CALL_ID, resident(OTHER_ID)),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_CALL_NOT_FOUND,
      });
    });
  });

  describe('relaySignal', () => {
    const active = () =>
      liveCall({
        voiceState: VoiceCallState.ACTIVE,
        outcome: CallOutcome.ANSWERED,
      });

    it('le pasa la señal a la otra parte', async () => {
      const { service, socketService } = make({ call: active() });

      await service.relaySignal(
        { callId: CALL_ID, kind: 'offer', payload: '{"sdp":"x"}' },
        guard(),
      );

      expect(socketService.emitToUser).toHaveBeenCalledWith(
        RESIDENT_ID,
        SocketEvent.INTERCOM_SIGNAL,
        expect.objectContaining({ kind: 'offer', fromUserId: GUARD_ID }),
      );
    });

    it('nadie ajeno puede meter señal', async () => {
      const { service } = make({ call: active() });
      await expect(
        service.relaySignal(
          { callId: CALL_ID, kind: 'candidate', payload: '{}' },
          guard(GUARD_2_ID),
        ),
      ).rejects.toMatchObject({
        errorCode: IntercomErrorCode.INTERCOM_CALL_NOT_FOUND,
      });
    });
  });

  describe('updateSettings', () => {
    it('en SIM apaga las llamadas del residente y avisa al conjunto', async () => {
      const { service, complexRepo, cacheService, socketService } = make();

      await service.updateSettings(
        {
          complexId: COMPLEX_ID,
          mode: IntercomMode.SIM,
          residentCallsEnabled: true,
        },
        user(OTHER_ID, [ValidRoles.SUPER_ADMIN_ROL], undefined),
      );

      expect(complexRepo.update).toHaveBeenCalledWith(
        { id: COMPLEX_ID },
        {
          intercomMode: IntercomMode.SIM,
          residentIntercomCallsEnabled: false,
        },
      );
      expect(cacheService.delete).toHaveBeenCalled();
      expect(socketService.emitToComplex).toHaveBeenCalledWith(
        COMPLEX_ID,
        SocketEvent.INTERCOM_SETTINGS_UPDATED,
        expect.objectContaining({ intercomMode: IntercomMode.SIM }),
      );
    });
  });
});

describe('IceServersService', () => {
  const config = (values: Record<string, string>) =>
    ({ get: (key: string) => values[key] }) as never;

  it('firma credenciales temporales de TURN al estilo coturn', () => {
    const service = new IceServersService(
      config({
        INTERCOM_STUN_URLS: 'stun:turn.alternaqj.com:3478',
        INTERCOM_TURN_URLS:
          'turn:turn.alternaqj.com:3478?transport=udp, turns:turn.alternaqj.com:5349',
        INTERCOM_TURN_SECRET: 'secreto-de-prueba',
        INTERCOM_TURN_TTL_SECONDS: '600',
      }),
    );

    const servers = service.forUser(
      RESIDENT_ID,
      new Date('2026-11-10T15:00:00Z'),
    );

    const expiresAt = Date.parse('2026-11-10T15:00:00Z') / 1000 + 600;
    const username = `${expiresAt}:${RESIDENT_ID}`;
    expect(servers).toEqual([
      { urls: ['stun:turn.alternaqj.com:3478'] },
      {
        urls: [
          'turn:turn.alternaqj.com:3478?transport=udp',
          'turns:turn.alternaqj.com:5349',
        ],
        username,
        credential: createHmac('sha1', 'secreto-de-prueba')
          .update(username)
          .digest('base64'),
      },
    ]);
  });

  it('sin secreto no entrega TURN', () => {
    const service = new IceServersService(
      config({ INTERCOM_TURN_URLS: 'turn:turn.alternaqj.com:3478' }),
    );
    expect(service.forUser(RESIDENT_ID)).toEqual([]);
  });
});
