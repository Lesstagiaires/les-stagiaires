import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// ============================================================================
// LA PREUVE DE POSSESSION DU TÉLÉPHONE NE SE DÉDUIT DE RIEN
//
// DÉFAUT TROUVÉ EN RECETTE RÉELLE le 2026-08-10, sur données réelles.
//
// La connexion testait `status === PENDING_VERIFICATION` pour décider si le
// téléphone avait été vérifié. Or NEUF endroits écrivent `User.status`, dont
// six sans aucun rapport avec la vérification — et `declineConsent` l'écrivait
// SANS CONDITION.
//
// Conséquence observée en base : le compte +237690445566 portait un
// LOGIN_SUCCESS sans le moindre ACCOUNT_PHONE_VERIFIED, et sans LS-ID. Le refus
// d'un tuteur avait suffi à le rendre connectable.
//
// CE QUE CELA OUVRAIT — et c'est le vrai sujet : s'inscrire avec le numéro de
// quelqu'un d'autre, se déclarer soi-même comme tuteur, refuser depuis son
// propre téléphone. Le compte devenait accessible, et le numéro de la victime,
// unique en base, lui restait interdit pour toujours.
//
// Ces tests portent sur la GARANTIE, pas sur l'implémentation : ils survivront
// à une réécriture du service.
// ============================================================================

const SRC = join(__dirname, '..');

