import { DataSource } from 'typeorm';
import { SpecialNumber } from '../../../modules/special-numbers/entities/special-number.entity';
import { GLOBAL_SPECIAL_NUMBERS_TO_SEED } from './datas/special-numbers-data.seed';

export const seedSpecialNumbers = async (dataSource: DataSource): Promise<void> => {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const repo = queryRunner.manager.getRepository(SpecialNumber);

    for (const data of GLOBAL_SPECIAL_NUMBERS_TO_SEED) {
      const existing = await repo.findOne({ where: { id: data.id } });
      if (!existing) {
        await repo.save(
          repo.create({
            id:          data.id,
            complexId:   null,
            isGlobal:    true,
            name:        data.name,
            phoneNumber: data.phoneNumber,
            category:    data.category,
            description: data.description,
            order:       data.order,
          }),
        );
        console.log(`  ✅ Número global creado: "${data.name}"`);
      } else {
        console.log(`  ⏭️  Número global ya existe: "${data.name}"`);
      }
    }

    await queryRunner.commitTransaction();
    console.log(`✅ Seed de números especiales globales completado\n`);
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
};
