export function formatLabel(value: string): string {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_key, nestedValue) => (
        typeof nestedValue === 'bigint' ? String(nestedValue) : nestedValue
      ));
    } catch {
      return String(value);
    }
  }
  return String(value);
}
