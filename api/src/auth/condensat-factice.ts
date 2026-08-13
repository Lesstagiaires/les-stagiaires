import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';

// ============================================================================
// LE CONDENSAT FACTICE — défaut S-06-B
//
// LE PROBLÈME. `login` ne vérifiait un mot de passe que si le compte existait.
// Argon2 étant DÉLIBÉRÉMENT coûteux — c'est sa raison d'être —, cette économie
// se voyait : mesuré le 2026-08-12 sur 30 essais par scénario, un numéro
// inconnu répondait en 2,26 ms de médiane, un numéro réel en 71,46 ms. Un
// facteur 31, et surtout AUCUN RECOUVREMENT des plages : [1,5 – 3,5] contre
// [68,0 – 98,8]. Une seule requête suffisait à savoir si quelqu'un est inscrit,
// sans rien modifier et sans laisser la moindre trace.
//
// LA SOLUTION N'EST PAS D'ATTENDRE. Aucun `sleep`, aucune compensation
// mesurée : ces procédés se désynchronisent dès que la machine change de
// charge, et ils cachent le signal au lieu de le supprimer. On fait le MÊME
// TRAVAIL des deux côtés — une vraie vérification Argon2, contre un condensat
// qui n'appartient à personne.
//
// POURQUOI `argon2.hash()` ET PAS UNE CHAÎNE EN DUR. Un condensat écrit en dur
// figerait ses paramètres au jour où on l'a collé. Le jour où la bibliothèque
// change ses valeurs par défaut — ou le jour où quelqu'un les configure — les
// condensats réels se déplaceraient, pas lui, et l'écart de temps reviendrait
// sans que personne ne touche à `login`. En appelant la MÊME fonction que
// `register`, les paramètres ne peuvent pas diverger : il n'y a rien à
// synchroniser.
//
// UNE SEULE FOIS. Le calcul coûte précisément ce que coûte Argon2. Le refaire à
// chaque requête ajouterait ~70 ms à toutes les connexions du site. La promesse
// est mémoïsée — pas la valeur, la promesse — pour que deux appels concurrents
// au démarrage partagent le même calcul au lieu d'en lancer deux.
// ============================================================================

let calcul: Promise<string> | null = null;

/**
 * Le condensat contre lequel on vérifie le mot de passe d'un identifiant qui
 * n'existe pas. Il correspond à un secret aléatoire de 32 octets : aucun mot de
 * passe ne peut s'y vérifier, et personne — pas même nous — ne connaît sa
 * préimage.
 */
export function condensatFactice(): Promise<string> {
  if (!calcul) {
    calcul = argon2.hash(randomBytes(32).toString('hex'));
  }
  return calcul;
}

/**
 * Appelé à l'initialisation du module pour que la première connexion réelle ne
 * paie pas le calcul — sans quoi elle serait, elle, mesurablement plus lente.
 */
export async function prechaufferCondensatFactice(): Promise<void> {
  await condensatFactice();
}

/**
 * Réservé aux tests : permet de vérifier que le condensat n'est calculé qu'une
 * fois, en repartant d'un état connu.
 */
export function reinitialiserCondensatFacticePourTests(): void {
  calcul = null;
}
