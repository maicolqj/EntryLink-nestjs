import { createUnionType } from '@nestjs/graphql';
import { User } from '../../entities/user.entity';
import { ResidentialComplex } from '../../../residential-complex/entities/residential-complex.entity';

export const MeResponse = createUnionType({
  name: 'MeResponse',
  types: () => [User, ResidentialComplex] as const,
  resolveType(value) {
    if ('slug' in value) return ResidentialComplex;
    return User;
  },
});
