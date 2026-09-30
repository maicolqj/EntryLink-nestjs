import { ObjectType, Field } from '@nestjs/graphql';

import { Unit } from '../../residential-complex/entities/unit.entity';
import { UnitAsset } from '../../residential-complex/entities/unit-asset.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { ResidentType } from '../../residents/enums/resident-type.enum';

/**
 * Un integrante de la unidad, visto por otro integrante.
 *
 * Solo lo que sirve entre quienes viven juntos: nombre, relación con la
 * unidad, desde cuándo y el teléfono para llamarse. Nada de documento, correo
 * ni notas de la administración.
 */
@ObjectType({ description: 'Integrante de la unidad del residente' })
export class UnitMember {
  @Field()
  residentId: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  lastName?: string | null;

  @Field(() => String, { nullable: true })
  phoneNumber?: string | null;

  @Field(() => ResidentType)
  type: ResidentType;

  @Field()
  isMainResident: boolean;

  @Field(() => Date, { nullable: true })
  startDate?: Date | null;

  /** Es quien consulta: la app lo marca como "Tú" y no le ofrece llamarse. */
  @Field()
  isMe: boolean;
}

@ObjectType({
  description: 'Todo lo de la unidad del residente, en una consulta',
})
export class MyUnitResponse {
  @Field(() => Unit)
  unit: Unit;

  @Field(() => [UnitAsset], {
    description: 'Parqueaderos y bodegas propios de la unidad',
  })
  assets: UnitAsset[];

  @Field(() => [Vehicle], {
    description: 'Vehículos de la unidad (sin los rechazados ni los retirados)',
  })
  vehicles: Vehicle[];

  /**
   * Cuándo es la próxima rotación de parqueaderos del conjunto (null si no
   * rota). Con ella el vehículo que quedó fuera sabe cuándo vuelve a entrar.
   */
  @Field(() => Date, { nullable: true })
  nextRotationAt?: Date | null;

  @Field(() => [UnitMember], {
    description: 'Integrantes activos de la unidad',
  })
  members: UnitMember[];
}
