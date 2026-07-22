# LES STAGIAIRES — MVP Couche 1 (Cameroun)

Point de départ du développement, préparé pour être ouvert directement dans Claude Code.

## Avant de commencer

1. Ouvrez ce dossier dans Claude Code (terminal, VS Code ou l'app desktop).
2. `CLAUDE.md` contient les règles de sécurité non négociables (mineurs, chiffrement du Digital Safe, permissions par rôle). Claude Code les lit automatiquement au démarrage de chaque session — ne les supprimez pas.
3. `docs/` contient les trois documents de référence déjà validés :
   - `LES_STAGIAIRES_Cahier_des_charges_MVP.docx` — la spécification fonctionnelle des 7 modules + socle gratuit, à suivre module par module.
   - `LES_STAGIAIRES_Note_de_synthese_comprehension.docx` — la vision d'ensemble du projet, pour donner le contexte à toute nouvelle personne (humaine ou Claude Code) qui rejoint le projet.
   - `LES_STAGIAIRES_Feuille_de_route_2026-2027.docx` — le cadrage stratégique et le modèle économique, pour ne pas dériver hors du périmètre MVP.

## Structure

```
les-stagiaires-mvp/
├── CLAUDE.md          # règles de sécurité — lu automatiquement par Claude Code
├── docs/              # documents de référence (cahier des charges, vision, roadmap)
├── docker-compose.yml # Postgres + Redis pour le développement local
├── mobile/            # React Native (Expo) + TypeScript — Android/iOS/Web
└── api/               # NestJS + TypeScript + Prisma
```

## Stack technique retenue

| Couche | Techno |
|---|---|
| Mobile | React Native (Expo) + TypeScript |
| Web (app connectée) | react-native-web (même code que le mobile) |
| Web (page publique investisseurs/partenaires) | à construire à part, statique et légère |
| Backend | NestJS + TypeScript |
| ORM | Prisma |
| Base de données | PostgreSQL |
| Cache & files d'attente | Redis + BullMQ |
| Stockage (Digital Safe) | Cloudflare R2 |
| SMS/OTP | Africa's Talking |
| Monitoring | Sentry |

Démarrage du backend en local :

```bash
docker compose up -d      # Postgres + Redis
cd api && cp .env.example .env && npm install && npx prisma generate && npm run start:dev
```

Démarrage du mobile en local :

```bash
cd mobile && npm install && npm run start
```

## Ordre de développement recommandé

Suivre l'ordre du cahier des charges, un module à la fois, avec une relecture de sécurité après chaque module marqué sensible :

1. Authentification et gestion des comptes (sensible — mineurs)
2. Gestion des profils
3. LS-ID, Passeport Professionnel Africain et Digital Safe (sensible — chiffrement)
4. Gestion des opportunités
5. Gestion des candidatures
6. Entreprises et organisations (inclut la vitrine des partenaires signés)
7. Établissements d'enseignement
8. Socle gratuit transversal (assistant CV/lettre, notifications, FAQ)

## Rappel avant tout lancement public

Un audit de sécurité indépendant reste nécessaire avant d'ouvrir la plateforme à de vrais utilisateurs mineurs — voir `CLAUDE.md`, section 7.
