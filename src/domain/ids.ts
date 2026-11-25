export function createId(prefix: string): string {
  const uuid = globalThis.crypto.randomUUID();
  return `${prefix}-${uuid}`;
}
