# Passage en production — SMS (Africa's Talking, Cameroun)

**Date** : 7 août 2026
**État** : bac à sable validé de bout en bout. Production non engagée.

---

## 1. Ce que l'architecture exige comme changement de code

**Aucun.** Vérifié sur le code, pas supposé.

Le passage du bac à sable à la production se joue entièrement sur des variables
d'environnement, pour trois raisons cumulées :

**Le choix du fournisseur est une lecture de configuration.** `SmsModule`
résout le jeton `SMS_PROVIDER` par une fabrique qui lit
`config.get('SMS_PROVIDER')`. Rien d'autre ne décide.

**L'adresse se déduit du nom d'utilisateur.** `endpointFor()` rend l'adresse du
bac à sable si le nom vaut `sandbox`, celle de production sinon. Un seul
`AFRICASTALKING_USERNAME` à changer, et l'adresse suit — il n'existe aucun cas
où l'un est de production et l'autre du bac à sable.

**Aucun service n'est couplé à un fournisseur concret.** Les dix modules qui
envoient des SMS injectent le jeton `SMS_PROVIDER`, jamais
`AfricasTalkingSmsProvider` ni `ConsoleSmsProvider`. Vérifié par recherche :
aucune importation d'une classe concrète hors de `src/sms/`.

Conséquence : changer d'opérateur — Africa's Talking vers un concurrent — ne
demanderait qu'un nouveau fichier dans `src/sms/` et une branche de plus dans la
fabrique. C'est ce que l'architecture provider-swap promettait ; elle tient.

### Les trois variables du basculement

```
SMS_PROVIDER="africastalking"
AFRICASTALKING_USERNAME="<nom de l'application de production>"
AFRICASTALKING_API_KEY="<clé du compte de production>"
AFRICASTALKING_SENDER_ID="<une fois approuvé, et pas avant>"
```

Le garde-fou de démarrage (`src/common/production-readiness.ts`) refuse déjà de
lancer l'API en `NODE_ENV=production` si `SMS_PROVIDER` vaut `console`. Le
basculement ne peut donc pas être oublié.

---

## 2. Le compte de production

Le bac à sable et la production sont **deux comptes distincts**, avec des
identifiants distincts. Rien de ce qui a été validé au bac à sable ne se
transporte : ni la clé, ni le nom d'utilisateur.

À faire :

1. Créer l'application de production dans la console Africa's Talking.
2. Générer sa clé (*Settings → API Key*).
3. Approvisionner le compte. **Le solde conditionne l'envoi** : un compte non
   approvisionné rend le statut 406, que l'adaptateur intercepte et journalise
   en clair — mais le SMS ne part pas.

**Point de vigilance.** L'approvisionnement n'est pas un détail d'intendance :
c'est une panne d'inscription totale et silencieuse pour l'utilisateur. Un
solde qui s'épuise un vendredi soir bloque tous les codes OTP et toutes les
demandes de consentement parental jusqu'à ce que quelqu'un s'en aperçoive.
Prévoir une alerte de solde bas côté Africa's Talking, et surveiller le taux
d'échec 406 dans les journaux applicatifs.

---

## 3. L'identifiant d'expéditeur (Sender ID) au Cameroun

Source : [Africa's Talking — Cameroon bulk SMS pricing and sender ID
registration](https://help.africastalking.com/en/articles/11586128-cameroon-bulk-sms-pricing-and-sender-id-registration),
consulté le 7 août 2026.

### Ce qui est confirmé par la documentation

| Point | Valeur |
|---|---|
| Coût | **Gratuit** |
| Longueur | **11 caractères maximum** |
| À fournir | Exemples de messages, lien du site de l'entreprise |
| Formulaire | **Cameroon Local Fiche KYC** (à télécharger sur la page ci-dessus) |

### Ce qui n'est PAS documenté, et qu'il faut demander

Le délai d'approbation n'apparaît nulle part dans la documentation publique, pas
plus que les règles propres à MTN, Orange ou Camtel. **Ne pas planifier sur une
estimation.** Écrire au support Africa's Talking pour obtenir un délai ferme
avant d'arrêter une date de lancement.

### Le nom à déposer

`STAGIAIRES` fait **10 caractères** — il tient dans la limite.
`LESSTAGIAIRES` en fait 13 : trop long.

Choisir avant de déposer le dossier, et le déposer tôt : c'est la seule étape de
toute la chaîne SMS dont le délai ne dépend pas de nous.

### En attendant l'approbation

**Laisser `AFRICASTALKING_SENDER_ID` vide.** Un identifiant non approuvé fait
REJETER le message (statut 409) au lieu de le laisser partir depuis le numéro
court par défaut. Renseigner la variable « en avance » ne prépare rien : cela
casse tout.

Les SMS partiront donc d'un numéro court, sans marque. C'est acceptable pour un
lancement, et c'est réversible sans redéploiement — la variable se renseigne le
jour de l'approbation.

---

## 4. Ce qui reste à vérifier avant d'engager la production

**La couverture et le prix au Cameroun.** Non vérifiés à ce jour. La grille
tarifaire est un PDF joint à la page citée plus haut, à télécharger. Africa's
Talking est historiquement centré sur l'Afrique de l'Est ; il faut confirmer que
le Cameroun est correctement desservi sur MTN, Orange et Camtel avant de
s'engager. Si la couverture ou le prix ne conviennent pas, changer d'opérateur
coûte un fichier dans `src/sms/` — pas une refonte.

**Un essai réel sur les trois opérateurs.** Le bac à sable ne dit rien du
routage réel. Prévoir un envoi de contrôle vers un numéro MTN, un Orange et un
Camtel avant l'ouverture.

**Le contenu des messages.** Les exemples demandés pour le dossier Sender ID
doivent correspondre à ce que l'application enverra vraiment — codes OTP,
demandes de consentement parental. Un dossier approuvé sur des exemples
fantaisistes expose à un blocage ultérieur.

---

## 5. Ordre recommandé

1. **Déposer le dossier Sender ID maintenant.** Délai inconnu, indépendant de
   nous, et gratuit. Rien ne justifie d'attendre.
2. Créer le compte de production et l'approvisionner.
3. Télécharger la grille tarifaire, confirmer la couverture des trois
   opérateurs.
4. Basculer les trois variables en préproduction, essai réel sur les trois
   opérateurs.
5. Renseigner `AFRICASTALKING_SENDER_ID` le jour de l'approbation — et pas
   avant.

---

## 6. Ce que ce document ne couvre pas

Le choix de l'opérateur SMS n'est pas une décision technique. Le prix par
message, la fiabilité du routage camerounais et la qualité du support comptent
davantage que l'API, qui est interchangeable par construction. Ce document dit
comment brancher Africa's Talking ; il ne dit pas que c'est le bon choix.
