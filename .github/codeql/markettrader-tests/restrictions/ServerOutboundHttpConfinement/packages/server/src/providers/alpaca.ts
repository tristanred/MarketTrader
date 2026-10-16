// OK: providers/ make the outbound market-data calls.
export async function snapshot(url: string) {
  const res = await fetch(url, { headers: {} });
  return res.json();
}
