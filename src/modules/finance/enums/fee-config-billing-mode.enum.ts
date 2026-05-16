import { registerEnumType } from '@nestjs/graphql';

export enum FeeConfigBillingMode {
  ADVANCE = 'ADVANCE',
  ARREARS = 'ARREARS',
}

registerEnumType(FeeConfigBillingMode, { name: 'FeeConfigBillingMode' });
