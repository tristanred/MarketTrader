// OK: the frontend's API client is out of scope.
export function get(path: string) {
  return fetch(`/api${path}`);
}
