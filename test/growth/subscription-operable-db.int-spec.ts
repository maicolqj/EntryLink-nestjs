/**
 * Pausa de las automatizaciones por suscripción vencida, contra Postgres real.
 * Las pruebas unitarias no ven un nombre de columna equivocado en SQL, que ya
 * dejó crons muertos en silencio. Crea sus propias filas (prefijo cccccccc-).
 */
import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { operableComplexSql } from '../../src/modules/subscriptions/utils/operable-complex.sql';

const URL = process.env.GROWTH_IT_DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

export const COMPLEX = {
  vigente: 'cccccccc-0000-4000-8000-000000000001',
  gracia: 'cccccccc-0000-4000-8000-000000000002',
  pausado: 'cccccccc-0000-4000-8000-000000000003',
  sinFecha: 'cccccccc-0000-4000-8000-000000000004',
};

describeDb('Suscripción vencida: automatizaciones (base real)', () => {
  let ds: DataSource;

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
});
