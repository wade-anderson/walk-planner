module.exports = {
  projects: [
    {
      displayName: 'app',
      testEnvironment: 'jsdom',
      setupFiles: ['./jest.setup.js'],
      testMatch: ['<rootDir>/tests/app.test.js']
    },
    {
      displayName: 'server',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/server.test.js']
    }
  ]
};
