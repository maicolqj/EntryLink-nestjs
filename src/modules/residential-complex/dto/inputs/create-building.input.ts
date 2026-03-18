import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsString, IsOptional,
  MaxLength, MinLength, IsInt, Min, Max,
  IsUUID,
} from 'class-validator';


@InputType()
export class CreateBuildingInput {

  @Field(() => String, { description: 'Nombre de la torre. Ej: "Torre A", "Edificio Norte"' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

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

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  complexId: string;

}
