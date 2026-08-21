import { NotFoundException } from '@nestjs/common';
import { OpportunityStatus } from '../../generated/prisma/enums';
import { OpportunitiesService } from './opportunities.service';

// ============================================================================
// LA CONSULTATION D'UNE OFFRE EST PUBLIQUE — MAIS PAS N'IMPORTE LAQUELLE
//
// POURQUOI CE FICHIER EXISTE MAINTENANT. `getById()` acceptait déjà un
// `userId` facultatif, mais AUCUN APPELANT NE S'EN SERVAIT : l'écran de détail
// mobile refusait de charger sans jeton. La propriété était donc vraie sans
// jamais être exercée, ni testée.
//
// V6-2 ouvre cet écran aux visiteurs sans compte. La garde qui limite un
// anonyme aux offres publiées cesse d'être une précaution théorique : elle
// devient la SEULE chose qui empêche un brouillon, une offre suspendue ou une
// offre expirée d'être lue par n'importe qui. Une propriété dont dépend un
// accès public se teste.
//
// CE QUI EST VÉRIFIÉ ICI : le comportement de la garde, pas le classement. Le
// moteur de recherche a ses propres tests, et V6-2 n'y touche pas.
// ============================================================================

function servicePourOffre(offre: unknown, estParticipant = false) {
  const prisma = {
    opportunity: { findUnique: jest.fn().mockResolvedValue(offre) },
  };
  const access = { isParticipant: jest.fn().mockResolvedValue(estParticipant) };

  return new OpportunitiesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    access as never,
    {} as never,
  );
}

const OFFRE = {
  id: 'opp-1',
  organizationId: 'org-1',
  title: 'Stage en cybersécurité',
  organization: { id: 'org-1', name: 'Acme', verificationStatus: 'VERIFIED' },
};

describe('Consultation publique du détail d’une offre', () => {
  it('rend une offre publiée à un visiteur sans compte', async () => {
    const service = servicePourOffre({
      ...OFFRE,
      status: OpportunityStatus.ACTIVE,
    });

    // `undefined` : c'est exactement ce que transmet un appel non authentifié.
    const offre = await service.getById(undefined, 'opp-1');

    expect(offre.id).toBe('opp-1');
  });

  // LE CŒUR DU TEST. Sans cette garde, ouvrir l'écran au public exposerait tout
  // ce qui n'est pas publié.
  it('refuse une offre non publiée à un visiteur sans compte', async () => {
    const service = servicePourOffre({
      ...OFFRE,
      status: OpportunityStatus.DRAFT,
    });

    await expect(service.getById(undefined, 'opp-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Le refus est un 404, jamais un 403 : un anonyme ne doit pas pouvoir
  // distinguer « cette offre n'existe pas » de « elle existe mais vous n'y avez
  // pas droit ». Sans cela, l'écran de détail deviendrait un oracle permettant
  // d'énumérer les brouillons d'une organisation.
  it('ne révèle pas l’existence d’une offre non publiée', async () => {
    const service = servicePourOffre({
      ...OFFRE,
      status: OpportunityStatus.SUSPENDED,
    });

    await expect(service.getById(undefined, 'opp-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rend une offre non publiée au membre de l’organisation qui la publie', async () => {
    const service = servicePourOffre(
      { ...OFFRE, status: OpportunityStatus.DRAFT },
      true,
    );

    const offre = await service.getById('membre-1', 'opp-1');

    expect(offre.id).toBe('opp-1');
  });

  it('refuse une offre inexistante, avec ou sans compte', async () => {
    const service = servicePourOffre(null);

    await expect(service.getById(undefined, 'inconnue')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getById('user-1', 'inconnue')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
