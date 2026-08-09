Pod::Spec.new do |s|
  s.name           = 'CameraOptics'
  s.version        = '1.0.0'
  s.summary        = 'What the cameras on this phone actually are'
  s.description    = 'Zoom ranges, lens switch-over factors and fields of view, read from AVFoundation.'
  s.author         = ''
  s.homepage       = 'https://github.com/jasecena/activity-tracker'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
