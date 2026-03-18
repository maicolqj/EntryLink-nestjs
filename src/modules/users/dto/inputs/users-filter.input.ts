import { InputType, Field, Int } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsUUID, Min, Max } from 'class-validator';

import { UserStatus } from '../../enums/user.enums';

@InputType()
export class UsersFilterInput {
  @Field(() => UserStatus, { nullable: true, description: 'Filtrar por estado del usuario' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @Field(() => String, { nullable: true, description: 'Filtrar por complejo residencial' })
  @IsOptional()
  @IsUUID()
  complexId?: string;

  @Field(() => Int, { nullable: true, defaultValue: 20, description: 'Cantidad de resultados (máx. 100)' })
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;

  @Field(() => Int, { nullable: true, defaultValue: 0, description: 'Desplazamiento para paginación' })
  @IsOptional()
  @Min(0)
  offset?: number;
}
