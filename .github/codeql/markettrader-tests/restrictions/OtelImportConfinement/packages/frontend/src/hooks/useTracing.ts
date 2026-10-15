import { trace } from '@opentelemetry/api'; // BAD: frontend API use outside observability/
import { logs } from '@opentelemetry/api-logs'; // BAD
import { ZoneContextManager } from '@opentelemetry/context-zone'; // BAD: context managers are bootstrap concerns
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'; // BAD

export const t = [trace, logs, ZoneContextManager, WebTracerProvider];
