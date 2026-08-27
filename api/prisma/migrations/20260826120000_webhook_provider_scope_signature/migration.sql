-- Une référence de paiement est unique à l'intérieur de son fournisseur.
DROP INDEX IF EXISTS "Payment_providerReference_key";

CREATE UNIQUE INDEX "Payment_providerName_providerReference_key"
  ON "Payment" ("providerName", "providerReference");