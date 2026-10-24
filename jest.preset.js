const nxPreset = require('@nx/jest/preset').default;

const coverageReporters = ['json', 'json-summary', 'lcovonly', 'text-summary'];

const collectCoverageFrom = [
    'src/**/*.{ts,js,mjs,html}',
    '!src/**/*.{spec,test}.ts',
    '!src/**/test-setup.ts',
    '!src/**/test-stubs/**',
    '!src/**/*.generated.*',
    '!src/**/environments/**',
    '!src/**/index.ts',
];

module.exports = {
    ...nxPreset,
    // Keep browser-only import.meta URL handling out of CommonJS consumers.
    // The client/protocol stay real; their own ESM tests inject fake workers.
    moduleNameMapper: {
        '^\\./caption-worker-factory$': require('node:path').join(
            __dirname,
            'apps/web/src/test-stubs/caption-worker-factory.ts'
        ),
    },
    coverageReporters,
    collectCoverageFrom,
};
