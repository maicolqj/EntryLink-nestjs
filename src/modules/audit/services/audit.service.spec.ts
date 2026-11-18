import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { AuditService } from './audit.service';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditAction } from '../enums/audit-action.enum';
import { AuditEntityType } from '../enums/audit-entity-type.enum';

jest.setTimeout(30_000);

describe('AuditService.log — roles auditados', () => {
  let service: AuditService;
  const auditRepo = {
    create: jest.fn((row: unknown) => row),
    save: jest.fn(async (row: unknown) => row),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();
    service = module.get(AuditService);
    jest
      .spyOn(service as any, 'generateReferenceNumber')
      .mockResolvedValue('AUD-1');
  });

  const base = {
    entityType: AuditEntityType.User,
    entityId: 'user-1',
    action: AuditAction.COMPLEX_SWITCH,
    performedById: 'user-1',
    performedByRole: 'RESIDENT_ROL',
  };

  it('un rol no auditado no deja registro', async () => {
    await service.log(base);
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('alwaysAudit registra aunque el rol no esté auditado', async () => {
    await service.log({ ...base, alwaysAudit: true });
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.COMPLEX_SWITCH,
        performedByRole: 'RESIDENT_ROL',
      }),
    );
  });
});
