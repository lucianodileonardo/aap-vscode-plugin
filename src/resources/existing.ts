import { stringify } from 'yaml';

/** Helpers for reading AAP objects into form values (every form value is a string). */

/** A mapping as YAML text for a code field; empty mappings give an empty field. */
export function yamlText(value: unknown): string {
  if (!value || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
    return '';
  }
  return stringify(value, { lineWidth: 0 });
}

/** A scalar as form text: booleans become "true"/"false", null/undefined become "". */
export function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Variables stored by AAP as text ("---" or "{}" when empty) shown as the user would type them. */
export function variablesText(value: unknown): string {
  const raw = text(value).trim();
  return raw === '---' || raw === '{}' || raw === '' ? '' : raw + '\n';
}
