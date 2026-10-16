// GOOD: allowlisted defensive read.
export function capture(request: any): string | undefined {
  const user = request.user as { id?: string } | undefined;
  return user?.id;
}
