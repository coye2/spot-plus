import globals from 'globals';
export default [
  {ignores:['dist/**','node_modules/**','js/vendor/**']},
  {files:['**/*.js','**/*.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node,...globals.serviceworker}},rules:{'no-undef':'error','no-unreachable':'error','no-constant-condition':'error','no-dupe-args':'error','no-dupe-keys':'error','valid-typeof':'error'}}
];
