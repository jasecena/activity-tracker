import AVFoundation
import ExpoModulesCore

/**
 What the cameras on this phone actually are.

 `expo-camera` exposes a zoom of 0 to 1 and a list of lens names, and nothing
 else — no zoom factors, no switch-over points, no fields of view. Everything a
 real zoom dial needs to print `0.5×` or `24 mm` as a fact rather than a guess
 lives in AVFoundation, and this module reads it out.

 It also sets the zoom, by factor, on the device itself. Two reasons rather
 than going through the `zoom` prop:

 - The prop's mapping runs through `activeFormat.videoMaxZoomFactor`, which
   changes with the session's format. A factor computed in JavaScript from a
   value read at a different moment lands somewhere near the target; the device
   asked directly lands on it.
 - `ramp(toVideoZoomFactor:withRate:)` is how the built-in camera makes zoom
   feel like glass moving rather than a value changing. There is no reaching it
   from JavaScript.

 Writing to the device `expo-camera` is running is deliberate, not a trick:
 `AVCaptureDevice` instances are per-hardware singletons, so looking the device
 up by name yields the same object the session configured, and
 `lockForConfiguration` is the documented way for anyone to adjust it.
 */
public class CameraOpticsModule: Module {
  private static let deviceTypes: [AVCaptureDevice.DeviceType] = [
    // Virtual first: one of these is what continuous zoom should select, and
    // which one exists depends on the phone.
    .builtInTripleCamera,
    .builtInDualWideCamera,
    .builtInDualCamera,
    .builtInWideAngleCamera,
    .builtInUltraWideCamera,
    .builtInTelephotoCamera,
    .builtInTrueDepthCamera,
  ]

  private func discover(_ position: AVCaptureDevice.Position) -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: Self.deviceTypes,
      mediaType: .video,
      position: position
    ).devices
  }

  private func findDevice(named localizedName: String) -> AVCaptureDevice? {
    (discover(.back) + discover(.front)).first { $0.localizedName == localizedName }
  }

  public func definition() -> ModuleDefinition {
    Name("CameraOptics")

    /**
     Every camera on one side of the phone, virtual ones included.

     `videoMaxZoomFactor` is read from the *active* format at call time. It is
     format-dependent, which is exactly why the caller re-asks after the
     session settles rather than caching a value from before it existed.
     */
    AsyncFunction("describe") { (position: String) -> [[String: Any]] in
      let devices = self.discover(position == "front" ? .front : .back)
      return devices.map { device in
        let constituents = device.isVirtualDevice ? device.constituentDevices : [device]
        return [
          "localizedName": device.localizedName,
          "deviceType": device.deviceType.rawValue,
          "isVirtual": device.isVirtualDevice,
          "videoMaxZoomFactor": Double(device.activeFormat.videoMaxZoomFactor),
          // Where the virtual device changes lens, in its own zoom-factor
          // space: [2, 6] means the second lens takes over at 2× and the
          // third at 6×. Empty for a physical device.
          "switchOverFactors": device.virtualDeviceSwitchOverVideoZoomFactors.map { Double(truncating: $0) },
          "constituents": constituents.map { constituent in
            [
              "localizedName": constituent.localizedName,
              "deviceType": constituent.deviceType.rawValue,
              // Horizontal, in degrees. The 35 mm-equivalent focal length is
              // derived from this in TypeScript, where it can be tested.
              "fieldOfViewDeg": Double(constituent.activeFormat.videoFieldOfView),
            ]
          },
        ]
      }
    }

    /**
     Set the zoom on a named device, as a factor in its own space.

     Ramped by default, which is the built-in camera's feel. `rate` is in
     powers of two per second; 4 tracks a finger closely without stepping.
     A factor outside the device's range is clamped rather than thrown —
     the dial's edge is not an error.
     */
    AsyncFunction("setZoomFactor") { (localizedName: String, factor: Double, ramped: Bool) in
      guard let device = self.findDevice(named: localizedName) else {
        throw Exception(name: "DeviceNotFound", description: "No camera called \(localizedName)")
      }
      let clamped = max(
        device.minAvailableVideoZoomFactor,
        min(device.maxAvailableVideoZoomFactor, CGFloat(factor))
      )
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      if ramped {
        device.ramp(toVideoZoomFactor: clamped, withRate: 4)
      } else {
        device.videoZoomFactor = clamped
      }
    }

    /**
     Where the zoom actually is, for settling the dial after a ramp.
     */
    AsyncFunction("getZoomFactor") { (localizedName: String) -> Double in
      guard let device = self.findDevice(named: localizedName) else {
        throw Exception(name: "DeviceNotFound", description: "No camera called \(localizedName)")
      }
      return Double(device.videoZoomFactor)
    }
  }
}
