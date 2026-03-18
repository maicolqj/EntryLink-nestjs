import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsEnum, IsString, Matches } from 'class-validator';
import { ChargeStatus } from '../../enums/charge-status.enum';

@InputType()
export class FilterChargesInput {

  @Field(() => ChargeStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ChargeStatus)
  status?: ChargeStatus;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  unitId?: string;

  /** Filtrar por período YYYY-MM */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Formato de período: YYYY-MM' })
  period?: string;
}
