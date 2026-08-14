import express from 'express';
import * as http from 'http';
import { prefixeIp } from './login-throttle/prefixe-ip';

// ============================================================================
// TRUST_PROXY — CE QUE LE LIMITEUR VOIT COMME « IP CLIENTE »
//
// Tout S-06-C repose sur une clé d'origine. Si cette clé est fausse, le
// mécanisme entier l'est aussi — et il l'est alors des DEUX façons possibles :
//
//   `trust proxy` désactivé derrière un CDN : Express rend l'adresse du proxy.
//     Toutes les requêtes du monde partagent une seule clé. Le limiteur cesse
//     d'être une limite par abonné pour devenir une limite GLOBALE : il exclut
//     les utilisateurs légitimes et laisse à l'attaquant le budget entier.
//
//   `trust proxy` activé sans proxy devant : le client écrit lui-même son
//     `X-Forwarded-For` et s'octroie une origine neuve à chaque requête.
//
// AUCUNE DES DEUX VALEURS N'EST SÛRE DANS L'ABSOLU. C'est pourquoi
// `production-readiness.ts` n'en impose pas une : il refuse l'ABSENCE DE
// CHOIX. Ce test existe pour que cette décision repose sur une mesure, et pour
// qu'elle reste vraie — une montée de version d'Express qui changerait la
// sémantique de `trust proxy` le ferait tomber.
// ============================================================================

interface Vue {
  ip: string;
  cle: string;
}

function serveur(trustProxy: boolean): Promise<{
  port: number;
  fermer: () => Promise<void>;
}> {
  const app = express();
  // Exactement ce que fait `main.ts` quand TRUST_PROXY vaut "true".
  if (trustProxy) app.set('trust proxy', 1);

  app.get('/vue', (req, res) => {
    res.json({ ip: req.ip ?? '', cle: prefixeIp(req.ip) } satisfies Vue);
  });

  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      resolve({
        port,
        fermer: () => new Promise<void>((fini) => s.close(() => fini())),
      });
    });
  });
}

function demander(port: number, xff?: string): Promise<Vue> {
  return new Promise((resolve, reject) => {
    const requete = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/vue',
        headers: xff ? { 'X-Forwarded-For': xff } : {},
      },
      (reponse) => {
        let corps = '';
        reponse.on('data', (c) => (corps += String(c)));
        reponse.on('end', () => resolve(JSON.parse(corps) as Vue));
      },
    );
    requete.on('error', reject);
    requete.end();
  });
}

describe("TRUST_PROXY — l'origine vue par le limiteur", () => {
  describe('sans trust proxy', () => {
    let port = 0;
    let fermer: () => Promise<void>;

    beforeAll(async () => {
      const s = await serveur(false);
      port = s.port;
      fermer = s.fermer;
    });
    afterAll(async () => fermer());

    it("ignore X-Forwarded-For : l'en-tête forgée n'a aucun effet", async () => {
      const sans = await demander(port);
      const avec = await demander(port, '203.0.113.9');
      expect(avec.ip).toBe(sans.ip);
      expect(avec.ip).toContain('127.0.0.1');
    });

    it('DEUX CLIENTS DIFFÉRENTS PARTAGENT LA MÊME CLÉ — la limite devient globale', async () => {
      // C'est le défaut à connaître : derrière un CDN, chaque abonné du monde
      // consomme le même budget.
      const a = await demander(port, '203.0.113.9');
      const b = await demander(port, '198.51.100.7');
      expect(a.cle).toBe(b.cle);
    });
  });

  describe('avec trust proxy = 1', () => {
    let port = 0;
    let fermer: () => Promise<void>;

    beforeAll(async () => {
      const s = await serveur(true);
      port = s.port;
      fermer = s.fermer;
    });
    afterAll(async () => fermer());

    it("retient l'adresse écrite par le proxy", async () => {
      const vue = await demander(port, '203.0.113.9');
      expect(vue.ip).toBe('203.0.113.9');
      expect(vue.cle).toBe('v4:203.0.113.9');
    });

    it('deux clients obtiennent des clés DISTINCTES', async () => {
      const a = await demander(port, '203.0.113.9');
      const b = await demander(port, '198.51.100.7');
      expect(a.cle).not.toBe(b.cle);
    });

    it('une chaîne X-Forwarded-For retient la valeur la plus à DROITE', async () => {
      // Celle que le proxy en façade a ajoutée. Un client qui préfixe la sienne
      // — `1.2.3.4, <vraie ip>` — voit sa valeur poussée à gauche, donc ignorée.
      // C'est ce qui rend `trust proxy = 1` sûr DERRIÈRE UN PROXY, et lui seul.
      const vue = await demander(port, '198.51.100.7, 203.0.113.9');
      expect(vue.ip).toBe('203.0.113.9');
    });
  });
});
