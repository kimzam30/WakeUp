// Time hooks that cost nothing while nobody is looking: they tick only while the app is on screen (and, for
// useNow, only while the screen using it is focused), aligned to the minute so countdowns change on time.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Planner } from './shared';

function useActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const s = AppState.addEventListener('change', (st) => setActive(st === 'active')); return () => s.remove(); }, []);
  return active;
}

// "today" (YYYY-MM-DD) that rolls over at midnight and when the app comes back after a night in the background
export function useToday() {
  const active = useActive();
  const [today, setToday] = useState(Planner.today());
  useEffect(() => {
    if (!active) return;
    setToday(Planner.today());
    const now = new Date(); const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1).getTime();
    const t = setTimeout(() => setToday(Planner.today()), midnight - now.getTime());
    return () => clearTimeout(t);
  }, [active, today]);
  return today;
}

// the current time, refreshed at each minute boundary while this screen is focused and the app is active
export function useNow(focusedOnly = true) {
  const active = useActive();
  const focused = useIsFocused();
  const on = active && (!focusedOnly || focused);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(Date.now()); t = setTimeout(tick, 60e3 - (Date.now() % 60e3) + 50); };
    t = setTimeout(tick, 60e3 - (Date.now() % 60e3) + 50);
    return () => clearTimeout(t);
  }, [on]);
  return now;
}
