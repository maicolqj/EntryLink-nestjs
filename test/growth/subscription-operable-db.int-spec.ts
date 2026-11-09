/**
 * Pausa de las automatizaciones por suscripción vencida, contra Postgres real.
 * Las pruebas unitarias no ven un nombre de columna equivocado en SQL, que ya
 * dejó crons muertos en silencio. Crea sus propias filas (prefijo cccccccc-).
 */
import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { operableComplexSql } from '../../src/modules/subscriptions/utils/operable-complex.sql';
import { AmenityBookingsService } from '../../src/modules/amenities/services/amenity-bookings.service';
import { AmenityBooking } from '../../src/modules/amenities/entities/amenity-booking.entity';
import { AutoApplyMoraCron } from '../../src/modules/finance/cron/auto-apply-mora.cron';
import { AutoCauseRecurringCron } from '../../src/modules/finance/cron/auto-cause-recurring.cron';
import { AutoGenerateChargesCron } from '../../src/modules/finance/cron/auto-generate-charges.cron';
import { OverdueChargesCron } from '../../src/modules/finance/cron/overdue-charges.cron';
import { ComplexFinanceConfig } from '../../src/modules/finance/entities/complex-finance-config.entity';
import { FeeCharge } from '../../src/modules/finance/entities/fee-charge.entity';
import { FeeConfig } from '../../src/modules/finance/entities/fee-config.entity';
import { RecurringCharge } from '../../src/modules/finance/entities/recurring-charge.entity';
import { MaintenanceTicketsService } from '../../src/modules/maintenance/services/maintenance-tickets.service';
import { MaintenanceTicket } from '../../src/modules/maintenance/entities/maintenance-ticket.entity';
import { MarketplaceListingsService } from '../../src/modules/marketplace/services/marketplace-listings.service';
import { MarketplaceListing } from '../../src/modules/marketplace/entities/marketplace-listing.entity';
import { PetsService } from '../../src/modules/pets/services/pets.service';
import { Pet } from '../../src/modules/pets/entities/pet.entity';
import { PqrfService } from '../../src/modules/pqrf/services/pqrf.service';
import { Pqrf } from '../../src/modules/pqrf/entities/pqrf.entity';
import { SecurityAppExitsService } from '../../src/modules/security-app-exits/services/security-app-exits.service';
import { SecurityAppExit } from '../../src/modules/security-app-exits/entities/security-app-exit.entity';
import { RevokeInactiveAssignmentsCron } from '../../src/modules/supervisor-visits/cron/revoke-inactive-assignments.cron';
import { UserComplexAssignment } from '../../src/modules/users/entities/user-complex-assignment.entity';
import { VehiclesService } from '../../src/modules/vehicles/services/vehicles.service';
import { ParkingRotationConfig } from '../../src/modules/vehicles/entities/parking-rotation-config.entity';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

export const COMPLEX = {
  vigente: 'cccccccc-0000-4000-8000-000000000001',
  gracia: 'cccccccc-0000-4000-8000-000000000002',
  pausado: 'cccccccc-0000-4000-8000-000000000003',
  sinFecha: 'cccccccc-0000-4000-8000-000000000004',
};

