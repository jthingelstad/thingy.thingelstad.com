import globals from 'globals';

const commonRules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    caughtErrors: 'none'
  }]
};

export default [
  {
    ignores: [
      '_site/**',
      'node_modules/**'
    ]
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __THINGY_TINYLYTICS_ID__: 'readonly'
      }
    },
    rules: commonRules
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: commonRules
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: commonRules
  }
];
