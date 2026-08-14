import type { ConfigService } from '@nestjs/config';
import { BUDGETS_PAR_DEFAUT } from '../auth/login-throttle/login-throttle.interface';
import {
  assertProductionReadiness,
  findConfigurationDefects,
} from './production-readiness';

// ============================================================================
// LE GARDE-FOU DE DÉMARRAGE
//
// Ce qui est vérifié ici n'est pas « la fonction lit bien une variable » mais
// une propriété de sécurité : AUCUNE valeur de développement ne peut atteindre
// la production sans que le service refuse de démarrer.
//
// Toutes ces valeurs FONCTIONNENT. C'est ce qui les rend dangereuses : rien ne
// casse, rien n'alerte, et le système fait le contraire de ce qu'on croit. Le
// pire cas est `SMS_PROVIDER=console` — un mineur s'inscrit, son parent n'est
// jamais sollicité, et la plateforme croit l'avoir protégé.
// ============================================================================

// Une configuration de production complète, dont chaque test dégrade UNE
// valeur — pour qu'on voie exactement ce qui cause quoi.
const PRODUCTION_VALIDE: Record<string, string> = {
  SMS_PROVIDER: 'africas-talking',
  EMAIL_PROVIDER: 'sendgrid',
  APP_PUBLIC_URL: 'https://app.les-stagiaires.africa',
  PAYMENT_GATEWAY_PROVIDER: 'orange-money-cm',
  STORAGE_PROVIDER: 'r2',
  MALWARE_SCANNER_PROVIDER: 'clamav',
  FIELD_ENCRYPTION_KEYS: 'v1:' + 'a'.repeat(64),
  FIELD_ENCRYPTION_ACTIVE_KEY: 'v1',
  LOGIN_THROTTLE_PROVIDER: 'redis',
  LOGIN_THROTTLE_HMAC_SECRET: 'c'.repeat(48),
  TRUST_PROXY: 'true',
};

function configAvec(surcharges: Record<string, string | undefined> = {}) {
  const valeurs = { ...PRODUCTION_VALIDE, ...surcharges };
  return {
    get: <T>(cle: string): T | undefined => valeurs[cle] as T | undefined,
  } as unknown as ConfigService;
}

const ENV_PROD: NodeJS.ProcessEnv = { NODE_ENV: 'production' };