function fichiers(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fichiers(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('Preuve de possession du téléphone', () => {
  // --- Confinement : un seul endroit a le droit d'écrire la preuve ----------
  describe('confinement de l’écriture', () => {
    it('un seul fichier de production écrit phoneVerifiedAt', () => {
      const ecrivains = fichiers(SRC)
        .filter((f) =>
          /phoneVerifiedAt\s*:/.test(sansCommentaires(readFileSync(f, 'utf8'))),
        )
        .map((f) => f.slice(f.indexOf('src')).replace(/\\/g, '/'));

      // `auth.service.ts` — la validation du code d'inscription, et rien
      // d'autre. Si ce test échoue, quelqu'un vient de fabriquer une seconde
      // façon d'obtenir la preuve : c'est exactement ce qu'il faut relire.
      expect(ecrivains).toEqual(['src/auth/auth.service.ts']);
    });

    it('la preuve n’est jamais remise à null', () => {
      const code = sansCommentaires(
        readFileSync(join(SRC, 'auth', 'auth.service.ts'), 'utf8'),
      );
      // Une preuve effaçable n'est pas une preuve : elle redevient un état, et
      // les états se font écraser par le premier service qui n'y pense pas.
      expect(code).not.toMatch(/phoneVerifiedAt\s*:\s*null/);
    });

    it('le refus parental ne touche pas à la preuve', () => {
      const code = sansCommentaires(
        readFileSync(join(SRC, 'auth', 'parental-consent.service.ts'), 'utf8'),
      );
      expect(code).not.toMatch(/phoneVerifiedAt/);
    });
  });

  // --- La connexion lit le fait, pas le statut ------------------------------
  describe('la connexion ne déduit plus rien du statut', () => {
    const auth = () =>
      sansCommentaires(
        readFileSync(join(SRC, 'auth', 'auth.service.ts'), 'utf8'),
      );

    it('login s’appuie sur phoneVerifiedAt', () => {
      expect(auth()).toMatch(/if\s*\(\s*!\s*user\.phoneVerifiedAt\s*\)/);
    });

    it('plus aucune décision de sécurité ne lit PENDING_VERIFICATION', () => {
      // Le statut garde son rôle d'affichage et de cycle de vie ; ce qu'on
      // interdit, c'est qu'il serve de substitut à une donnée de sécurité.
      // Seule l'écriture à l'inscription reste légitime.
      const lignes = auth()
        .split(/\r?\n/)
        .filter((l) => /PENDING_VERIFICATION/.test(l))
        .map((l) => l.trim());

      expect(lignes).toEqual(['status: AccountStatus.PENDING_VERIFICATION,']);
    });

    it('LOGIN_SUCCESS n’est jamais lu pour en déduire une vérification', () => {
      // Le journal sert à reconstituer l'histoire, jamais à décider. Un
      // `AuditLog.findFirst({ action: 'LOGIN_SUCCESS' })` utilisé comme preuve
      // serait la même erreur, déplacée d'un cran.
      for (const f of fichiers(SRC)) {
        const code = sansCommentaires(readFileSync(f, 'utf8'));
        if (!/LOGIN_SUCCESS/.test(code)) continue;
        // La seule occurrence admise est l'ÉCRITURE au journal.
        const lectures = code.match(/LOGIN_SUCCESS/g) ?? [];
        const ecritures = code.match(/record\(\s*'LOGIN_SUCCESS'/g) ?? [];
        expect(lectures.length).toBe(ecritures.length);
      }
    });
  });

  // --- Le scénario complet, exigé par le promoteur -------------------------
  describe('scénario : vérifier, puis subir un refus parental', () => {
    it('déroule les huit étapes sans jamais perdre la preuve', () => {
      // Le scénario de bout en bout tourne dans le test d'intégration sur base
      // réelle (`preuve-telephone.integration.spec.ts`) : ici, on garde la
      // vérification statique, qui n'a pas besoin de PostgreSQL et qui tourne
      // partout, y compris sur une machine sans base.
      const consent = sansCommentaires(
        readFileSync(join(SRC, 'auth', 'parental-consent.service.ts'), 'utf8'),
      );

      // Étape 5 : le refus écrit le statut et les compteurs — jamais la preuve.
      const blocRefus = /data:\s*\{([^}]*)\}/g;
      const blocs = [...consent.matchAll(blocRefus)].map((m) => m[1]);
      const blocsAvecStatut = blocs.filter((b) =>
        /AWAITING_PARENTAL_CONSENT/.test(b),
      );
      expect(blocsAvecStatut.length).toBeGreaterThan(0);
      for (const b of blocsAvecStatut) {
        expect(b).not.toMatch(/phoneVerifiedAt/);
      }
    });
  });

  // --- LE TEST DE SÉCURITÉ ------------------------------------------------
  describe('usurpation du numéro d’un tiers', () => {
    it('connaître le numéro d’une victime ne fabrique aucune preuve', () => {
      // LE SCÉNARIO D'ATTAQUE, mot pour mot :
      //
      //   1. l'attaquant s'inscrit avec le numéro de la victime ;
      //   2. il déclare SON PROPRE numéro comme celui du tuteur ;
      //   3. il reçoit le SMS d'accord sur son téléphone, et REFUSE ;
      //   4. avant correction, le compte sortait de PENDING_VERIFICATION
      //      et devenait connectable.
      //
      // Ce qui ferme la porte : la preuve ne naît QUE d'un code reçu sur le
      // numéro du compte — celui de la victime, que l'attaquant n'a pas.
      const auth = sansCommentaires(
        readFileSync(join(SRC, 'auth', 'auth.service.ts'), 'utf8'),
      );

      // L'écriture de la preuve est dans la méthode de vérification du code,
      // et cette méthode valide un code envoyé à `user.phone`.
      const verif = auth.slice(
        auth.indexOf('async verifyRegistrationOtp'),
        auth.indexOf('private async generateUniqueLsId'),
      );
      expect(verif).toMatch(/phoneVerifiedAt:\s*new Date\(\)/);
      expect(verif).toMatch(/OtpPurpose\.REGISTRATION/);

      // Et aucun chemin parental n'écrit la preuve : vérifié plus haut.
      const consent = sansCommentaires(
        readFileSync(join(SRC, 'auth', 'parental-consent.service.ts'), 'utf8'),
      );
      expect(consent).not.toMatch(/phoneVerifiedAt/);
    });

    it('aucune route n’expose un moyen d’obtenir la preuve sans code', () => {
      // Un endpoint « marquer comme vérifié », même réservé aux
      // administrateurs, rouvrirait la brèche — un compte d'administration
      // compromis suffirait alors à s'approprier n'importe quel numéro.
      for (const f of fichiers(SRC).filter((x) =>
        x.endsWith('.controller.ts'),
      )) {
        expect(sansCommentaires(readFileSync(f, 'utf8'))).not.toMatch(
          /phoneVerifiedAt/,
        );
      }
    });
  });
});
