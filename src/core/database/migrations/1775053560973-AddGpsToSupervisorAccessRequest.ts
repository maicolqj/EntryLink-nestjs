import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGpsToSupervisorAccessRequest1775053560973 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "supervisor_access_requests"
            ADD COLUMN IF NOT EXISTS "request_lat" decimal(10,8),
            ADD COLUMN IF NOT EXISTS "request_lng" decimal(11,8)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "supervisor_access_requests"
            DROP COLUMN IF EXISTS "request_lat",
            DROP COLUMN IF EXISTS "request_lng"
        `);
    }

}
