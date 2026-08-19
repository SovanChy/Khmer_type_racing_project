// This config exists to enforce one security invariant — react/no-danger —
// not to impose a style regime on a finished, already-reviewed codebase.
// SECURITY-REVIEW.md §4 requires the rule to actually run, not just be
// documented: F-03 shipped behind an eslint-disable comment for a linter
// that had never been installed, which is the failure mode this closes.
// Keep the rule set to exactly this; a wall of unrelated style findings
// would just get `--fix`ed or ignored, and either way stops being a signal.
import parser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'dev-dist/**'] },
  {
    // .tsx only: `dangerouslySetInnerHTML` is JSX syntax, which a plain .ts
    // file cannot legally contain, so a bare .ts has nothing for this rule to
    // catch. Narrower than "everything under src/" on purpose — a couple of
    // .test.ts files carry `eslint-disable-next-line @typescript-eslint/...`
    // comments for a plugin this config deliberately does not install, and
    // linting them would fail on an unresolvable rule name rather than on
    // anything security-relevant.
    files: ['src/**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      'react/no-danger': 'error',
    },
  },
];
