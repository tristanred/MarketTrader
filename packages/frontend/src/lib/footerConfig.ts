/**
 * Edit this file to add or remove footer links. The footer renders the array
 * in order, left to right. `external` items open in a new tab; `internal`
 * items use react-router for client-side navigation.
 */
export type FooterLink =
  | { kind: 'external'; label: string; href: string }
  | { kind: 'internal'; label: string; to: string };

export const FOOTER_LINKS: FooterLink[] = [
  { kind: 'external', label: 'API Docs', href: '/docs' },
  { kind: 'external', label: 'Investopedia', href: 'https://www.investopedia.com' },
];
