import { SweepIncidentKind } from '../../generated/prisma/enums';
import {
  estAnormalementEnRetard,
  identiteEchec,
  identiteRetard,
  identiteReveil,
  K_TOLERANCE,
  NOTIFICATION_DE_L_INCIDENT,
  TOUTES_LES_FILES,
} from './sweep-supervision.types';

const HEURE = 60 * 60 * 1000;
const JOUR = 24 * HEURE;
const MAINTENANT = 1_800_000_000_000;

describe('Le seuil de tolérance', () => {
  it('vaut trois fois la cadence, et cette valeur n’existe qu’ici', () => {
    expect(K_TOLERANCE).toBe(3);
  });

  // LES QUATRE CAS EXIGÉS : sous le seuil et au-dessus, pour une file horaire et
  // pour une file quotidienne. La règle est la même ; seule la cadence lue dans
  // Redis change — c'est précisément ce qui permet de n'écrire aucune cadence
  // dans ce module.
  it.each<[string, number, number, boolean]>([
    ['horaire, deux heures de retard', HEURE, 2 * HEURE, false],
    ['horaire, exactement trois heures', HEURE, 3 * HEURE, false],
    ['horaire, trois heures et une minute', HEURE, 3 * HEURE + 60_000, true],
    ['quotidienne, deux jours de retard', JOUR, 2 * JOUR, false],
    ['quotidienne, exactement trois jours', JOUR, 3 * JOUR, false],
    ['quotidienne, quatre jours', JOUR, 4 * JOUR, true],
    // Le cas réellement observé le 2026-08-25.
    ['quotidienne, quatorze jours', JOUR, 14 * JOUR, true],
  ])('%s', (_libelle, every, retard, attendu) => {
    expect(
      estAnormalementEnRetard(MAINTENANT - retard, every, MAINTENANT),
    ).toBe(attendu);
  });

  // STRICTEMENT SUPÉRIEUR, jamais « supérieur ou égal ». Une file qui vient
  // d'atteindre exactement le seuil n'est pas en retard : elle l'atteint.
  it('n’alerte pas au moment exact où le seuil est atteint', () => {
    const every = HEURE;
    const next = MAINTENANT - K_TOLERANCE * every;
    expect(estAnormalementEnRetard(next, every, MAINTENANT)).toBe(false);
    expect(estAnormalementEnRetard(next - 1, every, MAINTENANT)).toBe(true);
  });

  // Une file en avance — planifiée dans le futur — n'est évidemment pas en
  // retard. Le cas paraît trivial ; il ne l'est pas si l'on compare des valeurs
  // absolues quelque part.
  it('ne voit aucun retard dans une échéance à venir', () => {
    expect(estAnormalementEnRetard(MAINTENANT + JOUR, HEURE, MAINTENANT)).toBe(
      false,
    );
  });
});

describe('L’identité d’un épisode RETARD', () => {
  // LA PROPRIÉTÉ QUI PORTE TOUT LE DISPOSITIF : deux observateurs lisant le même
  // Redis calculent la même clé, donc l'index unique n'en laisse passer qu'un.
  it('ne dépend que de faits partagés, jamais d’une horloge locale', () => {
    const a = identiteRetard('hourly-sweep', 1_786_436_677_598);
    const b = identiteRetard('hourly-sweep', 1_786_436_677_598);
    expect(a).toBe(b);
  });

  // Tant que rien ne tourne, `next` ne bouge pas — mesuré sur quatorze jours.
  // L'identité reste donc la même, et une panne persistante n'alerte qu'une fois.
  it('reste stable tant que l’échéance n’a pas été honorée', () => {
    const gele = identiteRetard('daily-sweep', 1_785_549_823_695);
    expect(identiteRetard('daily-sweep', 1_785_549_823_695)).toBe(gele);
  });

  // Dès la reprise, `next` avance : l'ancienne identité n'est plus productible,
  // l'épisode est clos sans qu'aucun état n'ait été écrit.
  it('change dès que l’échéance est replanifiée', () => {
    const avant = identiteRetard('hourly-sweep', 1_786_436_677_598);
    const apres = identiteRetard('hourly-sweep', 1_786_440_277_598);
    expect(apres).not.toBe(avant);
  });

  // Deux planificateurs sur une même file ne doivent pas se confondre. Aucune
  // file n'en a deux aujourd'hui — l'inclure supprime l'hypothèse.
  it('distingue deux planificateurs d’une même file', () => {
    expect(identiteRetard('hourly-sweep', 42)).not.toBe(
      identiteRetard('daily-sweep', 42),
    );
  });
});

