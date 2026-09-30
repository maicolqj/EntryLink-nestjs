import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { ComplexDocument } from '../entities/complex-document.entity';
import { ComplexDocumentAck } from '../entities/complex-document-ack.entity';
import {
  CreateComplexDocumentInput,
  UpdateComplexDocumentInput,
} from '../dto/complex-info.inputs';
import {
  ComplexDocumentAckEntry,
  ComplexDocumentAckReport,
  MyComplexDocument,
} from '../dto/complex-info.responses';
import {
  ComplexDocumentAudience,
  ComplexDocumentCategory,
} from '../enums/complex-info.enums';
import {
  ComplexInfoAccessService,
  unitLabelOf,
} from './complex-info-access.service';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { docxBase64ToHtml } from '../../shared/utils/docx-html.utils';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexInfoErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

export const CATEGORY_LABELS: Record<ComplexDocumentCategory, string> = {
  [ComplexDocumentCategory.COEXISTENCE_MANUAL]: 'Manual de convivencia',
  [ComplexDocumentCategory.BYLAWS]: 'Reglamento de propiedad horizontal',
  [ComplexDocumentCategory.COMMON_AREA_RULES]: 'Normas de zonas comunes',
  [ComplexDocumentCategory.CIRCULARS]: 'Circulares y comunicados',
  [ComplexDocumentCategory.ASSEMBLY_MINUTES]: 'Actas de asamblea y consejo',
  [ComplexDocumentCategory.FINANCIAL_REPORTS]:
    'Estados financieros y presupuesto',
  [ComplexDocumentCategory.INSURANCE]: 'Pólizas y certificados',
  [ComplexDocumentCategory.FORMS]: 'Formatos y solicitudes',
  [ComplexDocumentCategory.OTHER]: 'Otros documentos',
};

const CATEGORY_ORDER = Object.values(ComplexDocumentCategory);

/** Destacados primero, luego por sección y lo más reciente arriba. */
function byRelevance(a: ComplexDocument, b: ComplexDocument): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  const byCategory =
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  if (byCategory !== 0) return byCategory;
  const at = (a.publishedAt ?? a.createdAt).getTime();
  const bt = (b.publishedAt ?? b.createdAt).getTime();
  return bt - at;
}

export interface ComplexDocumentFile {
  key: string;
  fileName: string;
}

/**
 * Documentos de "Mi Conjunto".
 *
 * La administración los arma como borrador (texto de un Word, PDF o ambos) y
 * los publica; publicar —o cambiar el contenido de uno publicado— avisa a los
 * residentes a quienes va dirigido. Cada cambio de contenido de un documento
 * ya publicado sube la versión, y con ella el acuse de lectura vuelve a quedar
 * pendiente.
 */
@Injectable()
export class ComplexDocumentsService {
  private readonly logger = new Logger(ComplexDocumentsService.name);

