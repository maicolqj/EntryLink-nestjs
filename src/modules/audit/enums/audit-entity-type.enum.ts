import { registerEnumType } from '@nestjs/graphql';

// Values must match the TypeORM entity class names exactly
// so DataSource.entityMetadatas.find(m => m.name === value) works
export enum AuditEntityType {
  User = 'User',
  Vehicle = 'Vehicle',
  ParkingRecord = 'ParkingRecord',
  ParkingConfig = 'ParkingConfig',
  Resident = 'Resident',
  FeeCharge = 'FeeCharge',
  FeeConfig = 'FeeConfig',
  PucAccount = 'PucAccount',
  Payment = 'Payment',
  Note = 'Note',
  Pqrf = 'Pqrf',
  ResidentialComplex = 'ResidentialComplex',
  Unit = 'Unit',
  Building = 'Building',
  VisitorVehicle = 'VisitorVehicle',
  Visit = 'Visit',
  Visitor = 'Visitor',
  SupervisorVisit = 'SupervisorVisit',
  SupervisorAccessRequest = 'SupervisorAccessRequest',
  SentMessage = 'SentMessage',
  CallLog = 'CallLog',
  SpecialNumber = 'SpecialNumber',
  Amenity = 'Amenity',
  AmenityBooking = 'AmenityBooking',
  VotingMeeting = 'VotingMeeting',
  VotingQuestion = 'VotingQuestion',
  Pet = 'Pet',
  PetIncident = 'PetIncident',
  MaintenanceTicket = 'MaintenanceTicket',
  MaintenanceVendor = 'MaintenanceVendor',
  MaintenanceLocationTag = 'MaintenanceLocationTag',
  MarketplaceListing = 'MarketplaceListing',
  DataExport = 'DataExport',
}

registerEnumType(AuditEntityType, {
  name: 'AuditEntityType',
  description: 'Tipo de entidad afectada en el historial de auditoría',
});
