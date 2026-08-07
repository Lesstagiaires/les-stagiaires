-- ============================================================================
-- FORMATION ET QUIZ BLOQUANT
-- Arbitrages 8 et 9 du promoteur, 2026-08-02, phase 2.
--
-- « Formation obligatoire avec modules, progression et version. Quiz bloquant,
-- 80 % par defaut, nombre de tentatives configurable, derogation possible mais
-- journalisee. »
--
-- LA REGLE QUI GOUVERNE CE SCHEMA : `QuizQuestion.correctIndex` NE QUITTE JAMAIS
-- LE SERVEUR.
--
-- « Tout le code execute dans le navigateur est public » (SKILL SECURITY FIRST
-- §5). Envoyer les bonnes reponses au client, fut-ce dans un champ que
-- l'interface n'affiche pas, revient a les publier : il suffit d'ouvrir l'onglet
-- reseau. La correction se fait donc entierement cote serveur, et le service qui
-- sert les questions les projette sans ce champ. Un test le verifie.
--
-- LA VERSION EST L'AUTRE POINT DELICAT. Une formation evolue. Sans version,
-- quelqu'un ayant suivi la formation de janvier serait repute connaitre le
-- contenu de septembre. La progression photographie donc la version suivie —
-- c'est elle qui permettra de dire « qui doit refaire quoi » apres une refonte.
--
-- LE SEUIL EST PHOTOGRAPHIE SUR CHAQUE TENTATIVE, comme un bareme de commission
-- sur une commission : abaisser le seuil demain ne doit pas rendre recu
-- quelqu'un qui avait echoue.
-- ============================================================================

-- AlterTable
ALTER TABLE "Ambassador" ADD COLUMN     "quizWaivedAt" TIMESTAMP(3),
ADD COLUMN     "quizWaivedById" TEXT,
ADD COLUMN     "quizWaivedReasonCode" "AmbassadorDecisionReason";

-- AlterTable
ALTER TABLE "AmbassadorPolicy" ADD COLUMN     "quizMaxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "quizPassScorePercent" INTEGER NOT NULL DEFAULT 80;

-- CreateTable
CREATE TABLE "TrainingModule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "countryCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgress" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "moduleVersion" INTEGER NOT NULL,
    "applicationCycle" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT,
    "prompt" TEXT NOT NULL,
    "choices" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "applicationCycle" INTEGER NOT NULL DEFAULT 1,
    "attemptNumber" INTEGER NOT NULL,
    "scorePercent" INTEGER NOT NULL,
    "passScorePercent" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "answers" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingModule_isActive_sortOrder_idx" ON "TrainingModule"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingModule_code_version_countryCode_key" ON "TrainingModule"("code", "version", "countryCode");

-- CreateIndex
CREATE INDEX "TrainingProgress_ambassadorId_applicationCycle_idx" ON "TrainingProgress"("ambassadorId", "applicationCycle");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgress_ambassadorId_moduleId_applicationCycle_key" ON "TrainingProgress"("ambassadorId", "moduleId", "applicationCycle");

-- CreateIndex
CREATE INDEX "QuizQuestion_isActive_moduleId_idx" ON "QuizQuestion"("isActive", "moduleId");

-- CreateIndex
CREATE INDEX "QuizAttempt_ambassadorId_applicationCycle_idx" ON "QuizAttempt"("ambassadorId", "applicationCycle");

-- AddForeignKey
ALTER TABLE "TrainingProgress" ADD CONSTRAINT "TrainingProgress_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgress" ADD CONSTRAINT "TrainingProgress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- LES GARDE-FOUS ----------------------------------------------------------
-- Un seuil hors de [0, 100] n'est pas un pourcentage. Zero rendrait le quiz
-- purement decoratif ; plus de 100 le rendrait impossible a reussir.
ALTER TABLE "AmbassadorPolicy" ADD CONSTRAINT "AmbassadorPolicy_quiz_score_is_percent"
  CHECK ("quizPassScorePercent" > 0 AND "quizPassScorePercent" <= 100);

-- Zero tentative interdirait la formation a tout le monde.
ALTER TABLE "AmbassadorPolicy" ADD CONSTRAINT "AmbassadorPolicy_quiz_attempts_positive"
  CHECK ("quizMaxAttempts" >= 1);

-- Une derogation porte TOUJOURS son auteur et son motif. « Qui a dispense cette
-- personne du quiz, et pourquoi ? » ne doit jamais rester sans reponse.
ALTER TABLE "Ambassador" ADD CONSTRAINT "Ambassador_quiz_waiver_is_attributed"
  CHECK (
    "quizWaivedAt" IS NULL
    OR ("quizWaivedById" IS NOT NULL AND "quizWaivedReasonCode" IS NOT NULL)
  );

-- Les scores sont des pourcentages, et le nombre de bonnes reponses ne peut pas
-- depasser le nombre de questions posees.
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_scores_are_coherent"
  CHECK (
    "scorePercent" >= 0 AND "scorePercent" <= 100
    AND "correctCount" >= 0
    AND "correctCount" <= "questionCount"
  );

ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_attempt_positive"
  CHECK ("attemptNumber" >= 1);

-- L'indice de la bonne reponse doit designer une proposition qui existe.
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_correct_index_in_range"
  CHECK ("correctIndex" >= 0 AND "correctIndex" < array_length("choices", 1));

-- Une question a deux propositions au moins : une question a choix unique n'en
-- est pas une.
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_has_choices"
  CHECK (array_length("choices", 1) >= 2);
