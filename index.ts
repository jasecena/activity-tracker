// The background location task, registered by importing it — and imported
// FIRST, before anything React touches.
//
// iOS relaunches this app into the background with no UI when a significant
// location change arrives. At that moment `TaskManager` looks for a handler
// registered under the task name; if the JS bundle has not yet run the
// `defineTask` call, the launch is wasted and the fixes for that stretch of the
// day are simply lost. Registering it at module scope of the entry file is what
// makes it present within the first tick of every launch, foreground or not.
import '@/services/locationTask';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
