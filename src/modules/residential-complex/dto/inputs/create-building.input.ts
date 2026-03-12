import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsString, IsOptional, IsUUID,
  MaxLength, MinLength, IsInt, Min, Max,
} from 'class-validator';

@InputType()
export class CreateBuildingInput {

  @Field(() => String, { description: 'Nombre de la torre. Ej: "Torre A", "Edificio Norte"' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @Field(() => String, { description: 'Código corto único dentro del complejo. Ej: "TA", "EN"' })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  code: string;

  @Field(() => Int, { description: 'Número de pisos', defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  floors?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, { description: 'ID del complejo al que pertenece' })
  @IsUUID()
  complexId: string;
}
