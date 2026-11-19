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
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  // ── Growth Suite: aislamiento de datos comerciales ────────────────────────
  // La suite no importa módulos operativos (residentes, conjuntos, …): solo
  // `shared` y los enums de roles/permisos. La lista autoritativa (allow-list,
  // con rutas resueltas) está en src/modules/growth/growth-isolation.spec.ts.
  {
    files: ['src/modules/growth/**/*.ts'],
    // Las specs importan migraciones y seeds a propósito (verifican que las
    // copias fijas coincidan con el catálogo).
    ignores: ['src/modules/growth/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^\\.{1,2}/(?:.*/)?(amenities|app-versions|audit|auth|call-logs|complex-info|data-export|device-management|finance|graphql-manifest|health|legal|maintenance|marketplace|messages|my-unit|notes|notifications|packages|pets|platform-announcements|pqrf|residential-complex|residents|security-app-exits|special-numbers|subscriptions|supervisor-visits|users|vehicles|visitor-parking|visitors|voting|mail|core)(/|$)',
              message:
                'Growth Suite: no importa módulos operativos. Ver src/modules/growth/README.md',
            },
            {
              regex: '^\\.{1,2}/(?:.*/)?(permissions|roles)/(?!enums/)',
              message: 'Growth Suite: de roles y permisos solo se importan los enums.',
            },
          ],
        },
      ],
    },
  },
  // Y al revés: fuera de la suite nadie la importa, salvo su catálogo de
  // acceso (datos puros para seeds y el bloqueo de roles inactivos).
  {
    files: ['src/**/*.ts'],
    ignores: ['src/modules/growth/**', 'src/app.module.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)growth/(?!shared/growth-access\\.catalog$)',
              message:
                'Solo src/app.module.ts registra la Growth Suite; fuera de ella solo se importa growth/shared/growth-access.catalog.',
            },
          ],
        },
      ],
    },
  },
);
