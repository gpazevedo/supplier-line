const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Returns the `ExpiresAt` value if it is an ISO 8601 UTC timestamp (`2026-09-26T18:30:00Z`); throws otherwise. */
export function requireExpiresAt(value: unknown): string {
  if (typeof value !== 'string' || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `ExpiresAt is missing or malformed (want e.g. 2026-09-26T18:30:00Z), got: ${JSON.stringify(value)}`
    );
  }
  return value;
}
