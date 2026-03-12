// dto/sort.dto.ts

import { InputType, Field, registerEnumType } from '@nestjs/graphql';
import { IsString, IsEnum, IsOptional } from 'class-validator';

// Enum para la dirección
export enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

registerEnumType(SortDirection, {
  name: 'SortDirection',
  description: 'Dirección del ordenamiento',
});

@InputType()
export class SortInput {
  @Field({ defaultValue: 'createdAt', nullable: true })
  @IsOptional()
  @IsString()
  field?: string;

  @Field(() => SortDirection, { defaultValue: SortDirection.DESC, nullable: true })
  @IsOptional()
  @IsEnum(SortDirection)
  direction?: SortDirection;
}