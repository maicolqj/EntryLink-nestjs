import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsEnum, IsString, MaxLength } from 'class-validator';

import { PqrfType } from '../../enums/pqrf-type.enum';
import { PqrfStatus } from '../../enums/pqrf-status.enum';
import { PqrfAddressee } from '../../enums/pqrf-addressee.enum';

@InputType()
export class FilterPqrfInput {
  @Field(() => PqrfType, { nullable: true })
  @IsOptional()
  @IsEnum(PqrfType)
  type?: PqrfType;

  @Field(() => PqrfStatus, { nullable: true })
  @IsOptional()
  @IsEnum(PqrfStatus)
  status?: PqrfStatus;

  /**
   * Filtra por destinatario DENTRO de lo que quien consulta ya puede ver: no
   * sirve para alcanzar radicados de la otra instancia.
   */
  @Field(() => PqrfAddressee, { nullable: true })
  @IsOptional()
  @IsEnum(PqrfAddressee)
  addressee?: PqrfAddressee;

  @Field(() => String, {
    nullable: true,
    description: 'Busca en el número de radicado y en el asunto',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
