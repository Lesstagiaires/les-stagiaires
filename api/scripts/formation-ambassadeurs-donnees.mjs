// ============================================================================
// FORMATION DES AMBASSADEURS — CONTENU ET QUIZ
//
// De la DONNÉE, pas du code, et séparée du script qui l'écrit : ce contenu se
// juge par le métier et l'engagement pris envers les jeunes, pas par la lecture
// d'un programme. Il doit pouvoir être relu et corrigé par quelqu'un qui ne
// programme pas.
//
// ---------------------------------------------------------------------------
// CE QUE CETTE FORMATION EST, ET CE QU'ELLE N'EST PAS
//
// Ce n'est pas un argumentaire commercial. Un ambassadeur est rémunéré à
// l'attribution : il a donc un intérêt direct à inscrire le plus de monde
// possible, le plus vite possible. La formation existe pour poser les limites
// que cet intérêt pousserait naturellement à franchir — pas pour l'aiguiser.
//
// Elle est BLOQUANTE : sans elle et sans le quiz réussi à 80 %, aucun code
// d'attribution n'est généré. C'est délibéré. Le code d'un ambassadeur est ce
// qui lui rapporte de l'argent ; le lui remettre avant qu'il ne sache ce qu'il
// n'a pas le droit de dire reviendrait à le payer pour improviser.
//
// ---------------------------------------------------------------------------
// TROIS RÈGLES D'ÉCRITURE
//
// 1. DES SITUATIONS, PAS DES PRINCIPES. « Ne divulguez pas de données
//    personnelles » ne change le comportement de personne. « Un ami vous
//    demande le numéro d'un recruteur que vous avez vu sur la plateforme » se
//    retient, parce que ça arrivera.
//
// 2. CE QU'ON NE PEUT PAS PROMETTRE, EN TOUTES LETTRES. La faute la plus
//    probable d'un ambassadeur de bonne foi n'est pas la fraude : c'est la
//    promesse. « Tu vas trouver un stage » engage la plateforme et déçoit le
//    jeune. Le module 2 y est entièrement consacré.
//
// 3. LES MINEURS D'ABORD. Un ambassadeur en croise, et rien dans son intérêt
//    financier ne l'incite à ralentir devant eux. Le module 3 est le seul dont
//    chaque question du quiz porte une conséquence irréversible.
// ============================================================================

