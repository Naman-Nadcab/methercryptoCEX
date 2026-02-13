/**
 * EXCHANGE INVARIANT SHIELD — Static rules to prevent float/unsafe numeric usage.
 * Monetary logic MUST use Decimal.js and ROUND_DOWN only.
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', project: false },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  overrides: [
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "CallExpression[callee.name='parseFloat']",
            message: 'INVARIANT: parseFloat forbidden. Use Decimal.js for monetary values.',
          },
          {
            selector: "CallExpression[callee.name='Number']",
            message: 'INVARIANT: Number() forbidden. Use Decimal.js for monetary values.',
          },
          {
            selector: "MemberExpression[object.name='Decimal'][property.name='toNumber']",
            message: 'INVARIANT: Decimal.toNumber() forbidden in financial logic.',
          },
          {
            selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']",
            message: 'INVARIANT: Math.round forbidden for money. Use Decimal.js.',
          },
          {
            selector: "CallExpression[callee.object.name='Math'][callee.property.name='floor']",
            message: 'INVARIANT: Math.floor forbidden for money. Use Decimal.js.',
          },
          {
            selector: "CallExpression[callee.object.name='Math'][callee.property.name='ceil']",
            message: 'INVARIANT: Math.ceil forbidden for money. Use Decimal.js.',
          },
        ],
      },
    },
    {
      files: [
        'src/lib/redis.ts',
        'src/plugins/latencyTrace.plugin.ts',
        'src/server.ts',
        'src/routes/user.fastify.ts',
        'src/routes/wallet.fastify.ts',
        'src/middleware/rateLimiter.ts',
        'src/middleware/security.ts',
        'src/middleware/auth.ts',
        'src/services/otp.service.ts',
        'src/lib/admin-ip-whitelist.ts',
      ],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
};
