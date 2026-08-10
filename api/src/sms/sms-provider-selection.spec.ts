import {
  resolveSmsProviderName,
  SmsConfigurationError,
} from './sms-provider-selection';

// ============================================================================
// AUCUN REPLI SILENCIEUX VERS LA CONSOLE
//
// Défaut trouvé le 2026-08-09 pendant la préparation de la recette. La
// sélection s'écrivait `=== 'africastalking' ? africasTalking : console` :
// toute autre valeur — faute de frappe, majuscule, variable oubliée — basculait
// sur le fournisseur console, qui écrit le message ENTIER dans le journal,
// code à usage unique compris.
//
// Sur une application joignable depuis Internet, cela revient à publier un
// secret d'authentification. Ces tests interdisent le retour du défaut.
// ============================================================================

describe('Sélection du fournisseur SMS', () => {
  // --- Les quatre cas exigés par le promoteur le 2026-08-09 -----------------
  describe('les quatre cas de la consigne', () => {
    it('1. africastalking → accepté', () => {
      expect(resolveSmsProviderName({ SMS_PROVIDER: 'africastalking' })).toBe(
        'africastalking',
      );
    });

    it('2. console + REQUIRE_REAL_SMS=true → refusé', () => {
      expect(() =>
        resolveSmsProviderName({
          SMS_PROVIDER: 'console',
          REQUIRE_REAL_SMS: 'true',
        }),
      ).toThrow(SmsConfigurationError);
    });

    it('3. valeur inconnue → refusé', () => {
      expect(() => resolveSmsProviderName({ SMS_PROVIDER: 'bogus' })).toThrow(
        SmsConfigurationError,
      );
    });

    it('4. absente + REQUIRE_REAL_SMS=true → refusé', () => {
      expect(() =>
        resolveSmsProviderName({ REQUIRE_REAL_SMS: 'true' }),
      ).toThrow(SmsConfigurationError);
    });
  });

  // --- Ce que la consigne n'énumérait pas, et qui compte autant -------------
  describe('absence de fournisseur par défaut', () => {
    // C'EST LE CŒUR DU CORRECTIF. Avant, une variable oubliée donnait la
    // console sans un mot. Elle doit maintenant arrêter l'application, que
    // REQUIRE_REAL_SMS soit posé ou non.
    it.each([
      ['absente', undefined],
      ['vide', ''],
      ['des espaces', '   '],
    ])('refuse une variable %s même sans REQUIRE_REAL_SMS', (_, valeur) => {
      expect(() => resolveSmsProviderName({ SMS_PROVIDER: valeur })).toThrow(
        SmsConfigurationError,
      );
    });

    // La casse compte, et c'est délibéré : accepter « AfricasTalking » ou
    // « AFRICASTALKING » obligerait à deviner l'intention. Mieux vaut refuser
    // et faire corriger la variable une fois pour toutes.
    it.each(['AfricasTalking', 'AFRICASTALKING', 'africas-talking', 'Console'])(
      'refuse « %s » plutôt que de deviner',
      (valeur) => {
        expect(() => resolveSmsProviderName({ SMS_PROVIDER: valeur })).toThrow(
          SmsConfigurationError,
        );
      },
    );
  });

  describe('console, quand elle est explicitement demandée', () => {
    it.each([
      ['REQUIRE_REAL_SMS absente', undefined],
      ['REQUIRE_REAL_SMS=false', 'false'],
      ['REQUIRE_REAL_SMS=0', '0'],
      ['REQUIRE_REAL_SMS vide', ''],
    ])('reste possible en développement : %s', (_, exigence) => {
      expect(
        resolveSmsProviderName({
          SMS_PROVIDER: 'console',
          REQUIRE_REAL_SMS: exigence,
        }),
      ).toBe('console');
    });

    it.each(['true', '1'])(
      'devient interdite dès que REQUIRE_REAL_SMS vaut « %s »',
      (exigence) => {
        expect(() =>
          resolveSmsProviderName({
            SMS_PROVIDER: 'console',
            REQUIRE_REAL_SMS: exigence,
          }),
        ).toThrow(/interdit le fournisseur console/);
      },
    );
  });

  describe('lecture du booléen de configuration', () => {
    // « yes » demande une protection. La traduire par « faux » reproduirait le
    // défaut corrigé, un cran plus loin : quelqu'un croirait l'environnement
    // protégé alors qu'il ne le serait pas.
    it.each(['yes', 'oui', 'on', 'vrai', '2'])(
      'refuse « %s » plutôt que de le tenir pour faux',
      (valeur) => {
        expect(() =>
          resolveSmsProviderName({
            SMS_PROVIDER: 'console',
            REQUIRE_REAL_SMS: valeur,
          }),
        ).toThrow(/ni vrai ni faux/);
      },
    );
  });

  describe('le message d’erreur sert à quelque chose', () => {
    it('nomme la valeur fautive et les valeurs acceptées', () => {
      // Une erreur de configuration se lit souvent à trois heures du matin, au
      // milieu d'un journal de démarrage. Elle doit se suffire à elle-même.
      expect(() => resolveSmsProviderName({ SMS_PROVIDER: 'bogus' })).toThrow(
        /« bogus ».*africastalking, console/s,
      );
    });

    it('ne divulgue jamais la clef Africa’s Talking', () => {
      // Le nom d'une variable de secret peut apparaître ; sa valeur, jamais.
      let message = '';
      try {
        resolveSmsProviderName({ SMS_PROVIDER: 'bogus' });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toMatch(/API_KEY\s*[:=]/);
    });
  });
});
