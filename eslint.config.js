import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'supabase/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'http', 'https', 'net', 'postgres', '@supabase/*'], message: 'packages/core es puro (P8): sin I/O.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'El tiempo se inyecta (P8/P9): no uses new Date() sin argumentos.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'El tiempo se inyecta (P8/P9): no uses Date.now().' },
        { selector: "CallExpression[callee.object.name='DateTime'][callee.property.name='now']", message: 'El tiempo se inyecta (P8/P9): no uses DateTime.now().' },
        { selector: 'Identifier[name=/^(vertical|tipoDeNegocio|businessType)$/]', message: 'P13: el core no decide lógica por rubro. Corrige el modelo.' },
      ],
    },
  },
);
