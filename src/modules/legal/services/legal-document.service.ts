import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';

import { LegalDocument } from '../entities/legal-document.entity';
import { LegalAudience } from '../enums/legal-audience.enum';
import { CreateLegalDocumentInput } from '../dto/inputs/create-legal-document.input';
import { UpdateLegalDocumentInput } from '../dto/inputs/update-legal-document.input';
import { R2StorageService } from '../../../core/infrastructure/r2/r2.service';

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'ul', 'ol', 'li', 'blockquote',
    'strong', 'em', 'b', 'i', 'u', 's', 'br', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'sup', 'sub', 'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    '*': ['id'],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }, true),
  },
};

@Injectable()
export class LegalDocumentService {
  private readonly logger = new Logger(LegalDocumentService.name);

  constructor(
    @InjectRepository(LegalDocument)
    private readonly repo: Repository<LegalDocument>,
    private readonly storage: R2StorageService,
  ) {}

  /** Sube un PDF (base64) a R2 y devuelve {url, publicId}. */
  private async uploadPdf(base64: string, slug: string, fileName?: string): Promise<{ url: string; publicId: string }> {
    const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(clean, 'base64');
    } catch {
      throw new BadRequestException('El PDF no es un base64 válido.');
    }
    if (!buffer.length) throw new BadRequestException('El PDF está vacío.');
    // Firma de PDF: "%PDF"
    if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new BadRequestException('El archivo descargable debe ser un PDF.');
    }
    const folder = this.storage.buildFolder('legal', slug);
    const result = await this.storage.uploadBuffer(buffer, folder, fileName ?? `${slug}.pdf`, 'raw');
    return { url: result.url, publicId: result.publicId };
  }

  /** Convierte un .docx (base64) a HTML sanitizado. */
  private async docxToHtml(base64: string): Promise<string> {
    const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(clean, 'base64');
    } catch {
      throw new BadRequestException('El archivo no es un base64 válido.');
    }
    if (!buffer.length) {
      throw new BadRequestException('El archivo está vacío.');
    }

    let rawHtml: string;
    try {
      const result = await mammoth.convertToHtml({ buffer });
      rawHtml = result.value;
    } catch (err: any) {
      this.logger.error(`Error convirtiendo .docx: ${err.message}`);
      throw new BadRequestException('No se pudo procesar el archivo .docx. Verifica que sea un Word válido.');
    }

    const html = sanitizeHtml(rawHtml, SANITIZE_OPTIONS).trim();
    if (!html) {
      throw new BadRequestException('El documento no contiene texto legible.');
    }
    return html;
  }

  // ── Lectura pública ────────────────────────────────────────────────

  /** Lista de documentos PÚBLICOS publicados (sin el HTML completo). */
  findAllPublished(): Promise<LegalDocument[]> {
    return this.repo.find({
      where: { isPublished: true, audience: LegalAudience.PUBLIC },
      order: { title: 'ASC' },
      select: ['id', 'slug', 'title', 'description', 'updatedAt', 'version'],
    });
  }

  /** Documento PÚBLICO publicado por slug (con contenido). */
  async findPublishedBySlug(slug: string): Promise<LegalDocument> {
    const doc = await this.repo.findOne({
      where: { slug, isPublished: true, audience: LegalAudience.PUBLIC },
    });
    if (!doc) throw new NotFoundException(`Documento legal "${slug}" no encontrado`);
    return doc;
  }

  /**
   * Documentos dirigidos a complejos registrados (audience COMPLEX, publicados).
   * Consumido por el dashboard del complejo autenticado. Incluye la URL de descarga.
   */
  findComplexDocuments(): Promise<LegalDocument[]> {
    return this.repo.find({
      where: { isPublished: true, audience: LegalAudience.COMPLEX },
      order: { title: 'ASC' },
    });
  }

  // ── Administración (SUPER_ADMIN) ───────────────────────────────────

  /** Todos los documentos, incluidos los no publicados. */
  findAllAdmin(): Promise<LegalDocument[]> {
    return this.repo.find({ order: { title: 'ASC' } });
  }

  async findById(id: string): Promise<LegalDocument> {
    const doc = await this.repo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Documento legal no encontrado');
    return doc;
  }

  async create(input: CreateLegalDocumentInput, userId: string): Promise<LegalDocument> {
    const existing = await this.repo.findOne({ where: { slug: input.slug } });
    if (existing) {
      throw new ConflictException(`Ya existe un documento con el slug "${input.slug}"`);
    }

    const contentHtml = input.docxBase64 ? await this.docxToHtml(input.docxBase64) : undefined;

    let downloadFileUrl: string | undefined;
    let downloadFilePublicId: string | undefined;
    let downloadFileName: string | undefined;
    if (input.pdfBase64) {
      const uploaded = await this.uploadPdf(input.pdfBase64, input.slug, input.pdfFileName);
      downloadFileUrl = uploaded.url;
      downloadFilePublicId = uploaded.publicId;
      downloadFileName = input.pdfFileName ?? `${input.slug}.pdf`;
    }

    const isDownloadable = input.isDownloadable ?? false;
    if (isDownloadable && !downloadFileUrl) {
      throw new BadRequestException('Para marcar el documento como descargable debes subir un PDF.');
    }

    const doc = this.repo.create({
      slug: input.slug,
      title: input.title,
      description: input.description,
      contentHtml,
      audience: input.audience ?? LegalAudience.PUBLIC,
      isDownloadable,
      downloadFileUrl,
      downloadFilePublicId,
      downloadFileName,
      isPublished: false,
      version: 1,
      updatedById: userId,
    });

    const saved = await this.repo.save(doc);
    this.logger.log(`Documento legal creado: ${saved.slug} (${saved.id})`);
    return saved;
  }

  async update(id: string, input: UpdateLegalDocumentInput, userId: string): Promise<LegalDocument> {
    const doc = await this.findById(id);

    if (input.title !== undefined) doc.title = input.title;
    if (input.description !== undefined) doc.description = input.description;
    if (input.audience !== undefined) doc.audience = input.audience;

    if (input.docxBase64) {
      doc.contentHtml = await this.docxToHtml(input.docxBase64);
      doc.version += 1;
    }

    // Reemplazo del PDF descargable
    let oldPdfPublicId: string | undefined;
    if (input.pdfBase64) {
      oldPdfPublicId = doc.downloadFilePublicId;
      const uploaded = await this.uploadPdf(input.pdfBase64, doc.slug, input.pdfFileName);
      doc.downloadFileUrl = uploaded.url;
      doc.downloadFilePublicId = uploaded.publicId;
      doc.downloadFileName = input.pdfFileName ?? `${doc.slug}.pdf`;
    }

    if (input.isDownloadable !== undefined) {
      if (input.isDownloadable && !doc.downloadFileUrl) {
        throw new BadRequestException('Para marcar el documento como descargable debes subir un PDF.');
      }
      doc.isDownloadable = input.isDownloadable;
    }

    if (input.isPublished !== undefined) {
      if (input.isPublished && !doc.contentHtml && !doc.downloadFileUrl) {
        throw new BadRequestException('No puedes publicar un documento sin contenido ni archivo descargable.');
      }
      doc.isPublished = input.isPublished;
    }

    doc.updatedById = userId;
    const saved = await this.repo.save(doc);

    // Best-effort: elimina el PDF anterior tras guardar el nuevo
    if (oldPdfPublicId && oldPdfPublicId !== saved.downloadFilePublicId) {
      await this.storage.deleteByPublicId(oldPdfPublicId, 'raw').catch(() => {});
    }

    this.logger.log(`Documento legal actualizado: ${saved.slug} (v${saved.version})`);
    return saved;
  }

  async remove(id: string): Promise<boolean> {
    const doc = await this.findById(id);
    const pdfId = doc.downloadFilePublicId;
    await this.repo.remove(doc);
    if (pdfId) {
      await this.storage.deleteByPublicId(pdfId, 'raw').catch(() => {});
    }
    this.logger.log(`Documento legal eliminado: ${doc.slug}`);
    return true;
  }
}
