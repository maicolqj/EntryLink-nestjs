import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CustomError } from '../../shared/utils/errors.utils';

const mockRepo = () => ({ findOne: jest.fn(), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() });

describe('AuthService.registerSupervisor', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockRepo>;
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

    // Mock createQueryBuilder para recargar el usuario con roles
    userRepo.createQueryBuilder = jest.fn().mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'new-user-id', email: input.email, userRoles: [] }),
    });

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User),               useValue: userRepo },
        { provide: getRepositoryToken(UserRole),           useValue: mockRepo() },
        { provide: getRepositoryToken(Role),               useValue: roleRepo },
        { provide: getRepositoryToken(ResidentialComplex), useValue: mockRepo() },
        { provide: getRepositoryToken(OtpCode),            useValue: mockRepo() },
        { provide: getRepositoryToken(RefreshToken),       useValue: mockRepo() },
        { provide: getRepositoryToken(UserSession),        useValue: mockRepo() },
        { provide: DataSource,                             useValue: dataSource },
        { provide: TokenService,                           useValue: tokenService },
        { provide: SessionService,                         useValue: sessionService },
        { provide: OtpService,                             useValue: {} },
        { provide: CacheService,                           useValue: { get: jest.fn(), set: jest.fn(), delete: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('lanza EMAIL_ALREADY_IN_USE cuando el email ya está registrado', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(service.registerSupervisor(input, {} as any)).rejects.toBeInstanceOf(CustomError);
  });

  it('crea el usuario con SUPERVISOR_ROL y devuelve AuthResponse', async () => {
    userRepo.findOne.mockResolvedValue(null);
    roleRepo.findOne.mockResolvedValue({ id: 'role-id', name: ValidRoles.SUPERVISOR_ROL });

    const result = await service.registerSupervisor(input, {} as any);
    expect(result).toHaveProperty('accessToken');
    expect(dataSource.transaction).toHaveBeenCalled();
  });
});
