import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQrLoginPinToComplexes1746486000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "residential_complexes"
            ADD COLUMN IF NOT EXISTS "qr_login_pin" varchar(72)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "residential_complexes"
            DROP COLUMN IF EXISTS "qr_login_pin"
        `);
    }

}
