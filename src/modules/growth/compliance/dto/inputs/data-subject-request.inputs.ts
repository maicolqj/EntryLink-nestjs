import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  GrowthDataSubjectRequestStatus,
  GrowthDataSubjectRequestType,
  GrowthIdentifierType,
  GrowthRequestChannel,
} from '../../../shared/growth.enums';

@InputType()
export class GrowthCreateDataSubjectRequestInput {
  @Field(() => GrowthDataSubjectRequestType)
  @IsEnum(GrowthDataSubjectRequestType)
  requestType: GrowthDataSubjectRequestType;

  @Field(() => GrowthRequestChannel)
  @IsEnum(GrowthRequestChannel)
  channel: GrowthRequestChannel;

  @Field(() => GrowthIdentifierType)
  @IsEnum(GrowthIdentifierType)
  identifierType: GrowthIdentifierType;

  @Field({
    description: 'Dato que identifica al titular; se guarda solo su hash',
  })
  @IsString()
  @Length(3, 320)
  identifierValue: string;

  @Field({
    nullable: true,
    description: 'Medio de respuesta. Se borra al cerrar la solicitud.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 320)
  subjectContact?: string;

  @Field({
    nullable: true,
    description: 'Fecha de recepción. Vacío = ahora. No puede ser futura.',
  })
  @IsOptional()
  @IsDate()
  receivedAt?: Date;
}

@InputType()
export class GrowthExtendDataSubjectRequestInput {
  @Field({
    description: 'Motivo de la prórroga, que debe informarse al titular',
  })
  @IsString()
  @Length(10, 2000)
  reason: string;
}

@InputType()
export class GrowthCloseDataSubjectRequestInput {
  @Field(() => GrowthDataSubjectRequestStatus, {
    description: 'RESOLVED o REJECTED',
  })
  @IsEnum(GrowthDataSubjectRequestStatus)
  outcome: GrowthDataSubjectRequestStatus;

  @Field()
  @IsString()
  @Length(10, 4000)
  resolutionNotes: string;
}

@InputType()
export class GrowthDataSubjectRequestFilterInput {
  @Field(() => GrowthDataSubjectRequestStatus, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthDataSubjectRequestStatus)
  status?: GrowthDataSubjectRequestStatus;

  @Field({
    nullable: true,
    description: 'Solo las abiertas con el plazo vencido',
  })
  @IsOptional()
  @IsBoolean()
  overdue?: boolean;
}
