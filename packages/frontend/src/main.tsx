import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/geist-mono/700.css';
import './index.css';
import App from './App';
import { buildInfo } from './build-info';

// No room for a version in the UI, so the build stamp lives in the console —
// enough to tell whether a browser is holding a stale bundle.
console.info(`MarketTrader ${buildInfo.version} (${buildInfo.commit})`);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Loaded dynamically, and after render, so the OTel browser SDK lands in its own
// chunk instead of the entry bundle — it is a substantial download and nothing
// on the critical path needs it. Failure to load is deliberately swallowed:
// telemetry must never be the reason the app doesn't start.
void import('./observability/otel')
  .then(({ initBrowserTelemetry }) => initBrowserTelemetry())
  .catch(() => {});
