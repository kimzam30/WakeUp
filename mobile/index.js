// App entry. The reminder top-up task has to be defined before anything else runs, because Android can start
// the app's JavaScript in the background just to run it (no screen, no router).
import './src/lib/reminders';
// widgets: Android can also start the JavaScript just to draw one
import './src/widgets';
import 'expo-router/entry';
