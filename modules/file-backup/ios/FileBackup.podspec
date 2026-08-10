Pod::Spec.new do |s|
  s.name           = 'FileBackup'
  s.version        = '1.0.0'
  s.summary        = 'Whether a file is copied into a backup'
  s.description    = 'Reads and sets NSURLIsExcludedFromBackupKey, which expo-file-system does not expose.'
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
