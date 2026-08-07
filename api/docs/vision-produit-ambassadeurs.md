# Vision Produit — Programme d'Ambassadeurs, Partenariats et Abonnements

> Transcription fidèle du document `LES_STAGIAIRES_Vision_Produit_Complete.docx`
> reçu le 2026-07-31, complétée par les décisions d'arbitrage du promoteur
> transmises le même jour (voir `docs/decisions-promoteur-2026-07-31.md`).
> Le `.docx` d'origine reste la pièce de référence.
>
> ATTENTION — la section « Précision sur le partenariat » en fin de document
> ANNULE la règle de durée d'un an avec reconduction tacite décidée le
> 2026-07-30. Voir la note dédiée dans le fichier de décisions.

## 
Développement du Programme d’Ambassadeurs et d’Affiliation — LES STAGIAIRES
Je souhaite que tu conçoives et implémentes maintenant un Programme d’Ambassadeurs et d’Affiliation destiné à développer la plateforme LES STAGIAIRES sur le terrain.
L’objectif est de permettre à des jeunes, étudiants, commerciaux indépendants et représentants locaux de promouvoir la plateforme et de percevoir des commissions sur les revenus qu’ils génèrent réellement.
Le système doit être sécurisé, traçable, évolutif et compatible avec l’architecture existante.
1. Principe économique
Les inscriptions gratuites ne donnent pas lieu à une rémunération directe.
La commission est déclenchée uniquement lorsqu’une action génère effectivement un revenu encaissé par LES STAGIAIRES.
Les principales sources de commission sont :
souscription d’un utilisateur à PROTECT ; 
souscription d’un utilisateur à PRO ; 
achat d’un service payant par une entreprise apportée par l’ambassadeur ; 
campagne publicitaire ; 
campagne marketing ; 
campagne de recrutement ; 
recherche de main-d’œuvre ; 
mise en avant sponsorisée ; 
toute autre prestation commerciale validée par l’administration. 
La règle fondamentale est la suivante :
L’ambassadeur est rémunéré sur les paiements effectivement reçus, et non sur les simples inscriptions ou intentions d’achat.
2. Catégories d’ambassadeurs
Prévoir au minimum deux catégories.
Ambassadeur Campus
Il développe principalement le réseau des :
élèves ; 
étudiants ; 
apprentis ; 
jeunes diplômés ; 
centres de formation ; 
établissements scolaires et universitaires. 
Il perçoit des commissions lorsque les utilisateurs qu’il a apportés achètent PROTECT ou PRO.
Ambassadeur Business
Il développe principalement le réseau des :
entreprises ; 
administrations ; 
ONG ; 
institutions ; 
centres de formation ; 
partenaires commerciaux. 
Le partenariat d’une entreprise reste gratuit.
L’ambassadeur Business perçoit une commission lorsque l’entreprise qu’il a apportée achète ultérieurement une prestation payante.
Prévoir une architecture permettant à un même ambassadeur de cumuler les deux catégories, sous réserve de validation administrative.
3. Identification et traçabilité
Chaque ambassadeur validé doit disposer de :
son identifiant unique ; 
son code de parrainage ; 
son lien d’affiliation ; 
son QR Code personnel ; 
son tableau de bord ; 
son statut ; 
sa catégorie ; 
sa zone géographique ; 
la date de début de sa collaboration. 
Exemple de code :
AMB-CM-YDE-000123
Lorsqu’un utilisateur ou une entreprise s’inscrit à partir du lien, du QR Code ou du code de l’ambassadeur, la relation d’apport doit être enregistrée durablement.
Le système doit empêcher qu’un même utilisateur soit attribué à plusieurs ambassadeurs.
Prévoir une règle claire d’attribution, par exemple :
premier lien d’affiliation valide ; 
code renseigné lors de l’inscription ; 
attribution administrative exceptionnelle avec journalisation. 
4. Attribution des commissions
Prévoir des taux configurables depuis l’administration.
Valeurs initiales proposées :
PROTECT : 20 % ; 
PRO : 20 % ; 
prestations vendues aux entreprises : entre 10 % et 15 % selon la prestation. 
Ces taux ne doivent pas être codés en dur.
Ils doivent pouvoir être configurés selon :
le produit ; 
le service ; 
la catégorie d’ambassadeur ; 
le pays ; 
la période ; 
le niveau de performance ; 
une campagne promotionnelle particulière. 
Le montant de la commission doit être calculé sur la somme réellement encaissée, après application éventuelle :
des remises ; 
des annulations ; 
des remboursements ; 
des taxes ; 
des frais de paiement, selon la politique comptable retenue. 
Avant d’implémenter cette règle financière, propose-moi clairement l’assiette de calcul recommandée.
5. Paliers de performance
Prévoir un système de commissions progressives configurable.
Exemple :
de 1 à 10 ventes mensuelles : 10 % ; 
de 11 à 30 ventes : 15 % ; 
au-delà de 30 ventes : 20 %. 
Le système doit pouvoir gérer :
les paliers mensuels ; 
les paliers trimestriels ; 
les bonus exceptionnels ; 
les campagnes temporaires ; 
les objectifs individuels ; 
les objectifs par équipe, ville, région ou pays. 
La rémunération doit néanmoins rester soutenable financièrement pour LES STAGIAIRES.
6. Cycle de vie d’une commission
Prévoir les statuts suivants :
PENDING : paiement reçu, mais période de sécurité non expirée ; 
APPROVED : commission validée ; 
PAYABLE : commission disponible au paiement ; 
PAID : commission payée ; 
CANCELLED : vente annulée ; 
REVERSED : commission reprise après remboursement ou fraude ; 
DISPUTED : commission contestée ; 
BLOCKED : paiement suspendu pour vérification. 
Aucune commission ne doit devenir immédiatement payable après une transaction.
Prévoir une période de sécurité configurable afin de couvrir :
les remboursements ; 
les contestations ; 
les fraudes ; 
les erreurs techniques. 
7. Paiement des ambassadeurs
Prévoir un portefeuille interne permettant à l’ambassadeur de consulter :
commissions en attente ; 
commissions validées ; 
solde disponible ; 
total déjà payé ; 
prochaines échéances ; 
historique des transactions. 
Les moyens de paiement devront pouvoir évoluer vers :
Orange Money ; 
MTN Mobile Money ; 
Wave ; 
virement bancaire ; 
autres solutions locales selon les pays. 
Pour la première version, il est possible de mettre en place un système de paiement manuel validé par un administrateur, avec une architecture prête pour une automatisation ultérieure.
Prévoir :
un seuil minimal de retrait configurable ; 
la demande de retrait ; 
la validation administrative ; 
la référence de paiement ; 
la date du paiement ; 
la preuve du paiement ; 
l’historique complet. 
8. Tableau de bord de l’ambassadeur
Créer un tableau de bord clair et motivant affichant notamment :
nombre total d’inscriptions apportées ; 
nombre de comptes vérifiés ; 
nombre d’abonnements PROTECT vendus ; 
nombre d’abonnements PRO vendus ; 
nombre d’entreprises partenaires apportées ; 
nombre de prestations vendues à ces entreprises ; 
chiffre d’affaires généré ; 
commissions en attente ; 
commissions disponibles ; 
commissions payées ; 
taux de conversion ; 
classement éventuel ; 
évolution mensuelle. 
Les chiffres doivent distinguer clairement :
inscription gratuite ; 
utilisateur vérifié ; 
client payant ; 
entreprise partenaire gratuite ; 
entreprise ayant acheté une prestation. 
9. Interface d’administration
Les administrateurs doivent pouvoir :
accepter ou refuser une candidature d’ambassadeur ; 
suspendre ou désactiver un ambassadeur ; 
modifier sa catégorie ; 
définir sa zone d’intervention ; 
consulter ses performances ; 
consulter les utilisateurs et entreprises apportés ; 
configurer les taux de commission ; 
créer des campagnes de commission temporaires ; 
approuver ou annuler une commission ; 
traiter les demandes de retrait ; 
enregistrer les paiements ; 
consulter les alertes antifraude ; 
exporter les données ; 
consulter l’historique complet des modifications. 
Toute modification financière doit être journalisée avec :
l’administrateur concerné ; 
la date ; 
l’ancienne valeur ; 
la nouvelle valeur ; 
le motif. 
10. Protection contre la fraude
Le système doit prévoir des contrôles contre :
les faux comptes ; 
les inscriptions multiples ; 
les numéros de téléphone dupliqués ; 
les paiements artificiels ; 
l’auto-parrainage ; 
les inscriptions créées depuis un même appareil de manière anormale ; 
les entreprises fictives ; 
les remboursements après paiement de la commission ; 
les modifications frauduleuses des codes d’affiliation. 
Prévoir notamment :
vérification du téléphone ; 
vérification de l’identité de l’ambassadeur ; 
détection des doublons ; 
journalisation des appareils et adresses IP dans le respect des règles de protection des données ; 
plafonds temporaires ; 
mise en attente automatique des opérations suspectes ; 
validation humaine des cas à risque. 
Un ambassadeur ne doit jamais percevoir de commission sur son propre abonnement ou sur une entreprise qu’il contrôle directement, sauf autorisation administrative exceptionnelle et dûment journalisée.
11. Expérience d’inscription
Lorsqu’un jeune ou une entreprise accède à la plateforme par un lien d’ambassadeur :
le code doit être capturé automatiquement ; 
l’utilisateur doit pouvoir voir le nom ou l’identifiant de l’ambassadeur qui l’a invité ; 
l’attribution doit être confirmée lors de l’inscription ; 
le code ne doit pas être modifiable après validation, sauf intervention administrative motivée. 
Prévoir également la saisie manuelle d’un code de parrainage.
12. Notifications
Prévoir des notifications pour l’ambassadeur lors de :
nouvelle inscription attribuée ; 
compte vérifié ; 
abonnement payé ; 
commission créée ; 
commission validée ; 
commission annulée ; 
demande de retrait reçue ; 
retrait validé ; 
paiement effectué ; 
détection d’une anomalie. 
Les notifications peuvent d’abord être internes et par e-mail.
Prévoir l’architecture nécessaire pour le SMS et WhatsApp ultérieurement.
13. Modèle de données
Propose puis implémente un modèle de données couvrant notamment :
Ambassador; 
AmbassadorApplication; 
AmbassadorReferralCode; 
ReferralAttribution; 
CommissionRule; 
CommissionTier; 
Commission; 
CommissionEvent; 
AmbassadorWallet; 
WithdrawalRequest; 
AmbassadorPayment; 
AmbassadorCampaign; 
FraudAlert; 
AmbassadorAuditLog. 
Les noms exacts peuvent être adaptés à l’architecture existante.
Le modèle doit préserver l’intégrité financière et permettre un audit complet.
14. Intégration avec les modules existants
Le programme doit s’intégrer avec :
les comptes utilisateurs ; 
les comptes entreprises ; 
PROTECT ; 
PRO ; 
les abonnements ; 
les paiements ; 
les partenariats gratuits ; 
les demandes de prestations commerciales ; 
les notifications ; 
l’administration ; 
les rapports et statistiques. 
Aucune commission ne doit être créée à partir d’une simple réponse frontend.
La source de vérité doit être un événement backend confirmé, notamment un webhook de paiement authentifié ou une validation administrative sécurisée.
15. Tests obligatoires
Prévoir des tests unitaires, d’intégration et de sécurité couvrant au minimum :
attribution correcte d’un parrainage ; 
impossibilité de double attribution ; 
auto-parrainage interdit ; 
calcul des taux ; 
application des paliers ; 
idempotence des commissions ; 
annulation après remboursement ; 
blocage des opérations suspectes ; 
contrôle des rôles administratifs ; 
demande de retrait ; 
validation et paiement ; 
isolation entre ambassadeurs ; 
protection contre la modification des montants côté client. 
16. Déploiement par étapes
Je souhaite une implémentation progressive.
Étape 1 — Conception
Présente :
modèle de données ; 
règles métier ; 
parcours utilisateurs ; 
écrans ; 
API ; 
événements déclencheurs ; 
risques ; 
stratégie antifraude ; 
impacts sur l’existant. 
Étape 2 — Backend minimal
Développe :
inscription des ambassadeurs ; 
validation administrative ; 
codes et liens d’affiliation ; 
attribution des inscriptions ; 
commissions PROTECT et PRO ; 
portefeuille ; 
paiement manuel ; 
tests. 
Étape 3 — Interface
Développe :
tableau de bord ambassadeur ; 
espace administrateur ; 
QR Code ; 
historique ; 
demandes de retrait ; 
notifications. 
Étape 4 — Entreprises et services
Ajoute :
rattachement des entreprises ; 
commissions sur les prestations commerciales ; 
règles spécifiques ; 
rapports. 
Étape 5 — Automatisation
Prépare :
Mobile Money ; 
virements ; 
automatisation des paiements ; 
antifraude avancée ; 
fiscalité selon les pays. 
17. Consigne d’exécution
Commence par analyser l’architecture actuelle et réutilise les modules existants autant que possible.
Ne duplique pas la logique des utilisateurs, paiements, abonnements, entreprises ou notifications.
Ne casse aucune fonctionnalité existante.
Avant de modifier la base de données, présente-moi :
les choix structurants ; 
les migrations envisagées ; 
les règles d’attribution ; 
l’assiette de calcul des commissions ; 
la durée de la période de sécurité ; 
les risques de fraude ; 
les décisions qui nécessitent ma validation. 
Après cette présentation, attends ma validation avant d’exécuter les migrations et de commencer l’implémentation complète.
Tu peux cependant corriger immédiatement toute vulnérabilité de sécurité indépendante de ces décisions, à condition de documenter précisément les changements réalisés et de lancer tous les tests de non-régression.
## 
## 
## 
## 
## 
## 
## LES STAGIAIRES - Vision ProduitProgramme d'Ambassadeurs, Partenariats et Abonnements
Document consolidé à destination de Claude Code.
## Vision
Construire le premier écosystème africain dédié aux stages, à l'apprentissage et à l'insertion professionnelle. L'écosystème est gratuit ; les services premium assurent la monétisation.
## Principes économiques
Le partenariat des entreprises est gratuit.
L'inscription des jeunes est gratuite.
Les abonnements donnent accès à des services premium.
Les prestations spécifiques des entreprises sont facturées.
Les ambassadeurs sont rémunérés uniquement sur les revenus effectivement encaissés.
## Programme d'Ambassadeurs
Ambassadeur Campus.
Ambassadeur Business.
Code de parrainage, QR Code, lien d'affiliation.
Portefeuille de commissions.
Tableau de bord et historique.
## Commissions
Aucune commission sur les inscriptions gratuites.
Commission sur Carrière Sécurisée, Carrière Plus, Business et prestations commerciales.
Taux configurables.
Statuts financiers sécurisés et auditables.
## Formule GRATUIT
Objectif : permettre à tous les jeunes d'accéder gratuitement aux opportunités.
Profil candidat.
Passeport Professionnel Africain.
Recherche d'offres.
Favoris.
Candidatures.
Notifications essentielles.
Suivi des candidatures.
la création du profil candidat ; 
l’accès aux offres de stage, d’apprentissage et de première expérience ; 
la recherche par pays, ville, secteur et type d’opportunité ; 
l’enregistrement d’offres dans les favoris ; 
un nombre raisonnable de candidatures ; 
la réception des notifications essentielles ; 
l’accès au Passeport Professionnel Africain dans sa version de base ; 
la conservation des attestations et expériences principales ; 
l’accès aux contenus publics d’orientation. 
Cette formule doit rester suffisamment utile pour favoriser une adoption massive.
## Formule CARRIÈRE SÉCURISÉE
Objectif : protéger le parcours professionnel du jeune.
Tous les avantages de GRATUIT.
Assistance juridique.
Vérification des conventions.
Digital Safe.
Conservation sécurisée des documents.
Signalement d'entreprises.
Support prioritaire.
  assistance juridique de premier niveau ; 
  vérification des conventions de stage ; 
  explication des droits et obligations du stagiaire ; 
  signalement d’une entreprise ou d’une situation problématique ; 
  accompagnement en cas de non-remise d’attestation ; 
  assistance en cas de stage non conforme à l’offre publiée ; 
  accès prioritaire au service juridique de la plateforme ; 
  conservation sécurisée des conventions, attestations et évaluations dans le Digital Safe ; 
  alertes relatives aux risques, fraudes et entreprises signalées ; 
  modèles de documents utiles ; 
  assistance pour obtenir ou faire rectifier certains documents liés au stage.