export const MODULES = [
  {
    code: 'PROGRAMME',
    sortOrder: 1,
    title: 'Le programme et votre rôle',
    body: `
LES STAGIAIRES met en relation des jeunes d'Afrique avec des entreprises, des
établissements et des institutions qui proposent des stages, des apprentissages
et des premiers emplois.

VOTRE RÔLE
Vous faites connaître la plateforme autour de vous et accompagnez ceux qui s'y
inscrivent. Vous recevez un code personnel : quand quelqu'un s'inscrit avec ce
code, l'inscription vous est attribuée.

CE QUE VOUS N'ÊTES PAS
Vous n'êtes ni salarié, ni recruteur, ni représentant légal de LES STAGIAIRES.
Vous ne pouvez ni embaucher, ni promettre une place, ni parler au nom de la
plateforme auprès d'une entreprise ou d'une administration.

VOTRE RÉMUNÉRATION
Elle dépend des attributions validées, selon un barème consultable dans votre
espace. Une attribution n'est validée qu'après vérification. Elle peut être
refusée si l'inscription se révèle non conforme — un compte fabriqué, un
doublon, une personne inscrite sans le savoir.

CE QUI VOUS PROTÈGE
Toutes vos attributions et vos commissions sont enregistrées et consultables.
Vous pouvez à tout moment voir ce qui vous est dû et pourquoi. Si vous n'êtes
pas d'accord avec une décision, vous pouvez la contester : chaque refus porte un
motif écrit.
`.trim(),
  },
  {
    code: 'DEONTOLOGIE',
    sortOrder: 2,
    title: 'Ce que vous pouvez dire, et ce que vous ne pouvez pas promettre',
    body: `
La faute la plus fréquente n'est pas la malhonnêteté. C'est la promesse faite de
bonne foi, pour convaincre — et qui n'engage que celui qui l'a crue.

CE QUE VOUS POUVEZ DIRE
« La plateforme rassemble des offres de stage et d'apprentissage. »
« L'inscription est gratuite. »
« Tu peux constituer ton profil et postuler depuis ton téléphone. »
« Je peux t'aider à créer ton profil. »

CE QUE VOUS NE POUVEZ JAMAIS PROMETTRE
« Tu vas trouver un stage. » — Personne ne peut le garantir.
« Je connais quelqu'un, ça va passer. » — Aucun ambassadeur n'influence une
  décision de recrutement.
« C'est payant après, mais pour toi ce sera gratuit. » — Vous ne fixez aucun prix.
« Donne-moi ton mot de passe, je vais remplir pour toi. » — Interdit sans
  exception, voir le module suivant.

NE JAMAIS INSCRIRE QUELQU'UN À SA PLACE
Vous pouvez montrer, expliquer, accompagner. La personne saisit elle-même ses
informations et valide elle-même son inscription. Un compte créé par vous au nom
d'un autre est une attribution invalide, et selon les cas une usurpation.

SI VOUS NE SAVEZ PAS
Dites que vous ne savez pas et remontez la question. Une réponse inventée
aujourd'hui devient une réclamation demain.
`.trim(),
  },
  {
    code: 'MINEURS',
    sortOrder: 3,
    title: 'Les mineurs — ce qui ne se rattrape pas',
    body: `
Vous rencontrerez des jeunes de moins de dix-huit ans. Ce module est le plus
important de la formation : les erreurs qu'il décrit ne se corrigent pas après
coup.

UN MINEUR PEUT S'INSCRIRE
Il n'est pas exclu de la plateforme. Il s'inscrit en indiquant le numéro de
téléphone d'un parent ou d'un tuteur, et peut immédiatement explorer, remplir
son profil et préparer sa candidature.

LE PARENT DOIT DONNER SON ACCORD, ACTIVEMENT
Le parent reçoit un message et doit agir — valider un code ou un lien. Une
simple information ne suffit pas. Tant que cet accord n'est pas donné, le compte
reste en mode restreint : le jeune ne peut ni candidater réellement, ni signer
une convention, ni partager un document de son Coffre-fort.

CE QUE VOUS NE FAITES JAMAIS
Vous ne donnez jamais votre propre numéro comme numéro de parent, ni celui d'un
ami, ni un numéro inventé — même si le jeune vous le demande, même s'il dit que
ses parents sont d'accord, même si vous perdez l'attribution. Un accord parental
contourné, c'est un mineur qui signe une convention de stage sans que personne
de responsable ne l'ait su.

VOUS NE RESTEZ PAS SEUL AVEC UN MINEUR pour l'aider à s'inscrire. Faites-le dans
un lieu ouvert, ou en présence d'un adulte de son entourage.

SI QUELQUE CHOSE VOUS INQUIÈTE
Un jeune qui vous parle de harcèlement, de danger, d'une offre qui lui demande
de l'argent ou des photos : signalez-le immédiatement depuis l'application. Ne
menez pas l'enquête vous-même, et ne promettez pas le silence.
`.trim(),
  },
  {
    code: 'DONNEES',
    sortOrder: 4,
    title: 'Les informations des autres ne vous appartiennent pas',
    body: `
Vous allez voir passer des numéros de téléphone, des noms, parfois des
documents. Rien de tout cela ne vous appartient.

LE MOT DE PASSE, JAMAIS
Vous ne demandez jamais le mot de passe de quelqu'un, ni son code de
vérification reçu par SMS, ni son code Mobile Money. Personne de LES STAGIAIRES
ne vous les demandera non plus — si quelqu'un le fait en se réclamant de la
plateforme, c'est une tentative de fraude, et il faut la signaler.

LES DOCUMENTS DU COFFRE-FORT
Diplômes, pièces d'identité, conventions : vous n'y avez pas accès, et vous
n'avez pas à demander qu'on vous les envoie. Si vous aidez quelqu'un à déposer
un document, il le dépose lui-même, depuis son téléphone.

LES CONTACTS RECUEILLIS
Les numéros que vous collectez pour votre activité d'ambassadeur servent à cela
et à rien d'autre. Vous ne les revendez pas, ne les transmettez pas, ne les
utilisez pas pour autre chose. Une personne qui vous demande de ne plus la
contacter doit être retirée de vos listes.

CE QUE VOUS RACONTEZ
Ne publiez pas la photo ou le nom de quelqu'un sans son accord, même pour une
bonne nouvelle. « Bravo à X qui a décroché son stage chez Y » révèle à tout un
quartier une information qui ne vous appartient pas.
`.trim(),
  },
  {
    code: 'ATTRIBUTION',
    sortOrder: 5,
    title: 'Attributions, commissions et fraude',
    body: `
Votre rémunération dépend des attributions. C'est précisément pour cela que les
règles qui suivent existent.

UNE ATTRIBUTION VALIDE
Une personne réelle, qui s'inscrit elle-même, en connaissance de cause, avec
votre code. C'est tout.

CE QUI EST UNE FRAUDE
Créer des comptes avec des numéros que vous contrôlez. Inscrire des personnes
sans qu'elles le sachent ou en leur faisant croire qu'il s'agit d'autre chose.
Réutiliser le même numéro sous plusieurs identités. Acheter une liste de
contacts et l'inscrire. Promettre de l'argent à quelqu'un pour qu'il s'inscrive.

CE QUI EST SURVEILLÉ
Le rythme des inscriptions, les schémas inhabituels, les comptes qui ne
reviennent jamais. Un signalement n'est pas une sanction : il déclenche un
contrôle humain. Si votre activité est légitime, un contrôle ne vous coûte
qu'un peu de temps.

SI VOUS VOUS ÊTES TROMPÉ
Dites-le. Une erreur signalée par vous se corrige. Une erreur découverte par le
contrôle, après plusieurs mois, ressemble à autre chose.

LES VERSEMENTS
Vos commissions sont versées sur les coordonnées que vous avez enregistrées.
Elles sont chiffrées et personne ne les consulte sans raison. Si vous les
modifiez, un délai de sécurité s'applique avant le versement suivant : c'est ce
qui empêche quelqu'un qui prendrait le contrôle de votre compte de détourner
votre argent dans la foulée.
`.trim(),
  },
];

