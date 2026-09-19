import { join } from 'path';
import { DataSource } from 'typeorm';

import { DATA_EXPORT_MODULES } from './data-export.registry';
import { exportableColumns, headerFor } from './data-export.columns';
import { User } from '../users/entities/user.entity';

/**
 * El registro nombra entidades y propiedades como texto (`complexId`,
 * `questionId`, `userId`). Si una entidad cambia, el error saldría en
 * producción el día que una administración pida su respaldo. Aquí se arma la
 * metadata real de TypeORM, sin base de datos, y se revisa cada entrada.
 */
describe('Registro de exportación de datos', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      entities: [join(__dirname, '../**/*.entity.{ts,js}')],
    });
    await (
      dataSource as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();
  });

  const entries = DATA_EXPORT_MODULES.flatMap((module) =>
    module.entities.map((entity) => ({ module: module.module, entity })),
  );

  it.each(entries.map((e) => [e.module, e.entity.sheet, e] as const))(
    '%s / %s se puede recortar al complejo',
    (_module, _sheet, { entity }) => {
      const metadata = dataSource.getMetadata(entity.entity);
      if (entity.parent) {
        expect(
          metadata.findColumnWithPropertyName(entity.parent.foreignKey),
        ).toBeDefined();
        const parent = dataSource.getMetadata(entity.parent.entity);
        expect(parent.findColumnWithPropertyName('complexId')).toBeDefined();
      } else {
        expect(metadata.findColumnWithPropertyName('complexId')).toBeDefined();
      }
      if (entity.transactional) {
        expect(metadata.createDateColumn).toBeDefined();
      }
      if (entity.userDetails) {
        expect(
          metadata.findColumnWithPropertyName(entity.userDetails),
        ).toBeDefined();
      }
    },
  );

  it('ningún nombre de hoja pasa del máximo de Excel ni se repite en un módulo', () => {
    for (const module of DATA_EXPORT_MODULES) {
      const names = module.entities.map((entity) => entity.sheet);
      for (const name of names) expect(name.length).toBeLessThanOrEqual(31);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('toda columna exportada tiene encabezado en español', () => {
    // Un campo nuevo sin traducción sale con su nombre técnico: agrégalo a
    // data-export.headers.ts.
    const missing = entries.flatMap(({ entity }) =>
      exportableColumns(dataSource.getMetadata(entity.entity))
        .map((column) => column.propertyName)
        .filter((property) => headerFor(property) === property),
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  it('no exporta credenciales', () => {
    // User no está en el registro, pero es la entidad con más secretos: si el
    // filtro los deja pasar aquí, los dejaría pasar en cualquiera.
    const names = exportableColumns(dataSource.getMetadata(User)).map(
      (column) => column.propertyName,
    );
    expect(names).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/password|token/i)]),
    );
  });

  it('no exporta las papeletas de votación en crudo', () => {
    const sheets = entries.map((e) => e.entity.entity.name);
    expect(sheets).not.toContain('VotingBallot');
  });
});
