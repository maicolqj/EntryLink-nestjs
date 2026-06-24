import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsEnum, Matches } from 'class-validator';

import { AccountingDocumentType } from '../../enums/accounting-document-type.enum';

@InputType()
export class FilterAccountingDocumentsInput {

  @Field()
  @IsUUID()
  complexId: string;

  @Field(() => AccountingDocumentType, { nullable: true })
  @IsOptional()
  @IsEnum(AccountingDocumentType)
  documentType?: AccountingDocumentType;

  /** YYYY-MM */
  @Field({ nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El período debe tener el formato YYYY-MM' })
  period?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
