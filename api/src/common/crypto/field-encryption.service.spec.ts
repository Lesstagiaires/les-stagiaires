import type { ConfigService } from '@nestjs/config';
import { FieldEncryptionService } from './field-encryption.service';

// ============================================================================
// CHIFFREMENT DE CHAMP — TROUSSEAU ET ROTATION
//
// Exigence du promoteur du 2026-08-04 : « si une clé devait être remplacée un
// jour, les données ne devraient pas devenir illisibles ».
//
// Le test qui compte est celui de la rotation. Les autres vérifient la
// mécanique ; celui-là vérifie la PROMESSE — et c'est celle qu'on ne pourra pas
// tenir après coup, le jour où une clé devra être remplacée en urgence.
// ============================================================================
describe('Chiffrement de champ', () => {
  const V1 = 'a'.repeat(64);
  const V2 = 'b'.repeat(64);

  const serviceAvec = (keys: string, active: string) => {
    const config = {
      getOrThrow: (nom: string) =>
        nom === 'FIELD_ENCRYPTION_KEYS' ? keys : active,
    };
    return new FieldEncryptionService(config as unknown as ConfigService);
  };

  const SECRET = 'MTN MoMo — Titulaire A 677123456';

  // --- L'aller-retour ---------------------------------------------------------
  describe('chiffrer puis déchiffrer', () => {
    it('rend exactement la valeur d’origine', () => {
      const service = serviceAvec(`v1:${V1}`, 'v1');
      expect(service.decrypt(service.encrypt(SECRET))).toBe(SECRET);
    });

    it('ne laisse RIEN de lisible dans la valeur chiffrée', () => {
      const service = serviceAvec(`v1:${V1}`, 'v1');
      const chiffre = service.encrypt(SECRET);

      expect(chiffre).not.toContain('677123456');
      expect(chiffre).not.toContain('Titulaire');
      expect(chiffre).not.toContain('MoMo');
    });

    it('deux chiffrements de la MÊME valeur diffèrent', () => {
      // Propriété essentielle : sans vecteur d'initialisation neuf à chaque
      // fois, deux ambassadeurs ayant le même opérateur produiraient le même
      // chiffré — et il suffirait de comparer les colonnes pour les regrouper.
      const service = serviceAvec(`v1:${V1}`, 'v1');
      expect(service.encrypt(SECRET)).not.toBe(service.encrypt(SECRET));
    });

    it('préserve les accents et les caractères non latins', () => {
      const service = serviceAvec(`v1:${V1}`, 'v1');
      const valeur = 'Société Générale — Aïcha N’Diaye — ٦٧٧١٢٣٤٥٦';
      expect(service.decrypt(service.encrypt(valeur))).toBe(valeur);
    });
  });

  // --- L'INTÉGRITÉ ------------------------------------------------------------
  describe('valeur altérée', () => {
    it('refuse de déchiffrer une valeur retouchée', () => {
      const service = serviceAvec(`v1:${V1}`, 'v1');
      const chiffre = service.encrypt(SECRET);

      // Un octet modifié en base par une main malveillante ne doit pas produire
      // un numéro de compte DIFFÉRENT — il doit produire une erreur. C'est ce
      // que garantit le mode authentifié GCM.
      const altere = chiffre.slice(0, -4) + 'AAAA';
      expect(() => service.decrypt(altere)).toThrow();
    });

    it('refuse une valeur malformée', () => {
      const service = serviceAvec(`v1:${V1}`, 'v1');
      expect(() => service.decrypt('pas-du-tout-chiffré')).toThrow(/malformée/);
    });
  });

  // --- LA ROTATION, LE CŒUR DE L'EXIGENCE ------------------------------------
  describe('rotation de clé', () => {
    it('une valeur chiffrée avec v1 reste lisible après passage à v2', () => {
      const avant = serviceAvec(`v1:${V1}`, 'v1');
      const chiffreV1 = avant.encrypt(SECRET);

      // La rotation : on AJOUTE v2 sans retirer v1, et on déclare v2 active.
      const apres = serviceAvec(`v1:${V1},v2:${V2}`, 'v2');

      // C'est TOUTE la promesse : remplacer la clé ne rend rien illisible.
      expect(apres.decrypt(chiffreV1)).toBe(SECRET);
    });

    it('les nouvelles écritures utilisent la clé active', () => {
      const service = serviceAvec(`v1:${V1},v2:${V2}`, 'v2');
      expect(service.keyIdOf(service.encrypt(SECRET))).toBe('v2');
    });

    it('rotate() réécrit une ancienne valeur avec la clé active', () => {
      const avant = serviceAvec(`v1:${V1}`, 'v1');
      const chiffreV1 = avant.encrypt(SECRET);

      const apres = serviceAvec(`v1:${V1},v2:${V2}`, 'v2');
      const reecrit = apres.rotate(chiffreV1);

      expect(apres.keyIdOf(reecrit)).toBe('v2');
      expect(apres.decrypt(reecrit)).toBe(SECRET);
    });

    it('rotate() ne touche pas une valeur déjà à jour', () => {
      const service = serviceAvec(`v1:${V1},v2:${V2}`, 'v2');
      const dejaV2 = service.encrypt(SECRET);
      // Rechiffrer inutilement ferait du bruit dans les journaux et rallongerait
      // une réécriture qui peut porter sur des dizaines de milliers de lignes.
      expect(service.rotate(dejaV2)).toBe(dejaV2);
    });

    it('DIT CLAIREMENT quelle clé manque si on l’a retirée trop tôt', () => {
      const avant = serviceAvec(`v1:${V1}`, 'v1');
      const chiffreV1 = avant.encrypt(SECRET);

      // L'erreur d'exploitation la plus probable : retirer v1 du trousseau avant
      // d'avoir réécrit toutes les valeurs. Le message doit nommer la clé —
      // sinon on cherche des heures.
      const sansV1 = serviceAvec(`v2:${V2}`, 'v2');
      expect(() => sansV1.decrypt(chiffreV1)).toThrow(/« v1 »/);
    });
  });

  // --- Le trousseau -----------------------------------------------------------
  describe('trousseau', () => {
    it('refuse une clé qui n’a pas la bonne longueur', () => {
      const service = serviceAvec('v1:abcdef', 'v1');
      expect(() => service.encrypt(SECRET)).toThrow(/32 octets/);
    });

    it('refuse un identifiant contenant un point', () => {
      // L'identifiant est le premier segment du format : un point dedans
      // rendrait toute valeur indéchiffrable.
      const service = serviceAvec(`v.1:${V1}`, 'v.1');
      expect(() => service.encrypt(SECRET)).toThrow(/point/);
    });

    it('refuse un trousseau vide', () => {
      const service = serviceAvec('  ', 'v1');
      expect(() => service.encrypt(SECRET)).toThrow(/aucune clé/);
    });

    it('refuse une clé active absente du trousseau', () => {
      const service = serviceAvec(`v1:${V1}`, 'v9');
      expect(() => service.encrypt(SECRET)).toThrow(/absente/);
    });

    it('reconnaît ses propres valeurs, et seulement elles', () => {
      const service = serviceAvec(`v1:${V1}`, 'v1');
      expect(service.isEncrypted(service.encrypt(SECRET))).toBe(true);
      expect(service.isEncrypted('MTN MoMo 677123456')).toBe(false);
      // Un identifiant de clé inconnu : la valeur est peut-être chiffrée, mais
      // pas par ce trousseau. Une migration doit pouvoir faire la différence.
      expect(service.isEncrypted('v9.aaa.bbb.ccc')).toBe(false);
    });
  });
});
