import type { ConfigService } from '@nestjs/config';
import { AfricasTalkingSmsProvider } from './africastalking-sms.provider';

// ============================================================================
// ENVOI DE SMS VIA AFRICA'S TALKING
//
// Ce fournisseur porte les codes OTP et les demandes de consentement parental.
// Les tests portent donc moins sur « l'appel HTTP est bien formé » que sur
// trois propriétés :
//
//   1. UN ÉCHEC EST UN ÉCHEC. L'API répond 201 même quand le message est
//      rejeté. Croire au succès sur le seul code HTTP laisserait l'inscription
//      se poursuivre pendant qu'aucun SMS ne part — et, pour un mineur, aucun
//      parent n'est sollicité (CLAUDE.md §5).
//   2. NI LE CODE OTP NI LE NUMÉRO EN CLAIR dans un journal (CLAUDE.md §2).
//   3. LE BAC À SABLE ET LA PRODUCTION ne se confondent jamais.
// ============================================================================

// Réponse type de l'API : le verdict par destinataire vit dans le corps.
function reponse(statusCode: number, httpStatus = 201) {
  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    json: () =>
      Promise.resolve({
        SMSMessageData: {
          Message: 'Sent to 1/1',
          Recipients: [
            {
              statusCode,
              status: 'Whatever',
              number: '+237690000000',
              messageId: 'ATXid_abc',
            },
          ],
        },
      }),
    text: () => Promise.resolve('corps'),
  } as unknown as Response;
}

