import { prefixeIp } from './prefixe-ip';

// ============================================================================
// LA CLÉ D'ORIGINE — S-06-C
//
// Tout le limiteur repose sur cette fonction : elle décide de ce qu'est « la
// même origine ». Trop large, elle fait payer un abonné pour son voisin ; trop
// étroite, elle offre un budget neuf à chaque requête.
//
// Le cas IPv6 est le piège. Un abonné reçoit un /64 entier — parfois un /56.
// Compter par ADRESSE laisserait un attaquant changer de suffixe indéfiniment
// et n'être jamais limité. On compte donc par /64, c'est-à-dire par abonné.
// ============================================================================
describe('prefixeIp', () => {
  describe('IPv4', () => {
    it("garde l'adresse entière (/32)", () => {
      expect(prefixeIp('203.0.113.9')).toBe('v4:203.0.113.9');
    });

    it('sépare deux adresses voisines', () => {
      expect(prefixeIp('203.0.113.9')).not.toBe(prefixeIp('203.0.113.10'));
    });
  });

  describe('IPv4 déguisée en IPv6', () => {
    it('reconnaît `::ffff:` et rend la MÊME clé que la forme IPv4', () => {
      // Node produit couramment cette forme sur une pile double. Sans ce
      // traitement, le même abonné aurait deux budgets selon la façon dont sa
      // connexion a été négociée.
      expect(prefixeIp('::ffff:203.0.113.9')).toBe('v4:203.0.113.9');
      expect(prefixeIp('::FFFF:203.0.113.9')).toBe(prefixeIp('203.0.113.9'));
    });
  });

  describe('IPv6', () => {
    it('tronque aux 64 premiers bits', () => {
      expect(prefixeIp('2001:0db8:85a3:0000:1319:8a2e:0370:7344')).toBe(
        'v6:2001:db8:85a3:0',
      );
    });

    it('DEUX SUFFIXES DIFFÉRENTS DU MÊME /64 PARTAGENT LA CLÉ', () => {
      // Le cœur du sujet : sans cela, changer de suffixe suffirait à échapper
      // au limiteur.
      const a = prefixeIp('2001:db8:85a3:0:1111:2222:3333:4444');
      const b = prefixeIp('2001:db8:85a3:0:9999:8888:7777:6666');
      expect(a).toBe(b);
    });

    it('sépare deux /64 différents', () => {
      expect(prefixeIp('2001:db8:85a3:1::1')).not.toBe(
        prefixeIp('2001:db8:85a3:2::1'),
      );
    });

    it('développe correctement la notation `::`', () => {
      expect(prefixeIp('::1')).toBe('v6:0:0:0:0');
      expect(prefixeIp('2001:db8::1')).toBe('v6:2001:db8:0:0');
    });

    it("ignore l'identifiant de zone", () => {
      expect(prefixeIp('fe80::1%eth0')).toBe(prefixeIp('fe80::1'));
    });

    it('normalise la casse et les zéros de tête', () => {
      expect(prefixeIp('2001:0DB8:0085:0000::1')).toBe(
        prefixeIp('2001:db8:85:0::1'),
      );
    });
  });

  describe('IP absente', () => {
    it('rend une clé propre plutôt que de lever', () => {
      // Une exception ici ferait échouer `login` — donc contourner le limiteur
      // en le faisant tomber. Appels internes, sondes de santé, tests.
      expect(prefixeIp(undefined)).toBe('origine:inconnue');
      expect(prefixeIp(null)).toBe('origine:inconnue');
      expect(prefixeIp('')).toBe('origine:inconnue');
      expect(prefixeIp('   ')).toBe('origine:inconnue');
    });
  });

  describe('loopback', () => {
    // Le loopback n'est PAS un cas d'école : c'est ce que voit l'API quand
    // `TRUST_PROXY` vaut "false" alors qu'un proxy en façade lui parle en local.
    // Toutes les requêtes du monde arrivent alors avec la même origine.
    it('produit une clé normale, ni exemption ni erreur', () => {
      // Surtout PAS de traitement de faveur : une exemption du loopback ferait
      // du limiteur un mécanisme contournable dès que la topologie place un
      // proxy sur la même machine.
      expect(prefixeIp('127.0.0.1')).toBe('v4:127.0.0.1');
      expect(prefixeIp('::1')).toBe('v6:0:0:0:0');
      expect(prefixeIp('::ffff:127.0.0.1')).toBe('v4:127.0.0.1');
    });

    it('tout le loopback IPv4 partage une seule clé /32 par adresse', () => {
      // 127.0.0.1 et 127.0.0.2 restent distincts — cohérent avec le /32 retenu
      // pour IPv4. Aucune règle spéciale ne s'applique au réseau 127.0.0.0/8.
      expect(prefixeIp('127.0.0.1')).not.toBe(prefixeIp('127.0.0.2'));
    });

    it('la forme IPv4 et la forme IPv6 du loopback NE partagent PAS de budget', () => {
      // COMPORTEMENT MESURÉ, PAS ARBITRÉ. `127.0.0.1` et `::1` désignent la même
      // machine mais donnent deux clés. C'est sans effet tant que le loopback ne
      // sert qu'aux appels internes et aux sondes ; cela deviendrait un choix à
      // trancher le jour où un proxy local parlerait à l'API sur les deux piles.
      expect(prefixeIp('127.0.0.1')).not.toBe(prefixeIp('::1'));
    });
  });

  it('ne confond jamais une clé v4 et une clé v6', () => {
    expect(prefixeIp('203.0.113.9').startsWith('v4:')).toBe(true);
    expect(prefixeIp('2001:db8::1').startsWith('v6:')).toBe(true);
  });
});
