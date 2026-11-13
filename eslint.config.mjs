import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'temp_repo/**/*']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