describe('Garde-fou de configuration au démarrage', () => {
  describe('Une configuration de production complète', () => {
    it('laisse démarrer', () => {
      expect(findConfigurationDefects(configAvec(), ENV_PROD)).toHaveLength(0);
      expect(() =>
        assertProductionReadiness(configAvec(), ENV_PROD),
      ).not.toThrow();
    });
  });

  describe('Les valeurs de développement, une par une', () => {
    // LE CAS LE PLUS GRAVE. Sans SMS, aucun parent n'est sollicité pour un
    // mineur — et la plateforme croit l'avoir protégé (CLAUDE.md §5).
    it('refuse un fournisseur SMS console', () => {
      const defauts = findConfigurationDefects(
        configAvec({ SMS_PROVIDER: 'console' }),
        ENV_PROD,
      );
      expect(defauts.map((d) => d.key)).toContain('SMS_PROVIDER');
      expect(defauts[0].why).toContain('mineur');
    });

    it('refuse une adresse publique locale', () => {
      for (const valeur of [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://localhost',
      ]) {
        const defauts = findConfigurationDefects(
          configAvec({ APP_PUBLIC_URL: valeur }),
          ENV_PROD,
        );
        expect(defauts.map((d) => d.key)).toContain('APP_PUBLIC_URL');
      }
    });

    // Un QR code imprimé sur un flyer ne se rappelle pas. Le lien doit être
    // chiffré, pas seulement joignable.
    it('refuse une adresse publique en clair', () => {
      const defauts = findConfigurationDefects(
        configAvec({ APP_PUBLIC_URL: 'http://app.les-stagiaires.africa' }),
        ENV_PROD,
      );
      expect(defauts.map((d) => d.key)).toContain('APP_PUBLIC_URL');
    });

    it('refuse la passerelle de paiement simulée', () => {
      const defauts = findConfigurationDefects(
        configAvec({ PAYMENT_GATEWAY_PROVIDER: 'simulated' }),
        ENV_PROD,
      );
      expect(defauts.map((d) => d.key)).toContain('PAYMENT_GATEWAY_PROVIDER');
    });

    it('refuse le stockage local des documents', () => {
      const defauts = findConfigurationDefects(
        configAvec({ STORAGE_PROVIDER: 'local' }),
        ENV_PROD,
      );
      expect(defauts.map((d) => d.key)).toContain('STORAGE_PROVIDER');
    });

    it('refuse l’analyse antivirus désactivée', () => {
      for (const valeur of ['none', 'noop', 'disabled']) {
        const defauts = findConfigurationDefects(
          configAvec({ MALWARE_SCANNER_PROVIDER: valeur }),
          ENV_PROD,
        );
        expect(defauts.map((d) => d.key)).toContain('MALWARE_SCANNER_PROVIDER');
      }
    });

    it('refuse un trousseau de chiffrement absent', () => {
      const defauts = findConfigurationDefects(
        configAvec({ FIELD_ENCRYPTION_KEYS: undefined }),
        ENV_PROD,
      );
      expect(defauts.map((d) => d.key)).toContain('FIELD_ENCRYPTION_KEYS');
    });
  });

  // ==========================================================================
  // LE LIMITEUR DE CONNEXION — S-06-C
  //
  // Ces trois contrôles gardent une propriété que le code seul ne peut pas
  // tenir : un limiteur qui compte en mémoire, ou dont les clés sont lisibles,
  // ou qui se trompe d'adresse cliente, FONCTIONNE PARFAITEMENT. Il ne lève
  // rien, ne ralentit rien — il ne limite simplement pas.
  // ==========================================================================
  describe('Le limiteur de connexion', () => {
    it('refuse un comptage en mémoire', () => {
      // Avec plusieurs instances derrière un répartiteur, chacune tient son
      // propre compteur : le budget réel est multiplié par leur nombre.
      for (const valeur of ['memory', undefined]) {
        const defauts = findConfigurationDefects(
          configAvec({ LOGIN_THROTTLE_PROVIDER: valeur }),
          ENV_PROD,
        );
        expect(defauts.map((d) => d.key)).toContain('LOGIN_THROTTLE_PROVIDER');
      }
    });

    it('refuse un secret de clé absent ou trop court', () => {
      // Sans secret, `KEYS lt:*` rendrait l'annuaire des numéros qui tentent de
      // se connecter. Un secret court se force ; 32 caractères est le plancher.
      for (const valeur of [undefined, '', 'trop-court']) {
        const defauts = findConfigurationDefects(
          configAvec({ LOGIN_THROTTLE_HMAC_SECRET: valeur }),
          ENV_PROD,
        );
        expect(defauts.map((d) => d.key)).toContain(
          'LOGIN_THROTTLE_HMAC_SECRET',
        );
      }
    });

    it('exige que TRUST_PROXY soit DÉCLARÉ, sans imposer laquelle', () => {
      // Le garde-fou refuse l'ABSENCE DE CHOIX, pas une valeur : les deux sont
      // légitimes, mais seulement l'une des deux dans une topologie donnée.
      expect(
        findConfigurationDefects(
          configAvec({ TRUST_PROXY: undefined }),
          ENV_PROD,
        ).map((d) => d.key),
      ).toContain('TRUST_PROXY');

      for (const valeur of ['true', 'false']) {
        expect(
          findConfigurationDefects(
            configAvec({ TRUST_PROXY: valeur }),
            ENV_PROD,
          ),
        ).toHaveLength(0);
      }
    });

    // ========================================================================
    // LES BUDGETS — A3
    //
    // Ce qui est vérifié ici n'est pas « la fonction lit un nombre » mais que
    // AUCUNE configuration de budget ne peut être silencieusement corrigée. Une
    // valeur absente reste légitime — elle dit « je m'en remets au défaut ».
    // Une valeur ÉCRITE et inexploitable, elle, doit se voir : sinon
    // l'opérateur croit avoir réglé un compteur qui ne l'est pas.
    // ========================================================================
    it('refuse un seuil de vigilance supérieur ou égal au plafond dur', () => {
      // Inversés, le plafond dur tranche AVANT la vigilance : le palier non
      // bloquant devient inatteignable et le compteur par origine redevient un
      // refus pur — le déni de service collatéral que B′ existe pour supprimer.
      for (const [vigilance, dur] of [
        ['600', '500'],
        ['500', '500'],
      ]) {
        const defauts = findConfigurationDefects(
          configAvec({
            LOGIN_THROTTLE_ORIGINE_VIGILANCE: vigilance,
            LOGIN_THROTTLE_ORIGINE_DUR: dur,
          }),
          ENV_PROD,
        );
        expect(defauts.map((d) => d.key)).toContain('LOGIN_THROTTLE (budgets)');
      }
    });

    it('accepte un couple de seuils cohérent', () => {
      expect(
        findConfigurationDefects(
          configAvec({
            LOGIN_THROTTLE_ORIGINE_VIGILANCE: '40',
            LOGIN_THROTTLE_ORIGINE_DUR: '400',
          }),
          ENV_PROD,
        ),
      ).toHaveLength(0);
    });

    it('refuse une valeur écrite mais inexploitable, sans la corriger', () => {
      // `abc`, `0`, `-5`, `2.5` : quatre façons d'écrire quelque chose qui ne
      // peut pas être un budget. Aucune ne doit passer en silence.
      for (const valeur of ['abc', '0', '-5', '2.5']) {
        const defauts = findConfigurationDefects(
          configAvec({ LOGIN_THROTTLE_OI_MAX: valeur }),
          ENV_PROD,
        );
        expect({ valeur, cles: defauts.map((d) => d.key) }).toEqual({
          valeur,
          cles: ['LOGIN_THROTTLE (budgets)'],
        });
      }
    });

    it('refuse une valeur hors bornes, en haut comme en bas', () => {
      // Sans borne haute, `LOGIN_THROTTLE_ORIGINE_DUR=10⁹` désactiverait le
      // plafond sans que rien ne le signale.
      for (const [cle, valeur] of [
        ['LOGIN_THROTTLE_ORIGINE_DUR', '1000000000'],
        ['LOGIN_THROTTLE_OI_FENETRE_S', '999999'],
      ]) {
        const defauts = findConfigurationDefects(
          configAvec({ [cle]: valeur }),
          ENV_PROD,
        );
        expect({ cle, cles: defauts.map((d) => d.key) }).toEqual({
          cle,
          cles: ['LOGIN_THROTTLE (budgets)'],
        });
      }
    });

    // ========================================================================
    // LES QUATRE RELATIONS — C1
    //
    // Ce que ces tests protègent n'est pas un nombre mais LA phrase qui fonde
    // l'architecture : aucun compteur PARTAGÉ entre utilisateurs ne doit
    // pouvoir refuser un utilisateur légitime. Elle ne tenait jusqu'ici qu'aux
    // valeurs par défaut ; une seule variable d'environnement suffisait à
    // rouvrir le déni de service collatéral, en silence.
    //
    // La marge de DEUX n'est pas une précaution : `consommer` incrémente avant
    // de décider, l'attaquant laisse donc le compteur d'origine à `oiMax + 1`,
    // et la tentative du voisin le porte à `oiMax + 2`.
    // ========================================================================
    describe('cohérence des quatre budgets', () => {
      const avecBudgets = (b: {
        oi?: string;
        vigilance?: string;
        dur?: string;
        id?: string;
      }) =>
        configAvec({
          LOGIN_THROTTLE_OI_MAX: b.oi,
          LOGIN_THROTTLE_ORIGINE_VIGILANCE: b.vigilance,
          LOGIN_THROTTLE_ORIGINE_DUR: b.dur,
          LOGIN_THROTTLE_IDENTIFIANT_MAX: b.id,
        });

      const messages = (b: Parameters<typeof avecBudgets>[0]) =>
        findConfigurationDefects(avecBudgets(b), ENV_PROD).map((d) => d.why);

      it('les valeurs par défaut LIVRÉES satisfont les quatre relations', () => {
        // Garde-fou sur les défauts eux-mêmes : les recalibrer en un jeu
        // incohérent ferait tomber ce test avant tout déploiement.
        const d = BUDGETS_PAR_DEFAUT;
        expect(d.parOrigine.maxVigilance).toBeLessThan(d.parOrigine.maxDur);
        expect(d.parOrigineEtIdentifiant.max + 2).toBeLessThanOrEqual(
          d.parOrigine.maxVigilance,
        );
        expect(d.parOrigineEtIdentifiant.max + 2).toBeLessThanOrEqual(
          d.parOrigine.maxDur,
        );
        expect(d.parOrigineEtIdentifiant.max).toBeLessThanOrEqual(
          d.parIdentifiant.max,
        );
        // Et la configuration livrée passe le garde-fou de démarrage.
        expect(findConfigurationDefects(configAvec(), ENV_PROD)).toHaveLength(
          0,
        );
      });

      // --- relation 2 : oiMax + 2 ≤ maxVigilance ---------------------------
      it('oiMax = maxVigilance − 1 → REFUS', () => {
        const m = messages({
          oi: '49',
          vigilance: '50',
          dur: '500',
          id: '100',
        });
        expect(m.join(' ')).toContain('LOGIN_THROTTLE_ORIGINE_VIGILANCE');
      });

      it('oiMax = maxVigilance − 2 → ACCEPTÉ', () => {
        expect(
          messages({ oi: '48', vigilance: '50', dur: '500', id: '100' }),
        ).toHaveLength(0);
      });

      // --- relation 3 : oiMax + 2 ≤ maxDur ---------------------------------
      //
      // CETTE RELATION NE PEUT JAMAIS ÊTRE LA SEULE VIOLÉE : les relations 1 et
      // 2 l'impliquent. On vérifie donc la PRÉSENCE puis l'ABSENCE de SON
      // message propre, la configuration restant refusée par la relation 2.
      it('oiMax = maxDur − 1 → REFUS, avec le message du plafond dur', () => {
        const m = messages({
          oi: '499',
          vigilance: '50',
          dur: '500',
          id: '10000',
        });
        expect(m.some((x) => x.includes('LOGIN_THROTTLE_ORIGINE_DUR'))).toBe(
          true,
        );
      });

      it('oiMax = maxDur − 2 → la relation du plafond dur est satisfaite', () => {
        const m = messages({
          oi: '498',
          vigilance: '50',
          dur: '500',
          id: '10000',
        });
        expect(m.some((x) => x.includes('LOGIN_THROTTLE_ORIGINE_DUR'))).toBe(
          false,
        );
      });

      // --- relation 4 : oiMax ≤ idMax --------------------------------------
      it('oiMax > idMax → REFUS', () => {
        const m = messages({
          oi: '200',
          vigilance: '300',
          dur: '1000',
          id: '100',
        });
        expect(m).toHaveLength(1);
        expect(m[0]).toContain('LOGIN_THROTTLE_IDENTIFIANT_MAX');
      });

      it('oiMax = idMax → ACCEPTÉ', () => {
        expect(
          messages({ oi: '100', vigilance: '300', dur: '1000', id: '100' }),
        ).toHaveLength(0);
      });

      // --- lisibilité du message -------------------------------------------
      it('le message nomme la relation violée ET les deux valeurs', () => {
        // Un refus de démarrage se lit à trois heures du matin : il doit dire
        // quoi corriger, pas seulement que quelque chose ne va pas.
        const m = messages({
          oi: '49',
          vigilance: '50',
          dur: '500',
          id: '100',
        });
        const texte = m.join(' ');
        expect(texte).toContain('LOGIN_THROTTLE_OI_MAX (49)');
        expect(texte).toContain('LOGIN_THROTTLE_ORIGINE_VIGILANCE (50)');
        expect(texte).toContain('second facteur');
      });

      it('la configuration DÉMONTRÉE dangereuse est refusée', () => {
        // `oiMax = 20, maxDur = 10` : mesuré sur le code réel, le voisin
        // légitime était bloqué. Les deux relations doivent la nommer.
        const m = messages({ oi: '20', vigilance: '8', dur: '10', id: '100' });
        expect(m.some((x) => x.includes('LOGIN_THROTTLE_ORIGINE_DUR'))).toBe(
          true,
        );
        expect(
          m.some((x) => x.includes('LOGIN_THROTTLE_ORIGINE_VIGILANCE')),
        ).toBe(true);
      });
    });

    it('une variable ABSENTE reste parfaitement légitime', () => {
      // C'est la distinction qui fonde tout le contrôle : ne rien écrire n'est
      // pas se tromper.
      expect(
        findConfigurationDefects(
          configAvec({
            LOGIN_THROTTLE_OI_MAX: undefined,
            LOGIN_THROTTLE_ORIGINE_DUR: undefined,
          }),
          ENV_PROD,
        ),
      ).toHaveLength(0);
    });

    it('refuse une valeur TRUST_PROXY approximative', () => {
      // `1`, `yes`, `on` : lues comme « pas false » par un humain pressé, elles
      // ne disent pas quelle topologie a été choisie.
      for (const valeur of ['1', 'yes', 'on', 'TRUE']) {
        const defauts = findConfigurationDefects(
          configAvec({ TRUST_PROXY: valeur }),
          ENV_PROD,
        );
        expect(defauts.map((d) => d.key)).toContain('TRUST_PROXY');
      }
    });
  });

  describe('Secrets restés à leur valeur d’exemple', () => {
    it('détecte un secret d’exemple par le motif du nom, sans liste à tenir', () => {
      const defauts = findConfigurationDefects(configAvec(), {
        ...ENV_PROD,
        // Cette variable n'est nommée nulle part dans le garde-fou : elle est
        // attrapée parce que son NOM ressemble à un secret. Une variable
        // ajoutée demain sera couverte sans que personne y pense.
        UN_FOURNISSEUR_FUTUR_API_KEY: 'change-me',
      });
      expect(defauts.map((d) => d.key)).toContain(
        'UN_FOURNISSEUR_FUTUR_API_KEY',
      );
    });

    // Le message part dans les journaux de démarrage, souvent les moins
    // protégés de la chaîne. Dire qu'un secret est resté à sa valeur d'exemple
    // suffit à le corriger ; l'écrire serait le publier.
    it('ne recopie jamais la valeur du secret dans le message', () => {
      const defauts = findConfigurationDefects(configAvec(), {
        ...ENV_PROD,
        PAYMENT_WEBHOOK_SECRET_SIMULATED: 'change-me',
      });
      const defaut = defauts.find(
        (d) => d.key === 'PAYMENT_WEBHOOK_SECRET_SIMULATED',
      );
      expect(defaut).toBeDefined();
      expect(JSON.stringify(defaut)).not.toContain('change-me');
    });

    it('laisse passer un vrai secret', () => {
      const defauts = findConfigurationDefects(configAvec(), {
        ...ENV_PROD,
        PAYMENT_WEBHOOK_SECRET_SIMULATED: 'b7f3c1a9e42d8f6b0c5a7e91d3f8b2a6',
      });
      expect(defauts).toHaveLength(0);
    });
  });

  describe('Hors production', () => {
    // En développement, ces valeurs sont exactement ce qu'il faut : personne ne
    // veut envoyer de vrais SMS en écrivant du code.
    it('ne bloque jamais le démarrage', () => {
      const toutEnDev = configAvec({
        SMS_PROVIDER: 'console',
        EMAIL_PROVIDER: 'console',
        APP_PUBLIC_URL: 'http://localhost:3000',
        PAYMENT_GATEWAY_PROVIDER: 'simulated',
        STORAGE_PROVIDER: 'local',
      });

      expect(() =>
        assertProductionReadiness(toutEnDev, { NODE_ENV: 'development' }),
      ).not.toThrow();
      expect(() => assertProductionReadiness(toutEnDev, {})).not.toThrow();
    });
  });

  describe('Le message d’erreur', () => {
    it('nomme chaque valeur fautive et ce qu’elle casse', () => {
      let message = '';
      try {
        assertProductionReadiness(
          configAvec({ SMS_PROVIDER: 'console', STORAGE_PROVIDER: 'local' }),
          ENV_PROD,
        );
      } catch (erreur) {
        message = (erreur as Error).message;
      }

      expect(message).toContain('SMS_PROVIDER');
      expect(message).toContain('STORAGE_PROVIDER');
      // Le POURQUOI, pas seulement le QUOI : c'est ce qui rend le message utile
      // à celui qui le lit à trois heures du matin.
      expect(message).toContain('mineur');
      expect(message).toContain('Coffre');
    });
  });
});
