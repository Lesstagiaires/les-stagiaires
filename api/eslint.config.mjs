// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // V6-4 — LE CATALOGUE D'ENTITLEMENTS NE SE LIT QUE PAR SON DÉCIDEUR.
    //
    // Sans cette règle, n'importe quel service pourrait importer le catalogue et
    // trancher lui-même : la décision cesserait d'être centralisée sans que rien
    // ne le signale, et deux endroits finiraient par ne plus répondre la même
    // chose à la même question. Le test de source couvre la lecture des
    // abonnements ; celle-ci couvre l'accès direct à la table de vérité.
    //
    // `entitlements.service.ts` en est exclu : c'est lui, et lui seul, qui a le
    // droit de la lire.
    //
    // Son test direct en est exclu aussi, et lui seul : vérifier que le catalogue
    // est vide suppose de le lire.
    //
    // DEUX FICHIERS NOMMÉS, JAMAIS UN MOTIF. Une exclusion en `*.spec.ts` avait
    // été écrite d'abord ; relevée en revue, elle a été refusée. Un motif donne
    // la permission par avance à tout fichier qu'on créera demain : la
    // dérogation cesserait d'être une décision pour devenir un effet de bord du
    // nommage. Ici, un nouveau lecteur exige d'écrire son nom dans ce fichier,
    // donc de le faire apparaître dans un diff.
    files: ['src/**/*.ts'],
    ignores: [
      'src/entitlements/entitlements.service.ts',
      'src/entitlements/entitlements.service.spec.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/entitlement-catalogue'],
              message:
                "Le catalogue d'entitlements ne se lit que depuis entitlements.service.ts. Appelez EntitlementsService.decide() plutôt que de décider vous-même.",
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
