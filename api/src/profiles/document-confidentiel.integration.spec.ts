import 'dotenv/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  DocumentCategory,
  ProfileSection,
  SectionVisibility,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { CountryPolicyService } from '../auth/country-policy.service';
import { MinorPolicyService } from '../auth/minor-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { createTemporaryPostgres } from '../test-support/temporary-postgres';
import { DevMalwareScanner } from '../storage/dev-malware-scanner';
import { DocumentEncryptionService } from '../storage/document-encryption.service';
import { FileValidationService } from '../storage/file-validation.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { DocumentsService } from './documents.service';
import { VisibilityService } from './visibility.service';

// ============================================================================
// S-02 — UN DOCUMENT CONFIDENTIEL N'EST JAMAIS TÉLÉCHARGEABLE ANONYMEMENT
//
// Défaut relevé le 2026-08-10 : un majeur pouvait basculer sa rubrique
// DOCUMENTS en PUBLIC, et `canView` renvoyait alors `true` SANS REGARDER LE
// VISITEUR. Le fichier était servi déchiffré à qui présentait un identifiant.
//
// CLAUDE.md §1 classe diplômes et attestations en CONFIDENTIEL : « titulaire et
// destinataires autorisés », avec chiffrement ET journalisation.
//
// Ces tests portent sur la GARANTIE et tournent sur PostgreSQL réel, avec le
// vrai stockage et le vrai chiffrement. Ils survivront à une réécriture du
// service — c'est leur seul intérêt.
// ============================================================================

const BASE = 'stagiaires_it_document_confidentiel';

