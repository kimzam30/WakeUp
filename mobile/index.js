// App entry. The reminder top-up task has to be defined before anything else runs, because Android can start
// the app's JavaScript in the background just to run it (no screen, no router).
import './src/lib/reminders';
import 'expo-router/entry';
