import { ObjectLiteral } from 'typeorm';

import { ComplexModule } from '../residential-complex/enums/complex-module.enum';
import { Building } from '../residential-complex/entities/building.entity';
import { Unit } from '../residential-complex/entities/unit.entity';
import { CoefficientWeighting } from '../residential-complex/entities/coefficient-weighting.entity';
import { Resident } from '../residents/entities/resident.entity';
import { Visitor } from '../visitors/entities/visitor.entity';
import { Visit } from '../visitors/entities/visit.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { ParkingRecord } from '../vehicles/entities/parking-record.entity';
import { VisitorVehicle } from '../visitor-parking/entities/visitor-vehicle.entity';
import { Package } from '../packages/entities/package.entity';
import { ChargeCategory } from '../finance/entities/charge-category.entity';
import { FeeConfig } from '../finance/entities/fee-config.entity';
import { RecurringCharge } from '../finance/entities/recurring-charge.entity';
import { ChargeEmission } from '../finance/entities/charge-emission.entity';
import { FeeCharge } from '../finance/entities/fee-charge.entity';
import { Payment } from '../finance/entities/payment.entity';
import { DirectIncome } from '../finance/entities/direct-income.entity';
import { ComplexExpense } from '../finance/entities/complex-expense.entity';
import { WalletEntry } from '../finance/entities/wallet-entry.entity';
import { PropertyAccountStatus } from '../finance/entities/property-account-status.entity';
import { AccountingHeader } from '../finance/entities/accounting-header.entity';
import { AccountingLine } from '../finance/entities/accounting-line.entity';
import { Note } from '../notes/entities/note.entity';
import { UserComplexAssignment } from '../users/entities/user-complex-assignment.entity';
import { SupervisorAccessRequest } from '../supervisor-visits/entities/supervisor-access-request.entity';
import { SupervisorVisit } from '../supervisor-visits/entities/supervisor-visit.entity';
import { SentMessage } from '../messages/entities/sent-message.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CallLog } from '../call-logs/entities/call-log.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { PanicAlert } from '../notifications/entities/panic-alert.entity';
import { Amenity } from '../amenities/entities/amenity.entity';
import { AmenityBooking } from '../amenities/entities/amenity-booking.entity';
import { Pqrf } from '../pqrf/entities/pqrf.entity';
import { VotingMeeting } from '../voting/entities/voting-meeting.entity';
import { VotingQuestion } from '../voting/entities/voting-question.entity';
import { VotingOption } from '../voting/entities/voting-option.entity';
import { Pet } from '../pets/entities/pet.entity';
import { PetIncident } from '../pets/entities/pet-incident.entity';
import { PetIncidentStatement } from '../pets/entities/pet-incident-statement.entity';
import { MaintenanceTicket } from '../maintenance/entities/maintenance-ticket.entity';
import { MaintenanceTicketEvent } from '../maintenance/entities/maintenance-ticket-event.entity';
import { MaintenanceVendor } from '../maintenance/entities/maintenance-vendor.entity';
import { MaintenanceLocationTag } from '../maintenance/entities/maintenance-location-tag.entity';
import { MarketplaceListing } from '../marketplace/entities/marketplace-listing.entity';
import { MarketplaceListingReport } from '../marketplace/entities/marketplace-listing-report.entity';

/** Una hoja del Excel: una entidad y cómo se recorta al complejo. */
export interface ExportEntitySpec {
  entity: new () => ObjectLiteral;
  /** Nombre de la hoja. Excel admite máximo 31 caracteres. */
  sheet: string;
  /**
   * Registros que ocurren en el tiempo (visitas, pagos, tickets): se filtran
   * por el rango de fechas con su `createdAt`. Los datos maestros (unidades,
   * residentes, mascotas) salen completos: un respaldo sin ellos no sirve.
   */
  transactional?: boolean;
  /**
   * Para las entidades sin `complexId`: se recortan por la columna que apunta
   * a un padre que sí lo tiene.
   */
  parent?: { entity: new () => ObjectLiteral; foreignKey: string };
  /**
   * Propiedad con un id de usuario cuyos datos de contacto se agregan a la
   * hoja (correo, teléfono y documento viven en `users`, no en el residente).
   */
  userDetails?: string;
}

export interface ExportModuleSpec {
  module: ComplexModule;
  label: string;
  entities: ExportEntitySpec[];
}

/**
 * Qué se descarga de cada módulo. Las columnas no se listan aquí: salen de la
 * metadata de TypeORM, así que un campo nuevo en una entidad entra solo al
 * respaldo en vez de quedarse por fuera sin que nadie lo note.
 *
 * Los módulos de parqueadero (PARKING_*) no tienen entrada propia: sus
 * registros van en Vehículos.
 *
 * Votaciones no exporta papeletas en crudo: en una pregunta secreta la
 * papeleta dice quién votó qué. El servicio arma los resultados agregados y,
 * solo para las preguntas nominales, el detalle por unidad.
 */
