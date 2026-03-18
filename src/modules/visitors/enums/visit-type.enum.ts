import { registerEnumType } from '@nestjs/graphql';

export enum VisitType {
  WALK_IN          = 'WALK_IN',          // Visita sin cita previa
  SCHEDULED        = 'SCHEDULED',        // Pre-autorizada por el residente (con QR)
  DELIVERY         = 'DELIVERY',         // Domicilio / paquetería
  SERVICE_PROVIDER = 'SERVICE_PROVIDER', // Técnico, plomero, etc.
}

registerEnumType(VisitType, {
  name: 'VisitType',
  description: 'Modalidad de la visita',
  valuesMap: {
    WALK_IN:          { description: 'Sin cita — requiere aprobación del residente en tiempo real' },
    SCHEDULED:        { description: 'Pre-autorizada — genera QR de acceso' },
    DELIVERY:         { description: 'Domicilio o entrega de paquete' },
    SERVICE_PROVIDER: { description: 'Proveedor de servicio: técnico, mantenimiento, etc.' },
  },
});
