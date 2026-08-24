import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EntitlementsService } from './entitlements.service';

// Enregistré dès V6-4 bien qu'aucun module ne l'appelle encore : un service
// laissé hors du graphe d'injection n'est pas éprouvé, et le jour où la première
// capacité payante arrivera, on découvrirait son câblage en même temps que la
// fonctionnalité. Il est exporté pour qu'un futur consommateur n'ait qu'à
// l'importer — jamais à recréer la décision chez lui.
@Module({
  imports: [PrismaModule],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
