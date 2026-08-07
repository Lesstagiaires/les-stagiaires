# Passerelles de paiement — connexion des prestataires officiels

Ce document explique comment brancher une passerelle de paiement réelle (Orange Money,
MTN MoMo, ou un agrégateur pan-africain) au module Abonnements/Paiement, sans modifier
`SubscriptionsService` ni `PaymentsService`. Il complète le code — il ne le remplace pas :
avant toute mise en production, relire `src/payments/` et `src/subscriptions/` en parallèle
de ce document.

## 1. Rappel — règle non négociable (CLAUDE.md §6)

> Ne jamais demander, collecter ou stocker le mot de passe ou le code PIN Mobile Money
> d'un utilisateur dans l'application. La confirmation d'un paiement doit toujours passer
> par le canal officiel et sécurisé de l'opérateur — l'application ne reçoit qu'une
> confirmation de statut, jamais l'identifiant de paiement lui-même.

Concrètement dans ce code :

- **`PaymentGatewayProvider.initiate()`** (`src/payments/payment-gateway-provider.interface.ts`)
  ne fait qu'amorcer le paiement auprès du prestataire — il ne doit jamais afficher, ni a
  fortiori soumettre, un champ de saisie de code PIN dans l'application.
- **`POST /payments/webhooks/:provider`** (`src/subscriptions/payments.controller.ts`) est
  le **seul** chemin qui peut faire passer un abonnement à `ACTIVE`. Il est authentifié par
  un secret propre à chaque prestataire (`PAYMENT_WEBHOOK_SECRET_<PROVIDER>`), jamais par un
  jeton JWT utilisateur — ce n'est pas l'utilisateur qui confirme, c'est le prestataire.
- Il n'existe et ne doit jamais exister d'endpoint où l'utilisateur authentifié déclare
  lui-même « j'ai payé ».

## 2. Architecture — provider-swap

Même schéma que `STORAGE_PROVIDER` / `SMS_PROVIDER` / `MALWARE_SCANNER_PROVIDER` : une
interface, plusieurs implémentations, sélection par variable d'environnement.

```text
src/payments/
  payment-gateway-provider.interface.ts   # contrat PaymentGatewayProvider (PAYMENT_GATEWAY_PROVIDER)
  simulated-payment-gateway.provider.ts   # implémentation de développement (aucune collecte réelle)
  payments.module.ts                      # sélection du provider actif via config

src/subscriptions/
  payments.service.ts                     # handleProviderCallback() — seul point d'activation
  payments.controller.ts                  # POST /payments/webhooks/:provider (authentifié par secret)
```

### Pour connecter un nouveau prestataire

1. Créer une classe qui implémente `PaymentGatewayProvider` :
   ```typescript
   // src/payments/orange-money-cm.provider.ts
   @Injectable()
   export class OrangeMoneyCmProvider implements PaymentGatewayProvider {
     async initiate(request: PaymentInitiationRequest): Promise<PaymentInitiationResult> {
       // Appel à l'API du prestataire pour AMORCER le paiement — ne retourne qu'une
       // référence opaque et, éventuellement, des instructions (ex. lien de paiement
       // officiel) à afficher au payeur. Jamais de PIN.
     }
   }
   ```
2. L'ajouter aux `providers` et au `useFactory` de `src/payments/payments.module.ts`,
   sélectionné quand `PAYMENT_GATEWAY_PROVIDER="orange-money-cm"`.
3. Créer le contrôleur/endpoint de callback si le prestataire a un format de webhook
   spécifique à vérifier (signature HMAC, certificat, IP allowlist...) — sinon réutiliser
   `POST /payments/webhooks/:provider` existant en adaptant `ProviderPaymentWebhookDto` si
   la charge utile diffère. Dans tous les cas, la confirmation doit terminer par un appel à
   `PaymentsService.handleProviderCallback()`, qui reste inchangé.
