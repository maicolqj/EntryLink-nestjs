import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, Matches, IsOptional, IsArray, IsBoolean } from 'class-validator';

@InputType()
export class ProcessPrepaidBalancesInput {

  @Field()
  @IsUUID()
  complexId: string;

  /** Período de las facturas recién causadas, YYYY-MM. */
  @Field()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El período debe tener el formato YYYY-MM' })
  period: string;

  /** Subconjunto opcional de unidades; vacío = todas las que tengan anticipo. */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  unitIds?: string[];

  /** Si true, calcula y reporta sin asentar (simulación). */
  @Field({ nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
