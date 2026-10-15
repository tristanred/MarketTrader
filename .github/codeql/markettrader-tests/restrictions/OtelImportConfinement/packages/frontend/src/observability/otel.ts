// OK: the browser bootstrap.
import { context, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';

export const parts = [context, trace, logs, WebTracerProvider, registerInstrumentations, FetchInstrumentation];
