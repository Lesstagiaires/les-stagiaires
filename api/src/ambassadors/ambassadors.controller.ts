import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AmbassadorStatus,
  FraudAlertStatus,
  PayoutRequestStatus,
} from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { AmbassadorsService } from './ambassadors.service';
import { ReconciliationService } from './reconciliation.service';
import { CommissionsService } from './commissions.service';
import { CommissionCapsService } from './commission-caps.service';
import { FraudDetectionService } from './fraud-detection.service';
import { IdentityDocumentsService } from './identity-documents.service';
import { PaymentDetailsService } from './payment-details.service';
import { AttributionKitService } from './attribution-kit.service';
import { TrainingAdminService } from './training-admin.service';
import { TrainingService } from './training.service';
import { AmbassadorDecisionDto } from './dto/ambassador-decision.dto';
import { AttributionCodeDto } from './dto/attribution-code.dto';
import { CorrectCommissionDto } from './dto/correct-commission.dto';
import { ApplyAmbassadorDto } from './dto/apply-ambassador.dto';
import { AttachIdentityDocumentDto } from './dto/attach-identity-document.dto';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import {
  CreateQuizQuestionDto,
  CreateTrainingModuleDto,
} from './dto/training-admin.dto';
import { CreateAmbassadorDto } from './dto/create-ambassador.dto';
import { CreateCommissionCapDto } from './dto/create-commission-cap.dto';
import { PaymentDetailsDto } from './dto/payment-details.dto';
import { ReportPaymentDetailsDto } from './dto/report-payment-details.dto';
import { RevealDestinationDto } from './dto/reveal-destination.dto';
import {
  AdjustFraudRuleDto,
  CreateFraudRuleDto,
  ReviewFraudAlertDto,
} from './dto/fraud-rule.dto';
import { ExecutePayoutDto } from './dto/execute-payout.dto';
import { PayoutStepDto } from './dto/payout-step.dto';
import { ReleaseCommissionDto } from './dto/release-commission.dto';
import { RejectPayoutDto } from './dto/reject-payout.dto';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { SignContractDto } from './dto/sign-contract.dto';
import { PayoutsService } from './payouts.service';
import { PortfolioService } from './portfolio.service';
import { WalletService } from './wallet.service';

@Controller('ambassadors')
export class AmbassadorsController {
  constructor(
    private readonly ambassadors: AmbassadorsService,
    private readonly reconciliation: ReconciliationService,
    private readonly portfolio: PortfolioService,
    private readonly commissions: CommissionsService,
    private readonly caps: CommissionCapsService,
    private readonly wallet: WalletService,
    private readonly payouts: PayoutsService,
    private readonly paymentDetails: PaymentDetailsService,
    private readonly fraud: FraudDetectionService,
    private readonly identityDocuments: IdentityDocumentsService,
    private readonly training: TrainingService,
    private readonly kit: AttributionKitService,
    private readonly trainingAdmin: TrainingAdminService,
  ) {}

  // --- Espace de l'ambassadeur -------------------------------------------------------
  // Déclarées AVANT les routes en `:id` : Express résout dans l'ordre d'enregistrement,
  // et `me` comme `payouts` doivent gagner sur le paramètre générique — sinon un
  // ambassadeur consultant son espace serait renvoyé vers une route réservée aux ADMIN.
  // La même inversion avait déjà failli passer sur le module Partenariat.

  @Get('me')
  getMine(@CurrentUser() user: AccessTokenPayload) {
    return this.ambassadors.getMine(user.sub);
  }

  // DEPOT D'UNE CANDIDATURE, par la personne elle-meme.
  //
  // Authentifiee, mais sans role particulier : c'est le sens d'un formulaire
  // ouvert. Elle n'accorde rien — ni code, ni attribution, ni droit — et un
  // candidat ne devient JAMAIS ambassadeur automatiquement.
  @HttpCode(HttpStatus.CREATED)
  @Post('apply')
  apply(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ApplyAmbassadorDto,
  ) {
    return this.ambassadors.apply(user.sub, dto);
  }

  // --- Pièces d'identité, côté candidat ---------------------------------------
  // Niveau « Très sensible » (CLAUDE.md §1). Aucun fichier ne transite par ces
  // routes : le dépôt se fait au Coffre-fort, qui chiffre et journalise. Ici on
  // ne fait que RATTACHER une référence à son dossier.

