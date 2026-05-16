import { registerEnumType } from '@nestjs/graphql';

export enum FeeConfigTriggerType {
  VEHICLE = 'VEHICLE',
}

registerEnumType(FeeConfigTriggerType, { name: 'FeeConfigTriggerType' });
