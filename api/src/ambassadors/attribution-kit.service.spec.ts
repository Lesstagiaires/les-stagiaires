import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AttributionKitService } from './attribution-kit.service';

// ============================================================================
// KIT D'AFFILIATION — CODE, LIEN, QR
// Arbitrage 10 du promoteur, 2026-08-02.
//
// Deux garanties, et la seconde est la plus délicate :
//
//   1. LE QR N'EST PAS STOCKÉ. Il se calcule à l'affichage, à partir du lien.
//      Un fichier stocké survivrait à une suspension ; un calcul, non.
//
//   2. LA ROUTE PUBLIQUE NE TRAHIT RIEN. « Comportement extérieur identique,
//      que le code soit valide ou non ; aucune réponse ne doit permettre
//      d'énumérer les codes actifs. » Un booléen, un message, un statut HTTP
//      différent — n'importe lequel des trois suffirait à balayer l'espace des
//      codes.
// ============================================================================
describe('Kit d’affiliation', () => {
  let prisma: { ambassador: { findUnique: jest.Mock } };
  let config: { get: jest.Mock };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let service: AttributionKitService;

  const ACTIF = {
    id: 'amb-1',
    code: 'K7RQ4M',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    prisma = { ambassador: { findUnique: jest.fn().mockResolvedValue(ACTIF) } };
    config = { get: jest.fn().mockReturnValue('https://lesstagiaires.app') };
    audit = { record: jest.fn(), recordChange: jest.fn() };

    service = new AttributionKitService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
  });

  // --- LE KIT ---------------------------------------------------------------
  describe('le kit', () => {
    it('rend le code, le lien et un QR calculé', async () => {
      const kit = await service.myKit('user-1');

      expect(kit.code).toBe('K7RQ4M');
      expect(kit.link).toBe('https://lesstagiaires.app/r/K7RQ4M');
      // Un QR calculé, pas un chemin de fichier : la donnée est dans la
      // réponse, elle n'est écrite nulle part.
      expect(kit.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('le lien ne porte QUE le code', async () => {
      const kit = await service.myKit('user-1');
      // Un lien se colle dans un groupe WhatsApp : ce qu'il porte devient
      // public. Ni identifiant interne, ni nom.
      expect(kit.link).not.toContain('amb-1');
      expect(kit.link).not.toContain('user-1');
    });

    it('le QR encode le LIEN, pas le code nu', async () => {
      // Un QR contenant « K7RQ4M » n'amènerait nulle part une fois scanné.
      const kit = await service.myKit('user-1');
      const attendu = await service.myKit('user-1');
      expect(kit.qrDataUrl).toBe(attendu.qrDataUrl);
    });

    it.each(['SUSPENDED', 'TRAINING_PENDING', 'TERMINATED', 'SUBMITTED'])(
      'refuse le kit à un dossier en %s',
      async (status) => {
        prisma.ambassador.findUnique.mockResolvedValue({ ...ACTIF, status });

        // Servir le kit d'un suspendu reviendrait à le laisser recruter pendant
        // sa suspension. Le code reste EN BASE — pour qu'une réintégration ne
        // casse pas les liens distribués — mais il ne le reçoit plus.
        await expect(service.myKit('user-1')).rejects.toThrow(
          ConflictException,
        );
      },
    );

    it('refuse un dossier ACTIVE sans code', async () => {
      // Cas impossible en théorie ; on refuse plutôt que de construire un lien
      // vers `/r/null`.
      prisma.ambassador.findUnique.mockResolvedValue({ ...ACTIF, code: null });
      await expect(service.myKit('user-1')).rejects.toThrow(ConflictException);
    });

    it('refuse quelqu’un qui n’est pas ambassadeur', async () => {
      prisma.ambassador.findUnique.mockResolvedValue(null);
      await expect(service.myKit('user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // --- LA ROUTE PUBLIQUE ----------------------------------------------------
  describe('la route publique ne trahit rien', () => {
    it('rend EXACTEMENT la même chose pour un code valide et un code inconnu', async () => {
      const valide = await service.resolvePublicLink('K7RQ4M');
      const inconnu = await service.resolvePublicLink('ZZZZZZ');

      // Même forme, mêmes clés, même valeur de `next`. Seul le code diffère,
      // et il vient de l'appelant.
      expect(Object.keys(valide)).toEqual(Object.keys(inconnu));
      expect(valide.next).toBe(inconnu.next);
      expect(valide.attributionCode).toBe('K7RQ4M');
      expect(inconnu.attributionCode).toBe('ZZZZZZ');
    });

    it('ne consulte PAS la base', async () => {
      await service.resolvePublicLink('K7RQ4M');

      // Interroger la base ouvrirait une attaque temporelle : un code existant
      // se résoudrait mesurablement plus vite qu'un code inconnu, et cet écart
      // suffit à énumérer.
      expect(prisma.ambassador.findUnique).not.toHaveBeenCalled();
    });

    it('ne dit jamais si le code est valide', async () => {
      const reponse = await service.resolvePublicLink('K7RQ4M');
      const serialise = JSON.stringify(reponse);

      expect(serialise).not.toContain('valid');
      expect(serialise).not.toContain('exists');
      expect(serialise).not.toContain('active');
    });

    it('journalise la visite sans permettre de reconstituer les codes', async () => {
      await service.resolvePublicLink('K7RQ4M');

      const [action, actorId, contexte] = (
        audit.record.mock.calls as unknown[][]
      )[0] as [string, null, Record<string, unknown>];

      expect(action).toBe('AMBASSADOR_LINK_VISITED');
      expect(actorId).toBeNull();
      // Assez pour repérer un balayage dans le volume, pas assez pour
      // reconstituer une liste depuis le journal.
      expect(contexte.codePrefix).toBe('K7R');
      expect(JSON.stringify(contexte)).not.toContain('K7RQ4M');
    });
  });
});