  @Get('me/identity-documents')
  getMyIdentityDocuments(@CurrentUser() user: AccessTokenPayload) {
    return this.identityDocuments.listMine(user.sub);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post('me/identity-documents')
  attachIdentityDocument(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: AttachIdentityDocumentDto,
  ) {
    return this.identityDocuments.attach(user.sub, dto);
  }

  // LE KIT D'AFFILIATION : code, lien personnel, QR.
  //
  // Le QR est GENERE MAINTENANT, a partir du lien, et n'est stocke nulle part —
  // ni fichier, ni cache. Un QR calcule a l'affichage ne peut pas survivre au
  // droit qui le fonde : plus de code actif, plus de QR.
  //
  // N'existe qu'au statut ACTIVE. Un suspendu garde son code en base, pour
  // qu'une reintegration ne casse pas les liens deja distribues, mais il ne le
  // recoit plus.
  @Get('me/kit')
  getMyKit(@CurrentUser() user: AccessTokenPayload) {
    return this.kit.myKit(user.sub);
  }

  // --- Formation et quiz, côté candidat ---------------------------------------

  @Get('me/training')
  getMyTraining(@CurrentUser() user: AccessTokenPayload) {
    return this.training.myPath(user.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Post('me/training/:moduleId/complete')
  completeTrainingModule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId') moduleId: string,
  ) {
    return this.training.completeModule(user.sub, moduleId);
  }

  // LES QUESTIONS, SANS LES RÉPONSES. Le service les projette champ par champ :
  // `correctIndex` ne quitte jamais le serveur (SKILL SECURITY FIRST §5).
  @Get('me/quiz')
  getMyQuiz(@CurrentUser() user: AccessTokenPayload) {
    return this.training.questionsFor(user.sub);
  }

  // Le client envoie ce qu'il a répondu ; le serveur corrige, compte et décide.
  @HttpCode(HttpStatus.OK)
  @Post('me/quiz')
  submitQuiz(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: SubmitQuizDto,
  ) {
    return this.training.submit(user.sub, dto);
  }

  @Get('me/portfolio')
  getMyPortfolio(@CurrentUser() user: AccessTokenPayload) {
    return this.portfolio.listForAmbassador(user.sub);
  }

  @Get('me/commissions')
  getMyCommissions(@CurrentUser() user: AccessTokenPayload) {
    return this.commissions.listForAmbassador(user.sub);
  }

  @Get('me/wallet')
  async getMyWallet(@CurrentUser() user: AccessTokenPayload) {
    const ambassador = await this.ambassadors.getMine(user.sub);
    return this.wallet.ledger(ambassador.id);
  }

  @Get('me/payouts')
  getMyPayouts(@CurrentUser() user: AccessTokenPayload) {
    return this.payouts.listMine(user.sub);
  }

  // --- Coordonnées de versement ------------------------------------------------
  // Jamais rendues en clair : seule leur forme masquée sort d'ici.

  @Get('me/payment-details')
  getMyPaymentDetails(@CurrentUser() user: AccessTokenPayload) {
    return this.paymentDetails.getMine(user.sub);
  }

  // Toute modification rouvre le délai de refroidissement et déclenche l'alerte
  // de sécurité (e-mail + SMS).
  @HttpCode(HttpStatus.OK)
  @Put('me/payment-details')
  updateMyPaymentDetails(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: PaymentDetailsDto,
  ) {
    return this.paymentDetails.update(user.sub, dto);
  }

  // LE FREIN D'URGENCE. « L'utilisateur peut signaler immédiatement une
  // modification non autorisée. » Immédiatement, et sans condition : le
  // signalement gèle les versements et prévient l'administration.
  @HttpCode(HttpStatus.OK)
  @Post('me/payment-details/report')
  reportMyPaymentDetails(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ReportPaymentDetailsDto,
  ) {
    return this.paymentDetails.report(user.sub, dto);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post('me/payouts')
  requestPayout(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: RequestPayoutDto,
  ) {
    return this.payouts.request(user.sub, dto);
  }

  // Vérifie qu'un code d'affiliation est valide avant de s'en servir. Ne renvoie que
  // sa validité — jamais l'identité de son titulaire (CLAUDE.md §1, niveau Public).
  @HttpCode(HttpStatus.OK)
  @Post('verify-code')
  verifyCode(@Body() dto: AttributionCodeDto) {
    return this.ambassadors.lookupByCode(dto.code);
  }

  // --- Back-office ADMIN --------------------------------------------------------------
  // RolesGuard exige aussi la double authentification active sur le compte
  // (CLAUDE.md §2/§3).

  @Roles('ADMIN')
  @Get('payouts')
  listAllPayouts(@Query('status') status?: PayoutRequestStatus) {
    return this.payouts.listAll(status);
  }

  // La piste complète d'un versement, étape par étape. Destination déjà masquée.
  @Roles('ADMIN')
  @Get('payouts/:id/history')
  payoutHistory(@Param('id') id: string) {
    return this.payouts.history(id);
  }

  // --- LE CYCLE EN SIX ÉTAPES -------------------------------------------------
  // Une route par étape, à dessein. Fusionner contrôle et validation, ou
  // exécution et confirmation, ferait disparaître la trace de qui a fait quoi —
  // et c'est précisément ce que la séparation des pouvoirs interdit.

  @Roles('ADMIN')
  @Post('payouts/:id/review')
  reviewPayout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PayoutStepDto,
  ) {
    return this.payouts.review(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post('payouts/:id/validate')
  validatePayout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PayoutStepDto,
  ) {
    return this.payouts.validate(user.sub, id, dto);
  }

  // Contresignature exigée au-delà du seuil configuré par pays.
  @Roles('ADMIN')
  @Post('payouts/:id/second-approval')
  secondApprovePayout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PayoutStepDto,
  ) {
    return this.payouts.secondApproval(user.sub, id, dto);
  }

  // Ordonne le virement. Interdit à celui qui a approuvé.
  @Roles('ADMIN')
  @Post('payouts/:id/execute')
  executePayout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ExecutePayoutDto,
  ) {
    return this.payouts.execute(user.sub, id, dto);
  }

  // Constate l'arrivée du virement — et c'est SEULEMENT ici que le grand livre
  // enregistre la sortie.
  @Roles('ADMIN')
  @Post('payouts/:id/confirm')
  confirmPayout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PayoutStepDto,
  ) {
    return this.payouts.confirm(user.sub, id, dto);
  }

