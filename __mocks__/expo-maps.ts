/**
 * Apple Maps, off-device.
 *
 * There is no MapKit on a Linux runner and there never will be, so the view is
 * a plain `View` that keeps the props it was given. That is enough for the only
 * questions a test here can usefully ask: was the map rendered at all, and were
 * the right polylines and annotations handed to it — which is exactly the
 * boundary `components/MapCanvas.tsx` exists to own.
 */
import { createElement } from 'react';
import { View } from 'react-native';

export const AppleMaps = {
  View: jest.fn((props: Record<string, unknown>) =>
    createElement(View, { accessibilityLabel: 'Apple Maps', ...props }, null),
  ),
  MapType: { HYBRID: 'HYBRID', STANDARD: 'STANDARD', IMAGERY: 'IMAGERY' },
  ContourStyle: { STRAIGHT: 'STRAIGHT', GEODESIC: 'GEODESIC' },
  MapColorScheme: { AUTOMATIC: 'AUTOMATIC', LIGHT: 'LIGHT', DARK: 'DARK' },
  MapStyleElevation: { AUTOMATIC: 'AUTOMATIC', FLAT: 'FLAT', REALISTIC: 'REALISTIC' },
};

export const GoogleMaps = { View: AppleMaps.View };

export const requestPermissionsAsync = jest.fn(async () => ({ status: 'granted', granted: true }));
export const getPermissionsAsync = jest.fn(async () => ({ status: 'granted', granted: true }));
