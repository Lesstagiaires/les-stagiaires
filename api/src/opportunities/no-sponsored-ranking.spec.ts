import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// AUCUNE MISE EN AVANT PAYANTE — LE TEST QUI TIENT L'ENGAGEMENT
//
// Arbitrage du promoteur, 2026-08-07 :
//
//   « Interdire dans tout le projet : featured, promoted, sponsored, boost,
//     priorityScore, paidRank, premiumRank. Même si personne ne les utilise.
//     Ton idée d'un test qui échoue si un tel champ apparaît est excellente.
//     Je la garderais. »
//
// POURQUOI CE TEST ET PAS UNE NOTE DANS UNE DOCUMENTATION. Un engagement écrit
// dans un document se perd : la personne qui l'a pris part, celle qui arrive ne
// l'a pas lu, et un jour de tension commerciale quelqu'un ajoute un champ
// `featured` « juste pour tester ». Un test échoue, lui, à la seconde même.
//
// Il ne protège pas d'une intention déterminée — rien ne le peut. Il protège de
// la DÉRIVE, qui est le vrai risque : personne ne décide un matin de trahir la
// promesse, on l'érode un champ à la fois.
// ============================================================================

const MOTS_INTERDITS = [
  'featured',
  'promoted',
  'sponsored',
  'boost',
  'priorityScore',
  'paidRank',
  'premiumRank',
];

const RACINE = join(__dirname, '..', '..');

// Parcourt une arborescence en ignorant ce qui n'est pas du code du projet.
function fichiers(dossier: string, extensions: string[]): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (
      entree.name === 'node_modules' ||
      entree.name === 'generated' ||
      entree.name === 'dist' ||
      entree.name.startsWith('.')
    ) {
      continue;
    }
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) {
      trouves.push(...fichiers(chemin, extensions));
    } else if (extensions.some((ext) => entree.name.endsWith(ext))) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

// Une occurrence dans un COMMENTAIRE est légitime — ce fichier-ci en est plein,
// et les commentaires du schéma expliquent précisément pourquoi ces champs
// n'existent pas. On ne cherche donc que dans le code effectif.
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((ligne) => !ligne.trimStart().startsWith('//'))
    .filter((ligne) => !ligne.trimStart().startsWith('--'))
    .join('\n');
}

describe('Aucune mise en avant payante', () => {
  it('le schéma Prisma ne déclare AUCUN champ de sponsoring', () => {
    const schema = sansCommentaires(
      readFileSync(join(RACINE, 'prisma', 'schema.prisma'), 'utf8'),
    );

    const trouves = MOTS_INTERDITS.filter((mot) =>
      new RegExp(`\\b${mot}\\b`, 'i').test(schema),
    );

    // Si ce test échoue, la question n'est pas « comment le faire passer » mais
    // « qui a décidé de vendre des places, et l'a-t-il dit au promoteur ».
    expect(trouves).toEqual([]);
  });

  it('les migrations n’en créent AUCUN', () => {
    const migrations = fichiers(join(RACINE, 'prisma', 'migrations'), ['.sql']);
    expect(migrations.length).toBeGreaterThan(0);

    const fautifs: string[] = [];
    for (const fichier of migrations) {
      const contenu = sansCommentaires(readFileSync(fichier, 'utf8'));
      for (const mot of MOTS_INTERDITS) {
        if (new RegExp(`\\b${mot}\\b`, 'i').test(contenu)) {
          fautifs.push(`${fichier} → ${mot}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('le code du module Opportunités n’en manipule AUCUN', () => {
    const sources = fichiers(join(RACINE, 'src', 'opportunities'), ['.ts']);
    expect(sources.length).toBeGreaterThan(0);

    const fautifs: string[] = [];
    for (const fichier of sources) {
      // Ce fichier-ci contient forcément la liste : c'est lui qui l'interdit.
      if (fichier.endsWith('no-sponsored-ranking.spec.ts')) continue;

      const contenu = sansCommentaires(readFileSync(fichier, 'utf8'));
      for (const mot of MOTS_INTERDITS) {
        if (new RegExp(`\\b${mot}\\b`, 'i').test(contenu)) {
          fautifs.push(`${fichier} → ${mot}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  // LE CLASSEMENT NE CONNAÎT QUE SIX CRITÈRES. Un septième ajouté sans passer
  // par cette liste serait précisément la façon dont la promesse s'éroderait :
  // pas un champ nommé `sponsored`, mais un critère anodin qui, par hasard,
  // favoriserait ceux qui paient.
  it('l’énumération des critères de classement reste celle qui a été validée', () => {
    const schema = readFileSync(
      join(RACINE, 'prisma', 'schema.prisma'),
      'utf8',
    );
    const bloc = /enum SearchCriterion \{([^}]*)\}/.exec(schema);
    expect(bloc).not.toBeNull();

    const criteres = bloc![1]
      .split('\n')
      .map((ligne) => ligne.replace(/\/\/.*/, '').trim())
      .filter(Boolean)
      .sort();

    expect(criteres).toEqual([
      'AVAILABILITY_MATCH',
      'EDUCATION_MATCH',
      'FRESHNESS',
      'LOCATION_MATCH',
      'OCCUPATION_MATCH',
      'SKILL_MATCH',
    ]);
  });
});
