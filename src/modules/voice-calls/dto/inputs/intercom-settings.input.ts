import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsEnum, IsUUID } from 'class-validator';

import { IntercomMode } from '../../../residential-complex/enums/intercom-mode.enum';

@InputType()
export class UpdateIntercomSettingsInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => IntercomMode)
  @IsEnum(IntercomMode)
  mode: IntercomMode;

  @Field(() => Boolean, {
    description:
      'El residente puede llamar a portería por la app (solo aplica en INTERNET)',
  })
  @IsBoolean()
  residentCallsEnabled: boolean;
}
