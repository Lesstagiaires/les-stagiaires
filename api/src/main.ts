import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertProductionReadiness } from './common/production-readiness';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // AVANT TOUT LE RESTE. Chacune des valeurs contrôlées ici a un défaut de
  // développement qui fonctionne sans rien casser : le service démarrerait,
  // les journaux resteraient verts, et les SMS de consentement parental
  // n'arriveraient nulle part. Le seul moment où quelqu'un regarde vraiment,
  // c'est quand le service refuse de démarrer.
  assertProductionReadiness(config);

  // Derrière un reverse proxy / CDN (ex. Cloudflare) en production, seule cette
  // configuration permet à express-rate-limit (ThrottlerGuard) de lire la vraie IP
  // cliente via X-Forwarded-For au lieu de celle du proxy — sans quoi tout le trafic
  // semble venir d'une seule IP et la limitation de débit sur login/OTP est neutralisée.
  // "1" = on ne fait confiance qu'au premier saut (le proxy en façade), jamais à une
  // en-tête X-Forwarded-For arbitraire envoyée par le client lui-même.
  if (config.get<string>('TRUST_PROXY', 'false') === 'true') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  // CORS désactivé par défaut (aucune origine autorisée) : l'app mobile (Expo, fetch
  // natif) n'est pas soumise au CORS et n'a besoin de rien ici. À renseigner uniquement
  // quand un client web (navigateur, react-native-web) doit appeler l'API directement —
  // jamais une valeur permissive (origin: true) ajoutée dans l'urgence.
  const corsOrigins = config
    .get<string>('CORS_ALLOWED_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
