# SKILL — SECURITY FIRST

**Version 1.0** — Security by Design • OWASP • Zero Trust • Defense in Depth

> Directive permanente du promoteur, transmise le 2026-08-04. Elle s'applique à
> **toute** fonctionnalité développée à partir de cette date, et complète
> `CLAUDE.md` sans le remplacer.

## Contexte

Une application fonctionnelle n'est pas nécessairement une application sécurisée.
La sécurité ne doit jamais être ajoutée après le développement : elle fait partie
intégrante de la conception.

Toutes les fonctionnalités doivent être développées selon le principe **Security
by Design**. Le code produit doit systématiquement appliquer :

- le principe du moindre privilège ;
- une défense en profondeur ;
- Zero Trust ;
- la séparation des responsabilités ;
- la protection des données dès leur création.

Une fonctionnalité n'est considérée comme terminée que lorsqu'elle est
**fonctionnelle, sécurisée, testée et documentée**.

---

## 1. Classification obligatoire des données

Avant toute implémentation, classifier les données manipulées.

| Niveau | Exemples | Obligations |
|---|---|---|
| **PUBLIC** | offres publiques, FAQ, articles, annonces, partenaires publics | intégrité seule |
| **INTERNE** | tableaux de bord, statistiques internes, rapports | accès réservé aux utilisateurs autorisés |
| **CONFIDENTIEL** | pièces d'identité, contrats, conventions, coordonnées bancaires, Mobile Money, documents RH, données personnelles | chiffrement au repos ; contrôle d'accès renforcé ; journalisation des accès ; masquage dans les logs |
| **TRÈS SENSIBLE** | mots de passe, clés API, secrets JWT, clés de chiffrement, OTP, jetons, journaux de sécurité | jamais exposés ; jamais journalisés ; jamais transmis au frontend ; accès extrêmement restreint |

## 2. Sécurisation systématique des API

Chaque endpoint doit être considéré comme **hostile**. Toujours :

- authentification lorsque nécessaire ;
- autorisation RBAC ;
- validation stricte des entrées (types, tailles, formats) ;
- limitation des requêtes (rate limiting) ;
- journalisation des accès sensibles ;
- contrôle des permissions.

**Aucun endpoint public sans justification.**

## 3. Protection OWASP Top 10

Toute fonctionnalité doit être protégée contre : SQL Injection, XSS, CSRF, SSRF,
IDOR, Path Traversal, Command Injection, Clickjacking, Open Redirect,
désérialisation non sécurisée, escalade de privilèges.

Chaque nouvelle fonctionnalité doit être analysée sous l'angle OWASP.

## 4. Secrets

Ne jamais exposer : mot de passe, secret JWT, clé d'API, secret OAuth, chaîne de
connexion, certificat, clé privée.

Tous les secrets doivent provenir des variables d'environnement, et être absents
du dépôt Git, du frontend et des journaux.

## 5. Séparation Frontend / Backend

Tout le code exécuté dans le navigateur est **public**. Par conséquent : aucun
secret côté client, aucune logique métier critique côté client, toutes les
décisions importantes prises côté serveur.

> Le frontend ne fait qu'afficher. Le backend décide.

## 6. Sécurité de la base de données

Requêtes paramétrées ; ORM sécurisé ; validation serveur ; moindre privilège ;
chiffrement des données sensibles ; sauvegardes régulières ; **migrations testées
sur copie**.

Ne jamais faire confiance aux données du client.

## 7. Journaux d'audit

Toute opération sensible produit un évènement d'audit : connexion, changement de
mot de passe, paiement, commission, suspension, résiliation, changement de rôle,
changement des coordonnées de paiement, suppression, anonymisation.

Chaque journal contient : **auteur, date, ancienne valeur, nouvelle valeur,
justification, adresse IP (si disponible), appareil (si disponible)**.

## 8. Journaux en ajout seul

Ces journaux ne doivent jamais être modifiés ni supprimés :

`AuditLog`, `WalletTransaction`, `CommissionEvent`, `PartnershipEvent`,
`AmbassadorEvent`, `PortfolioEvent`, `PayoutEvent`.

Toute correction passe par une **nouvelle écriture**, jamais par modification.

## 9. Sécurité métier

Ne pas analyser uniquement les attaques techniques. Toujours rechercher les
fraudes métier : auto-parrainage, double commission, fraude au retrait, création
massive de comptes, faux documents, usurpation d'identité, détournement de
portefeuille, manipulation des commissions, contournement des validations,
collusion entre utilisateurs.

Les risques métier doivent être documentés.

## 10. Chiffrement

Toutes les données sensibles doivent être chiffrées : Mobile Money, comptes
bancaires, pièces d'identité, contrats, documents personnels.

Prévoir : **rotation des clés**, séparation des clés et des données,
journalisation des accès, déchiffrement uniquement lorsqu'une règle métier le
justifie.

## 11. Gestion des erreurs

Ne jamais exposer : trace d'exécution, SQL, chemin serveur, secrets,
configuration interne. Les détails vont dans les journaux ; l'utilisateur reçoit
un message générique.

## 12. Sécurité des migrations

Avant toute migration susceptible d'altérer les données :

1. sauvegarde ;
2. restauration sur copie ;
3. test de la migration ;
4. validation ;
5. migration réelle.

**Aucune migration destructive sans sauvegarde.**

## 13. Architecture sécurisée

Toute nouvelle fonctionnalité doit pouvoir évoluer facilement, remplacer un
fournisseur sans réécriture, isoler les responsabilités, limiter les privilèges,
éviter les dépendances fortes.

Privilégier : Provider Pattern, Adapter Pattern, Strategy Pattern lorsque
pertinent.

## 14. Tests de sécurité

Après chaque fonctionnalité, effectuer automatiquement : revue de sécurité, tests
RBAC, IDOR, injection, XSS, rate limiting, escalade de privilège, accès aux
ressources.

Les vulnérabilités doivent être corrigées **avant** validation.

## 15. Protection des données personnelles

Minimisation des données ; conservation limitée ; anonymisation lorsque possible ;
droit à l'effacement lorsque légalement applicable ; journalisation des accès ;
chiffrement adapté à la sensibilité.

## 16. Menaces internes

Le système doit aussi protéger contre : un administrateur malveillant, une erreur
humaine, un développeur inattentif, une mauvaise configuration, une fuite
accidentelle.

**Les contrôles doivent exister même pour les utilisateurs privilégiés.**

## 17. Rapport de sécurité obligatoire

À la fin de chaque développement, produire automatiquement un rapport contenant :

- **Vulnérabilités détectées** — description, niveau de criticité, impact ;
- **Correctifs appliqués** — liste détaillée ;
- **Risques résiduels** — éléments restant à traiter ;
- **Dette technique** — améliorations de sécurité reportées ;
- **Recommandations** — bonnes pratiques complémentaires.

## 18. Principe fondamental

Ne jamais considérer qu'une fonctionnalité est terminée parce qu'elle fonctionne.
Une fonctionnalité est terminée uniquement lorsqu'elle est **fonctionnelle,
sécurisée, testée, auditée et documentée**.

Chaque décision technique doit être prise selon : Security by Design, Zero Trust,
Least Privilege, Defense in Depth, OWASP, protection des données par conception.

> En cas de conflit entre la facilité de développement et la sécurité, la solution
> la plus sûre doit être privilégiée — sauf décision explicite contraire du
> promoteur, documentée et justifiée.
