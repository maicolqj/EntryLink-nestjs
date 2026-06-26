import { registerEnumType } from '@nestjs/graphql';

/**
 * A qué unidades aplica una regla de emisión.
 *
 *  - ALL:           todas las unidades del complejo.
 *  - UNIT_TYPE:     unidades de un `UnitType` (targetValue.unitType).
 *  - SPECIFIC_UNITS: lista explícita de ids (targetValue.unitIds).
 *  - TARGET_RULES:  segmentación por reglas reutilizando FeeConfigTargetRules
 *                   (targetValue: { excludeFloor1, floorMin, floorMax, buildingIds, unitTypes }).
 *
 * Nota: el prompt original contemplaba BILLING_GROUP; en este proyecto la
 * segmentación reutiliza `TARGET_RULES` (no se persiste una entidad de grupo).
 */
export enum ChargeRuleTargetType {
  ALL           = 'ALL',
  UNIT_TYPE     = 'UNIT_TYPE',
  SPECIFIC_UNITS = 'SPECIFIC_UNITS',
  TARGET_RULES  = 'TARGET_RULES',
}

registerEnumType(ChargeRuleTargetType, {
  name: 'ChargeRuleTargetType',
  description: 'Alcance de una regla de emisión de cargos',
});