// --- Quiz --------------------------------------------------------------------
//
// Seuil de réussite : 80 % (configurable par pays). Les questions portent sur
// les situations où l'intérêt de l'ambassadeur s'oppose à la règle — pas sur ce
// qu'il retiendrait de toute façon.
//
// `correctIndex` ne quitte JAMAIS le serveur : `questionsFor()` projette
// explicitement les champs servis et ne le contient pas.
export const QUESTIONS = [
  // --- Programme ------------------------------------------------------------
  {
    module: 'PROGRAMME',
    prompt:
      'Une entreprise vous demande de signer un document en tant que représentant de LES STAGIAIRES. Que faites-vous ?',
    choices: [
      'Je signe, puisque je représente la plateforme sur le terrain.',
      'Je refuse : un ambassadeur ne représente pas juridiquement la plateforme, et je remonte la demande.',
      'Je signe en précisant que c’est à titre personnel.',
    ],
    correctIndex: 1,
  },
  {
    module: 'PROGRAMME',
    prompt: 'Une attribution peut-elle être refusée après coup ?',
    choices: [
      'Oui, après vérification, si l’inscription se révèle non conforme — et le refus porte un motif écrit.',
      'Oui, sans motif, à la discrétion de l’administration.',
      'Non, une fois enregistrée elle est définitive.',
    ],
    correctIndex: 0,
  },

  {
    module: 'PROGRAMME',
    prompt:
      'Un ami vous demande si vous pouvez « faire passer » sa candidature auprès d’un recruteur de la plateforme.',
    choices: [
      'Je lui explique que je n’ai aucune influence sur les décisions de recrutement.',
      'Je lui dis que je vais essayer, cela ne coûte rien.',
      'Je contacte le recruteur pour appuyer son dossier.',
    ],
    correctIndex: 0,
  },

  // --- Déontologie ----------------------------------------------------------
  {
    module: 'DEONTOLOGIE',
    prompt:
      'Un jeune hésite. Pour le convaincre, vous lui dites qu’avec votre aide il trouvera un stage. Est-ce acceptable ?',
    choices: [
      'Oui, si vous pensez sincèrement qu’il en trouvera un.',
      'Oui, c’est de l’encouragement.',
      'Non : personne ne peut garantir un stage, et cette promesse engage la plateforme.',
    ],
    correctIndex: 2,
  },
  {
    module: 'DEONTOLOGIE',
    prompt:
      'Quelqu’un vous demande de créer son compte à sa place parce qu’il n’a pas de téléphone sous la main. Que faites-vous ?',
    choices: [
      'Je crée le compte avec ses informations, il validera plus tard.',
      'Je l’accompagne pour qu’il le crée lui-même quand il aura son téléphone.',
      'Je crée le compte avec mon propre numéro et je le lui transfère ensuite.',
    ],
    correctIndex: 1,
  },
  {
    module: 'DEONTOLOGIE',
    prompt: 'On vous pose une question sur la plateforme dont vous ignorez la réponse.',
    choices: [
      'Je dis que je ne sais pas et je remonte la question.',
      'Je change de sujet.',
      'Je donne la réponse qui me paraît la plus probable.',
    ],
    correctIndex: 0,
  },

  // --- Mineurs --------------------------------------------------------------
  {
    module: 'MINEURS',
    prompt:
      'Un jeune de 16 ans veut s’inscrire mais dit que ses parents ne répondront pas. Il vous propose de mettre votre numéro. Que faites-vous ?',
    choices: [
      'Je mets le numéro d’un ami majeur pour débloquer la situation.',
      'J’accepte : il est d’accord, et sinon il ne s’inscrira pas.',
      'Je refuse. Le numéro doit être celui d’un parent ou tuteur, même si je perds l’attribution.',
    ],
    correctIndex: 2,
  },
  {
    module: 'MINEURS',
    prompt: 'Que peut faire un mineur tant que l’accord parental n’a pas été donné ?',
    choices: [
      'Rien du tout, son compte est bloqué.',
      'Explorer, remplir son profil et préparer sa candidature — mais ni candidater réellement, ni signer une convention, ni partager un document.',
      'Tout, l’accord parental n’est qu’une formalité ultérieure.',
    ],
    correctIndex: 1,
  },
  {
    module: 'MINEURS',
    prompt:
      'Un mineur vous confie qu’une personne rencontrée via une offre lui demande des photos. Il vous demande de n’en parler à personne.',
    choices: [
      'Je signale immédiatement depuis l’application, sans lui promettre le silence.',
      'Je contacte moi-même cette personne pour vérifier.',
      'Je respecte sa demande et je garde le silence.',
    ],
    correctIndex: 0,
  },

  // --- Données --------------------------------------------------------------
  {
    module: 'DONNEES',
    prompt:
      'Quelqu’un se présentant comme administrateur de LES STAGIAIRES vous demande le code SMS reçu par un inscrit. Que faites-vous ?',
    choices: [
      'Je le transmets après avoir vérifié son nom.',
      'Je le transmets, c’est une demande interne.',
      'Je refuse et je signale : personne de la plateforme ne demande jamais un code de vérification.',
    ],
    correctIndex: 2,
  },
  {
    module: 'DONNEES',
    prompt:
      'Une personne inscrite grâce à vous décroche un stage. Vous voulez le faire savoir.',
    choices: [
      'Je publie son nom et sa photo : c’est une bonne nouvelle.',
      'Je ne publie rien la concernant sans son accord.',
      'Je publie son prénom seulement, cela suffit à l’anonymiser.',
    ],
    correctIndex: 1,
  },
  {
    module: 'DONNEES',
    prompt: 'Que faites-vous des numéros de téléphone collectés pour votre activité ?',
    choices: [
      'Ils servent à mon activité d’ambassadeur et à rien d’autre ; je retire quiconque me demande de ne plus le contacter.',
      'Je peux les revendre s’ils ne servent plus.',
      'Je peux les utiliser pour d’autres projets personnels.',
    ],
    correctIndex: 0,
  },

  // --- Attribution ----------------------------------------------------------
  {
    module: 'ATTRIBUTION',
    prompt:
      'Pour atteindre votre objectif du mois, vous inscrivez cinq comptes avec des numéros que vous contrôlez. Que risquez-vous ?',
    choices: [
      'Une simple correction des chiffres.',
      'Rien, tant que les comptes existent.',
      'C’est une fraude : les attributions seront refusées et votre participation au programme est en jeu.',
    ],
    correctIndex: 2,
  },
  {
    module: 'ATTRIBUTION',
    prompt: 'Vous recevez une alerte de contrôle sur votre activité. Qu’est-ce que cela signifie ?',
    choices: [
      'Je suis sanctionné et mes versements sont annulés.',
      'Un comportement inhabituel a été repéré et sera vérifié par une personne ; ce n’est pas une sanction.',
      'Mon compte est suspendu automatiquement.',
    ],
    correctIndex: 1,
  },
  {
    module: 'ATTRIBUTION',
    prompt:
      'Vous vous apercevez qu’une inscription que vous avez enregistrée n’était pas conforme. Que faites-vous ?',
    choices: [
      'Je le signale moi-même : une erreur signalée se corrige.',
      'J’attends qu’on me le demande.',
      'Je ne dis rien, cela passera peut-être inaperçu.',
    ],
    correctIndex: 0,
  },
  {
    module: 'ATTRIBUTION',
    prompt: 'Pourquoi un délai s’applique-t-il après la modification de vos coordonnées de paiement ?',
    choices: [
      'C’est une contrainte de l’opérateur de paiement.',
      'Pour des raisons comptables internes.',
      'Pour empêcher quelqu’un ayant pris le contrôle du compte de détourner le versement suivant.',
    ],
    correctIndex: 2,
  },
];
