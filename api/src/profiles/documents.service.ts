import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { DocumentCategory, ProfileSection } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentEncryptionService } from '../storage/document-encryption.service';
import { FileValidationService } from '../storage/file-validation.service';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';
import type { StorageProvider } from '../storage/storage-provider.interface';
import { VisibilityService } from './visibility.service';

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

// checksum et storageKey ne sont jamais renvoyés au client — ce sont des détails
// d'implémentation du stockage chiffré, pas des données consultables (CLAUDE.md §6).
const SAFE_DOCUMENT_SELECT = {
  id: true,
  profileId: true,
  category: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly visibility: VisibilityService,
    private readonly encryption: DocumentEncryptionService,
    private readonly validation: FileValidationService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async upload(userId: string, category: DocumentCategory, file: UploadedFile) {
    const maxSizeBytes =
      Number(this.config.get<string>('DOCUMENT_MAX_SIZE_MB', '10')) *
      1024 *
      1024;
    const allowedTypes = this.config
      .get<string>('DOCUMENT_ALLOWED_MIME_TYPES', '')
      .split(',')
      .map((type) => type.trim());

    try {
      await this.validation.validate(file, maxSizeBytes, allowedTypes);
    } catch (error) {
      await this.audit.record('DOCUMENT_UPLOAD_REJECTED', userId, {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw error;
    }

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `profiles/${profile.id}/${randomUUID()}`;
    await this.storage.put(storageKey, this.encryption.encrypt(file.buffer));

    const document = await this.prisma.profileDocument.create({
      data: {
        profileId: profile.id,
        category,
        fileName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        checksum,
      },
      select: SAFE_DOCUMENT_SELECT,
    });

    await this.audit.record('DOCUMENT_UPLOADED', userId, {
      documentId: document.id,
      category,
    });
    return document;
  }

  async list(userId: string) {
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return this.prisma.profileDocument.findMany({
      where: { profileId: profile.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: SAFE_DOCUMENT_SELECT,
    });
  }

  // ==========================================================================
  // LE TÉLÉCHARGEMENT EXIGE UN DEMANDEUR IDENTIFIÉ
  //
  // DÉFAUT S-02, corrigé le 2026-08-10. La route était publique et le
  // demandeur facultatif : un document dont le propriétaire avait basculé la
  // rubrique DOCUMENTS en PUBLIC était servi DÉCHIFFRÉ à un anonyme.
  //
  // CLAUDE.md §1 classe ces fichiers — diplômes, attestations, pièces jointes —
  // en CONFIDENTIEL : « titulaire et destinataires autorisés », avec
  // « chiffrement ET JOURNALISATION ». Un accès anonyme ne se journalise pas :
  // l'entrée d'audit portait un auteur NUL, donc un journal qui n'identifie
  // personne.
  //
  // Le paramètre n'est plus optionnel. Ce n'est pas une précaution
  // supplémentaire, c'est LA garantie : le type interdit désormais d'appeler
  // cette méthode sans savoir qui demande. Un futur contrôleur qui rendrait la
  // route publique ne compilerait pas.
  // ==========================================================================
  async download(requestingUserId: string, documentId: string) {
    const document = await this.prisma.profileDocument.findUnique({
      where: { id: documentId },
      include: { profile: true },
    });
    if (!document || document.deletedAt) {
      // Supprimé ou inexistant : même réponse. Distinguer les deux dirait à qui
      // tâtonne des identifiants lesquels ont existé.
      throw new NotFoundException('Document introuvable.');
    }

    // ========================================================================
    // AUCUNE VISIBILITÉ NE VAUT AUTORISATION ANONYME
    //
    // La rubrique DOCUMENTS ne peut plus être rendue publique
    // (`VisibilityService.setVisibility`), mais on ne s'appuie pas là-dessus
    // ici : le contrôle vaut quelle que soit la valeur trouvée en base, y
    // compris une valeur PUBLIC héritée d'avant la correction ou écrite par un
    // chemin qu'on n'a pas prévu.
    //
    // Deux portes, et deux seulement : être le titulaire, ou avoir reçu un
    // partage que `canView` reconnaît. Un administrateur n'en franchit aucune —
    // CLAUDE.md §3 interdit le rôle fourre-tout qui voit tout.
    // ========================================================================
    const estTitulaire = document.profile.userId === requestingUserId;
    const canView =
      estTitulaire ||
      (await this.visibility.canView(
        document.profile.userId,
        ProfileSection.DOCUMENTS,
        requestingUserId,
      ));
    if (!canView) {
      throw new ForbiddenException('Accès non autorisé à ce document.');
    }

    const encrypted = await this.storage.get(document.storageKey);
    const plaintext = this.encryption.decrypt(encrypted);

    const checksum = createHash('sha256').update(plaintext).digest('hex');
    if (checksum !== document.checksum) {
      // Intégrité compromise — ne jamais renvoyer un contenu altéré (CLAUDE.md §4).
      throw new BadRequestException(
        "L'intégrité du document n'a pas pu être vérifiée.",
      );
    }

    // Le journal porte toujours un auteur, désormais : c'est ce qui distingue
    // un journal d'accès d'un compteur.
    await this.audit.record('DOCUMENT_ACCESSED', requestingUserId, {
      documentId,
      ownerId: document.profile.userId,
      parLeTitulaire: estTitulaire,
    });

    return {
      buffer: plaintext,
      mimeType: document.mimeType,
      fileName: document.fileName,
    };
  }

  async rename(userId: string, documentId: string, fileName: string) {
    const document = await this.assertOwnsDocument(userId, documentId);
    const updated = await this.prisma.profileDocument.update({
      where: { id: document.id },
      data: { fileName },
      select: SAFE_DOCUMENT_SELECT,
    });
    await this.audit.record('DOCUMENT_RENAMED', userId, { documentId });
    return updated;
  }

  async remove(userId: string, documentId: string) {
    const document = await this.assertOwnsDocument(userId, documentId);
    const retentionDays = Number(
      this.config.get<string>('DOCUMENT_RETENTION_DAYS', '7'),
    );
    await this.prisma.profileDocument.update({
      where: { id: document.id },
      data: {
        deletedAt: new Date(),
        deletionScheduledAt: new Date(
          Date.now() + retentionDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
    await this.audit.record('DOCUMENT_DELETION_REQUESTED', userId, {
      documentId,
    });
  }

  private async assertOwnsDocument(userId: string, documentId: string) {
    const document = await this.prisma.profileDocument.findUnique({
      where: { id: documentId },
      include: { profile: true },
    });
    if (!document || document.profile.userId !== userId || document.deletedAt) {
      throw new NotFoundException('Document introuvable pour ce profil.');
    }
    return document;
  }
}
