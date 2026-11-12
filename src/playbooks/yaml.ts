import { AapSession } from '../auth';
import { VaultedString } from '../vault';

/**
 * Quotes a value as a YAML double-quoted scalar. Values containing Jinja delimiters are tagged
 * !unsafe so Ansible does not try to template user input.
 */
export function yamlString(value: string): string {
  const quoted = JSON.stringify(value);
  return /\{\{|\{%|\{#/.test(value) ? `!unsafe ${quoted}` : quoted;
}

/**
 * Serializes plain data (objects, arrays, scalars) as block YAML at the given indent. Strings go
 * through yamlString, so Jinja in user data (e.g. injector templates) is passed through untemplated.
 * VaultedString values become inline `!vault |` blocks.
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value) && value.length) {
    return value
      .map((item) =>
        isBlock(item) ? `${pad}- ${toYaml(item, indent + 2).slice(indent + 2)}` : `${pad}- ${yamlScalar(item, indent + 2)}`,
      )
      .join('\n');
  }
  if (isPlainObject(value) && Object.keys(value).length) {
    return Object.entries(value)
      .map(([key, item]) =>
        isBlock(item)
          ? `${pad}${yamlKey(key)}:\n${toYaml(item, indent + 2)}`
          : `${pad}${yamlKey(key)}: ${yamlScalar(item, indent + 2)}`,
      )
      .join('\n');
  }
  return pad + yamlScalar(value, indent + 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isBlock(value: unknown): boolean {
  return (Array.isArray(value) && value.length > 0) || (isPlainObject(value) && Object.keys(value).length > 0);
}

/**
 * Writes a multi-line string as a literal block (`|` / `|-`) so it stays readable, e.g. a pod spec.
 * Returns undefined for strings a literal block cannot represent exactly; those stay quoted.
 */
function literalBlock(value: string, contentIndent: number): string | undefined {
  // Leading spaces/newlines would need an indentation indicator, several trailing newlines "keep"
  // chomping, and control characters cannot appear in a block at all.
  if (!value.includes('\n') || /^[ \n]/.test(value) || /\n\n$/.test(value) || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) {
    return undefined;
  }
  const trailingNewline = value.endsWith('\n');
  const body = trailingNewline ? value.slice(0, -1) : value;
  const tag = /\{\{|\{%|\{#/.test(value) ? '!unsafe ' : '';
  const pad = ' '.repeat(contentIndent);
  const lines = body.split('\n').map((line) => (line ? pad + line : ''));
  return `${tag}${trailingNewline ? '|' : '|-'}\n${lines.join('\n')}`;
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
}

/** Formats a non-block value; contentIndent is where a multi-line (`|`) body starts. */
function yamlScalar(value: unknown, contentIndent: number): string {
  if (value instanceof VaultedString) {
    const pad = ' '.repeat(contentIndent);
    return `!vault |\n${value.vaultText.split('\n').map((line) => pad + line).join('\n')}`;
  }
  if (typeof value === 'string') {
    return literalBlock(value, contentIndent) ?? yamlString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return '[]';
  }
  if (isPlainObject(value)) {
    return '{}';
  }
  return 'null';
}

/**
 * Jinja expression reading an environment variable, falling back to another variable when unset.
 * The fallback is a variable rather than a Jinja literal so user values never need Jinja escaping.
 */
function envLookup(name: string, fallbackVar?: string): string {
  const lookup = `lookup('ansible.builtin.env', '${name}')`;
  return `"{{ ${lookup}${fallbackVar ? ` | default(${fallbackVar}, true)` : ''} }}"`;
}

/** Playbook `vars:` entries (indented for a play) describing how to reach AAP. */
export function connectionVars(session: AapSession | undefined, verifyTls: boolean): string {
  const lines = [
    '# Environment variables (AAP_HOSTNAME, AAP_USERNAME, ...) override these defaults.',
    `aap_default_hostname: ${yamlString(session?.baseUrl ?? 'https://aap.example.com')}`,
  ];
  if (session?.authKind !== 'token') {
    lines.push(`aap_default_username: ${yamlString(session?.username ?? 'admin')}`);
  }
  lines.push(`aap_hostname: ${envLookup('AAP_HOSTNAME', 'aap_default_hostname')}`);
  if (session?.authKind === 'token') {
    lines.push(`aap_token: ${envLookup('AAP_TOKEN')}`);
  } else {
    lines.push(`aap_username: ${envLookup('AAP_USERNAME', 'aap_default_username')}`);
    lines.push(`aap_password: ${envLookup('AAP_PASSWORD')}`);
  }
  lines.push(`aap_validate_certs: ${verifyTls}`);
  return lines.map((line) => `    ${line}`).join('\n');
}

export interface ConfigurationPlaybookOptions {
  /** One-line summary for the header comment. */
  title: string;
  playName: string;
  /** Role(s) of the infra.aap_configuration collection, e.g. "gateway_organizations", applied in order. */
  role: string | string[];
  /** The role's input variable(s) as YAML at column 0, e.g. "aap_organizations:\n  - name: ...". */
  data: string;
  session: AapSession | undefined;
  verifyTls: boolean;
  /** Extra header comment lines (without "# "), e.g. caveats about the data. */
  notes?: string[];
  /**
   * Set when `data` contains vaulted values: the run instructions then ask for the vault password.
   * Holds the vault ID the values were encrypted with, or "" for none.
   */
  vaultId?: string;
}

/**
 * Builds a playbook that applies one infra.aap_configuration role. All generated playbooks go
 * through here so they share the same header, connection vars and collection requirements.
 * Secrets are never written to the file; they are read from environment variables at run time.
 */
export function configurationPlaybook(options: ConfigurationPlaybookOptions): string {
  const { title, playName, role, data, session, verifyTls, vaultId, notes = [] } = options;
  const roles = (Array.isArray(role) ? role : [role]).map((name) => `    - infra.aap_configuration.${name}`).join('\n');
  const noteLines = notes.length ? `${notes.map((line) => `# ${line}`.trimEnd()).join('\n')}\n#\n` : '';
  const secret = session?.authKind === 'token' ? 'AAP_TOKEN=<api token>' : 'AAP_PASSWORD=<password>';
  const vaultOption =
    vaultId === undefined ? '' : vaultId ? ` --vault-id ${vaultId}@prompt` : ' --ask-vault-pass';
  const vaultNote =
    vaultId === undefined
      ? ''
      : `#
# Values marked !vault are encrypted with Ansible Vault${vaultId ? ` (vault ID "${vaultId}")` : ''}. Use
# --vault-password-file <file> instead of the prompt for unattended runs.
`;
  const indentedData = data
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n');
  return `---
# ${title.replace(/[\r\n]+/g, ' ')}
#
${noteLines}# Requires the infra.aap_configuration collection and its dependencies:
#   ansible-galaxy collection install infra.aap_configuration ansible.platform ansible.controller
# (ansible.platform and ansible.controller come from Red Hat Automation Hub.)
#
# Run:
#   ${secret} ansible-playbook${vaultOption} <this file>
${vaultNote}
- name: ${yamlString(playName)}
  hosts: localhost
  connection: local
  gather_facts: false

  vars:
${connectionVars(session, verifyTls)}

${indentedData}

  roles:
${roles}
`;
}

/** The object being written to the playbook: new, or loaded from AAP and edited (maybe renamed). */
export interface PlaybookTarget {
  /** The `name` (and `new_name` when renamed) keys of the item. */
  nameKeys: { name: string; new_name?: string };
  /** Start of the header title, e.g. 'Creates the "web" project'. */
  title: string;
  /** Header notes about the rename, if any. */
  notes: string[];
}

/** Describes how a playbook should name the object; `existing` is set when an AAP object is edited. */
export function playbookTarget(noun: string, name: string, existing?: { name: string }): PlaybookTarget {
  if (!existing) {
    return { nameKeys: { name }, title: `Creates the "${name}" ${noun}`, notes: [] };
  }
  if (existing.name === name) {
    return { nameKeys: { name }, title: `Creates or updates the "${name}" ${noun}`, notes: [] };
  }
  return {
    nameKeys: { name: existing.name, new_name: name },
    title: `Renames the "${existing.name}" ${noun} to "${name}" and updates it`,
    notes: [
      `Renames "${existing.name}" to "${name}" (name / new_name). Once it has run, set name to the`,
      'new name and remove new_name, so that later runs find the renamed object.',
    ],
  };
}
