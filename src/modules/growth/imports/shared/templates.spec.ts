import { ValidPermissions as P } from '../../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import {
  GrowthImportField as F,
  GrowthImportTarget as T,
  GrowthImportTemplateScope as Scope,
} from '../imports.enums';
import {
  canEditTemplate,
  canManageTeamTemplates,
  canReadTemplate,
  looksLikeContactValue,
  normalizeTemplateName,
  templateMappingProblems,
  templateNameProblem,
} from './templates';

const actor = (sub: string, permissions: P[] = [], roles: ValidRoles[] = []) =>
  ({ sub, permissions, roles }) as unknown as JwtAccessPayload;
const ana = actor('ana', [P.IMPORT_GROWTH_DATA]);
const beto = actor('beto', [P.IMPORT_GROWTH_DATA]);
const jefa = actor('jefa', [
  P.IMPORT_GROWTH_DATA,
  P.MANAGE_GROWTH_IMPORT_TEMPLATES,
]);
const root = actor('root', [], [ValidRoles.SUPER_ADMIN_ROL]);

const personalDeAna = {
  scope: Scope.PERSONAL,
  ownerUserId: 'ana',
  archivedAt: null,
};
const delEquipo = { scope: Scope.TEAM, ownerUserId: 'ana', archivedAt: null };

describe('Plantillas de importación: quién ve y quién edita', () => {
  it('una personal solo la ve y la edita su dueño', () => {
    expect(canReadTemplate(personalDeAna, ana)).toBe(true);
    expect(canEditTemplate(personalDeAna, ana)).toBe(true);
    expect(canReadTemplate(personalDeAna, beto)).toBe(false);
    expect(canEditTemplate(personalDeAna, beto)).toBe(false);
    // Ni con permiso de gestión se toca la personal de otro.
    expect(canReadTemplate(personalDeAna, jefa)).toBe(false);
    expect(canEditTemplate(personalDeAna, jefa)).toBe(false);
  });

  it('una del equipo la ve todo quien importa; solo la gestión la cambia', () => {
    for (const a of [ana, beto, jefa])
      expect(canReadTemplate(delEquipo, a)).toBe(true);
    // Su autora sin permiso de gestión tampoco la edita.
    expect(canEditTemplate(delEquipo, ana)).toBe(false);
    expect(canEditTemplate(delEquipo, beto)).toBe(false);
    expect(canEditTemplate(delEquipo, jefa)).toBe(true);
    expect(canEditTemplate(delEquipo, root)).toBe(true);
  });

  it('una archivada no se edita', () => {
    const archived = { ...personalDeAna, archivedAt: new Date() };
    expect(canEditTemplate(archived, ana)).toBe(false);
    expect(
      canEditTemplate({ ...delEquipo, archivedAt: new Date() }, jefa),
    ).toBe(false);
  });

  it('crear del equipo o compartir exige el permiso de gestión (o SUPER_ADMIN)', () => {
    expect(canManageTeamTemplates(ana)).toBe(false);
    expect(canManageTeamTemplates(jefa)).toBe(true);
    expect(canManageTeamTemplates(root)).toBe(true);
  });
});

describe('Plantillas de importación: contenido', () => {
  it('el nombre se normaliza y tiene entre 2 y 80 caracteres', () => {
    expect(normalizeTemplateName('  Directorio   IT ')).toBe('Directorio IT');
    expect(templateNameProblem('x')).toMatch(/entre 2 y 80/);
    expect(templateNameProblem('a'.repeat(81))).toMatch(/entre 2 y 80/);
    expect(templateNameProblem('Directorio IT')).toBeNull();
  });

  it('acepta encabezados con su campo del destino', () => {
    expect(
      templateMappingProblems(T.ORGANIZATIONS, [
        { header: 'Razón social', field: F.LEGAL_NAME },
        { header: 'NIT', field: F.NIT },
      ]),
    ).toEqual([]);
  });

  it('rechaza un correo o un teléfono como encabezado: la plantilla no guarda datos', () => {
    expect(looksLikeContactValue('ana@empresa.co')).toBe(true);
    expect(looksLikeContactValue('3001234567')).toBe(true);
    expect(looksLikeContactValue('Teléfono')).toBe(false);
    expect(
      templateMappingProblems(T.ORGANIZATIONS, [
        { header: 'ana@empresa.co', field: F.EMAIL },
      ]).join(' '),
    ).toMatch(/no puede ser un correo ni un teléfono/);
  });

  it('rechaza vacío, campos de otro destino, repetidos y más de 100 columnas', () => {
    expect(templateMappingProblems(T.ORGANIZATIONS, [])).toEqual([
      'La plantilla necesita al menos una columna',
    ]);
    const problems = templateMappingProblems(T.PROPERTIES, [
      { header: 'NIT', field: F.FULL_NAME },
      { header: 'nit', field: F.NIT },
      { header: '', field: F.NAME },
    ]).join(' | ');
    expect(problems).toMatch(/fullName no aplica/);
    expect(problems).toMatch(/Encabezado repetido/);
    expect(problems).toMatch(/entre 1 y 200/);
    const many = Array.from({ length: 101 }, (_, i) => ({
      header: `Columna ${i}`,
      field: F.NAME,
    }));
    expect(templateMappingProblems(T.PROPERTIES, many).join(' ')).toMatch(
      /hasta 100 columnas/,
    );
  });
});
