// ESLint: the frontend lint step this project did not have.
//
// CI built the frontend, which catches a syntax error or a missing import, and
// the workflow comments say so honestly. It does not catch a hook called
// conditionally, a variable used before it is defined, or a dependency array
// that silently stops an effect from re-running -- the mistakes that produce a
// screen which renders and is wrong.
//
// Kept to the recommended sets plus the React hook rules. A larger set on 7.5k
// lines of existing code produces findings nobody reads.
import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    // Test files. Vitest is configured with globals: true, so describe/it/
    // expect are available without importing them -- ESLint has to be told,
    // or every test file reports them as undefined.
    files: ['**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Without these two, no-unused-vars does not see a component used in
      // JSX and reports almost every component in the codebase as dead. The
      // first lint run said 290 errors, of which ~280 were this.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Unused arguments are frequently a signature being honoured rather than
      // a mistake; unused *variables* are not.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