export const DATA_EXPORT_MODULES: ExportModuleSpec[] = [
  {
    module: ComplexModule.EDIFICIOS,
    label: 'Torres',
    entities: [{ entity: Building, sheet: 'Torres' }],
  },
  {
    module: ComplexModule.UNIDADES,
    label: 'Unidades',
    entities: [
      { entity: Unit, sheet: 'Unidades' },
      { entity: CoefficientWeighting, sheet: 'Ponderación coeficientes' },
    ],
  },
  {
    module: ComplexModule.RESIDENTES,
    label: 'Residentes',
    entities: [
      { entity: Resident, sheet: 'Residentes', userDetails: 'userId' },
    ],
  },
  {
    module: ComplexModule.VISITAS,
    label: 'Visitas',
    entities: [
      { entity: Visitor, sheet: 'Visitantes' },
      { entity: Visit, sheet: 'Visitas', transactional: true },
    ],
  },
  {
    module: ComplexModule.VEHICULOS,
    label: 'Vehículos y parqueadero',
    entities: [
      { entity: Vehicle, sheet: 'Vehículos' },
      {
        entity: ParkingRecord,
        sheet: 'Registros de parqueadero',
        transactional: true,
      },
      {
        entity: VisitorVehicle,
        sheet: 'Vehículos visitantes',
        transactional: true,
      },
    ],
  },
  {
    module: ComplexModule.PAQUETES,
    label: 'Paquetes',
    entities: [{ entity: Package, sheet: 'Paquetes', transactional: true }],
  },
  {
    module: ComplexModule.FINANZAS,
    label: 'Finanzas',
    entities: [
      { entity: PropertyAccountStatus, sheet: 'Estado de cuenta' },
      { entity: FeeCharge, sheet: 'Cargos', transactional: true },
      { entity: Payment, sheet: 'Pagos', transactional: true },
      { entity: DirectIncome, sheet: 'Ingresos directos', transactional: true },
      { entity: ComplexExpense, sheet: 'Gastos', transactional: true },
      { entity: WalletEntry, sheet: 'Saldos a favor', transactional: true },
      {
        entity: ChargeEmission,
        sheet: 'Emisiones de cargos',
        transactional: true,
      },
      { entity: AccountingHeader, sheet: 'Comprobantes', transactional: true },
      {
        entity: AccountingLine,
        sheet: 'Movimientos contables',
        transactional: true,
      },
      { entity: RecurringCharge, sheet: 'Cargos recurrentes' },
      { entity: FeeConfig, sheet: 'Configuración de cuotas' },
      { entity: ChargeCategory, sheet: 'Conceptos de cobro' },
    ],
  },
  {
    module: ComplexModule.NOTAS,
    label: 'Notas',
    entities: [{ entity: Note, sheet: 'Notas', transactional: true }],
  },
  {
    module: ComplexModule.PERSONAL,
    label: 'Personal',
    entities: [
      {
        entity: UserComplexAssignment,
        sheet: 'Personal',
        userDetails: 'userId',
      },
      {
        entity: SupervisorAccessRequest,
        sheet: 'Solicitudes supervisores',
        transactional: true,
      },
      {
        entity: SupervisorVisit,
        sheet: 'Visitas de supervisores',
        transactional: true,
      },
    ],
  },
  {
    module: ComplexModule.MENSAJES,
    label: 'Mensajes',
    entities: [{ entity: SentMessage, sheet: 'Mensajes', transactional: true }],
  },
  {
    module: ComplexModule.MOVIMIENTOS,
    label: 'Movimientos',
    entities: [
      { entity: AuditLog, sheet: 'Auditoría', transactional: true },
      { entity: CallLog, sheet: 'Llamadas', transactional: true },
    ],
  },
  {
    module: ComplexModule.NOTIFICACIONES,
    label: 'Notificaciones',
    entities: [
      { entity: Notification, sheet: 'Notificaciones', transactional: true },
      { entity: PanicAlert, sheet: 'Alertas de pánico', transactional: true },
    ],
  },
  {
    module: ComplexModule.ZONAS_COMUNES,
    label: 'Zonas comunes',
    entities: [
      { entity: Amenity, sheet: 'Zonas comunes' },
      { entity: AmenityBooking, sheet: 'Reservas', transactional: true },
    ],
  },
  {
    module: ComplexModule.PQRF,
    label: 'PQRF',
    entities: [{ entity: Pqrf, sheet: 'PQRF', transactional: true }],
  },
  {
    module: ComplexModule.VOTACIONES,
    label: 'Votaciones',
    entities: [
      { entity: VotingMeeting, sheet: 'Asambleas', transactional: true },
      { entity: VotingQuestion, sheet: 'Preguntas', transactional: true },
      {
        entity: VotingOption,
        sheet: 'Opciones',
        parent: { entity: VotingQuestion, foreignKey: 'questionId' },
      },
    ],
  },
  {
    module: ComplexModule.MASCOTAS,
    label: 'Mascotas',
    entities: [
      { entity: Pet, sheet: 'Mascotas' },
      {
        entity: PetIncident,
        sheet: 'Reportes de convivencia',
        transactional: true,
      },
      {
        entity: PetIncidentStatement,
        sheet: 'Expedientes',
        transactional: true,
      },
    ],
  },
  {
    module: ComplexModule.MANTENIMIENTO,
    label: 'Mantenimiento',
    entities: [
      { entity: MaintenanceTicket, sheet: 'Tickets', transactional: true },
      {
        entity: MaintenanceTicketEvent,
        sheet: 'Bitácora de tickets',
        transactional: true,
      },
      { entity: MaintenanceVendor, sheet: 'Proveedores' },
      { entity: MaintenanceLocationTag, sheet: 'Puntos QR' },
    ],
  },
  {
    module: ComplexModule.CLASIFICADOS,
    label: 'Clasificados',
    entities: [
      { entity: MarketplaceListing, sheet: 'Avisos', transactional: true },
      {
        entity: MarketplaceListingReport,
        sheet: 'Denuncias',
        transactional: true,
      },
    ],
  },
];

export function findExportModule(module: string): ExportModuleSpec | undefined {
  return DATA_EXPORT_MODULES.find(
    (spec) => spec.module === (module as ComplexModule),
  );
}
