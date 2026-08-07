# Rapport de sécurité — Phase 1, durcissement financier du module Ambassadeurs

*Produit le 2026-08-05, au format imposé par le SKILL SECURITY FIRST §17.*

Périmètre : grand livre du portefeuille, commissions, versements, coordonnées de
paiement, détection de fraude. Vérifié par `scripts/revue-phase1.mjs`
(47 contrôles en base, 0 échec), 728 tests automatisés, et six recettes
fonctionnelles contre l'API réelle.

---

## 1. Vulnérabilités détectées

| # | Description | Criticité | Impact |
|---|---|---|---|
| V1 | **Cascade destructrice `User → Ambassador → Wallet → WalletTransaction`.** Supprimer un compte détruisait le grand livre. | **Critique** | Perte irréversible de l'historique comptable ; impossibilité de justifier les sommes versées. Démontré sur copie : un `DELETE` détruisait 2 écritures et un portefeuille. |
| V2 | **Journaux financiers modifiables.** Rien n'empêchait un `UPDATE` sur `WalletTransaction`. | **Critique** | Falsification d'un solde sans trace. Un administrateur, ou un défaut applicatif, pouvait réécrire l'histoire. |
| V3 | **Notes internes d'administration reprises dans les e-mails.** `dto.reason`, champ libre de 1 000 caractères, partait tel quel en notification. | **Élevée** | Une note « soupçon de fraude, à surveiller » atteignant l'intéressé ruine l'enquête et expose la plateforme. |
| V4 | **Écriture de sortie au grand livre dès l'ordre de virement**, avant toute confirmation. | **Élevée** | Un virement ordonné mais jamais arrivé sortait quand même du grand livre ; la somme était perdue pour l'ambassadeur sans qu'aucun contrôle ne la rattrape. |
| V5 | **Un même administrateur validait et exécutait un versement.** | **Élevée** | Aucune séparation des tâches sur un flux d'argent sortant. Menace interne (§16). |
| V6 | **Coordonnées de paiement en clair en base**, sur `AmbassadorPaymentDetail` et `PayoutRequest`. | **Élevée** | Un vidage de base volé — y compris une vieille sauvegarde — livrait tous les numéros Mobile Money. |
| V7 | **La destination était saisie à chaque demande de versement.** | **Élevée** | « Modifier ses coordonnées » n'était pas un acte datable : tout délai de refroidissement aurait été contournable en tapant un autre numéro. |
| V8 | **`=== null` au lieu de `== null`** dans la résolution de barème. | **Moyenne** | `undefined` franchissait le garde-fou et créait une commission à taux zéro : un ambassadeur payé zéro, en silence. |
| V9 | **Barèmes modifiables en place.** | **Moyenne** | « Quel était le taux le 15 mars ? » devenait sans réponse — un litige de commission n'était plus instruisable. |
| V10 | **Fuite du gabarit portugais** : `.replace()` ne traite que la première occurrence, ES et PT partageant l'intro « Motivo: ». | **Moyenne** | Un motif brut atteignait le destinataire lusophone. |
| V11 | **`CryptoModule` non enregistré** dans `app.module.ts` (défaut introduit pendant ce chantier). | **Moyenne** | Le chiffrement aurait échoué à l'injection au démarrage. 728 tests unitaires passaient ; seul le lint l'a vu. |

---

## 2. Correctifs appliqués

**Grand livre (V1, V2)** — Déclencheur PostgreSQL générique `financialLedgerAppendOnly`
sur six journaux : `WalletTransaction`, `AmbassadorEvent`, `CommissionEvent`,
`PortfolioEvent`, `PayoutEvent`, `AmbassadorPaymentDetailEvent`. Ni modification
ni suppression ; seule exception tolérée, l'anonymisation d'une clé étrangère
vers `NULL` (RGPD), vérifiée en comparant `to_jsonb(NEW)` amputé des colonnes
anonymisables à `to_jsonb(OLD)`. Sept cascades passées en `SET NULL`, faits
identifiants dénormalisés (`WalletTransaction.ambassadorId`,
`AmbassadorPortfolioEntry.organizationName`) pour que le journal survive à son
parent.

**Motifs (V3, V10)** — Trois niveaux rendus **structurels** : `internalNote`
(strictement interne), `reasonCode` (énumération traduite ×5 langues),
`publicMessage` (facultatif, balisage refusé à la frontière). Le champ qui part
en notification n'accepte qu'une valeur de la liste contrôlée : une note libre ne
peut pas y entrer. La suspicion de fraude n'a **pas** de code communicable — elle
se dit `COMPLIANCE_REVIEW`. Gabarits repris et couverts par un test cinq langues.

