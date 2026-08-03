/**
 * Core Location, off-device.
 *
 * Permissions default to granted and tracking defaults to off, which is the
 * state a test most often wants to start from. Anything that needs a different
 * one overrides these with `jest.spyOn`.
 */

export enum PermissionStatus {
  GRANTED = 'granted',
  UNDETERMINED = 'undetermined',
  DENIED = 'denied',
}

export enum Accuracy {
  Lowest = 1,
  Low = 2,
  Balanced = 3,
  High = 4,
  Highest = 5,
  BestForNavigation = 6,
}

export enum ActivityType {
  Other = 1,
  AutomotiveNavigation = 2,
  Fitness = 3,
  OtherNavigation = 4,
  Airborne = 5,
}

let started = false;

export const getForegroundPermissionsAsync = jest.fn(async () => ({ status: PermissionStatus.GRANTED }));
export const getBackgroundPermissionsAsync = jest.fn(async () => ({ status: PermissionStatus.GRANTED }));
export const requestForegroundPermissionsAsync = jest.fn(async () => ({ status: PermissionStatus.GRANTED }));
export const requestBackgroundPermissionsAsync = jest.fn(async () => ({ status: PermissionStatus.GRANTED }));

export const hasStartedLocationUpdatesAsync = jest.fn(async () => started);
export const startLocationUpdatesAsync = jest.fn(async () => {
  started = true;
});
export const stopLocationUpdatesAsync = jest.fn(async () => {
  started = false;
});

export const getCurrentPositionAsync = jest.fn(async () => ({
  coords: { latitude: 0, longitude: 0, accuracy: 10, speed: 0, altitude: 0, heading: 0, altitudeAccuracy: 5 },
  timestamp: 0,
}));
