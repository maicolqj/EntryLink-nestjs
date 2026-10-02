import { compare, hash } from 'bcrypt';

import { User } from './user.entity';

/**
 * El alta hashea la contraseña una sola vez: si el servicio ya entregó el
 * hash (registro de supervisor), el hook no lo vuelve a hashear.
 */
describe('User @BeforeInsert — contraseña', () => {
  beforeAll(() => {
    process.env.HASHSALT = process.env.HASHSALT ?? '4';
  });

  it('hashea la contraseña en texto plano', async () => {
    const user = Object.assign(new User(), { password: 'Clave.Segura1' });

    await user.beforeInsert();

    await expect(compare('Clave.Segura1', user.password)).resolves.toBe(true);
  });

  it('no vuelve a hashear una contraseña ya hasheada', async () => {
    const hashed = await hash('Clave.Segura1', 4);
    const user = Object.assign(new User(), { password: hashed });

    await user.beforeInsert();

    expect(user.password).toBe(hashed);
    await expect(compare('Clave.Segura1', user.password)).resolves.toBe(true);
  });
});
