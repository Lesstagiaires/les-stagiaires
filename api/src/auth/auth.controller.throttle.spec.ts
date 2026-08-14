import 'reflect-metadata';
// Ces constantes ne sont pas réexportées par la racine du paquet : on va les
// chercher là où le garde les lit lui-même. Un chemin profond est fragile, mais
// il l'est BRUYAMMENT — le premier test échouerait si la bibliothèque changeait
// de clé, là où des littéraux recopiés rendraient ce fichier silencieusement
// inutile.
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from './auth.controller';

// ============================================================================
// LE PLAFOND HTTP DE /auth/login NE DOIT PAS REDESCENDRE EN SILENCE — A6
//
// CE QUE CE TEST EMPÊCHE. `@Throttle` valait 10 requêtes par minute et par IP,
// SUCCÈS COMPRIS. Derrière un NAT d'opérateur — la règle en Afrique centrale —
// le onzième abonné à se connecter dans la minute était rejeté. Tout le travail
// de S-06-C sur le limiteur applicatif ne changeait rien à cela : le refus
// tombait un étage plus haut, avant même d'atteindre le service.
//
// UN RETOUR À 10 NE CASSERAIT AUCUN AUTRE TEST. Les tests d'intégration du
// limiteur appellent `auth.login()` directement ; ils ne traversent jamais le
// garde HTTP. C'est précisément le genre de régression qu'une relecture laisse
// passer et qu'aucune suite ne voit — d'où ce garde-fou.
//
// ON NE FIGE PAS LA VALEUR MÉTIER. Le test exige un PLANCHER, pas 300 :
// recalibrer à 250 ou 400 reste libre, retomber à 10 ne l'est pas. La valeur
// retenue (300/min) vient d'une mesure — ~74 ms par vérification Argon2, quatre
// fils libuv, soit ~54/s par instance, dont on concède au plus 10 % à une seule
// adresse. Le raisonnement complet est dans `auth.controller.ts`.
//
// CE PLAFOND N'EST PAS UNE PROTECTION DE SÉCURITÉ, et le second test le dit :
// il compte en mémoire par processus, clé sur `req.ip` brut — donc contournable
// en IPv6 — et le stockage de @nestjs/throttler 6.5.0 gèle la décroissance des
// compteurs. Le travail anti-bourrage appartient à `LoginThrottle`.
// ============================================================================

// Le décorateur pose sa métadonnée sur la FONCTION du gestionnaire, avec le nom
// du limiteur concaténé à la clé — `'THROTTLER:LIMIT' + 'default'`. C'est ce
// que lit `ThrottlerGuard.canActivate` : on interroge donc exactement la même
// chose que le garde, et non une constante recopiée.
const cleLimite = THROTTLER_LIMIT + 'default';
const cleTtl = THROTTLER_TTL + 'default';

describe('/auth/login — le plafond volumétrique HTTP', () => {
  // On récupère le DESCRIPTEUR plutôt que la méthode : c'est exactement sur
  // `descriptor.value` que `@Throttle` pose sa métadonnée, et cela évite de
  // détacher une méthode de son objet — ce que l'analyse statique reproche à
  // juste titre partout ailleurs.
  const gestionnaire = Object.getOwnPropertyDescriptor(
    AuthController.prototype,
    'login',
  )?.value as object;

  it('déclare bien un plafond nommé « default »', () => {
    // Si le nom du limiteur changeait, le garde lirait une autre clé et les
    // deux assertions suivantes deviendraient vides de sens.
    expect(Reflect.getMetadata(cleLimite, gestionnaire)).toBeDefined();
    expect(Reflect.getMetadata(cleTtl, gestionnaire)).toBeDefined();
  });

  it('laisse passer un NAT d’opérateur : au moins 100 requêtes par minute', () => {
    const limite = Reflect.getMetadata(cleLimite, gestionnaire) as number;
    const ttl = Reflect.getMetadata(cleTtl, gestionnaire) as number;

    // Un NAT de mille abonnés à une connexion par heure produit ~17 requêtes
    // par minute. Cent laisse une marge de sécurité ; dix n'en laissait aucune.
    expect(limite).toBeGreaterThanOrEqual(100);
    // La fenêtre doit rester une minute : un plafond de 300 sur une heure
    // vaudrait 5/min et reproduirait exactement le défaut corrigé.
    expect(ttl).toBe(60_000);
  });

  it('reste très au-dessus du budget applicatif — il ne le remplace pas', () => {
    // Le limiteur applicatif tranche à 5 ÉCHECS par quart d'heure sur un couple
    // (origine, identifiant). Si le plafond HTTP descendait à cet ordre de
    // grandeur, c'est lui qui trancherait — sur toutes les requêtes, succès
    // compris — et la distinction échec/succès qui fonde B′ serait perdue.
    const limite = Reflect.getMetadata(cleLimite, gestionnaire) as number;
    expect(limite).toBeGreaterThan(50);
  });
});