  constructor(
    @InjectRepository(ComplexDocument)
    private readonly docRepo: Repository<ComplexDocument>,
    @InjectRepository(ComplexDocumentAck)
    private readonly ackRepo: Repository<ComplexDocumentAck>,
    private readonly access: ComplexInfoAccessService,
    private readonly complexService: ResidentialComplexService,
    private readonly storage: R2StorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Administración ────────────────────────────────────────────────

  async listAdmin(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<ComplexDocument[]> {
    await this.access.assertAdmin(complexId, user);
    const docs = await this.docRepo.find({
      where: { complexId, deletedAt: IsNull() },
    });
    return docs.sort(byRelevance);
  }

  async create(
    input: CreateComplexDocumentInput,
    user: JwtAccessPayload,
  ): Promise<ComplexDocument> {
    await this.access.assertAdmin(input.complexId, user);

    const contentHtml = input.docxBase64
      ? await docxBase64ToHtml(input.docxBase64)
      : null;

    const doc = this.docRepo.create({
      complexId: input.complexId,
      category: input.category,
      title: input.title,
      description: input.description ?? null,
      contentHtml,
      audience: input.audience ?? ComplexDocumentAudience.ALL_RESIDENTS,
      isPinned: input.isPinned ?? false,
      requiresAcknowledgement: input.requiresAcknowledgement ?? false,
      effectiveDate: input.effectiveDate ?? null,
      // Siempre nace como borrador: publicar es un paso aparte y explícito.
      isPublished: false,
      version: 1,
      contentUpdatedAt: new Date(),
      createdById: user.sub,
      updatedById: user.sub,
    });

    const saved = await this.docRepo.save(doc);
    this.logger.log(`Documento creado: ${saved.id} (${saved.complexId})`);
    return saved;
  }

  async update(
    id: string,
    input: UpdateComplexDocumentInput,
    user: JwtAccessPayload,
  ): Promise<ComplexDocument> {
    const doc = await this.findOrFail(id);
    await this.access.assertAdmin(doc.complexId, user);

    const wasPublished = doc.isPublished;

    if (input.category !== undefined) doc.category = input.category;
    if (input.title !== undefined) doc.title = input.title;
    if (input.description !== undefined) doc.description = input.description;
    if (input.audience !== undefined) doc.audience = input.audience;
    if (input.isPinned !== undefined) doc.isPinned = input.isPinned;
    if (input.requiresAcknowledgement !== undefined) {
      doc.requiresAcknowledgement = input.requiresAcknowledgement;
    }
    if (input.effectiveDate !== undefined) {
      doc.effectiveDate = input.effectiveDate || null;
    }

    let contentChanged = false;
    if (input.docxBase64) {
      doc.contentHtml = await docxBase64ToHtml(input.docxBase64);
      contentChanged = true;
    } else if (input.removeContent && doc.contentHtml) {
      doc.contentHtml = null;
      contentChanged = true;
    }

    let fileToDelete: string | null = null;
    if (input.removeFile && doc.fileKey) {
      fileToDelete = doc.fileKey;
      doc.fileKey = null;
      doc.fileName = null;
      doc.fileSize = null;
      contentChanged = true;
    }

    if (contentChanged) this.markContentChanged(doc);

    if (input.isPublished !== undefined) {
      doc.isPublished = input.isPublished;
      if (input.isPublished && !wasPublished) doc.publishedAt = new Date();
    }

    this.assertHasContentIfPublished(doc);

    doc.updatedById = user.sub;
    const saved = await this.docRepo.save(doc);

    if (fileToDelete) this.deleteFile(fileToDelete);

    if (input.notifyResidents !== false && saved.isPublished) {
      if (!wasPublished) this.notify(saved, false);
      else if (contentChanged) this.notify(saved, true);
    }

    return saved;
  }

  /** Adjunta o reemplaza el PDF. El archivo ya pasó el filtro de tipo y tamaño. */
  async attachFile(
    id: string,
    file: Express.Multer.File,
    user: JwtAccessPayload,
    notifyResidents = true,
  ): Promise<ComplexDocument> {
    const doc = await this.findOrFail(id);
    await this.access.assertAdmin(doc.complexId, user);

    // Firma "%PDF": el mimetype lo declara el cliente, la firma no se inventa.
    if (file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new CustomError({
        message: 'El archivo debe ser un PDF válido',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ComplexInfoErrorCode.COMPLEX_DOCUMENT_INVALID_FILE,
      });
    }

    const slug = await this.complexService.getSlugById(doc.complexId);
    const folder = this.storage.buildFolder(slug, 'complex-documents');
    const uploaded = await this.storage.uploadBuffer(
      file.buffer,
      folder,
      file.originalname || 'documento.pdf',
      'raw',
    );

    const previousKey = doc.fileKey;
    doc.fileKey = uploaded.publicId;
    doc.fileName = file.originalname || `${doc.title}.pdf`;
    doc.fileSize = file.size;
    doc.updatedById = user.sub;
    this.markContentChanged(doc);

    let saved: ComplexDocument;
    try {
      saved = await this.docRepo.save(doc);
    } catch (error) {
      this.deleteFile(uploaded.publicId);
      throw error;
    }

    if (previousKey) this.deleteFile(previousKey);
    if (notifyResidents && saved.isPublished) this.notify(saved, true);
    return saved;
  }

  async remove(id: string, user: JwtAccessPayload): Promise<boolean> {
    const doc = await this.findOrFail(id);
    await this.access.assertAdmin(doc.complexId, user);

    await this.docRepo.softDelete(doc.id);
    // El PDF sí se borra: un documento retirado no debe seguir pagando R2 ni
    // quedar recuperable por su llave.
    if (doc.fileKey) {
      await this.docRepo.update(doc.id, {
        fileKey: null,
        fileName: null,
        fileSize: null,
      });
      this.deleteFile(doc.fileKey);
    }
    this.logger.log(`Documento eliminado: ${doc.id}`);
    return true;
  }

  async ackReport(
    id: string,
    user: JwtAccessPayload,
  ): Promise<ComplexDocumentAckReport> {
    const doc = await this.findOrFail(id);
    await this.access.assertAdmin(doc.complexId, user);

    const [residents, acks] = await Promise.all([
      this.access.audienceResidents(doc.complexId, doc.audience),
      this.ackRepo.find({
        where: { documentId: doc.id, version: doc.version },
        order: { acknowledgedAt: 'ASC' },
      }),
    ]);

    // Por unidad: basta con que una persona del hogar confirme.
    const byUnit = new Map<string, Resident[]>();
    for (const r of residents) {
      const list = byUnit.get(r.unitId) ?? [];
      list.push(r);
      byUnit.set(r.unitId, list);
    }

    const firstAckByUnit = new Map<string, ComplexDocumentAck>();
    for (const ack of acks) {
      if (!firstAckByUnit.has(ack.unitId)) firstAckByUnit.set(ack.unitId, ack);
    }

    const units: ComplexDocumentAckEntry[] = [...byUnit.entries()].map(
      ([unitId, household]) => {
        const ack = firstAckByUnit.get(unitId);
        const who =
          (ack && household.find((r) => r.userId === ack.userId)) ??
          household.find((r) => r.isMainResident) ??
          household[0];
        const name = [who.user?.name, who.user?.lastName]
          .filter(Boolean)
          .join(' ');
        return {
          unitId,
          unitLabel: unitLabelOf(who),
          residentName: name || null,
          acknowledgedAt: ack?.acknowledgedAt ?? null,
        };
      },
    );

    units.sort((a, b) => {
      if (!!a.acknowledgedAt !== !!b.acknowledgedAt) {
        return a.acknowledgedAt ? 1 : -1;
      }
      return a.unitLabel.localeCompare(b.unitLabel, 'es', { numeric: true });
    });

    return {
      documentId: doc.id,
      version: doc.version,
      totalUnits: units.length,
      acknowledgedUnits: units.filter((u) => u.acknowledgedAt).length,
      units,
    };
  }

  // ── Residente ─────────────────────────────────────────────────────

  /** Publicados y dirigidos a él, sin el texto completo. */
  async listForResident(
    complexId: string,
    user: JwtAccessPayload,
  ): Promise<{ documents: MyComplexDocument[]; pending: number }> {
    const residences = await this.access.myResidences(complexId, user);

    // Sin `content_html`: en la lista pesa y no se muestra; basta saber si
    // existe.
    const { entities, raw } = await this.docRepo
      .createQueryBuilder('d')
      .select([
        'd.id',
        'd.complexId',
        'd.category',
        'd.title',
        'd.description',
        'd.fileName',
        'd.fileSize',
        'd.audience',
        'd.isPublished',
        'd.publishedAt',
        'd.isPinned',
        'd.requiresAcknowledgement',
        'd.effectiveDate',
        'd.version',
        'd.contentUpdatedAt',
        'd.createdAt',
        'd.updatedAt',
      ])
      .addSelect('d.content_html IS NOT NULL', 'has_content')
      .where('d.complexId = :complexId', { complexId })
      .andWhere('d.isPublished = true')
      .getRawAndEntities();

    const hasContent = new Map<string, boolean>(
      raw.map((r: { d_id: string; has_content: boolean }) => [
        r.d_id,
        !!r.has_content,
      ]),
    );

    const visible = entities
      .filter((d) => this.access.canSee(d.audience, residences))
      .sort(byRelevance);

    const acks = visible.length
      ? await this.ackRepo.find({
          where: {
            userId: user.sub,
            documentId: In(visible.map((d) => d.id)),
          },
        })
      : [];

    const documents = visible.map((d) => {
      // Solo cuenta el acuse de la versión vigente.
      const ack = acks.find(
        (a) => a.documentId === d.id && a.version === d.version,
      );
      return {
        document: d,
        acknowledgedAt: ack?.acknowledgedAt ?? null,
        hasContent: hasContent.get(d.id) ?? false,
        hasFile: !!d.fileName,
      };
    });

    const pending = documents.filter(
      (d) => d.document.requiresAcknowledgement && !d.acknowledgedAt,
    ).length;

    return { documents, pending };
  }

  async getForResident(
    id: string,
    user: JwtAccessPayload,
  ): Promise<MyComplexDocument> {
    const doc = await this.findOrFail(id);
    await this.assertResidentCanRead(doc, user);

    const ack = await this.ackRepo.findOne({
      where: { documentId: doc.id, version: doc.version, userId: user.sub },
    });
    return {
      document: doc,
      acknowledgedAt: ack?.acknowledgedAt ?? null,
      hasContent: !!doc.contentHtml,
      hasFile: !!doc.fileKey,
    };
  }

  async acknowledge(
    id: string,
    user: JwtAccessPayload,
  ): Promise<MyComplexDocument> {
    const doc = await this.findOrFail(id);
    const residences = await this.assertResidentCanRead(doc, user);

    if (!doc.requiresAcknowledgement) {
      throw new CustomError({
        message: 'Este documento no pide confirmación de lectura',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ComplexInfoErrorCode.COMPLEX_DOCUMENT_ACK_NOT_REQUIRED,
      });
    }

    // Idempotente: confirmar dos veces la misma versión no duplica nada.
    await this.ackRepo
      .createQueryBuilder()
      .insert()
      .values({
        documentId: doc.id,
        version: doc.version,
        userId: user.sub,
        unitId: residences[0].unitId,
      })
      .orIgnore()
      .execute();

    return this.getForResident(id, user);
  }

  /**
   * Resuelve el PDF para servirlo. La administración lo ve siempre (también en
   * borrador); el residente, solo si está publicado y va dirigido a él.
   */
  async resolveFile(
    id: string,
    user: JwtAccessPayload,
  ): Promise<ComplexDocumentFile> {
    const doc = await this.findOrFail(id);

    if (this.access.isAdmin(user)) {
      await this.access.assertAdmin(doc.complexId, user);
    } else {
      await this.assertResidentCanRead(doc, user);
    }

    if (!doc.fileKey) {
      throw new CustomError({
        message: 'Este documento no tiene PDF adjunto',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexInfoErrorCode.COMPLEX_DOCUMENT_NO_FILE,
      });
    }
    return { key: doc.fileKey, fileName: doc.fileName ?? `${doc.title}.pdf` };
  }

  // ── Internos ──────────────────────────────────────────────────────

  private async findOrFail(id: string): Promise<ComplexDocument> {
    const doc = await this.docRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!doc) {
      throw new CustomError({
        message: 'Documento no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexInfoErrorCode.COMPLEX_DOCUMENT_NOT_FOUND,
      });
    }
    return doc;
  }

  /**
   * Un borrador o un documento solo para propietarios responde "no
   * encontrado", no "prohibido": al residente no le consta que existe.
   */
  private async assertResidentCanRead(
    doc: ComplexDocument,
    user: JwtAccessPayload,
  ): Promise<Resident[]> {
    const residences = await this.access.myResidences(doc.complexId, user);
    if (!doc.isPublished || !this.access.canSee(doc.audience, residences)) {
      throw new CustomError({
        message: 'Documento no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexInfoErrorCode.COMPLEX_DOCUMENT_NOT_FOUND,
      });
    }
    return residences;
  }

  /** Solo sube la versión si ya lo leyó alguien: los borradores no cuentan. */
  private markContentChanged(doc: ComplexDocument): void {
    if (doc.publishedAt) doc.version += 1;
    doc.contentUpdatedAt = new Date();
  }

  private assertHasContentIfPublished(doc: ComplexDocument): void {
    if (doc.isPublished && !doc.contentHtml && !doc.fileKey) {
      throw new CustomError({
        message:
          'Para publicar el documento carga el texto desde un Word o adjunta un PDF',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ComplexInfoErrorCode.COMPLEX_DOCUMENT_EMPTY,
      });
    }
  }

  private deleteFile(key: string): void {
    this.storage
      .deleteByPublicId(key, 'raw')
      .catch((err: Error) =>
        this.logger.warn(`No se pudo borrar ${key} de R2: ${err.message}`),
      );
  }

  /** Fuera del request: un aviso que falla no deshace la publicación. */
  private notify(doc: ComplexDocument, isUpdate: boolean): void {
    this.sendNotification(doc, isUpdate).catch((err: Error) =>
      this.logger.warn(`Error avisando el documento ${doc.id}: ${err.message}`),
    );
  }

  private async sendNotification(
    doc: ComplexDocument,
    isUpdate: boolean,
  ): Promise<void> {
    const residents = await this.access.audienceResidents(
      doc.complexId,
      doc.audience,
    );
    const userIds = [...new Set(residents.map((r) => r.userId))];
    if (userIds.length === 0) return;

    const section = CATEGORY_LABELS[doc.category];
    const ask = doc.requiresAcknowledgement
      ? ' La administración te pide confirmar que lo leíste.'
      : '';

    await this.notificationsService.notify({
      complexId: doc.complexId,
      userIds,
      type: NotificationType.COMPLEX_DOCUMENT_PUBLISHED,
      priority: doc.requiresAcknowledgement
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL,
      title: isUpdate
        ? `📄 Se actualizó: ${doc.title}`
        : `📄 Nuevo en Mi Conjunto: ${doc.title}`,
      body: `${section}.${ask}`,
      entityId: doc.id,
      entityType: 'complex_document',
      metadata: { documentId: doc.id, version: doc.version },
    });
  }
}
