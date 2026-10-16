declare const __GIT_COMMIT__: string; // BAD

export function VersionPage() {
  return <span>{__GIT_COMMIT__}</span>; // BAD
}