describe('L’identité d’un épisode ÉCHEC', () => {
  it('est l’identifiant du job, et rien d’autre', () => {
    expect(identiteEchec('repeat:hourly-sweep:1785285286350')).toBe(
      'repeat:hourly-sweep:1785285286350',
    );
  });

  it('distingue deux jobs échoués', () => {
    expect(identiteEchec('job-1')).not.toBe(identiteEchec('job-2'));
  });
});

describe('L’identité de l’épisode de réveil', () => {
  const files = [
    { queueName: 'subscription-expiry', schedulerId: 'hourly-sweep', next: 10 },
    { queueName: 'account-cleanup', schedulerId: 'daily-sweep', next: 20 },
  ];

  // DEUX INSTANCES QUI DÉMARRENT ENSEMBLE doivent produire la même clé. C'est la
  // raison pour laquelle aucun horodatage de démarrage n'entre dans l'identité :
  // il en aurait produit deux, donc deux notifications.
  it('ne contient aucune horloge', () => {
    expect(identiteReveil(files)).toBe(identiteReveil(files));
  });

  it('ne dépend pas de l’ordre d’observation', () => {
    expect(identiteReveil([...files].reverse())).toBe(identiteReveil(files));
  });

  it('change quand une file entre ou sort de l’ensemble silencieux', () => {
    const plus = [
      ...files,
      { queueName: 'document-cleanup', schedulerId: 'daily-sweep', next: 30 },
    ];
    expect(identiteReveil(plus)).not.toBe(identiteReveil(files));
  });

  // Une interruption ultérieure porte des `next` différents : elle alerte donc à
  // nouveau, au lieu d'être confondue avec la précédente.
  it('change quand les échéances manquées ne sont plus les mêmes', () => {
    const autre = files.map((f) => ({ ...f, next: f.next + 1 }));
    expect(identiteReveil(autre)).not.toBe(identiteReveil(files));
  });

  // Le point délicat : une file durablement orpheline contribue toujours la même
  // valeur. Elle ne doit pas figer la clé des autres, sans quoi une nouvelle
  // panne resterait muette.
  it('ne fige pas la clé à cause d’une file orpheline immuable', () => {
    const orpheline = {
      queueName: 'partnership-lifecycle',
      schedulerId: 'daily-sweep',
      next: 1_785_549_823_695,
    };
    const episode1 = identiteReveil([orpheline, files[0]]);
    const episode2 = identiteReveil([
      orpheline,
      { ...files[0], next: files[0].next + 3600_000 },
    ]);
    expect(episode2).not.toBe(episode1);
  });
});

describe('La table des notifications d’incident', () => {
  it('couvre les trois natures sans exception', () => {
    for (const kind of Object.values(SweepIncidentKind)) {
      expect(NOTIFICATION_DE_L_INCIDENT[kind]).toBeDefined();
    }
  });

  // Un `null` n'entre jamais en collision dans un index unique PostgreSQL : le
  // sentinelle doit rester une valeur réelle, sinon la déduplication du réveil
  // s'effondre en silence.
  it('désigne les incidents sans file par une valeur non nulle', () => {
    expect(TOUTES_LES_FILES).toBe('*');
    expect(TOUTES_LES_FILES).not.toBeNull();
  });
});
