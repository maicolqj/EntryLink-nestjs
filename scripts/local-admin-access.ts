/**
 * Quién puede entrar a la base LOCAL, y cómo devolverle el acceso a un admin.
 *
 * Existe porque el seed de usuarios no toca al que ya existe (`if (!exists)`),
 * así que volver a correrlo no arregla una clave que nadie recuerda: el usuario
 * ya está creado y el seed pasa de largo. Sin esto, la única salida era borrar
 * el registro a mano o adivinar el `SEED_ADMIN_PASSWORD` con el que se sembró
 * este equipo.
 *
 * Nunca imprime ni recibe la clave por argumento: la nueva llega por la
 * variable `NEW_PASSWORD`, para que no quede en el historial del shell.
 *
 *   yarn local:access                      # quién existe y con qué rol
 *   NEW_PASSWORD=... yarn local:access <email>
 *
 * Solo corre contra una base local. Apuntarlo a producción sería una puerta
 * trasera para reescribir la clave de cualquiera sin conocer la anterior, así
 * que el guard de abajo no tiene bandera para saltárselo: si hay que tocar
 * producción, se hace por el flujo de recuperación, que exige token.
 */
import 'reflect-metadata';
import { hash } from 'bcrypt';
import dataSource from '../src/core/database/data-source';
import { User } from '../src/modules/users/entities/user.entity';
import { UserRole } from '../src/modules/users/entities/user_has_roles.entity';

/** Hosts que se consideran la base de desarrollo de este equipo. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];

function assertLocalDatabase(): void {
  const host = process.env.DB_HOST || 'localhost';

  if (process.env.NODE_ENV === 'production' || !LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Este script solo corre contra la base local. DB_HOST=${host}, NODE_ENV=${process.env.NODE_ENV ?? 'sin definir'}.\n` +
        'Para producción usa el flujo de recuperación de contraseña, que exige token.',
    );
  }
}

async function listAccounts(): Promise<void> {
  const users = await dataSource.getRepository(User).find({
    // `password` es `select: false`: se pide explícito y solo para decir SI hay
    // una, nunca para mostrarla.
    select: ['id', 'email', 'name', 'lastName', 'status', 'password'],
    order: { email: 'ASC' },
  });

  const roles = await dataSource.getRepository(UserRole).find({
    relations: { user: true, role: true },
  });

  const rolesByUser = new Map<string, string[]>();
  for (const ur of roles) {
    if (!ur.user?.id || !ur.role?.name) continue;
    const list = rolesByUser.get(ur.user.id) ?? [];
    list.push(ur.role.name);
    rolesByUser.set(ur.user.id, list);
  }

  if (users.length === 0) {
    console.log('\nNo hay usuarios en esta base. Corre `yarn seed all`.\n');
    return;
  }

  console.log(`\nCuentas en la base local (${users.length}):\n`);
  for (const user of users) {
    const userRoles = rolesByUser.get(user.id) ?? ['sin rol'];
    const hasPassword = user.password ? 'con clave' : 'SIN CLAVE';
    console.log(
      `  ${user.email.padEnd(34)} ${user.status.padEnd(22)} ${hasPassword.padEnd(10)} ${userRoles.join(', ')}`,
    );
  }
  console.log(
    '\nPara devolverle el acceso a una:\n  NEW_PASSWORD=... yarn local:access <email>\n',
  );
}

async function resetPassword(email: string, newPassword: string): Promise<void> {
  const repo = dataSource.getRepository(User);
  // El mismo `toLowerCase().trim()` que la entidad aplica al guardar: buscar
  // con el correo tal cual lo escribió el usuario no encontraría nada.
  const user = await repo.findOne({
    where: { email: email.toLowerCase().trim() },
    select: ['id', 'email', 'status'],
  });

  if (!user) {
    throw new Error(
      `No hay ninguna cuenta con el correo ${email} en esta base. Corre el script sin argumentos para ver cuáles existen.`,
    );
  }

  // El hook `@BeforeUpdate` de la entidad NO hashea —solo `@BeforeInsert` lo
  // hace—, así que guardar la clave en claro la dejaría en texto plano en la
  // base. Se hashea acá, con el mismo costo que usa el resto del backend.
  const rounds = Number(process.env.HASHSALT) || 12;
  const hashed = await hash(newPassword, rounds);

  await repo.update(user.id, {
    password: hashed,
    lastPasswordChange: new Date(),
    // Misma invalidación que hace el cambio de clave real: las sesiones
    // abiertas con la clave vieja dejan de servir.
    tokenVersion: () => '"tokenVersion" + 1',
  });

  console.log(`\n✅ Clave actualizada para ${user.email} (estado: ${user.status}).`);
  console.log('   Las sesiones abiertas de esa cuenta quedaron invalidadas.\n');
}

async function main(): Promise<void> {
  assertLocalDatabase();

  const email = process.argv[2];
  const newPassword = process.env.NEW_PASSWORD;

  await dataSource.initialize();

  try {
    if (!email) {
      await listAccounts();
      return;
    }

    if (!newPassword) {
      throw new Error(
        'Falta la clave nueva. Pásala por entorno para que no quede en el historial:\n' +
          `  NEW_PASSWORD=... yarn local:access ${email}`,
      );
    }

    await resetPassword(email, newPassword);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
