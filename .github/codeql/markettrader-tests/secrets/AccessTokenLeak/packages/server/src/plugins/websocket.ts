import { echoImported } from './echo.js';

declare const app: any;
declare const ws: any;

// The hook is imported, so it must be resolved across modules.
app.register(ws, { options: { handleProtocols: echoImported } });
