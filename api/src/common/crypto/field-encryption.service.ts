import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ============================================================================
// CHIFFREMENT DE CHAMP, AVEC TROUSSEAU ET ROTATION
//
// Exigence du promoteur du 2026-08-04 : les coordonnées de paiement doivent être
// chiffrées au repos, les clés ne doivent jamais être stockées avec les données,
// et « si une clé devait être remplacée un jour, les données ne devraient pas
// devenir illisibles ».
//
// CE QUE CE SERVICE FAIT DIFFÉREMMENT DE DocumentEncryptionService. Ce dernier
// chiffre avec UNE clé et ne l'écrit nulle part dans le blob : remplacer cette
// clé rendrait tous les documents illisibles d'un coup. Ici, chaque valeur porte
// l'IDENTIFIANT de la clé qui l'a produite. Le trousseau peut donc contenir
// plusieurs clés simultanément :
//
//   — on chiffre TOUJOURS avec la clé active ;
//   — on déchiffre avec CELLE QUI A SERVI, quelle qu'elle soit.
//
// Une rotation devient alors : ajouter une clé au trousseau, la déclarer active,
// et laisser les anciennes en place le temps de réécrire les valeurs. Aucune
// interruption, aucune donnée perdue. Sans identifiant de clé, une rotation
// serait un pari — et sur des coordonnées de paiement, on ne parie pas.
//
// FORMAT : `<idClé>.<iv>.<sceau>.<chiffré>`, chacun en base64url. Le format est
// AUTODESCRIPTIF : une valeur sortie de la base se déchiffre sans consulter
// aucune table de correspondance. C'est ce qui permet à une sauvegarde restaurée
// des années plus tard de rester exploitable, du moment qu'on a le trousseau.
//
// AES-256-GCM, donc AUTHENTIFIÉ : une valeur modifiée en base ne se déchiffre
// pas, elle lève. Un octet retouché par une main malveillante ne produit pas un
// numéro de compte différent, il produit une erreur.
//
// LES CLÉS NE SONT JAMAIS EN BASE. Elles viennent de la configuration
// d'exécution, aux côtés des autres secrets, et n'ont aucune raison de croiser
// les données qu'elles protègent : quelqu'un qui obtiendrait un vidage de la
// base n'obtiendrait rien de lisible.
// ============================================================================

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SEPARATOR = '.';

@Injectable()
export class FieldEncryptionService {
  private readonly logger = new Logger(FieldEncryptionService.name);
  private ring: Map<string, Buffer> | null = null;
  private activeId: string | null = null;

  constructor(private readonly config: ConfigService) {}

  // Chiffre avec la clé ACTIVE. Le résultat porte son identifiant.
  encrypt(plaintext: string): string {
    const { id, key } = this.activeKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return [
      id,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(SEPARATOR);
  }

  // Déchiffre avec la clé QUI A SERVI, lue sur la valeur elle-même.
  decrypt(value: string): string {
    const parts = value.split(SEPARATOR);
    if (parts.length !== 4) {
      throw new Error('Valeur chiffrée malformée.');
    }

    const [keyId, ivPart, tagPart, ciphertextPart] = parts;
    const key = this.keyRing().get(keyId);
    if (!key) {
      // Message délibérément explicite : c'est l'erreur qu'on rencontrera le
      // jour où quelqu'un retirera une ancienne clé du trousseau trop tôt, et
      // savoir LAQUELLE manque fait gagner des heures.
      throw new Error(
        `Clé de chiffrement « ${keyId} » absente du trousseau : la valeur ne peut pas être déchiffrée. Ne retirez une clé qu'après avoir réécrit toutes les valeurs qu'elle protège.`,
      );
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  // Une valeur est-elle déjà chiffrée par ce service ? Utile aux migrations de
  // données, qui rencontrent des lignes des deux sortes.
  isEncrypted(value: string): boolean {
    const parts = value.split(SEPARATOR);
    return parts.length === 4 && this.keyRing().has(parts[0]);
  }

  // La clé qui a produit cette valeur. Permet à un travail de réécriture de
  // repérer ce qui reste à traiter, sans déchiffrer quoi que ce soit.
  keyIdOf(value: string): string | null {
    const parts = value.split(SEPARATOR);
    return parts.length === 4 ? parts[0] : null;
  }

  // Réécrit une valeur avec la clé active. C'est TOUTE la rotation : déchiffrer
  // avec l'ancienne, rechiffrer avec la nouvelle. Prévu dès maintenant même s'il
  // n'a pas encore d'appelant — le jour où une clé devra être remplacée en
  // urgence n'est pas le jour où l'on écrit ce code.
  rotate(value: string): string {
    if (this.keyIdOf(value) === this.activeKey().id) return value;
    return this.encrypt(this.decrypt(value));
  }

  // Identifiant de la clé active, pour les journaux et les rapports de rotation.
  // Un identifiant de clé n'est pas un secret : il ne dit rien de la clé.
  activeKeyId(): string {
    return this.activeKey().id;
  }

  private activeKey(): { id: string; key: Buffer } {
    // Le trousseau se charge à la première lecture, et c'est ce chargement qui
    // renseigne l'identifiant actif. L'appeler d'abord garantit donc les deux.
    const ring = this.keyRing();
    const id = this.activeId!;
    const key = ring.get(id);
    if (!key) {
      throw new Error(
        `FIELD_ENCRYPTION_ACTIVE_KEY désigne « ${id} », absente de FIELD_ENCRYPTION_KEYS.`,
      );
    }
    return { id, key };
  }

  // Trousseau lu une seule fois, puis gardé en mémoire. Format attendu :
  //   FIELD_ENCRYPTION_KEYS=v1:<64 hex>,v2:<64 hex>
  //   FIELD_ENCRYPTION_ACTIVE_KEY=v2
  private keyRing(): Map<string, Buffer> {
    if (this.ring) return this.ring;

    const raw = this.config.getOrThrow<string>('FIELD_ENCRYPTION_KEYS');
    const ring = new Map<string, Buffer>();

    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const separator = trimmed.indexOf(':');
      if (separator === -1) {
        throw new Error(
          'FIELD_ENCRYPTION_KEYS attend des entrées « identifiant:clé hexadécimale », séparées par des virgules.',
        );
      }

      const id = trimmed.slice(0, separator).trim();
      const key = Buffer.from(trimmed.slice(separator + 1).trim(), 'hex');

      if (!id) throw new Error('Une clé du trousseau n’a pas d’identifiant.');
      if (id.includes(SEPARATOR)) {
        // L'identifiant est le premier segment du format : un point dedans
        // rendrait toute valeur indéchiffrable.
        throw new Error(
          `L’identifiant de clé « ${id} » ne peut pas contenir de point.`,
        );
      }
      if (key.length !== KEY_LENGTH) {
        throw new Error(
          `La clé « ${id} » doit faire ${KEY_LENGTH} octets (${KEY_LENGTH * 2} caractères hexadécimaux).`,
        );
      }

      ring.set(id, key);
    }

    if (ring.size === 0) {
      throw new Error('FIELD_ENCRYPTION_KEYS ne contient aucune clé.');
    }

    this.activeId = this.config
      .getOrThrow<string>('FIELD_ENCRYPTION_ACTIVE_KEY')
      .trim();
    this.ring = ring;

    this.logger.log(
      `Trousseau de chiffrement chargé : ${ring.size} clé(s), active « ${this.activeId} ».`,
    );
    return ring;
  }
}
