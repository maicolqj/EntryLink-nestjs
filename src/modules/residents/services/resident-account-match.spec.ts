import { findAccountForNewResident } from './resident-account-match';
import { ResidentErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Alta de residente desde la web: si la persona ya tiene cuenta (vive en otro
 * conjunto o la creó otro flujo) se vincula sin decirle a este conjunto nada
 * del otro. El documento solo no basta: un error de digitación metería la
 * cuenta de un desconocido en el conjunto.
 */
describe('findAccountForNewResident', () => {
  const ana = {
    id: 'u-ana',
    identity: '1010',
    phoneNumber: '+573001112233',
    email: 'ana@x.co',
  };
  const users = [ana];

  // Repositorio en memoria con la misma forma de búsqueda que TypeORM.
  const repo = {
    findOne: jest.fn(async ({ where }: any) => {
      const [field, value] = Object.entries(where)[0] as [string, string];
      return users.find((u: any) => u[field] === value) ?? null;
    }),
  };
  const input = (
    over: Partial<{
      identityNumber: string | undefined;
      phoneNumber: string | undefined;
      email: string;
    }>,
  ) => ({
    identityNumber: '9999',
    phoneNumber: '+573009999999',
    email: 'nuevo@x.co',
    ...over,
  });
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'OK';
    } catch (e: any) {
      return e?.errorCode ?? e?.message;
    }
  };

  beforeEach(() => jest.clearAllMocks());

  it('documento y teléfono de una cuenta existente: la vincula', async () => {
    const found = await findAccountForNewResident(
      repo as any,
      input({ identityNumber: '1010', phoneNumber: '+573001112233' }),
    );
    expect(found?.id).toBe('u-ana');
  });

  it('documento y correo de una cuenta existente: la vincula (correo sin importar mayúsculas)', async () => {
    const found = await findAccountForNewResident(
      repo as any,
      input({ identityNumber: ' 1010 ', email: ' ANA@x.co ' }),
    );
    expect(found?.id).toBe('u-ana');
  });

  it('teléfono con espacios cuenta igual', async () => {
    const found = await findAccountForNewResident(
      repo as any,
      input({ identityNumber: '1010', phoneNumber: '+57 300 111 2233' }),
    );
    expect(found?.id).toBe('u-ana');
  });

  it('solo el documento coincide: error genérico, sin vincular', async () => {
    const code = await codeOf(
      findAccountForNewResident(repo as any, input({ identityNumber: '1010' })),
    );
    expect(code).toBe(ResidentErrorCode.ACCOUNT_DATA_MISMATCH);
  });

  it('el mensaje no menciona ningún conjunto', async () => {
    try {
      await findAccountForNewResident(
        repo as any,
        input({ identityNumber: '1010' }),
      );
    } catch (e: any) {
      expect(e.message).not.toMatch(/conjunto|complejo/i);
    }
  });

  it('teléfono de una cuenta con OTRO documento: error genérico (no es la misma persona)', async () => {
    const code = await codeOf(
      findAccountForNewResident(
        repo as any,
        input({ identityNumber: '2020', phoneNumber: '+573001112233' }),
      ),
    );
    expect(code).toBe(ResidentErrorCode.ACCOUNT_DATA_MISMATCH);
  });

  it('nada coincide: cuenta nueva (null)', async () => {
    await expect(
      findAccountForNewResident(repo as any, input({})),
    ).resolves.toBeNull();
  });

  it('teléfono de una cuenta sin documento registrado: la vincula como antes', async () => {
    users.push({
      id: 'u-sin-doc',
      identity: undefined as any,
      phoneNumber: '+573005550000',
      email: 'sd@x.co',
    });
    const found = await findAccountForNewResident(
      repo as any,
      input({ identityNumber: '3030', phoneNumber: '+573005550000' }),
    );
    expect(found?.id).toBe('u-sin-doc');
    users.pop();
  });

  // ── Campos opcionales (importación por Excel) ──────────────────────────────

  it('sin documento: vincula por correo como antes (no hay con qué contradecir)', async () => {
    const found = await findAccountForNewResident(
      repo as any,
      input({ identityNumber: undefined, email: 'ana@x.co' }),
    );
    expect(found?.id).toBe('u-ana');
  });

  it('documento existente y teléfono vacío en ambos lados: el vacío no cuenta como coincidencia', async () => {
    users.push({
      id: 'u-sin-tel',
      identity: '4040',
      phoneNumber: null as any,
      email: 'st@x.co',
    });
    const code = await codeOf(
      findAccountForNewResident(
        repo as any,
        input({ identityNumber: '4040', phoneNumber: undefined }),
      ),
    );
    expect(code).toBe(ResidentErrorCode.ACCOUNT_DATA_MISMATCH);
    users.pop();
  });

  it('teléfono vacío no busca cuentas por teléfono', async () => {
    await findAccountForNewResident(repo as any, input({ phoneNumber: '  ' }));
    const fields = repo.findOne.mock.calls.map(
      ([o]: any) => Object.keys(o.where)[0],
    );
    expect(fields).not.toContain('phoneNumber');
  });
});