describe('S-02 — confidentialité des documents de profil (base réelle)', () => {
  let prisma: PrismaService;
  let database: Awaited<ReturnType<typeof createTemporaryPostgres>>;
  let documents: DocumentsService;
  let visibility: VisibilityService;

  let titulaire = '';
  let inconnu = '';
  let partage = '';
  let administrateur = '';
  let documentId = '';
  let documentSupprime = '';

  // UN VRAI PDF, en-tête compris. `FileValidationService` compare le contenu
  // au type déclaré : un texte annoncé comme PDF est refusé — garantie
  // rencontrée en écrivant ce test, et qui tient.
  const CONTENU = Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from('DIPLOME — contenu confidentiel de recette\n'),
    Buffer.from('%%EOF\n'),
  ]);

  const creerCompte = async (phone: string) => {
    const u = await prisma.user.create({
      data: { phone, password: 'x', firstName: 'T' },
    });
    await prisma.profile.create({ data: { userId: u.id } });
    return u.id;
  };

  const deposer = async (userId: string, nom: string) => {
    return documents.upload(userId, DocumentCategory.OTHER, {
      originalname: nom,
      mimetype: 'application/pdf',
      size: CONTENU.length,
      buffer: CONTENU,
    } as never);
  };

  beforeAll(async () => {
    database = await createTemporaryPostgres(BASE);
    prisma = database.prisma;

    const config = new ConfigService({
      DOCUMENT_ENCRYPTION_KEY: 'a1'.repeat(32),
      DOCUMENT_MAX_SIZE_MB: '10',
      DOCUMENT_ALLOWED_MIME_TYPES: 'application/pdf,image/png,image/jpeg',
      DOCUMENT_RETENTION_DAYS: '7',
    });
    const audit = new AuditService(prisma);
    const pays = new CountryPolicyService(prisma, audit);
    const minor = new MinorPolicyService(prisma, pays);
    visibility = new VisibilityService(prisma, audit, minor);

    // L'ordre du constructeur compte :
    // (prisma, config, audit, visibility, encryption, validation, storage).
    documents = new DocumentsService(
      prisma,
      config,
      audit,
      visibility,
      new DocumentEncryptionService(config),
      new FileValidationService(new DevMalwareScanner()),
      new LocalStorageProvider(),
    );

    titulaire = await creerCompte('+237696000001');
    inconnu = await creerCompte('+237696000002');
    partage = await creerCompte('+237696000003');
    administrateur = await creerCompte('+237696000004');

    documentId = (await deposer(titulaire, 'diplome.pdf')).id;
    documentSupprime = (await deposer(titulaire, 'obsolete.pdf')).id;
    await documents.remove(titulaire, documentSupprime);
  }, 240_000);

  afterAll(async () => {
    try {
      // Prisma est la seule ressource spécifique de cette spec.
    } finally {
      await database?.close();
    }
  }, 60_000);

  // --- La cause racine -------------------------------------------------------
  describe('la rubrique DOCUMENTS ne peut plus devenir publique', () => {
    it('le service refuse PUBLIC, même pour un majeur', async () => {
      await expect(
        visibility.setVisibility(titulaire, ProfileSection.DOCUMENTS, {
          visibility: SectionVisibility.PUBLIC,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('la base refuse PUBLIC même sans passer par le service', async () => {
      // Le contrôle vit AUSSI en base. Un script d'administration, une reprise
      // de données ou un futur service qui écrirait cette table sans passer par
      // `setVisibility` échoue ici — au lieu de rouvrir la brèche en silence.
      const profile = await prisma.profile.findUniqueOrThrow({
        where: { userId: titulaire },
      });
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "ProfileSectionVisibility" (id, "profileId", section, visibility)
           VALUES ('force_1', '${profile.id}', 'DOCUMENTS', 'PUBLIC')`,
        ),
      ).rejects.toThrow();
    });

    it('les autres rubriques restent publiables', async () => {
      // On corrige S-02, on ne referme pas le produit : le CV public reste
      // possible. Seuls les FICHIERS sortent du domaine de l'anonyme.
      const r = await visibility.setVisibility(
        titulaire,
        ProfileSection.SUMMARY,
        { visibility: SectionVisibility.PUBLIC },
      );
      expect(r.visibility).toBe(SectionVisibility.PUBLIC);
    });
  });

  // --- Les neuf situations de téléchargement --------------------------------
  describe('qui peut télécharger, et qui ne peut pas', () => {
    beforeEach(async () => {
      await visibility.setVisibility(titulaire, ProfileSection.DOCUMENTS, {
        visibility: SectionVisibility.PRIVATE,
      });
    });

    it('le TITULAIRE télécharge son document', async () => {
      const r = await documents.download(titulaire, documentId);
      expect(r.buffer.equals(CONTENU)).toBe(true);
      expect(r.fileName).toBe('diplome.pdf');
    });

    it('un AUTRE UTILISATEUR authentifié est refusé', async () => {
      await expect(
        documents.download(inconnu, documentId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un ADMINISTRATEUR n’a aucun privilège sur les documents', async () => {
      // CLAUDE.md §3 : jamais de rôle fourre-tout qui voit tout. Un compte
      // d'administration compromis ne doit pas ouvrir les diplômes de tout le
      // monde.
      await prisma.userRole.create({
        data: {
          userId: administrateur,
          roleId: (
            await prisma.role.upsert({
              where: { name: 'ADMIN' },
              update: {},
              create: { name: 'ADMIN' },
            })
          ).id,
        },
      });
      await expect(
        documents.download(administrateur, documentId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un DESTINATAIRE d’un partage nominatif accède', async () => {
      await visibility.setVisibility(titulaire, ProfileSection.DOCUMENTS, {
        visibility: SectionVisibility.SHARED,
      });
      await visibility.shareSection(titulaire, ProfileSection.DOCUMENTS, {
        userId: partage,
      });
      const r = await documents.download(partage, documentId);
      expect(r.buffer.equals(CONTENU)).toBe(true);
    });

    it('un IDENTIFIANT MODIFIÉ ou deviné ne donne rien (IDOR)', async () => {
      // Le document d'autrui, un identifiant inventé, un identifiant tronqué :
      // aucun ne doit se comporter différemment d'un « introuvable ».
      const autre = (await deposer(inconnu, 'a-moi.pdf')).id;
      await expect(documents.download(titulaire, autre)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        documents.download(titulaire, 'cmzzzzzzzzzzzzzzzzzzzzzzzz'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        documents.download(titulaire, documentId.slice(0, -1)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('un document SUPPRIMÉ n’est plus téléchargeable, même par son titulaire', async () => {
      await expect(
        documents.download(titulaire, documentSupprime),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // --- Le point 7 : une bascule doit agir IMMÉDIATEMENT ----------------------
  describe('un changement de visibilité agit immédiatement', () => {
    it('RÉSEAU → PRIVÉ coupe l’accès sur-le-champ', async () => {
      await visibility.setVisibility(titulaire, ProfileSection.DOCUMENTS, {
        visibility: SectionVisibility.NETWORK,
      });
      // `inconnu` est authentifié : le réseau lui est ouvert.
      await expect(
        documents.download(inconnu, documentId),
      ).resolves.toHaveProperty('buffer');

      await visibility.setVisibility(titulaire, ProfileSection.DOCUMENTS, {
        visibility: SectionVisibility.PRIVATE,
      });
      // Aucun cache, aucune URL survivante : l'accès tombe au coup suivant.
      await expect(
        documents.download(inconnu, documentId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un partage RÉVOQUÉ coupe l’accès sur-le-champ', async () => {
      await visibility.setVisibility(titulaire, ProfileSection.DOCUMENTS, {
        visibility: SectionVisibility.SHARED,
      });
      await visibility.shareSection(titulaire, ProfileSection.DOCUMENTS, {
        userId: partage,
      });
      await expect(
        documents.download(partage, documentId),
      ).resolves.toHaveProperty('buffer');

      // `unshareSection` prend un identifiant nu, `shareSection` un DTO — les
      // deux signatures diffèrent, et le compilateur seul l'a signalé.
      await visibility.unshareSection(
        titulaire,
        ProfileSection.DOCUMENTS,
        partage,
      );
      await expect(
        documents.download(partage, documentId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // --- Le fichier au repos ---------------------------------------------------
  describe('le fichier déchiffré ne se dépose nulle part', () => {
    it('le stockage ne contient que du chiffré', async () => {
      const doc = await prisma.profileDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
      const auRepos = await new LocalStorageProvider().get(doc.storageKey);

      expect(auRepos.equals(CONTENU)).toBe(false);
      expect(auRepos.includes('DIPLOME')).toBe(false);
      // Et le clair reste vérifiable par son empreinte, jamais stocké.
      expect(createHash('sha256').update(CONTENU).digest('hex')).toBe(
        doc.checksum,
      );
    });

    it('aucune URL permanente n’est rendue au client', async () => {
      // Le service rend des OCTETS, pas un lien. Un jour où il rendrait une
      // URL, celle-ci vivrait sa vie hors de tout contrôle d'accès.
      const r = await documents.download(titulaire, documentId);
      expect(Object.keys(r).sort()).toEqual(['buffer', 'fileName', 'mimeType']);
      expect(JSON.stringify(Object.keys(r))).not.toMatch(/url|href|link/i);
    });
  });

  // --- La journalisation exigée au §4 ---------------------------------------
  it('chaque accès porte un auteur identifié', async () => {
    await documents.download(titulaire, documentId);
    const acces = await prisma.auditLog.findMany({
      where: { action: 'DOCUMENT_ACCESSED' },
    });
    expect(acces.length).toBeGreaterThan(0);
    // Avant la correction, un accès anonyme s'inscrivait avec un auteur NUL :
    // un journal qui n'identifie personne n'est pas un journal d'accès.
    for (const a of acces) expect(a.userId).not.toBeNull();
  });
});
