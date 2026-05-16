import { registerEnumType } from '@nestjs/graphql';

export enum SpecialNumberCategory {
  EMERGENCY      = 'EMERGENCY',
  SECURITY       = 'SECURITY',
  MAINTENANCE    = 'MAINTENANCE',
  ADMINISTRATION = 'ADMINISTRATION',
  OTHER          = 'OTHER',
}

registerEnumType(SpecialNumberCategory, {
  name: 'SpecialNumberCategory',
  description: 'Categoría del número especial de marcado rápido',
  valuesMap: {
    EMERGENCY:      { description: 'Emergencias (policía, bomberos, ambulancia)' },
    SECURITY:       { description: 'Seguridad interna (supervisor, central de monitoreo)' },
    MAINTENANCE:    { description: 'Mantenimiento del conjunto' },
    ADMINISTRATION: { description: 'Administración' },
    OTHER:          { description: 'Otro' },
  },
});
