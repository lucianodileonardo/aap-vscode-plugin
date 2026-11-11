import { isMap, parseDocument, visit } from 'yaml';
import { FieldErrors } from '../views/resourceFormPanel';

/** Parses a YAML/JSON mapping; empty text means an empty mapping. Records problems in fieldErrors. */
export function parseMapping(text: string, field: string, fieldErrors: FieldErrors): Record<string, unknown> | undefined {
  if (!text.trim()) {
    return {};
  }
  const doc = parseDocument(text);
  if (doc.errors.length) {
    fieldErrors[field] = [`Invalid YAML/JSON: ${doc.errors[0].message}`];
    return undefined;
  }
  // An unquoted "{{ x }}" parses as a flow mapping whose key is another flow mapping; catch the
  // usual mistake of forgetting to quote a Jinja template.
  let unquotedTemplate = false;
  visit(doc, {
    Map(_, node) {
      if (node.flow && node.items.some((pair) => isMap(pair.key) && pair.key.flow)) {
        unquotedTemplate = true;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  if (unquotedTemplate) {
    fieldErrors[field] = [`Quote Jinja templates, e.g. MY_VAR: '{{ field_id }}'.`];
    return undefined;
  }
  const parsed: unknown = doc.toJS();
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    fieldErrors[field] = ['Must be a mapping (key: value pairs), not a list or a single value.'];
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

/** Parses a whole number within bounds; empty text gives the fallback. Records problems in fieldErrors. */
export function parseInteger(
  text: string,
  field: string,
  fieldErrors: FieldErrors,
  { min, max, fallback = 0 }: { min?: number; max?: number; fallback?: number } = {},
): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value)) {
    fieldErrors[field] = ['Must be a whole number.'];
  } else if (min !== undefined && value < min) {
    fieldErrors[field] = [`Must be at least ${min}.`];
  } else if (max !== undefined && value > max) {
    fieldErrors[field] = [`Must be at most ${max}.`];
  }
  return value;
}

/** Splits text into trimmed, non-empty, de-duplicated lines (commas also separate entries). */
export function parseList(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((line) => line.trim()).filter(Boolean))];
}