Promesse commerciale
Sécurisez votre stage et protégez votre parcours professionnel.
Cette formule peut conserver un tarif accessible, par exemple 1 000 FCFA par an, afin de rester adaptée aux jeunes.
## Formule CARRIÈRE PLUS
Objectif : accélérer l'insertion professionnelle.
Tous les avantages de Carrière Sécurisée.
Optimisation du CV.
Lettres de motivation.
Analyse des candidatures.
Alertes avancées.
Préparation aux entretiens.
Mentorat.
Badges.
Statistiques personnelles.
  optimisation du CV ; 
  génération ou amélioration de lettres de motivation ; 
  analyse du profil par rapport aux offres ; 
  recommandations personnalisées ; 
  alertes avancées et prioritaires ; 
  accès à des offres réservées ou anticipées, lorsqu’elles existent ; 
  simulations d’entretien ; 
  accompagnement à la préparation des entretiens ; 
  suivi avancé des candidatures ; 
  statistiques personnelles ; 
  identification des compétences à renforcer ; 
  accès à des mentors ou séances collectives ; 
  mise en valeur renforcée du Passeport Professionnel Africain ; 
  badges de compétences et de progression ; 
  visibilité supplémentaire auprès des recruteurs, sans fausser le classement naturel ; 
  accès prioritaire à certains événements, formations ou webinaires.
