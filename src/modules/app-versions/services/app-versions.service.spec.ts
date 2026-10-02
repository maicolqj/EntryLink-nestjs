import { AppVersionsService } from './app-versions.service';
import { ClientApp, ClientPlatform } from '../enums/client-app.enum';

const build = (rows: Record<string, unknown>[] = []) => {
  const repo = {
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) => r.app === where.app && r.platform === where.platform),
    ),
    find: jest.fn(async () => rows),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
  };
  const service = new AppVersionsService(repo as never);
  return { service, repo };
};

describe('AppVersionsService', () => {
  const policy = {
    app: ClientApp.REMOTELINK,
    platform: ClientPlatform.ANDROID,
    minVersionCode: 21,
    message: 'Actualizamos la base de datos',
  };

  it('bloquea las versiones por debajo del mínimo', async () => {
    const { service } = build([policy]);

    await expect(
      service.check(ClientApp.REMOTELINK, ClientPlatform.ANDROID, 20),
    ).resolves.toEqual({
      updateRequired: true,
      minVersionCode: 21,
      message: 'Actualizamos la base de datos',
    });
  });

  it('deja pasar la versión mínima y las posteriores', async () => {
    const { service } = build([policy]);

    for (const versionCode of [21, 30]) {
      const result = await service.check(
        ClientApp.REMOTELINK,
        ClientPlatform.ANDROID,
        versionCode,
      );
      expect(result.updateRequired).toBe(false);
    }
  });

  it('sin política no obliga a nadie', async () => {
    const { service } = build([policy]);

    const result = await service.check(
      ClientApp.ENTRYLINK,
      ClientPlatform.ANDROID,
      1,
    );
    expect(result).toEqual({
      updateRequired: false,
      minVersionCode: 0,
      message: null,
    });
  });

  it('lista todas las combinaciones de app y plataforma', async () => {
    const { service } = build([policy]);

    const list = await service.list();
    expect(list).toHaveLength(4);
    expect(
      list.find(
        (p) =>
          p.app === ClientApp.REMOTELINK &&
          p.platform === ClientPlatform.ANDROID,
      )?.minVersionCode,
    ).toBe(21);
  });
});
