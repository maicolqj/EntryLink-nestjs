import { SpecialNumberCategory } from '../../../../modules/special-numbers/enums/special-number-category.enum';

export interface SpecialNumberSeedData {
  id: string;
  name: string;
  phoneNumber: string;
  category: SpecialNumberCategory;
  description: string | null;
  order: number;
  isGlobal: boolean;
}

// Números globales: visibles en todos los complejos, solo SUPER_ADMIN puede editarlos
export const GLOBAL_SPECIAL_NUMBERS_TO_SEED: SpecialNumberSeedData[] = [
  {
    id:          'a1b2c3d4-1111-4aaa-8bbb-cc1122334455',
    name:        'Policía Nacional',
    phoneNumber: '123',
    category:    SpecialNumberCategory.EMERGENCY,
    description: 'Línea de emergencias policiales 24h',
    order:       1,
    isGlobal:    true,
  },
  {
    id:          'b2c3d4e5-2222-4bbb-8ccc-dd2233445566',
    name:        'Bomberos',
    phoneNumber: '119',
    category:    SpecialNumberCategory.EMERGENCY,
    description: 'Cuerpo de Bomberos — emergencias de incendio',
    order:       2,
    isGlobal:    true,
  },
  {
    id:          'c3d4e5f6-3333-4ccc-8ddd-ee3344556677',
    name:        'Línea de Emergencias',
    phoneNumber: '123',
    category:    SpecialNumberCategory.EMERGENCY,
    description: 'Línea unificada de emergencias',
    order:       3,
    isGlobal:    true,
  },
];