  // Constate l'échec du virement : le montant immobilisé retourne au disponible.
  @Roles('ADMIN')
  @Post('payouts/:id/fail')
  failPayout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.payouts.fail(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post('payouts/:id/reject')
  rejectPayout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RejectPayoutDto,
  ) {
    return this.payouts.reject(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateAmbassadorDto,
  ) {
    return this.ambassadors.create(user.sub, dto);
  }

  @Roles('ADMIN')
  @Get()
  listAll(@Query('status') status?: AmbassadorStatus) {
    return this.ambassadors.listAll(status);
  }

  // RÉCONCILIATION COMPTABLE — lecture seule, aucune correction automatique.
  // Le rapport constate ; corriger reste une décision, et une décision se prend
  // par une écriture motivée au grand livre.
  @Roles('ADMIN')
  @Get('reconciliation')
  runReconciliation() {
    return this.reconciliation.runSweep();
  }

  @Roles('ADMIN')
  @Get(':id/reconciliation')
  reconcileOne(@Param('id') id: string) {
    return this.reconciliation.reconcileWallet(id);
  }

  // --- PLAFONDS ET COMMISSIONS EN CONTRÔLE -----------------------------------
  // Déclarées AVANT `@Get(':id')` : `commission-caps` est un segment unique et
  // serait sinon avalé par le paramètre générique, qui répondrait « ambassadeur
  // introuvable » à une demande de plafonds.

  @Roles('ADMIN')
  @Get('commission-caps')
  listCaps(@Query('active') active?: string) {
    return this.caps.list(active === 'true');
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Post('commission-caps')
  createCap(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateCommissionCapDto,
  ) {
    return this.caps.create(user.sub, dto);
  }

  // Un plafond se désactive, il ne se supprime pas : les commissions qu'il a
  // mises en contrôle portent son identifiant dans leur trace.
  @Roles('ADMIN')
  @Post('commission-caps/:id/deactivate')
  deactivateCap(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.caps.deactivate(user.sub, id);
  }

  @Roles('ADMIN')
  @Get('commissions/review')
  listCommissionsAwaitingReview() {
    return this.commissions.listAwaitingReview();
  }

  @Roles('ADMIN')
  @Post('commissions/:id/review/release')
  releaseCommission(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ReleaseCommissionDto,
  ) {
    return this.commissions.releaseReviewed(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post('commissions/:id/review/correct')
  correctCommission(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CorrectCommissionDto,
  ) {
    return this.commissions.correctReviewed(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post('commissions/:id/review/cancel')
  cancelCommission(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.commissions.cancelReviewed(user.sub, id, dto);
  }

  // LA SEULE ROUTE QUI REND UN NUMÉRO COMPLET.
  //
  // « Personne ne lit les coordonnées de paiement sans raison métier
  // explicite » — exigence du promoteur du 2026-08-04. Le motif est obligatoire,
  // choisi dans une liste contrôlée, accompagné d'un contexte écrit, et l'appel
  // entier part au journal d'audit avec son auteur.
  //
  // POST et non GET, à dessein : une lecture qui laisse une trace et exige un
  // corps de requête n'a pas sa place dans une barre d'adresse, un historique de
  // navigateur ou un journal de serveur mandataire.
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post(':id/payment-details/reveal')
  revealPaymentDestination(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RevealDestinationDto,
  ) {
    return this.paymentDetails.revealDestination(id, dto.purpose, user.sub, {
      reason: dto.reason,
    });
  }

  // Historique des changements de coordonnées, déjà masqué — il l'a été à
  // l'écriture, pas à la lecture.
  @Roles('ADMIN')
  @Get(':id/payment-details/history')
  paymentDetailsHistory(@Param('id') id: string) {
    return this.paymentDetails.history(id);
  }

  // Levée d'un signalement, après instruction. Tant qu'il n'est pas levé, aucun
  // virement ne part pour cet ambassadeur.
  @Roles('ADMIN')
  @Post(':id/payment-details/clear')
  clearPaymentDetailsReport(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PayoutStepDto,
  ) {
    return this.paymentDetails.clear(user.sub, id, dto.internalNote);
  }

  // --- ANTIFRAUDE -------------------------------------------------------------
  // Le moteur DÉTECTE, ALERTE et JOURNALISE. Aucune de ces routes ne suspend,
  // ne bloque ni ne refuse quoi que ce soit : les suites d'une alerte se
  // prennent par les chemins existants, qui exigent tous un motif écrit.

  // Déclenche un balayage à la demande. Le balayage quotidien fait la même
  // chose ; celui-ci sert au contrôle et à la recette. Il OBSERVE et alerte —
  // il ne corrige rien, comme la réconciliation.
  @Roles('ADMIN')
  @Get('fraud-sweep')
  runFraudSweep() {
    return this.fraud.runSweep();
  }

  @Roles('ADMIN')
  @Get('fraud-alerts')
  listFraudAlerts(
    @Query('status') status?: FraudAlertStatus,
    @Query('ambassadorId') ambassadorId?: string,
  ) {
    return this.fraud.list({ status, ambassadorId });
  }

  // Confirmer ou écarter. Une note est exigée dans les deux cas : c'est en
  // relisant les motifs d'écartement qu'on repérera une règle mal réglée.
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('fraud-alerts/:id/review')
  reviewFraudAlert(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ReviewFraudAlertDto,
  ) {
    return this.fraud.review(user.sub, id, {
      status: dto.status,
      note: dto.note,
    });
  }

  @Roles('ADMIN')
  @Get('fraud-rules')
  listFraudRules() {
    return this.fraud.listRules();
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Post('fraud-rules')
  createFraudRule(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateFraudRuleDto,
  ) {
    return this.fraud.createRule(user.sub, dto);
  }

  // Desserrer un seuil est exactement ce que ferait un administrateur complice
  // avant de laisser passer une fraude. D'où le motif obligatoire, et l'audit.
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('fraud-rules/:id/adjust')
  adjustFraudRule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AdjustFraudRuleDto,
  ) {
    return this.fraud.updateRuleThreshold(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('fraud-rules/:id/deactivate')
  deactivateFraudRule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.fraud.setRuleActive(user.sub, id, false);
  }

  // Instruction des pièces d'identité. La consultation du FICHIER se fait dans
  // le Coffre-fort, où chaque accès est journalisé ; ces routes-ci ne portent
  // que l'état de l'instruction.
  @Roles('ADMIN')
  @Get(':id/identity-documents')
  listIdentityDocuments(@Param('id') id: string) {
    return this.identityDocuments.listForAmbassador(id);
  }

  @Roles('ADMIN')
  @Post('identity-documents/:documentId/verify')
  verifyIdentityDocument(
    @CurrentUser() user: AccessTokenPayload,
    @Param('documentId') documentId: string,
  ) {
    return this.identityDocuments.verify(user.sub, documentId);
  }

  @Roles('ADMIN')
  @Post('identity-documents/:documentId/reject')
  rejectIdentityDocument(
    @CurrentUser() user: AccessTokenPayload,
    @Param('documentId') documentId: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.identityDocuments.reject(user.sub, documentId, dto);
  }

  // Dérogation au quiz. Possible, jamais silencieuse : auteur, date et motif
  // structuré, exigés par une contrainte CHECK en base.
  @Roles('ADMIN')
  @Post(':id/quiz-waiver')
  waiveQuiz(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.training.waiveQuiz(user.sub, id, dto);
  }

  // --- BACK-OFFICE DE LA FORMATION --------------------------------------------
  // Déclarées AVANT `@Get(':id')` : `training-modules` et `quiz-questions` sont
  // des segments uniques, que le paramètre générique avalerait sinon.

  @Roles('ADMIN')
  @Get('training-modules')
  listTrainingModules(@Query('all') all?: string) {
    return this.trainingAdmin.listModules(all === 'true');
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Post('training-modules')
  createTrainingModule(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateTrainingModuleDto,
  ) {
    return this.trainingAdmin.createModule(user.sub, dto);
  }

  // Un module publié ne se modifie pas : il se REMPLACE. Corriger en place
  // rendrait la question « qu'a réellement lu cette personne en mars ? » sans
  // réponse, et le verrou de version décoratif.
  @Roles('ADMIN')
  @Post('training-modules/:moduleId/supersede')
  supersedeTrainingModule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId') moduleId: string,
    @Body() dto: CreateTrainingModuleDto,
  ) {
    return this.trainingAdmin.supersedeModule(user.sub, moduleId, dto);
  }

  @Roles('ADMIN')
  @Post('training-modules/:moduleId/deactivate')
  deactivateTrainingModule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('moduleId') moduleId: string,
  ) {
    return this.trainingAdmin.deactivateModule(user.sub, moduleId);
  }

  // LA LISTE COMPLÈTE, réponses comprises. ADMIN + double authentification :
  // quelqu'un doit bien pouvoir relire ce qu'il a écrit. La garantie qui compte
  // est ailleurs — `GET me/quiz` ne sert jamais `correctIndex`.
  @Roles('ADMIN')
  @Get('quiz-questions')
  listQuizQuestions(@Query('all') all?: string) {
    return this.trainingAdmin.listQuestions(all === 'true');
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Post('quiz-questions')
  createQuizQuestion(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateQuizQuestionDto,
  ) {
    return this.trainingAdmin.createQuestion(user.sub, dto);
  }

  @Roles('ADMIN')
  @Post('quiz-questions/:questionId/deactivate')
  deactivateQuizQuestion(
    @CurrentUser() user: AccessTokenPayload,
    @Param('questionId') questionId: string,
  ) {
    return this.trainingAdmin.deactivateQuestion(user.sub, questionId);
  }

  @Roles('ADMIN')
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.ambassadors.getById(id);
  }

  // --- Instruction du dossier de candidature --------------------------------
  // Chaque étape est une décision administrative distincte et tracée. Aucune ne
  // génère de code : seule /activate le fait, et seulement si tous les jalons
  // sont réellement franchis.

  @Roles('ADMIN')
  @Post(':id/review')
  startReview(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.ambassadors.startReview(user.sub, id);
  }

  @Roles('ADMIN')
  @Post(':id/request-information')
  requestInformation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.ambassadors.requestInformation(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/verify-identity')
  verifyIdentity(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.ambassadors.verifyIdentity(user.sub, id);
  }

  @Roles('ADMIN')
  @Post(':id/approve')
  approve(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.ambassadors.approve(user.sub, id);
  }

  @Roles('ADMIN')
  @Post(':id/reject')
  reject(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.ambassadors.reject(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/charter')
  signCharter(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.ambassadors.signCharter(user.sub, id);
  }

  @Roles('ADMIN')
  @Post(':id/training')
  completeTraining(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() body: { quizScore?: number },
  ) {
    return this.ambassadors.completeTraining(user.sub, id, body?.quizScore);
  }

  // Le seul endpoint qui fait naître un code d'affiliation.
  @Roles('ADMIN')
  @Post(':id/activate')
  activate(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.ambassadors.activate(user.sub, id);
  }

  @Roles('ADMIN')
  @Post(':id/suspend')
  suspend(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.ambassadors.suspend(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/reinstate')
  reinstate(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.ambassadors.reinstate(user.sub, id);
  }

  @Roles('ADMIN')
  @Post(':id/terminate')
  terminate(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AmbassadorDecisionDto,
  ) {
    return this.ambassadors.terminate(user.sub, id, dto);
  }

  // Enregistre la signature du Contrat d'Apporteur d'Affaires — le fait qui lève le
  // verrou du premier versement dans un pays.
  @Roles('ADMIN')
  @Post(':id/contract')
  signContract(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: SignContractDto,
  ) {
    return this.ambassadors.signContract(user.sub, id, dto);
  }
}
