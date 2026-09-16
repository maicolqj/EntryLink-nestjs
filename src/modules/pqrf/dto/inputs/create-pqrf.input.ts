import { InputType, Field } from '@nestjs/graphql';
import {
  IsEnum,
  IsString,
  IsNotEmpty,
  MaxLength,
  MinLength,
  IsUUID,
} from 'class-validator';

import { PqrfType } from '../../enums/pqrf-type.enum';
import { PqrfAddressee } from '../../enums/pqrf-addressee.enum';

@InputType()
export class CreatePqrfInput {
  @Field()
  @IsUUID()
  complexId: string;

  @Field(() => PqrfType)
  @IsEnum(PqrfType)
  type: PqrfType;

  /**
   * A quién se dirige. Es una decisión del residente y no un detalle de forma:
   * dirigirlo solo al consejo es lo que permite quejarse de la administración
   * sin que la administración lo lea.
   */
  @Field(() => PqrfAddressee, { defaultValue: PqrfAddressee.ADMINISTRACION })
  @IsEnum(PqrfAddressee)
  addressee: PqrfAddressee = PqrfAddressee.ADMINISTRACION;

  @Field(() => String, { description: 'Asunto en una línea' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(200)
  subject: string;

  @Field(() => String, { description: 'Cuerpo del radicado' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  description: string;
}
