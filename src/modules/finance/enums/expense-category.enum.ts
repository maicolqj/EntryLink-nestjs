import { registerEnumType } from '@nestjs/graphql';

export enum ExpenseCategory {
  SUPPLIES      = 'SUPPLIES',       // Insumos y materiales
  REPAIRS       = 'REPAIRS',        // Reparaciones y obras
  UTILITIES     = 'UTILITIES',      // Servicios públicos (agua, luz, gas, internet)
  SALARIES      = 'SALARIES',       // Salarios y nómina
  MAINTENANCE   = 'MAINTENANCE',    // Mantenimiento preventivo
  SECURITY      = 'SECURITY',       // Vigilancia y seguridad (empresas externas)
  INSURANCE     = 'INSURANCE',      // Seguros
  ADMINISTRATIVE = 'ADMINISTRATIVE', // Gastos administrativos y papelería
  OTHER         = 'OTHER',          // Otros
}

registerEnumType(ExpenseCategory, {
  name: 'ExpenseCategory',
  description: 'Categoría del gasto operativo del complejo',
  valuesMap: {
    SUPPLIES:       { description: 'Insumos y materiales' },
    REPAIRS:        { description: 'Reparaciones y obras' },
    UTILITIES:      { description: 'Servicios públicos' },
    SALARIES:       { description: 'Salarios y nómina' },
    MAINTENANCE:    { description: 'Mantenimiento preventivo' },
    SECURITY:       { description: 'Vigilancia y seguridad' },
    INSURANCE:      { description: 'Seguros' },
    ADMINISTRATIVE: { description: 'Gastos administrativos' },
    OTHER:          { description: 'Otros' },
  },
});