**Versements (V4, V5)** — Cycle en six étapes ; l'écriture de sortie est passée
de l'ordre de virement à sa **confirmation**. Séparation des pouvoirs garantie par
trois contraintes `CHECK` en base — le validateur n'exécute pas, le second
approbateur non plus, et deux approbateurs sont forcément distincts. Seuil de
double contrôle configurable par pays, **figé à la demande**.

**Coordonnées (V6, V7)** — `FieldEncryptionService`, AES-256-GCM, trousseau à
rotation : chaque valeur porte l'identifiant de sa clé. Deux colonnes, chiffrée et
masquée, de sorte que le déchiffrement soit l'exception. Porte unique
`revealDestination()` exigeant un motif de liste contrôlée et journalisant chaque
lecture ; les échecs de déchiffrement écrivent `..._ACCESS_DENIED`. Les
coordonnées sont désormais **enregistrées**, ce qui rend le délai de 72 h
opérant. Colonne en clair supprimée du schéma.

**Barèmes et plafonds (V8, V9)** — Chaîne de versions (`lineageKey`, `version`,
`supersedesId`), quatre `CHECK` en base, photographie de la règle sur chaque
commission. Plafonds configurables sur deux axes (portée × fenêtre) ; un
dépassement met la commission en `REVIEW_REQUIRED` **pour son montant complet** —
`Commission_correction_never_upward` interdit en base qu'une correction remonte.

**Antifraude** — Moteur sans dépendance vers aucun service capable de
sanctionner ; `fraud-no-sanction.spec.ts` le vérifie sur le code source.

**V11** — `CryptoModule` enregistré ; détecté par le lint avant tout démarrage.

---

## 3. Risques résiduels

| # | Risque | Criticité | Statut |
|---|---|---|---|
| R1 | **Six cascades subsistent depuis `Ambassador`**, dont deux financières (`AmbassadorWallet`, `Commission`). | Moyenne | **Dette acceptée par le promoteur** sous quatre conditions. Non atteignable tant que la chaîne depuis `User` reste coupée et que `ambassador.delete()` reste absent du code métier. Ma documentation initiale n'en citait que deux : corrigée le 2026-08-05. |
| R2 | **`DocumentEncryptionService` (Coffre-fort) n'a qu'une clé sans identifiant.** Sa rotation est impossible. | Moyenne | **Non traité.** Hors du périmètre demandé, mais le Coffre-fort a désormais sur ce point une protection *inférieure* aux coordonnées de paiement. Corriger suppose de rechiffrer les fichiers stockés. |
| R3 | **`session_replication_role = replica` désactive les déclencheurs d'ajout seul.** | Faible | Inhérent à PostgreSQL ; exige les droits superutilisateur. À couvrir par la gestion des privilèges de base, pas par le schéma. |
| R4 | **Les seuils antifraude sont des valeurs de départ**, réglées sans connaître les comportements normaux. | Faible | Assumé. Une règle mal réglée produit du bruit, jamais de dégât. À réviser après les premières semaines. |
| R5 | **Fenêtres de plafond calées sur l'heure UTC**, pas sur la journée civile locale. | Faible | Documenté dans le code. À revoir si un pays l'exige. |
| R6 | **Le fournisseur SMS reste `console`.** | Faible | L'alerte de sécurité sur changement de coordonnées ne partira réellement qu'une fois Africa's Talking branché (tâche #102). |

---

## 4. Dette technique

- **R1** et **R2** ci-dessus.
- Les douze évènements du partenariat de démonstration restent **orphelins** :
  l'ajout seul interdit de les rattacher après la restauration du dossier.
- La recette du cycle complet crée des écritures **permanentes** au grand livre :
  c'est le prix d'une recette qui ne triche pas, mais la base de développement
  accumule des données de test qu'aucun script ne peut retirer.
- `scripts/prepare-production.mjs` refuse honnêtement de certifier une base
  portant un historique en ajout seul : **la production doit partir d'une base
  vierge**, pas d'un nettoyage.

---

## 5. Recommandations

1. **Arbitrer R1** avant toute fonctionnalité de suppression physique de dossier.
   Rendre `Commission.ambassadorId` nullable est un changement large : il se
   décide, il ne s'improvise pas en urgence.
2. **Traiter R2** en portant le trousseau à rotation au Coffre-fort numérique.
   Le mécanisme existe désormais ; il reste à rechiffrer les fichiers stockés.
3. **Restreindre les privilèges de base** en production : le compte applicatif
   n'a besoin ni de superutilisateur, ni du droit de modifier les déclencheurs.
   C'est la seule réponse à R3.
4. **Réviser les seuils antifraude** après quatre à six semaines d'exploitation,
   en relisant les motifs d'écartement : une règle systématiquement écartée est
   une règle mal réglée.
5. **Faire réaliser l'audit d'intrusion indépendant** prévu au CLAUDE.md §7 avant
   tout lancement public. Ce rapport documente le travail fait ; il ne le
   remplace pas.
