import { Global, Module } from '@nestjs/common';
import { FieldEncryptionService } from './field-encryption.service';

// GLOBAL, à dessein. Le chiffrement de champ est une capacité transverse : le
// jour où une pièce d'identité ou un dossier juridique devront l'être aussi
// (CLAUDE.md §1, niveau « Très sensible »), aucun module ne devra recopier une
// implémentation. Une seconde implémentation, c'est une seconde façon de se
// tromper.
@Global()
@Module({
  providers: [FieldEncryptionService],
  exports: [FieldEncryptionService],
})
export class CryptoModule {}