describe('Envoi de SMS via Africa’s Talking', () => {
  const NUMERO = '+237690001234';
  const MESSAGE = 'Votre code LES STAGIAIRES est 481902.';

  let fetchMock: jest.Mock;
  let erreurs: string[];

  function fournisseur(surcharges: Record<string, string | undefined> = {}) {
    const valeurs: Record<string, string | undefined> = {
      AFRICASTALKING_API_KEY: 'cle-de-test',
      AFRICASTALKING_USERNAME: 'sandbox',
      ...surcharges,
    };
    const config = {
      get: (cle: string) => valeurs[cle],
      getOrThrow: (cle: string) => {
        const valeur = valeurs[cle];
        if (valeur === undefined) throw new Error(`${cle} absente`);
        return valeur;
      },
    } as unknown as ConfigService;

    const provider = new AfricasTalkingSmsProvider(config);
    // On capture ce qui part au journal : c'est le sujet de plusieurs tests.
    erreurs = [];
    jest
      .spyOn(provider['logger'], 'error')
      .mockImplementation((m: unknown) => erreurs.push(String(m)));
    return provider;
  }

  // L'URL et les options du n-ième appel, typées une fois pour toutes : sans
  // cela, chaque lecture de « mock.calls » traîne une valeur non typée, et le
  // test perd la vérification que TypeScript est censé lui apporter.
  function urlAppelee(n = 0): string {
    return (fetchMock.mock.calls as unknown[][])[n][0] as string;
  }

  function optionsAppel(n = 0): {
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  } {
    return (fetchMock.mock.calls as unknown[][])[n][1] as {
      headers: Record<string, string>;
      body: string;
      signal?: AbortSignal;
    };
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => jest.restoreAllMocks());

  // --------------------------------------------------------------------------
  // 1. LE VERDICT RÉEL EST DANS LE CORPS
  // --------------------------------------------------------------------------
  describe('Un HTTP 201 ne veut pas dire « envoyé »', () => {
    it.each([
      [100, 'Processed'],
      [101, 'Sent'],
      [102, 'Queued'],
    ])('accepte le statut %i (%s)', async (code) => {
      fetchMock.mockResolvedValue(reponse(code));
      await expect(
        fournisseur().send(NUMERO, MESSAGE),
      ).resolves.toBeUndefined();
    });

    // LE TEST QUI COMPTE LE PLUS. Chacun de ces cas rend HTTP 201 : sans
    // lecture du corps, tous passeraient pour des envois réussis.
    it.each([
      [406, 'solde insuffisant'],
      [403, 'destinataire en liste de blocage'],
      [500, 'numéro invalide'],
      [409, 'sender ID non approuvé'],
      [404, 'aucun opérateur'],
    ])('échoue sur le statut %i (%s), malgré un HTTP 201', async (code) => {
      fetchMock.mockResolvedValue(reponse(code));
      await expect(fournisseur().send(NUMERO, MESSAGE)).rejects.toThrow(
        /rejeté par l’opérateur/,
      );
    });

    // L'API rend une liste vide quand le numéro n'est pas routable du tout.
    it('échoue quand aucun destinataire n’est retenu', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ SMSMessageData: { Recipients: [] } }),
      });

      await expect(fournisseur().send(NUMERO, MESSAGE)).rejects.toThrow(
        /non routé/,
      );
    });

    // Une réponse 2xx illisible ne prouve rien. La traiter comme un succès
    // serait exactement l'erreur que ce fichier cherche à éviter.
    it('échoue sur une réponse 2xx illisible', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('pas du JSON')),
      });

      await expect(fournisseur().send(NUMERO, MESSAGE)).rejects.toThrow(
        /illisible/,
      );
    });

    it('échoue sur un refus HTTP', async () => {
      fetchMock.mockResolvedValue(reponse(101, 401));
      await expect(fournisseur().send(NUMERO, MESSAGE)).rejects.toThrow();
    });

    it('échoue quand l’opérateur est injoignable', async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
      );
      await expect(fournisseur().send(NUMERO, MESSAGE)).rejects.toThrow(
        /injoignable/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. CE QUI NE DOIT JAMAIS ENTRER DANS UN JOURNAL
  // --------------------------------------------------------------------------
  describe('Journalisation', () => {
    // Le message contient le code OTP. CLAUDE.md §2 : aucun code de
    // vérification en clair dans un log.
    it('n’écrit jamais le message, donc jamais le code OTP', async () => {
      for (const cas of [
        () => fetchMock.mockResolvedValue(reponse(406)),
        () => fetchMock.mockResolvedValue(reponse(101, 500)),
        () => fetchMock.mockRejectedValue(new Error('réseau')),
      ]) {
        cas();
        await fournisseur()
          .send(NUMERO, MESSAGE)
          .catch(() => undefined);

        const tout = erreurs.join('\n');
        expect(tout).not.toContain('481902');
        expect(tout).not.toContain(MESSAGE);
      }
    });

    it('ne journalise le numéro que masqué', async () => {
      fetchMock.mockResolvedValue(reponse(406));
      await fournisseur()
        .send(NUMERO, MESSAGE)
        .catch(() => undefined);

      const tout = erreurs.join('\n');
      expect(tout).not.toContain(NUMERO);
      expect(tout).toContain('1234');
      expect(tout).toContain('*');
    });

    // Un journal qui ne montre qu'un nombre n'aide personne : on ne sait pas
    // si le problème vient du numéro, du compte ou de l'opérateur.
    it('explique la cause de l’échec en clair', async () => {
      fetchMock.mockResolvedValue(reponse(406));
      await fournisseur()
        .send(NUMERO, MESSAGE)
        .catch(() => undefined);

      expect(erreurs.join('\n')).toContain('Solde insuffisant');
    });

    // Le corps d'erreur renvoyé par l'API peut contenir le numéro : il ne doit
    // jamais être recopié tel quel.
    it('ne recopie pas le corps d’erreur brut', async () => {
      const corpsQuiFuit = `{"error":"invalid recipient ${NUMERO}"}`;
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(corpsQuiFuit),
      });

      await fournisseur()
        .send(NUMERO, MESSAGE)
        .catch(() => undefined);

      expect(erreurs.join('\n')).not.toContain(NUMERO);
    });
  });

  // --------------------------------------------------------------------------
  // 3. BAC À SABLE ET PRODUCTION
  // --------------------------------------------------------------------------
  describe('Choix de l’adresse', () => {
    // Déduire l'adresse du nom d'utilisateur supprime le pire cas : des
    // identifiants de PRODUCTION envoyés au bac à sable feraient croire à des
    // envois réussis qui n'atteignent personne.
    it('vise le bac à sable quand le nom d’utilisateur est « sandbox »', async () => {
      fetchMock.mockResolvedValue(reponse(101));
      await fournisseur({ AFRICASTALKING_USERNAME: 'sandbox' }).send(
        NUMERO,
        MESSAGE,
      );

      expect(urlAppelee()).toContain('api.sandbox.africastalking');
    });

    it('vise la production pour tout autre nom d’utilisateur', async () => {
      fetchMock.mockResolvedValue(reponse(101));
      await fournisseur({ AFRICASTALKING_USERNAME: 'lesstagiaires' }).send(
        NUMERO,
        MESSAGE,
      );

      const url = urlAppelee();
      expect(url).toContain('api.africastalking.com');
      expect(url).not.toContain('sandbox');
    });
  });

  // --------------------------------------------------------------------------
  // 4. LA REQUÊTE
  // --------------------------------------------------------------------------
  describe('Requête envoyée', () => {
    it('transmet la clé d’API par en-tête, jamais dans le corps', async () => {
      fetchMock.mockResolvedValue(reponse(101));
      await fournisseur().send(NUMERO, MESSAGE);

      const options = optionsAppel();
      expect(options.headers.apiKey).toBe('cle-de-test');
      expect(options.body).not.toContain('cle-de-test');
    });

    // Un `from` non approuvé fait rejeter le message (statut 409) au lieu de le
    // laisser partir depuis le numéro court par défaut. Tant que l'identifiant
    // d'expéditeur n'est pas validé par les opérateurs, on ne l'envoie pas.
    it('n’envoie pas de sender ID tant qu’il n’est pas configuré', async () => {
      fetchMock.mockResolvedValue(reponse(101));
      await fournisseur().send(NUMERO, MESSAGE);

      const options = optionsAppel();
      expect(options.body).not.toContain('from=');
    });

    it('envoie le sender ID quand il est configuré', async () => {
      fetchMock.mockResolvedValue(reponse(101));
      await fournisseur({ AFRICASTALKING_SENDER_ID: 'STAGIAIRES' }).send(
        NUMERO,
        MESSAGE,
      );

      const options = optionsAppel();
      expect(options.body).toContain('from=STAGIAIRES');
    });

    // Une requête sans délai d'attente peut pendre indéfiniment et bloquer la
    // connexion de l'utilisateur avec elle.
    it('borne l’attente', async () => {
      fetchMock.mockResolvedValue(reponse(101));
      await fournisseur().send(NUMERO, MESSAGE);

      const options = optionsAppel();
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    // L'API n'est pas idempotente : après un délai dépassé, on ne sait pas si
    // le SMS est parti. Réessayer risquerait un double envoi facturé et deux
    // codes OTP concurrents.
    it('ne réessaie jamais tout seul', async () => {
      fetchMock.mockRejectedValue(new Error('réseau'));
      await fournisseur()
        .send(NUMERO, MESSAGE)
        .catch(() => undefined);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