4. Définir `PAYMENT_WEBHOOK_SECRET_ORANGE-MONEY-CM` (ou le mécanisme d'authentification
   propre au prestataire, si ce n'est pas un simple secret partagé — voir §5).
5. Ajouter les tarifs réels dans `SUBSCRIPTION_PRICING_JSON` (voir
   `src/subscriptions/subscription-pricing.service.ts`) — **les tarifs actuellement en
   dur dans ce fichier sont des placeholders non validés commercialement.**

Aucun autre fichier n'a besoin de changer : `SubscriptionsService`, les contrôleurs, et le
schéma Prisma (`Payment.providerName` accepte n'importe quelle chaîne) restent identiques.

## 3. Orange Money — Cameroun

- **Portail développeur officiel** : [developer.orange.com/apis/om-webpay](https://developer.orange.com/apis/om-webpay)
  ([FAQ](https://developer.orange.com/apis/om-webpay/faq)).
- **API** : « Orange Money Web Payment / M Payment » — base pour le Cameroun :
  `https://api.orange.com/orange-money-webpay/cm/v1/webpayment`.
- **Flux côté payeur** : paiement initié depuis un navigateur (desktop ou mobile), le
  client génère un code OTP via le service USSD Orange Money sur son téléphone pour valider
  le paiement — la saisie du PIN reste entièrement dans l'écosystème Orange (USSD),
  jamais dans l'application LES STAGIAIRES.
- **Conformité marchand** : le marchand doit être conforme KYA (« Know Your API »/KYC
  opérateur). L'intégration est généralement prise en charge par le marchand lui-même
  (frameworks web usuels : Node.js, PHP, Python) ou via un partenaire d'intégration local
  Orange.
- **Délai d'onboarding constaté** : de l'ordre de 5 à 10 jours ouvrés après soumission des
  documents (à confirmer avec le contact commercial Orange Cameroun — ce délai peut varier).
- **Ce qu'il faut obtenir auprès d'Orange avant l'implémentation** : identifiants
  marchand (`merchant_key`), identifiants OAuth2 (`client_id`/`client_secret`), l'URL et le
  format exact du callback de confirmation, et l'environnement de test (sandbox) — ces
  éléments sont remis lors du contrat marchand, pas publiés en libre accès. Ne pas
  commencer l'implémentation avant de les avoir obtenus et vérifiés sur le portail
  développeur, dont le contenu peut évoluer indépendamment de ce document.

## 4. MTN MoMo — Cameroun

- **Portail développeur officiel** : [momodeveloper.mtn.com](https://momodeveloper.mtn.com/)
  — bac à sable (sandbox) sur [sandbox.momodeveloper.mtn.com](https://sandbox.momodeveloper.mtn.com/).
- **API pertinente** : « Collections » (encaissement depuis le portefeuille du client) —
  distincte de « Disbursements » (décaissement), à ne pas confondre.
- **Authentification** : après inscription et abonnement au produit Collections, MTN
  fournit une clé primaire et une clé secondaire (`Ocp-Apim-Subscription-Key`), utilisées en
  en-tête de chaque appel API.
- **Bac à sable** : le portail fournit un environnement sandbox qui simule l'environnement
  de production, pour tester l'intégration avant la mise en service réelle.
- **Ce qu'il faut obtenir auprès de MTN avant l'implémentation** : accès sandbox (gratuit,
  auto-service via le portail), puis accès production (nécessite un contrat marchand MTN
  Cameroun), le format exact des webhooks de confirmation (callback URL enregistrée côté
  MTN), et les codes pays/devise attendus. Le portail développeur reste la source
  d'autorité — vérifier la documentation à jour avant implémentation, une communauté de
  développeurs y signale occasionnellement des incidents sandbox.

## 5. Autres pays d'Afrique — passer par un agrégateur plutôt qu'opérateur par opérateur

Intégrer chaque opérateur mobile money pays par pays (Orange Money, MTN MoMo, Moov Money,
Wave, Airtel Money...) multiplierait les contrats marchands et les implémentations. Pour une
plateforme panafricaine comme LES STAGIAIRES, l'approche pragmatique — cohérente avec
l'architecture provider-swap déjà en place — est de brancher **un agrégateur** comme
implémentation `PaymentGatewayProvider`, qui expose lui-même une API unique vers plusieurs
opérateurs et pays :

| Agrégateur | Couverture notable | Remarque |
|---|---|---|
| **CinetPay** | Cameroun, Côte d'Ivoire, Sénégal, Mali, Burkina Faso, Togo, Guinée, Bénin | Fort en Afrique francophone ; agrège Orange Money et MTN MoMo derrière une seule intégration. Partenaire Flutterwave pour l'Afrique francophone depuis 2019. |
| **Flutterwave** | Large couverture panafricaine | Agrège mobile money, cartes et virements bancaires dans de nombreux pays. |
| **Paystack** | Principalement Nigeria/Afrique anglophone, en expansion | Adossé à Stripe, expérience développeur soignée, bon support des paiements récurrents. |

**Recommandation** : pour les pays où le volume ne justifie pas encore un contrat marchand
direct avec chaque opérateur (donc la majorité des pays hors Cameroun au lancement), créer
une implémentation `PaymentGatewayProvider` par agrégateur plutôt que par opérateur — ex.
`CinetPayProvider` qui route en interne vers Orange Money, MTN MoMo, etc. selon le pays et
le moyen choisi par l'utilisateur. Cela reste conforme à l'architecture : `SubscriptionsService`
ignore complètement s'il parle à un opérateur ou à un agrégateur.

Cette recommandation reflète l'état du marché constaté au moment de la rédaction — à
revalider avant toute décision commerciale, les conditions (tarifs, couverture pays,
délais de règlement) évoluent.

## 6. Variables d'environnement

| Variable | Rôle | Exemple |
|---|---|---|
| `PAYMENT_GATEWAY_PROVIDER` | Sélectionne l'implémentation active (`simulated`, puis `orange-money-cm`, `momo-cm`, `cinetpay`...) | `"simulated"` |
| `PAYMENT_WEBHOOK_SECRET_<PROVIDER>` | Secret partagé attendu dans l'en-tête `X-Webhook-Secret` du callback de ce prestataire (un par provider, nom en majuscules) | `PAYMENT_WEBHOOK_SECRET_SIMULATED="..."` |
| `SUBSCRIPTION_PRICING_JSON` | Surcharge des tarifs par plan/cycle/pays — voir `subscription-pricing.service.ts` | `{"PROTECT_PRO:QUARTERLY:CM": {"amountMinor": 500000, "currency": "XAF"}}` |

À ajouter lors de la connexion d'un prestataire réel (noms indicatifs, à adapter au
prestataire choisi — ne jamais committer de vraie valeur, seulement dans `.env` local ou le
gestionnaire de secrets de production, jamais dans `.env.example`) :

| Variable indicative | Prestataire | Contenu |
|---|---|---|
| `ORANGE_MONEY_CM_CLIENT_ID` / `ORANGE_MONEY_CM_CLIENT_SECRET` | Orange Money CM | Identifiants OAuth2 remis par Orange |
| `ORANGE_MONEY_CM_MERCHANT_KEY` | Orange Money CM | Clé marchand |
| `MOMO_CM_SUBSCRIPTION_KEY_PRIMARY` / `MOMO_CM_SUBSCRIPTION_KEY_SECONDARY` | MTN MoMo CM | `Ocp-Apim-Subscription-Key` (Collections) |
| `MOMO_CM_API_USER` / `MOMO_CM_API_KEY` | MTN MoMo CM | Identifiants API générés côté sandbox/production |
| `CINETPAY_API_KEY` / `CINETPAY_SITE_ID` | CinetPay | Identifiants marchand agrégateur |

Chaque nouvelle variable doit être documentée dans `.env.example` (valeur factice) dès son
introduction, jamais en clair ailleurs — conformément à CLAUDE.md §6.

## 7. Ce que ce document ne remplace pas

Comme le rappelle CLAUDE.md §7 pour l'ensemble du projet : ceci est un guide d'implémentation,
pas une validation contractuelle ou juridique. Avant toute connexion à un prestataire réel :
- Vérifier la documentation officielle à jour (les portails développeur évoluent
  indépendamment de ce document) ;
- Faire valider le contrat marchand et les tarifs par la personne responsable côté LES
  STAGIAIRES ;
- Faire tester le flux de bout en bout en sandbox avant tout basculement en production ;
- Faire relire l'intégration par une personne compétente en sécurité des paiements avant
  mise en production (CLAUDE.md §7).

## Sources

- [Orange Money Web Payment / M Payment (1.0) API – Overview](https://developer.orange.com/apis/om-webpay)
- [Orange Money Web Payment / M Payment (1.0) API – FAQs](https://developer.orange.com/apis/om-webpay/faq)
- [MTN MoMo Developer Portal](https://momodeveloper.mtn.com/)
- [MTN MoMo API Sandbox](https://sandbox.momodeveloper.mtn.com/)
- [Testing MTN MoMo Collection API in Sandbox using Postman](https://gist.github.com/chaiwa-berian/5294fdf1360247cf4561c95c8fa740d4)
- [CinetPay — After 5 reluctant years of bootstrapping, closing in on Francophone Africa dominance](https://techpoint.africa/feature/cinetpay-francophone-africa/)
- [Top Payment Gateways in Africa](https://www.dusupay.com/post/top-payment-gateways-in-africa)
