/** The pedometer, off-device. Available by default, reporting no steps. */
export const Pedometer = {
  isAvailableAsync: jest.fn(async () => true),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getStepCountAsync: jest.fn(async () => ({ steps: 0 })),
  watchStepCount: jest.fn(() => ({ remove: jest.fn() })),
};
