export const config = {
  baseURL: 'https://heap-insight.ttnr.me',
  timeouts: {
    navigation: 30000,
    element: 10000,
  },
  credentials: {
    generateRandomEmail: () => `test-user-${Date.now()}@test.com`,
    generateRandomPassword: () => `TestPass${Date.now()}!`,
  },
};
