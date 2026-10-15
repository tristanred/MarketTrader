import posthog from 'posthog-js'; // BAD: bypasses the facade
import type { Properties } from 'posthog-js'; // BAD: type coupling to the SDK outside the facade
import { capture } from '@/lib/posthog'; // OK

export function place(props: Properties) {
  capture('order_placed', props);
  return import('posthog-js/dist/module.no-external').then(() => posthog); // BAD: subpath, dynamic
}
