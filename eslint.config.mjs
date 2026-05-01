import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['dist', 'artifacts', 'coverage', 'node_modules', '*.ehpk', 'public/fixtures', '**/*.pcm', '**/*.txt'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      globals: {
        WebSocket: 'readonly',
        MessageEvent: 'readonly',
        AudioContext: 'readonly',
        AudioNode: 'readonly',
        AudioProcessingEvent: 'readonly',
        MediaStream: 'readonly',
        MediaStreamConstraints: 'readonly',
        navigator: 'readonly',
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        HTMLElement: 'readonly',
        Float32Array: 'readonly',
        Int16Array: 'readonly',
        Uint8Array: 'readonly',
        ArrayBuffer: 'readonly',
        DataView: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
