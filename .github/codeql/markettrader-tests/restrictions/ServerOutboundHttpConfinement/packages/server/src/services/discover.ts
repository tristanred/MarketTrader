import axios from 'axios'; // BAD: HTTP client outside providers/
import { fetch as undiciFetch } from 'undici'; // BAD
import https from 'node:https';
import { request, createServer } from 'node:http';

declare const client: { fetch(u: string): Promise<unknown> };

export async function trending() {
  await fetch('https://query1.finance.yahoo.com/v1/finance/trending/US'); // BAD
  await globalThis.fetch('https://example.com'); // BAD
  await client.fetch('x'); // OK: a method, not the global
  https.get('https://example.com'); // BAD: node https client
  request('http://example.com'); // BAD: node http client, named import
  createServer(); // OK: a server, not an outbound call
  return [axios, undiciFetch];
}
