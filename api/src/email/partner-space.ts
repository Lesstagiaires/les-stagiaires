// ============================================================================
// VERROU CONTRE LES BOUTONS MORTS — exigence du promoteur du 2026-08-02 :
// « aucun e-mail ne doit contenir un bouton mort ».
//
// L'espace partenaire (#112) n'existe pas encore. Un e-mail est irrattrapable :
// une organisation qui clique sur « Accéder à mon espace partenaire » et tombe sur
// une page absente, le jour où on lui annonce la fin de son partenariat, retient
// surtout que la plateforme ne fonctionne pas.
//
// Le défaut est donc FERMÉ. Il faut poser PARTNER_SPACE_ENABLED=true pour que le
// bouton apparaisse — l'oubli produit un e-mail sans bouton, jamais un bouton qui
// ne mène nulle part. Un verrou qui protège quand on l'oublie est le seul qui
// protège vraiment.
//
// Lecture paresseuse et non au chargement du module : la configuration doit
// pouvoir changer entre deux démarrages sans reconstruire l'image.
// ============================================================================
export const PARTNER_SPACE_PATH = '/recruiter/partnership';

export function isPartnerSpaceAvailable(): boolean {
  return process.env.PARTNER_SPACE_ENABLED === 'true';
}

// Rend le bouton, ou `undefined` — auquel cas le gabarit n'affiche simplement
// aucun appel à l'action. Le corps du message reste complet : il renvoie vers
// « votre espace partenaire » en toutes lettres, ce qui reste vrai et n'expose
// personne à un clic sans issue.
export function partnerSpaceCta(
  label: string,
): { label: string; path: string } | undefined {
  return isPartnerSpaceAvailable()
    ? { label, path: PARTNER_SPACE_PATH }
    : undefined;
}
