import { request } from 'undici';

// OK: observability transports ship telemetry over HTTP.
export async function ship(url: string, body: string) {
  await fetch(url, { method: 'POST', body });
  return request(url);
}
