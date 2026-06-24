import { DataSource } from 'typeorm';
import { PucAccount } from '../../../modules/finance/entities/puc-account.entity';
import { ResidentialComplex } from '../../../modules/residential-complex/entities/residential-complex.entity';
import { PUC_PH_SEED } from './datas/puc-data.seed';

/**
 * Siembra el PUC base para UNA copropiedad. Idempotente: salta los códigos
 * ya existentes. Inserta por nivel (clases → grupos → cuentas) para resolver
 * `parentId` de los hijos contra el padre ya persistido.
 */
export const seedPucForComplex = async (
  dataSource: DataSource,
  complexId: string,
): Promise<void> => {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const repo = queryRunner.manager.getRepository(PucAccount);

    // code → id (para enlazar parentId de los hijos)
    const codeToId = new Map<string, string>();
    const existing = await repo.find({ where: { complexId }, select: ['id', 'code'] });
    existing.forEach((a) => codeToId.set(a.code, a.id));

    // Insertar por nivel ascendente para que el padre exista antes que el hijo
    const rowsByLevel = [...PUC_PH_SEED].sort((a, b) => a.level - b.level);

    for (const row of rowsByLevel) {
      if (codeToId.has(row.code)) continue; // idempotencia

      const parentId = row.parentCode ? codeToId.get(row.parentCode) ?? null : null;

      const saved = await repo.save(
        repo.create({
          code: row.code,
          name: row.name,
          accountClass: row.accountClass,
          nature: row.nature,
          isPostable: row.isPostable,
          isActive: true,
          level: row.level,
          parentId,
          complexId,
        }),
      );
      codeToId.set(row.code, saved.id);
    }

    await queryRunner.commitTransaction();
    console.log(`  ✅ PUC sembrado para complejo ${complexId}`);
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
};

/** Siembra el PUC base para TODAS las copropiedades existentes. */
export const seedPucForAllComplexes = async (dataSource: DataSource): Promise<void> => {
  const complexes = await dataSource.getRepository(ResidentialComplex).find({ select: ['id'] });
  if (complexes.length === 0) {
    console.log('  ⏭️  No hay copropiedades; nada que sembrar.');
    return;
  }
  for (const complex of complexes) {
    await seedPucForComplex(dataSource, complex.id);
  }
};
