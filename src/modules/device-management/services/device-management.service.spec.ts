import { ConfigService } from '@nestjs/config';

import { DeviceManagementService } from './device-management.service';
import { AndroidManagementClient } from './android-management.client';
import {
  ENTRYLINK_PACKAGE,
  buildKioskPolicy,
  kioskPolicyHash,
} from '../kiosk-policy';
import { ManagedDeviceCommand } from '../dto/device-management.dto';

const ENTERPRISE = { id: 'e1', name: 'enterprises/LC01', policyHash: null } as any;

function setup(opts: { enterprise?: any; origins?: string } = {}) {
  const amapi = {
    configured: true,
    createSignupUrl: jest.fn().mockResolvedValue({ name: 'signupUrls/1', url: 'https://g' }),
    createEnterprise: jest.fn().mockResolvedValue({ name: 'enterprises/LC01' }),
    patchPolicy: jest.fn().mockResolvedValue({}),
    createEnrollmentToken: jest.fn().mockResolvedValue({
      name: 't',
      value: 'ABC',
      qrCode: '{"x":1}',
      expirationTimestamp: '2026-10-03T00:00:00Z',
    }),
    listDevices: jest.fn().mockResolvedValue([]),
    issueCommand: jest.fn().mockResolvedValue({}),
    deleteDevice: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<AndroidManagementClient>;

  const config = {
    get: jest.fn((k: string) =>
      k === 'ALLOWED_ORIGINS' ? (opts.origins ?? 'https://entrylink.alternaqj.com') : undefined,
    ),
  } as unknown as ConfigService;

  const enterpriseRepo = {
    findOne: jest.fn().mockResolvedValue(
      opts.enterprise === undefined ? ENTERPRISE : opts.enterprise,
    ),
    save: jest.fn(async (e) => e),
    create: jest.fn((e) => e),
  };
  const complexRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'c1', name: 'Torres del Parque' }),
    find: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Torres del Parque' }]),
  };

  const service = new DeviceManagementService(
    amapi,
    config,
    enterpriseRepo as any,
    complexRepo as any,
  );
  return { service, amapi, enterpriseRepo, complexRepo };
}

describe('DeviceManagementService', () => {
  describe('startSignup', () => {
    it('rechaza una URL de regreso fuera de ALLOWED_ORIGINS', async () => {
      const { service, amapi } = setup({ enterprise: null });
      await expect(
        service.startSignup('https://evil.example.com/cb'),
      ).rejects.toMatchObject({ errorCode: 'DEVICE_MANAGEMENT_INVALID_CALLBACK' });
      expect(amapi.createSignupUrl).not.toHaveBeenCalled();
    });

    it('acepta el dominio del panel', async () => {
      const { service } = setup({ enterprise: null });
      await expect(
        service.startSignup('https://entrylink.alternaqj.com/super-admin/equipos'),
      ).resolves.toEqual({ signupUrlName: 'signupUrls/1', url: 'https://g' });
    });

    it('no deja crear una segunda empresa', async () => {
      const { service } = setup();
      await expect(
        service.startSignup('https://entrylink.alternaqj.com/x'),
      ).rejects.toMatchObject({ errorCode: 'DEVICE_MANAGEMENT_ENTERPRISE_EXISTS' });
    });
  });

  it('completeSignup guarda la empresa y le aplica la política', async () => {
    const { service, amapi, enterpriseRepo } = setup({ enterprise: null });
    enterpriseRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ...ENTERPRISE, policyHash: kioskPolicyHash() });
    await service.completeSignup('signupUrls/1', 'tok', 'u1');
    expect(amapi.patchPolicy).toHaveBeenCalledWith(
      'enterprises/LC01/policies/porteria',
      buildKioskPolicy(),
    );
  });

  it('el QR lleva el conjunto en additionalData', async () => {
    const { service, amapi } = setup();
    const qr = await service.createEnrollmentQr('c1');
    expect(amapi.createEnrollmentToken).toHaveBeenCalledWith(
      'enterprises/LC01',
      expect.objectContaining({
        additionalData: 'c1',
        policyName: 'enterprises/LC01/policies/porteria',
      }),
    );
    expect(qr).toMatchObject({ complexName: 'Torres del Parque', enrollmentCode: 'ABC' });
  });

  it('managedDevices filtra por conjunto y lee la versión de EntryLink', async () => {
    const { service, amapi } = setup();
    amapi.listDevices.mockResolvedValue([
      {
        name: 'enterprises/LC01/devices/a',
        enrollmentTokenData: 'c1',
        applicationReports: [{ packageName: ENTRYLINK_PACKAGE, versionName: '1.3.2', versionCode: 9 }],
        nonComplianceDetails: [{ settingName: 'defaultApplicationSettings', nonComplianceReason: 'API_LEVEL' }],
      },
      { name: 'enterprises/LC01/devices/b', enrollmentTokenData: 'otro' },
    ]);
    const devices = await service.devices('c1');
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      complexName: 'Torres del Parque',
      appVersionCode: 9,
      nonCompliance: ['defaultApplicationSettings: API_LEVEL'],
    });
  });

  it('no envía órdenes a equipos de otra empresa', async () => {
    const { service, amapi } = setup();
    await expect(
      service.command('enterprises/OTRA/devices/x', ManagedDeviceCommand.REBOOT),
    ).rejects.toMatchObject({ errorCode: 'DEVICE_MANAGEMENT_DEVICE_NOT_FOUND' });
    await expect(
      service.release('enterprises/LC01/devices/../policies/porteria'),
    ).rejects.toMatchObject({ errorCode: 'DEVICE_MANAGEMENT_DEVICE_NOT_FOUND' });
    expect(amapi.issueCommand).not.toHaveBeenCalled();
    expect(amapi.deleteDevice).not.toHaveBeenCalled();
  });

  it('sin empresa vinculada no genera QR', async () => {
    const { service } = setup({ enterprise: null });
    await expect(service.createEnrollmentQr('c1')).rejects.toMatchObject({
      errorCode: 'DEVICE_MANAGEMENT_NO_ENTERPRISE',
    });
  });
});
