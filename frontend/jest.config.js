const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    // Playwright E2E specs are run by a separate runner (npm run test:e2e),
    // not by jest.
    '<rootDir>/__tests__/offline/',
    // Shared axe helper module — not a test suite.
    // Utility/helper files inside __tests__ that are not test suites
    '<rootDir>/__tests__/a11y/axe.utils.ts',
  ],
  coveragePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
}

module.exports = createJestConfig(customJestConfig)
