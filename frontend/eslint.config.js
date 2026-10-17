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
    // The Playwright layout tests and their config run in Node, not in the
    // page.
    files: ['e2e/**/*.{js,mjs}', 'playwright.config.js'],
    languageOptions: {
      globals: globals.node,
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
      // One icon set (UEP-13 §3.16): IBM Carbon through components/Icon.jsx.
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'lucide-react', message: 'Use <Icon name="…" /> (IBM Carbon).' }] },
      ],
      // Colours come from uep-tokens.css, never a hex typed into a component.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3}){1,2}$/]',
          message: 'Use a --uep-* colour token (styles/uep-tokens.css), not a hex value.',
        },
        {
          selector: 'JSXAttribute[name.name="style"] Property > Literal[value=/^-?[0-9]+([.][0-9]+)?px$/]',
          message: 'Use a token or a class for size and spacing; inline styles are for computed geometry only.',
        },
      ],
    },
  },
  {
    // Map data, chart geometry and the token mirror may hold raw values.
    files: ['src/design/tokens.js', 'src/pages/reports/coverageMap.js', '**/*.test.{js,jsx}', 'e2e/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
]
