import type { ConfigService } from '@nestjs/config';
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
