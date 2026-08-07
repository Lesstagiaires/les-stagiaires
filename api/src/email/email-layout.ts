import { Language } from '../../generated/prisma/enums';

// Contenu d'un e-mail, avant mise en page. Un gabarit produit CETTE structure et
// jamais du HTML : la mise en page est décidée à un seul endroit, ci-dessous, et
// changer la charte n'oblige pas à rouvrir cinquante gabarits.
export interface EmailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; path: string };
  // Rappel de bas de page propre au message (ex. « ceci concerne un mineur »).
  footnote?: string;
}

// Langues à écriture de droite à gauche. Seul l'arabe aujourd'hui ; le portugais
// n'en fait pas partie.
const RTL_LANGUAGES: ReadonlySet<Language> = new Set([Language.AR]);

const LOCALE_TAG: Record<Language, string> = {
  [Language.FR]: 'fr',
  [Language.EN]: 'en',
  [Language.ES]: 'es',
  [Language.AR]: 'ar',
  [Language.PT]: 'pt',
};

const FOOTER: Record<Language, string> = {
  [Language.FR]:
    'Vous recevez cet e-mail parce que vous avez un compte LES STAGIAIRES. Vous pouvez régler vos préférences de notification depuis l’application.',
  [Language.EN]:
    'You are receiving this email because you have a LES STAGIAIRES account. You can adjust your notification preferences in the app.',
  [Language.ES]:
    'Recibe este correo porque tiene una cuenta LES STAGIAIRES. Puede ajustar sus preferencias de notificación desde la aplicación.',
  [Language.AR]:
    'تصلك هذه الرسالة لأن لديك حسابا في LES STAGIAIRES. يمكنك ضبط تفضيلات الإشعارات من التطبيق.',
  [Language.PT]:
    'Recebe este e-mail porque tem uma conta LES STAGIAIRES. Pode ajustar as suas preferências de notificação na aplicação.',
};

// Palette de la direction artistique « Le Passeport ». Codée en dur ici, et
// seulement ici : un client de messagerie n'exécute ni feuille de style externe,
// ni variable CSS — tout doit être en style en ligne.
const INK_DEEP = '#0D1526';
const EMBER = '#F2901E';
const PAPER = '#F6F7FA';
const TEXT = '#16211C';
const MUTED = '#7B849B';

export function renderEmailHtml(
  content: EmailContent,
  language: Language,
  baseUrl: string,
): string {
  const dir = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';

  const paragraphs = content.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT};">${escapeHtml(text)}</p>`,
    )
    .join('');

  const cta = content.cta
    ? `<p style="margin:24px 0 0;">
         <a href="${escapeAttribute(joinUrl(baseUrl, content.cta.path))}"
            style="display:inline-block;background:${EMBER};color:${INK_DEEP};
                   text-decoration:none;font-weight:700;font-size:15px;
                   padding:12px 24px;border-radius:999px;">${escapeHtml(content.cta.label)}</a>
       </p>`
    : '';

  const footnote = content.footnote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(content.footnote)}</p>`
    : '';

  // Mise en page par tableau, à dessein : c'est la seule qui tienne dans les
  // clients de messagerie anciens, encore majoritaires sur les téléphones
  // d'entrée de gamme de nos utilisateurs. Flexbox et grid n'y survivent pas.
  return `<!doctype html>
<html lang="${LOCALE_TAG[language]}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAPER};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
        <tr><td style="background:${INK_DEEP};padding:20px 28px;">
          <span style="color:#FFFFFF;font-size:15px;font-weight:700;letter-spacing:1px;">LES STAGIAIRES</span>
        </td></tr>
        <tr><td style="padding:28px;text-align:${align};" dir="${dir}">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${INK_DEEP};">${escapeHtml(content.heading)}</h1>
          ${paragraphs}
          ${cta}
          ${footnote}
        </td></tr>
        <tr><td style="padding:20px 28px;border-top:1px solid #EAECF2;text-align:${align};" dir="${dir}">
          <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(FOOTER[language])}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Version texte, jamais optionnelle : les filtres anti-spam pénalisent un e-mail
// sans elle, et certains clients ne montrent rien d'autre.
export function renderEmailText(
  content: EmailContent,
  language: Language,
  baseUrl: string,
): string {
  const lines = [
    'LES STAGIAIRES',
    '',
    content.heading,
    '',
    ...content.paragraphs,
  ];
  if (content.cta) {
    lines.push(
      '',
      `${content.cta.label} : ${joinUrl(baseUrl, content.cta.path)}`,
    );
  }
  if (content.footnote) lines.push('', content.footnote);
  lines.push('', '—', FOOTER[language]);
  return lines.join('\n');
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

// Échappement obligatoire : les variables viennent de données saisies par des
// utilisateurs (nom d'organisation, motif de refus). Sans cela, un nom
// d'entreprise contenant du balisage injecterait du HTML dans l'e-mail d'un
// tiers.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
