import { useEffect, useState } from 'react';

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/New_York',
});

/**
 * Returns the current Eastern Time as `HH:MM:SS`, updating once per second.
 * Used by the status strip's ticking clock.
 */
export function useLiveClock(): string {
  const [now, setNow] = useState(() => ET_FORMATTER.format(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(ET_FORMATTER.format(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
