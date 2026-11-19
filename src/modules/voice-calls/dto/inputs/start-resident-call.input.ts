import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * Portería llama a UN residente. Igual que con la SIM: se busca la unidad, se
 * elige a la persona y solo a ella le suena.
 */
@InputType()
export class StartResidentIntercomCallInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => String, { description: 'Usuario del residente al que se llama' })
  @IsUUID()
  residentUserId: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Unidad desde la que se eligió al residente (si vive en varias del conjunto)',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
