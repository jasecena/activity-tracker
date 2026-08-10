import AVFoundation
import ExpoModulesCore

/**
 What the cameras on this phone actually are.

 `expo-camera` exposes a zoom of 0 to 1 and a list of lens names, and nothing
 else — no zoom factors, no switch-over points, no fields of view. Everything a
 real zoom dial needs to print `0.5×` or `24 mm` as a fact rather than a guess
 lives in AVFoundation, and this module reads it out.

 **Reading is all it does, and that is a decision rather than an omission.**
 It used to set the zoom as well, by factor and through
 `ramp(toVideoZoomFactor:withRate:)`, because that is how the built-in camera
 makes zoom feel like glass moving rather than a value changing — and because
 the `zoom` prop's mapping runs through `activeFormat.videoMaxZoomFactor`,
 which changes with the session's format.

 That went with the wheel it existed for. Three buttons drive `expo-camera`'s
 own prop, and the format-dependence is handled where it arises: the
 description is re-read when the mode changes, and `zoomPropFor` inverts the
 exponent exactly. Writing to a device the camera session owns is safe but it
 is not free of surprise, and nothing needs it. The argument for bringing it
 back is in the git history alongside the code.
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
  }
}
