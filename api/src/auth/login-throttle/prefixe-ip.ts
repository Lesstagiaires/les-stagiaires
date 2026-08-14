// ============================================================================
// DE QUELLE ORIGINE VIENT CETTE TENTATIVE ? — S-06-C
//
// Le limiteur compte par ORIGINE, pas par compte visé. Encore faut-il définir
// ce qu'est une origine, et ce choix décide seul de l'efficacité du mécanisme.
//
// IPv4 : l'adresse entière (/32). Un abonné mobile en partage souvent une avec
// des milliers d'autres — c'est le NAT opérateur, la règle et non l'exception
// en Afrique centrale. D'où les budgets larges du compteur par IP seule : ils
// doivent laisser respirer un immeuble entier derrière une adresse.
//
// IPv6 : les 64 premiers bits (/64), JAMAIS l'adresse entière. Un abonné se
// voit attribuer un /64 complet, parfois un /56 : compter par adresse laisserait
// un attaquant changer de suffixe à volonté et disposer d'un budget neuf à
// chaque requête. Compter par /64, c'est compter par abonné.
//
// Une IP absente n'est pas une erreur : appels internes, tests, sondes de
// santé. On lui donne une clé propre plutôt que de lever — sans quoi une
// requête sans IP contournerait le limiteur en le faisant échouer.
// ============================================================================

const IPV4_MAPPEE = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * Étend une adresse IPv6 en ses huit groupes, `::` compris.
 * `::1` devient `0,0,0,0,0,0,0,1`.
 */
function etendre(ipv6: string): string[] {
  // Une zone (`%eth0`) n'appartient pas à l'adresse : on la retire.
  const sansZone = ipv6.split('%')[0];

  if (!sansZone.includes('::')) {
    return sansZone.split(':');
  }

  const [avant, apres] = sansZone.split('::');
  const gauche = avant ? avant.split(':').filter(Boolean) : [];
  const droite = apres ? apres.split(':').filter(Boolean) : [];
  const manquants = Math.max(0, 8 - gauche.length - droite.length);

  return [...gauche, ...Array<string>(manquants).fill('0'), ...droite];
}

/**
 * La clé d'origine d'une tentative de connexion.
 *
 * Le préfixe est volontairement lisible (`v4:…`, `v6:…`) : il ne sert pas à
 * masquer l'IP — une adresse n'est pas un secret — mais à éviter qu'une clé
 * IPv4 et une clé IPv6 puissent jamais se confondre.
 */
export function prefixeIp(ip: string | undefined | null): string {
  if (!ip || !ip.trim()) return 'origine:inconnue';

  const brute = ip.trim();

  // `::ffff:203.0.113.9` est une IPv4 déguisée : Node la produit couramment
  // sur une pile double. La traiter comme de l'IPv6 donnerait deux clés
  // différentes au même abonné selon la façon dont il s'est connecté.
  const mappee = IPV4_MAPPEE.exec(brute);
  if (mappee) return `v4:${mappee[1]}`;

  if (!brute.includes(':')) return `v4:${brute}`;

  const groupes = etendre(brute).map((g) =>
    (g === '' ? '0' : g).replace(/^0+(?=.)/, '').toLowerCase(),
  );

  return `v6:${groupes.slice(0, 4).join(':')}`;
}
