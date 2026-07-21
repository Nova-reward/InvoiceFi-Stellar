/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  testEnvironment: 'node',
  // Ignore specs for the incomplete/experimental modules that are excluded
  // from the build (see tsconfig.json "exclude"). Keep this list in sync.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/api/',
    '<rootDir>/auth/',
    '<rootDir>/email/',
    '<rootDir>/financing-pool/',
    '<rootDir>/invoice/',
    '<rootDir>/invoice-reminder/',
    '<rootDir>/notification/',
    '<rootDir>/notifications/',
    '<rootDir>/settlement/settlement.controller',
    '<rootDir>/settlement/dto/',
  ],
};