Promesse commerciale
Développez vos compétences et accélérez votre accès au stage et à l’emploi.
Le tarif pourrait être fixé, par exemple, à 5 000 FCFA par an, sous réserve de validation du modèle financier.
## Formule BUSINESS
Le partenariat est gratuit ( Publication avancée d'offres. Gratuit)
         BUSINESS est un abonnement professionnel distinct.
Recherche de candidats pour le compte du partenaire ou entreprises
Gestion des candidatures.
Gestion des conventions.
Gestion des stagiaires.
Statistiques RH.
Marque employeur.
Label Entreprise Citoyenne.
Rapport d'impact.
Gestion multi-sites.
Support prioritaire.
## Prestations commerciales clairement identifiable sur la page des entreprises ou organisations partenaires
Chaque prestation donne lieu à un devis spécifique.
Campagnes marketing.
Campagnes de recrutement.
Publicités.
Mises en avant sponsorisées.
Recherche de talents.
Accompagnement RH.
Accompagnement juridique.
Événements.
Formations.
## Catalogue configurable
Fonctionnalités non codées en dur.
Gestion des droits, quotas, prix, promotions, pays et langues depuis l'administration.
## Consignes pour Claude Code
Présenter le modèle de données avant implémentation.
Présenter les migrations.
Présenter les API.
Prévoir une architecture évolutive.
Assurer la sécurité, les tests et la journalisation.
NB: J'aimerais apporter une précision importante concernant le module de partenariat.
Le partenariat entre LES STAGIAIRES et une entreprise, une organisation, une ONG, une administration ou une start-up ne doit pas avoir de date d'expiration dans la plateforme.
Le partenariat est une relation institutionnelle qui demeure active tant qu'aucune des parties ne décide d'y mettre fin.
La durée, les conditions de renouvellement, les modalités de résiliation ainsi que les obligations des parties sont définies exclusivement dans le contrat de partenariat signé entre LES STAGIAIRES et le partenaire.
Par conséquent, je souhaite que :
la plateforme affiche simplement qu'une organisation est Partenaire de LES STAGIAIRES ; 
la plateforme conserve la date de signature du partenariat à titre informatif ; 
la plateforme ne calcule pas automatiquement une date de fin de partenariat ; 
la plateforme ne désactive pas automatiquement un partenaire parce qu'une durée serait arrivée à échéance. 
Si un partenariat prend fin, cela doit résulter d'une décision administrative (résiliation, suspension ou retrait du partenariat) et non d'un mécanisme automatique lié au temps.
En pratique, le module devra gérer des statuts plutôt qu'une durée d'expiration.
Toutes les informations relatives à la durée du partenariat, aux obligations des parties, au renouvellement éventuel et aux conditions de résiliation doivent être contenues dans le contrat de partenariat et non dans la logique métier de l'application.
L'objectif est que la plateforme reflète fidèlement la relation contractuelle sans imposer de règles de durée qui pourraient être différentes de celles prévues dans le contrat signé.