/** Guarda el SQL que de verdad llega a Postgres. */
class SqlSpy implements TypeOrmLogger {
  sql: string[] = [];
  logQuery(query: string) {
    this.sql.push(query);
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

/** Servicio real con solo las dependencias que usa la consulta. */
const withDeps = <T extends object>(
  cls: new (...args: never[]) => T,
  deps: Record<string, unknown>,
): T =>
  Object.assign(Object.create(cls.prototype) as T, {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    ...deps,
  });

describeDb('Suscripción vencida: automatizaciones (base real)', () => {
  let ds: DataSource;
  const spy = new SqlSpy();

  const cleanupComplexes = () =>
    ds.query(`DELETE FROM public.residential_complexes WHERE id = ANY($1)`, [
      Object.values(COMPLEX),
    ]);

  const seedComplex = (id: string, slug: string, interval: string | null) =>
    ds.query(
      `INSERT INTO public.residential_complexes (id, name, slug, subscription_ends_at)
       VALUES ($1, $2, $3, ${interval ? `now() - interval '${interval}'` : 'NULL'})`,
      [id, `IT ${slug}`, `it-corte-${slug}`],
    );

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: [join(__dirname, '../../src/**/*.entity.ts')],
      synchronize: false,
      logging: true,
      logger: spy,
    });
    await ds.initialize();
    const [{ db }] = await ds.query('SELECT current_database() AS db');
    if (!/test/i.test(db)) throw new Error(`Base "${db}" no parece de prueba`);
    await cleanupComplexes();
    await seedComplex(COMPLEX.vigente, 'vigente', '-10 days');
    await seedComplex(COMPLEX.gracia, 'gracia', '4 days');
    await seedComplex(COMPLEX.pausado, 'pausado', '6 days');
    await seedComplex(COMPLEX.sinFecha, 'sin-fecha', null);
  });

  afterAll(async () => {
    await cleanupComplexes();
    await ds.destroy();
  });

  describe('operableComplexSql', () => {
    const operable = async (cast: string): Promise<string[]> => {
      const rows: { cid: string }[] = await ds.query(
        `SELECT v.cid::text AS cid
           FROM unnest($1::uuid[]) AS u(id)
           CROSS JOIN LATERAL (SELECT u.id::${cast} AS cid) v
          WHERE ${operableComplexSql('v.cid')}`,
        [Object.values(COMPLEX)],
      );
      return rows.map((r) => r.cid).sort();
    };

    const expected = [COMPLEX.vigente, COMPLEX.gracia, COMPLEX.sinFecha].sort();

    it('deja fuera solo al conjunto pausado con columna uuid', async () => {
      expect(await operable('uuid')).toEqual(expected);
    });

    it('deja fuera solo al conjunto pausado con columna de texto', async () => {
      expect(await operable('varchar')).toEqual(expected);
    });
  });

  describe('cada tarea por conjunto trae el filtro en su consulta', () => {
    const repo = <E extends object>(e: new () => E) => ds.getRepository(e);
    const bookings = () =>
      withDeps(AmenityBookingsService, { bookingRepo: repo(AmenityBooking) });
    const tickets = () =>
      withDeps(MaintenanceTicketsService, {
        ticketRepo: repo(MaintenanceTicket),
      });
    const listings = () =>
      withDeps(MarketplaceListingsService, {
        listingRepo: repo(MarketplaceListing),
      });
    const pets = () => withDeps(PetsService, { petRepo: repo(Pet) });
    const pqrf = () => withDeps(PqrfService, { pqrfRepo: repo(Pqrf) });
    const exits = () =>
      withDeps(SecurityAppExitsService, { exitRepo: repo(SecurityAppExit) });

    const cases: [string, number, () => Promise<unknown>][] = [
      [
        'reservas: expirar pendientes',
        1,
        () => bookings().expireStalePending(),
      ],
      ['reservas: sin ingreso', 1, () => bookings().markNoShows()],
      ['reservas: autocompletar', 1, () => bookings().autoCompleteCheckedIn()],
      ['reservas: recordatorios', 1, () => bookings().sendUpcomingReminders()],
      ['mantenimiento: plazos', 1, () => tickets().breachOverdueTickets()],
      ['mantenimiento: cierre', 1, () => tickets().autoCloseResolvedTickets()],
      ['mantenimiento: calificar', 1, () => tickets().remindPendingRatings()],
      ['clasificados: avisos', 1, () => listings().notifyExpiringSoon()],
      ['clasificados: vencer', 1, () => listings().expireOverdue()],
      ['mascotas: documentos', 1, () => pets().notifyExpiringDocuments()],
      ['pqrf: cerrar', 1, () => pqrf().closeFullyAnswered()],
      ['pqrf: silencio', 1, () => pqrf().resolveExpiredBySilence()],
      ['pqrf: recordatorios', 1, () => pqrf().sendDueReminders()],
      ['vigilantes: salidas', 1, () => exits().findDueAlerts()],
      [
        'rotación de parqueaderos',
        1,
        () =>
          withDeps(VehiclesService, {
            rotationConfigRepo: repo(ParkingRotationConfig),
          }).findDueRotationsInternal(new Date()),
      ],
      [
        'finanzas: mora',
        1,
        () =>
          withDeps(AutoApplyMoraCron, {
            financeConfigRepo: repo(ComplexFinanceConfig),
          }).run(),
      ],
      [
        'finanzas: causación recurrente',
        1,
        () =>
          withDeps(AutoCauseRecurringCron, {
            recurringRepo: repo(RecurringCharge),
          }).run(),
      ],
      [
        'finanzas: emisión de cobros',
        1,
        () =>
          withDeps(AutoGenerateChargesCron, {
            financeConfigRepo: repo(ComplexFinanceConfig),
            feeConfigRepo: repo(FeeConfig),
          }).run(),
      ],
      [
        'finanzas: cartera vencida (dos pasos)',
        2,
        () =>
          withDeps(OverdueChargesCron, {
            chargeRepo: repo(FeeCharge),
          }).markOverdueCharges(),
      ],
      [
        'supervisores: revocar',
        1,
        () =>
          withDeps(RevokeInactiveAssignmentsCron, {
            assignmentRepo: repo(UserComplexAssignment),
          }).run(),
      ],
    ];

    it.each(cases)('%s', async (_name, statements, run) => {
      spy.sql = [];
      await run();
      const filtered = spy.sql.filter((q) =>
        q.includes('sub_c.subscription_ends_at'),
      );
      expect(filtered.length).toBeGreaterThanOrEqual(statements);
    });
  });

  describe('con filas reales', () => {
    const silencedPqrf = () =>
      withDeps(PqrfService, {
        pqrfRepo: ds.getRepository(Pqrf),
        emitUpdated: () => undefined,
        notifySilence: () => Promise.resolve(),
        auditService: { log: () => Promise.resolve() },
      });

    const cleanupRows = async () => {
      const ids = Object.values(COMPLEX);
      await ds.query(
        `DELETE FROM public.pqrf_requests WHERE complex_id = ANY($1)`,
        [ids],
      );
      await ds.query(
        `DELETE FROM public.parking_rotation_configs WHERE complex_id = ANY($1)`,
        [ids],
      );
    };

    const seedExpiredPqrf = (
      complexId: string,
      n: number,
      consecutive: number,
    ) =>
      ds.getRepository(Pqrf).insert(
        Array.from({ length: n }, (_, i) => ({
          complexId,
          code: `IT-${consecutive + i}`,
          consecutive: consecutive + i,
          type: 'PETICION',
          addressee: 'ADMINISTRACION',
          subject: 'IT',
          description: 'IT',
          dueAt: new Date(Date.now() - 86_400_000),
        })) as never[],
      );

    beforeEach(cleanupRows);
    afterAll(cleanupRows);

    it('un lote lleno de conjuntos pausados no deja sin turno a los demás', async () => {
      await seedExpiredPqrf(COMPLEX.pausado, 201, 900000);
      await seedExpiredPqrf(COMPLEX.vigente, 1, 910000);

      const resolved = await silencedPqrf().resolveExpiredBySilence();

      expect(resolved).toBe(1);
      const paused = await ds.query(
        `SELECT count(*)::int AS n FROM public.pqrf_requests
          WHERE complex_id = $1 AND resolved_by_silence = true`,
        [COMPLEX.pausado],
      );
      expect(paused[0].n).toBe(0);
    });

    it('la rotación solo trae al conjunto que no está pausado', async () => {
      const past = new Date(Date.now() - 86_400_000);
      await ds.getRepository(ParkingRotationConfig).insert(
        [COMPLEX.pausado, COMPLEX.vigente].map((complexId) => ({
          complexId,
          rotationIntervalValue: 1,
          isActive: true,
          nextExecutionAt: past,
          lastExecutedAt: past,
        })) as never[],
      );

      const due = await withDeps(VehiclesService, {
        rotationConfigRepo: ds.getRepository(ParkingRotationConfig),
      }).findDueRotationsInternal(new Date());

      const mine = due.filter((c) =>
        Object.values(COMPLEX).includes(c.complexId),
      );
      expect(mine.map((c) => c.complexId)).toEqual([COMPLEX.vigente]);
    });
  });
});
