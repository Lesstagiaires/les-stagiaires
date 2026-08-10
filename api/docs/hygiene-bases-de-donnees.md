# Rapport d'hygiène — bases de données du serveur de développement

**Date du relevé** : 2026-08-09
**Serveur** : `127.0.0.1:5432` (PostgreSQL du `docker-compose.yml` de développement)

---

## Bases présentes

| Base | Rôle | Statut |
|---|---|---|
| `stagiaires` | base de développement, celle que désigne `DATABASE_URL` | **active — ne pas toucher** |
| `stagiaires_copie` | copie de travail, vestige d'un essai de migration antérieur | **à décider** |

---

## `stagiaires_copie`

**Emplacement** : même serveur que la base de développement, `127.0.0.1:5432`.

**Provenance** : copie intégrale de `stagiaires` (`CREATE DATABASE … TEMPLATE …`), créée
pour éprouver une migration avant de l'appliquer à la base réelle — la méthode imposée
par la directive SECURITY FIRST. Elle n'a pas été supprimée à la fin de cet essai.

**Contenu** : structure et données de `stagiaires` telles qu'elles étaient au moment de
la copie. Elle contient donc, potentiellement, les mêmes données personnelles de
développement — et elle **ne reçoit plus aucune migration**, donc son schéma diverge un
peu plus à chaque livraison.

**Statut** : conservée sur décision du promoteur (2026-08-09), la suppression d'une base
étant irréversible.

**Ce qu'elle ne fait pas** : elle n'est référencée par aucune configuration, aucun
script, aucun test. Rien ne s'y connecte. Elle n'occupe que de l'espace disque.

**Ce qu'elle appelle comme décision** : soit la supprimer une fois vérifié qu'elle ne
contient rien d'utile, soit la renommer avec une date pour que sa péremption soit
lisible. Une base « copie » sans date finit toujours par faire hésiter quelqu'un qui ne
sait pas si elle est récente.

```bash
psql -h 127.0.0.1 -U stagiaires -d postgres -c 'DROP DATABASE "stagiaires_copie"'
```

*(commande donnée pour mémoire — à n'exécuter que sur décision explicite)*

---

## Bases jetables créées puis supprimées

Ces bases sont créées et détruites automatiquement. Si l'une d'elles subsiste, c'est
qu'une exécution s'est interrompue avant sa fin — elle peut alors être supprimée sans
précaution.

| Base | Créée par |
|---|---|
| `stagiaires_it_guardian_change` | le test d'intégration du changement de tuteur |
| `stagiaires_revue_vierge` | contrôle de reproductibilité des migrations |
| `stagiaires_essai_autorisation` | essai de migration sur copie |

Relevé du 2026-08-09 : **aucune de ces trois bases n'est présente.** Les nettoyages ont
tous abouti.
