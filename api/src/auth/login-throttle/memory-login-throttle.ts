import { Injectable } from '@nestjs/common';
import { BUDGETS_PAR_DEFAUT, decider } from './login-throttle.interface';
import type {
  Budgets,
  DecisionLimiteur,
  LoginThrottle,
} from './login-throttle.interface';
import { prefixeIp } from './prefixe-ip';

// ============================================================================
// LE LIMITEUR EN MÉMOIRE — développement et repli
//
// DEUX USAGES, UN SEUL CODE. En développement, il évite d'exiger un Redis pour
// lancer l'API. En production, il sert de FILET quand Redis tombe : mieux vaut
// un limiteur par processus qu'aucun limiteur.
//
// SA LIMITE EST STRUCTURELLE, et c'est pourquoi `production-readiness.ts` le
// refuse comme fournisseur principal : chaque instance compte pour elle seule.
// Avec trois instances derrière un répartiteur, les budgets sont triplés. Ce
// n'est pas un défaut de cette classe — c'est la nature de la mémoire d'un
// processus, et la raison d'être de Redis.
//
// LA PURGE EST PARESSEUSE. On ne balaie pas la table à intervalle régulier :
// une entrée expirée est simplement ignorée puis remplacée à la lecture
// suivante. Un balayage périodique coûterait un minuteur permanent pour
// récupérer quelques kilo-octets.
//
// ÉQUIVALENCE AVEC REDIS — ce n'est pas un vœu, c'est une contrainte testée.
// Les deux implémentations partagent `decider()`, donc la RÈGLE ; elles ne
// partagent pas la façon de compter. Trois pièges doivent donc être évités des
// deux côtés, à l'identique, et le sont ici :
//   — ne jamais ressusciter une entrée expirée en la décrémentant ;
//   — ne jamais descendre sous zéro ;
//   — ne jamais réarmer la fenêtre en remboursant.
// Un test rejoue le même scénario contre les deux et compare les décisions.
// ============================================================================

interface Compteur {
  valeur: number;
  expireA: number;
}

@Injectable()
export class MemoryLoginThrottle implements LoginThrottle {
  private readonly compteurs = new Map<string, Compteur>();

  constructor(private readonly budgets: Budgets = BUDGETS_PAR_DEFAUT) {}

  private incrementer(cle: string, fenetreSecondes: number): number {
    const maintenant = Date.now();
    const existant = this.compteurs.get(cle);

    if (!existant || existant.expireA <= maintenant) {
      this.compteurs.set(cle, {
        valeur: 1,
        expireA: maintenant + fenetreSecondes * 1000,
      });
      return 1;
    }

    existant.valeur += 1;
    return existant.valeur;
  }

  /**
   * Rend une unité — l'exact inverse d'`incrementer`, à trois réserves près qui
   * sont chacune une faille en puissance :
   *
   *   ENTRÉE ABSENTE OU EXPIRÉE : on ne fait RIEN. La recréer à −1 ou à 0 lui
   *     donnerait une nouvelle fenêtre, donc prolongerait indéfiniment la vie
   *     d'un compteur que le temps avait effacé.
   *   PLANCHER À ZÉRO : un compteur négatif serait du budget offert. Deux
   *     remboursements de plus que de réservations — cas possible au passage
   *     d'une fenêtre — donneraient un crédit permanent.
   *   `expireA` N'EST JAMAIS TOUCHÉ : le rembourser reviendrait à faire glisser
   *     la fenêtre, et un attaquant régulier maintiendrait la sienne en vie.
   */
  private rendre(cle: string): void {
    const existant = this.compteurs.get(cle);
    if (!existant || existant.expireA <= Date.now()) return;
    existant.valeur = Math.max(0, existant.valeur - 1);
  }

  consommer(
    ip: string | undefined,
    identifiant: string,
  ): Promise<DecisionLimiteur> {
    const origine = prefixeIp(ip);

    const compteurs = {
      origineEtIdentifiant: this.incrementer(
        `oi:${origine}:${identifiant}`,
        this.budgets.parOrigineEtIdentifiant.fenetreSecondes,
      ),
      origine: this.incrementer(
        `o:${origine}`,
        this.budgets.parOrigine.fenetreSecondes,
      ),
      identifiant: this.incrementer(
        `i:${identifiant}`,
        this.budgets.parIdentifiant.fenetreSecondes,
      ),
    };

    return Promise.resolve(decider(compteurs, this.budgets, false));
  }

  preuveDuMotDePasse(
    ip: string | undefined,
    identifiant: string,
  ): Promise<void> {
    const origine = prefixeIp(ip);

    // (origine, identifiant) : REMISE À ZÉRO, pas décrément. Cette clé n'est
    // partagée avec personne — pour l'effacer il faut avoir prouvé le mot de
    // passe de cet identifiant. Celui qui se trompe quatre fois avant de
    // réussir repart donc avec un compte plein, au lieu d'être bloqué au
    // premier faux pas de la session suivante.
    this.compteurs.delete(`oi:${origine}:${identifiant}`);

    // (origine) : DÉCRÉMENT, JAMAIS SUPPRESSION. La clé est partagée par tout
    // un NAT. La supprimer offrirait un contournement propre : l'attaquant se
    // connecterait à son propre compte depuis la même adresse pour effacer le
    // compteur d'échecs de tout le monde.
    this.rendre(`o:${origine}`);

    // (identifiant) : décrément aussi. Une connexion réussie du titulaire ne
    // doit pas effacer la trace de quatre-vingt-dix échecs venus d'ailleurs —
    // c'est précisément le signal de bourrage distribué qu'on cherche à voir.
    this.rendre(`i:${identifiant}`);

    return Promise.resolve();
  }

  /** Réservé aux tests : repartir d'un état connu. */
  vider(): void {
    this.compteurs.clear();
  }
}
