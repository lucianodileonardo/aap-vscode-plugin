import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AapClient, AapHttpError, ExistingObject } from '../aapClient';
import { AapSession, AuthManager, errorMessage } from '../auth';

export type FieldErrors = Record<string, string[]>;

export interface FormField {
  id: string;
  label: string;
  /**
   * Checkbox values are passed to parse() as "true" / "false"; a checkgroup (a grid of checkboxes
   * built from `options`) as the comma-separated values of the checked boxes. A password field is a
   * masked text input that the browser does not autofill.
   */
  type: 'text' | 'password' | 'number' | 'textarea' | 'code' | 'select' | 'checkbox' | 'checkgroup';
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Initial value; also restored after a successful submit. */
  defaultValue?: string;
  options?: { value: string; label: string }[];
  /** Bounds for number fields. */
  min?: number;
  max?: number;
  /** Shows the field only while another (select) field has one of these values. */
  showWhen?: { field: string; values: string[] };
  /** For text/textarea fields naming AAP objects: in Online Mode the field becomes a list loaded from AAP. */
  lookup?: FieldLookup;
}

export interface LookupOption {
  /** The value put in the field, i.e. the name the user would otherwise type. */
  value: string;
  label?: string;
}

export interface FieldLookup {
  /** Loads the choices; `values` holds the current form values, for lookups that depend on other fields. */
  load(client: AapClient, values: Record<string, string>): Promise<LookupOption[]>;
  /** Several values can be picked; they reach parse() one per line, as typed in a textarea. */
  multiple?: boolean;
  /** Field ids whose change reloads this field's choices. */
  dependsOn?: string[];
}

/**
 * Loading existing objects into a form (Online Mode) so they can be edited, renamed and saved back.
 */
export interface ExistingSupport<T> {
  /**
   * List endpoint of the objects, e.g. "api/controller/v2/projects/"; a function when it depends on
   * the AAP release.
   */
  endpoint: string | ((client: AapClient) => Promise<string>);
  /** Extra list filters, e.g. "managed=false". */
  query?: string;
  /** Sort field of the list; "name" unless the objects have none (users sort by "username"). */
  orderBy?: string;
  /**
   * Filter parameter taking a controller organization ID (e.g. "organization" or
   * "inventory__organization"); when set, the objects are picked by organization.
   */
  organizationFilter?: string;
  /** Fields that cannot change on an existing object; disabled while editing. */
  lockedFields?: string[];
  /** Reads an object as form values (the same strings the fields hold). */
  read(client: AapClient, id: number): Promise<{ values: Record<string, string>; extra?: Record<string, string> }>;
  update(client: AapClient, existing: ExistingObject, value: T): Promise<{ id: number; name: string }>;
}

/**
 * Describes one "create a resource" form. The panel handles the UI, the "Use AAP API" /
 * "Generate Playbook" actions and error reporting; the spec only knows about its resource.
 */
export interface ResourceFormSpec<T extends { name: string }> {
  /** Unique webview type, e.g. "aap.createOrganization". One panel per type is kept open. */
  viewType: string;
  /** Lower-case resource name used in labels, e.g. "credential type". */
  noun: string;
  fields: FormField[];
  /** Validates the raw form values. Field-level problems go in fieldErrors, keyed by field id. */
  parse(values: Record<string, string>): { value: T } | { fieldErrors: FieldErrors };
  create(client: AapClient, value: T): Promise<{ id: number; name: string }>;
  /**
   * Builds the playbook text; may prompt the user (e.g. for a vault password) and resolve to undefined
   * if cancelled. `existing` is set when an object loaded from AAP is being edited (it may be renamed).
   */
  playbook(
    value: T,
    session: AapSession | undefined,
    verifyTls: boolean,
    existing?: ExistingObject,
  ): string | undefined | Promise<string | undefined>;
  /** Edit existing objects; forms without it only create. */
  existing?: ExistingSupport<T>;
}

interface ExistingItem {
  id: number;
  label: string;
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'online'; enabled: boolean }
  | { type: 'loadOptions'; fields: { id: string; seq: number }[]; values: Record<string, string> }
  | { type: 'listExisting'; seq: number; organization: string; withOrganizations: boolean }
  | { type: 'loadExisting'; id: number }
  | { type: 'newObject' }
  | { type: 'submit'; values: Record<string, string>; useApi: boolean; generatePlaybook: boolean; editingId: number | null };

interface SubmitError {
  message: string;
  fieldErrors: FieldErrors;
}

type ToWebview =
  | { type: 'session'; target: string | undefined }
  | { type: 'busy' }
  | { type: 'online'; enabled: boolean; error?: string }
  | { type: 'options'; id: string; seq: number; options?: LookupOption[]; error?: string }
  | { type: 'existingList'; seq: number; items?: ExistingItem[]; organizations?: ExistingItem[]; error?: string }
  | { type: 'loaded'; object?: { id: number; name: string }; values?: Record<string, string>; error?: string }
  | { type: 'editingCleared'; reason: string }
  | { type: 'done'; name: string; created?: { id: number }; updated?: { id: number }; playbook: boolean; error?: SubmitError };

/** Extension services a form panel needs. */
export interface FormContext {
  extensionUri: vscode.Uri;
  auth: AuthManager;
  log: vscode.LogOutputChannel;
}

/** Webview form that creates a resource through the AAP API and/or generates an equivalent playbook. */
export class ResourceFormPanel<T extends { name: string }> {
  private static readonly openPanels = new Map<string, ResourceFormPanel<{ name: string }>>();
  private readonly disposables: vscode.Disposable[] = [];
  /** Online Mode: lookup fields are lists loaded from AAP. Needs a login, shared by all forms. */
  private online = false;
  /** The AAP object loaded into the form, if editing one; saving updates it instead of creating. */
  private editing: ExistingObject | undefined;
  /** Server and user the edited object was loaded from; a different login ends the editing. */
  private editingTarget: string | undefined;

  static show<T extends { name: string }>(spec: ResourceFormSpec<T>, { extensionUri, auth, log }: FormContext): void {
    const existing = ResourceFormPanel.openPanels.get(spec.viewType);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const media = vscode.Uri.joinPath(extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(spec.viewType, `AAP: New ${titleCase(spec.noun)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media],
    });
    const logo = vscode.Uri.joinPath(media, 'logo.png');
    panel.iconPath = logo;
    const instance = new ResourceFormPanel(spec, panel, panel.webview.asWebviewUri(logo).toString(), auth, log);
    ResourceFormPanel.openPanels.set(spec.viewType, instance as unknown as ResourceFormPanel<{ name: string }>);
  }

  private constructor(
    private readonly spec: ResourceFormSpec<T>,
    private readonly panel: vscode.WebviewPanel,
    logoUri: string,
    private readonly auth: AuthManager,
    private readonly log: vscode.LogOutputChannel,
  ) {
    panel.webview.html = renderHtml(spec, crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, logoUri);
    panel.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(msg), undefined, this.disposables);
    auth.onDidChangeSession(() => this.onSessionChanged(), undefined, this.disposables);
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    if (msg.type === 'ready') {
      this.postSession();
      return;
    }
    if (msg.type === 'online') {
      await this.setOnline(msg.enabled);
      return;
    }
    if (msg.type === 'loadOptions') {
      await Promise.all(msg.fields.map(({ id, seq }) => this.loadOptions(id, seq, msg.values)));
      return;
    }
    if (msg.type === 'listExisting') {
      await this.listExisting(msg.seq, msg.organization, msg.withOrganizations);
      return;
    }
    if (msg.type === 'loadExisting') {
      await this.loadExisting(msg.id);
      return;
    }
    if (msg.type === 'newObject') {
      this.setEditing(undefined);
      return;
    }
    const { useApi, generatePlaybook } = msg;
    // The webview says which mode it shows; it wins over a stale state here (e.g. after "New").
    const editing = this.editing && msg.editingId === this.editing.id ? this.editing : undefined;
    const rawName = msg.values.name?.trim() ?? '';
    const fail = (error: SubmitError) => this.post({ type: 'done', name: rawName, playbook: false, error });
    if (!useApi && !generatePlaybook) {
      fail({ message: 'Select "Use AAP API", "Generate Playbook" or both.', fieldErrors: {} });
      return;
    }
    const parsed = this.spec.parse(msg.values);
    if ('fieldErrors' in parsed) {
      fail({ message: 'Please fix the errors below.', fieldErrors: parsed.fieldErrors });
      return;
    }
    const value = parsed.value;

    this.post({ type: 'busy' });
    let playbook = false;
    if (generatePlaybook) {
      try {
        if (!(await this.openPlaybook(value, editing))) {
          this.post({ type: 'done', name: value.name, playbook, error: { message: 'Playbook generation cancelled.', fieldErrors: {} } });
          return;
        }
        playbook = true;
      } catch (err) {
        this.log.error(`Generating playbook for ${this.spec.noun} "${value.name}" failed: ${errorMessage(err)}`);
        this.post({ type: 'done', name: value.name, playbook, error: { message: `Generating playbook failed: ${errorMessage(err)}`, fieldErrors: {} } });
        return;
      }
    }
    if (!useApi) {
      this.post({ type: 'done', name: value.name, playbook });
      return;
    }

    const client = await this.auth.getClient();
    if (!client) {
      this.post({ type: 'done', name: value.name, playbook, error: { message: 'Log in to Ansible Automation Platform first.', fieldErrors: {} } });
      return;
    }
    const verb = editing ? 'Updating' : 'Creating';
    try {
      if (editing && this.spec.existing) {
        const updated = await this.spec.existing.update(client, editing, value);
        this.log.info(`Updated ${this.spec.noun} "${updated.name}" (id ${updated.id}) on ${client.options.baseUrl}.`);
        editing.name = updated.name;
        this.setTitle();
        this.post({ type: 'done', name: updated.name, updated: { id: updated.id }, playbook });
        vscode.window.showInformationMessage(`${titleCase(this.spec.noun)} "${updated.name}" updated.`);
        return;
      }
      const created = await this.spec.create(client, value);
      this.log.info(`Created ${this.spec.noun} "${created.name}" (id ${created.id}) on ${client.options.baseUrl}.`);
      this.post({ type: 'done', name: created.name, created: { id: created.id }, playbook });
      vscode.window.showInformationMessage(`${titleCase(this.spec.noun)} "${created.name}" created.`);
    } catch (err) {
      this.log.error(`${verb} ${this.spec.noun} "${value.name}" failed: ${errorMessage(err)}`);
      const fieldErrors = err instanceof AapHttpError ? err.fieldErrors : {};
      this.post({ type: 'done', name: value.name, playbook, error: { message: errorMessage(err), fieldErrors } });
    }
  }

  /** Opens the generated playbook in a new unsaved editor beside the form. Returns false if cancelled. */
  private async openPlaybook(value: T, editing: ExistingObject | undefined): Promise<boolean> {
    const verifyTls = vscode.workspace.getConfiguration('aap').get<boolean>('verifyTls', true);
    const content = await this.spec.playbook(value, this.auth.currentSession, verifyTls, editing && { ...editing });
    if (content === undefined) {
      return false;
    }
    const language = (await vscode.languages.getLanguages()).includes('ansible') ? 'ansible' : 'yaml';
    const doc = await vscode.workspace.openTextDocument({ language, content });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    this.log.info(`Generated playbook for ${this.spec.noun} "${value.name}".`);
    return true;
  }

  /** Turns Online Mode on (logging in first if needed) or off. */
  private async setOnline(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.online = false;
      return;
    }
    // Reuses the login of any form (or the status bar); only asks when there is none.
    const client = await this.auth.getClient();
    if (!client) {
      this.online = false;
      this.post({ type: 'online', enabled: false, error: 'Online Mode needs a login to Ansible Automation Platform.' });
      return;
    }
    this.online = true;
    this.post({ type: 'online', enabled: true });
  }

  private async loadOptions(id: string, seq: number, values: Record<string, string>): Promise<void> {
    const lookup = this.spec.fields.find((field) => field.id === id)?.lookup;
    const client = this.auth.getClientIfLoggedIn();
    if (!lookup || !client) {
      this.post({ type: 'options', id, seq, error: 'Not logged in.' });
      return;
    }
    try {
      this.post({ type: 'options', id, seq, options: await lookup.load(client, values) });
    } catch (err) {
      this.log.warn(`Loading choices for "${id}" failed: ${errorMessage(err)}`);
      this.post({ type: 'options', id, seq, error: errorMessage(err) });
    }
  }

  /** Lists the objects that can be loaded, optionally of one organization (a controller organization ID). */
  private async listExisting(seq: number, organization: string, withOrganizations: boolean): Promise<void> {
    const existing = this.spec.existing;
    const client = this.auth.getClientIfLoggedIn();
    if (!existing || !client) {
      this.post({ type: 'existingList', seq, error: 'Not logged in.' });
      return;
    }
    try {
      const filters = [`order_by=${existing.orderBy ?? 'name'}`, existing.query, organization && existing.organizationFilter ? `${existing.organizationFilter}=${organization}` : '']
        .filter(Boolean)
        .join('&');
      const endpoint = typeof existing.endpoint === 'string' ? existing.endpoint : await existing.endpoint(client);
      const [objects, organizations] = await Promise.all([
        client.listAll<ListedObject>(`${endpoint}?${filters}`),
        withOrganizations && existing.organizationFilter
          ? client.listAll<{ id: number; name: string }>('api/controller/v2/organizations/?order_by=name')
          : undefined,
      ]);
      this.post({
        type: 'existingList',
        seq,
        items: objects.map((item) => ({ id: item.id, label: describeListed(item, !organization) })),
        ...(organizations ? { organizations: organizations.map((org) => ({ id: org.id, label: org.name })) } : {}),
      });
    } catch (err) {
      this.log.warn(`Listing existing ${this.spec.noun} objects failed: ${errorMessage(err)}`);
      this.post({ type: 'existingList', seq, error: errorMessage(err) });
    }
  }

  /** Reads an object into the form; saving then updates it. */
  private async loadExisting(id: number): Promise<void> {
    const existing = this.spec.existing;
    const client = this.auth.getClientIfLoggedIn();
    if (!existing || !client) {
      this.post({ type: 'loaded', error: 'Not logged in.' });
      return;
    }
    try {
      const { values, extra } = await existing.read(client, id);
      this.setEditing({ id, name: values.name, ...(extra ? { extra } : {}) });
      this.log.info(`Loaded ${this.spec.noun} "${values.name}" (id ${id}) from ${client.options.baseUrl} for editing.`);
      this.post({ type: 'loaded', object: { id, name: values.name }, values });
    } catch (err) {
      this.log.warn(`Loading ${this.spec.noun} ${id} failed: ${errorMessage(err)}`);
      this.post({ type: 'loaded', error: errorMessage(err) });
    }
  }

  private setEditing(editing: ExistingObject | undefined): void {
    this.editing = editing;
    this.editingTarget = editing && this.sessionKey();
    this.setTitle();
  }

  private setTitle(): void {
    const noun = titleCase(this.spec.noun);
    this.panel.title = this.editing ? `AAP: Edit ${noun}: ${this.editing.name}` : `AAP: New ${noun}`;
  }

  private sessionKey(): string | undefined {
    const session = this.auth.currentSession;
    return session && `${session.username}@${session.baseUrl}`;
  }

  /** Login changes reach every open form: online forms reload their lists, or go offline on logout. */
  private onSessionChanged(): void {
    this.postSession();
    // An object of another server or account cannot be saved back with this login.
    if (this.editing && this.sessionKey() !== this.editingTarget) {
      const name = this.editing.name;
      this.setEditing(undefined);
      this.post({
        type: 'editingCleared',
        reason: `You switched login, so "${name}" is no longer being edited: saving creates a new ${this.spec.noun}.`,
      });
    }
    if (!this.online) {
      return;
    }
    if (this.auth.currentSession) {
      this.post({ type: 'online', enabled: true });
    } else {
      this.online = false;
      this.post({ type: 'online', enabled: false, error: 'Logged out of Ansible Automation Platform.' });
    }
  }

  private postSession(): void {
    const session = this.auth.currentSession;
    this.post({ type: 'session', target: session && `${session.username} @ ${session.baseUrl} (AAP ${session.version})` });
  }

  private post(msg: ToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    ResourceFormPanel.openPanels.delete(this.spec.viewType);
    this.disposables.forEach((d) => d.dispose());
  }
}

/** The fields of a listed object used to describe it in the "load existing" list. */
interface ListedObject {
  id: number;
  /** Users have a username instead. */
  name?: string;
  username?: string;
  kind?: string;
  /** Role definitions: the kind of object the role applies to, e.g. "awx.jobtemplate". */
  content_type?: string;
  summary_fields?: { organization?: { name: string }; inventory?: { name: string }; credential_type?: { name: string } };
}

function describeListed(item: ListedObject, withOrganization: boolean): string {
  const details = [
    item.summary_fields?.credential_type?.name,
    item.summary_fields?.inventory && `inventory ${item.summary_fields.inventory.name}`,
    item.kind === 'smart' ? 'smart' : item.kind === 'constructed' ? 'constructed' : undefined,
    item.content_type,
    withOrganization ? item.summary_fields?.organization?.name : undefined,
  ].filter(Boolean);
  const name = item.name ?? item.username ?? `#${item.id}`;
  return details.length ? `${name} (${details.join(', ')})` : name;
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderField(field: FormField): string {
  const id = escapeHtml(field.id);
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  const value = field.defaultValue ?? '';
  if (field.type === 'checkbox') {
    return `
    <div class="field">
      <label class="check"><input type="checkbox" id="${id}"${value === 'true' ? ' checked' : ''}>
        <span>${escapeHtml(field.label)}${field.hint ? `<br><span class="hint">${escapeHtml(field.hint)}</span>` : ''}</span></label>
      <span class="field-error" id="${id}-error" hidden></span>
    </div>`;
  }
  let control: string;
  switch (field.type) {
    case 'text':
      control = `<input id="${id}" maxlength="512" autocomplete="off" value="${escapeHtml(value)}"${placeholder}>`;
      break;
    case 'password':
      control = `<input id="${id}" type="password" maxlength="512" autocomplete="new-password" value="${escapeHtml(value)}"${placeholder}>`;
      break;
    case 'number': {
      const bounds = `${field.min !== undefined ? ` min="${field.min}"` : ''}${field.max !== undefined ? ` max="${field.max}"` : ''}`;
      control = `<input id="${id}" type="number" step="1"${bounds} value="${escapeHtml(value)}"${placeholder}>`;
      break;
    }
    case 'textarea':
      control = `<textarea id="${id}"${placeholder}>${escapeHtml(value)}</textarea>`;
      break;
    case 'code':
      control = `<textarea id="${id}" class="code" rows="8" spellcheck="false"${placeholder}>${escapeHtml(value)}</textarea>`;
      break;
    case 'checkgroup': {
      const selected = value.split(',');
      control = `<div id="${id}" class="checkgroup" role="group" aria-labelledby="${id}-label">${(field.options ?? [])
        .map(
          (o) =>
            `<label class="check"><input type="checkbox" value="${escapeHtml(o.value)}"${selected.includes(o.value) ? ' checked' : ''}><span>${escapeHtml(o.label)}</span></label>`,
        )
        .join('')}</div>`;
      break;
    }
    case 'select':
      control = `<select id="${id}">${(field.options ?? [])
        .map((o) => `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
        .join('')}</select>`;
      break;
  }
  // Lookup fields also get the list used in Online Mode, hidden until then.
  const lookup = field.lookup
    ? `<select id="${id}__online" class="lookup"${field.lookup.multiple ? ' multiple' : ''} aria-labelledby="${id}-label" hidden></select>${
        field.lookup.multiple ? `<span class="hint" id="${id}__multi" hidden>Ctrl/Cmd-click to select several.</span>` : ''
      }`
    : '';
  return `
    <div class="field">
      <label for="${id}" id="${id}-label"${field.required ? ' class="required"' : ''}>${escapeHtml(field.label)}</label>
      ${field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : ''}
      ${control}${lookup}
      <span class="field-error" id="${id}-error" hidden></span>
    </div>`;
}

function renderHtml<T extends { name: string }>(spec: ResourceFormSpec<T>, nonce: string, cspSource: string, logoUri: string): string {
  const noun = escapeHtml(spec.noun);
  const defaults = Object.fromEntries(spec.fields.map((f) => [f.id, f.defaultValue ?? '']));
  // Embedded in a <script>; escaping "<" keeps "</script>" in user-facing strings harmless.
  const conditions = Object.fromEntries(spec.fields.filter((f) => f.showWhen).map((f) => [f.id, f.showWhen]));
  const lookupFields = spec.fields.filter((f) => f.lookup);
  const lookups = Object.fromEntries(
    lookupFields.map((f) => [f.id, { multiple: !!f.lookup?.multiple, dependsOn: f.lookup?.dependsOn ?? [], required: !!f.required }]),
  );
  const existing = spec.existing
    ? { byOrganization: !!spec.existing.organizationFilter, locked: spec.existing.lockedFields ?? [] }
    : null;
  const config = JSON.stringify({ noun: spec.noun, defaults, conditions, lookups, existing }).replace(/</g, '\\u003c');
  const onlineHint = lookupFields.length
    ? `Choose ${lookupFields.map((f) => f.label.toLowerCase()).join(', ')} from lists loaded from AAP. Needs a login, shared by all forms.`
    : 'Uses your AAP login, shared by all forms. This form has no values to pick from AAP.';
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New ${noun}</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 16px 24px; max-width: 720px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; padding-bottom: 16px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #8884)); }
  .logo { width: 44px; height: 44px; flex: none; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 2px; }
  .target { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .field { margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px; }
  label { font-weight: 600; }
  .required::after { content: ' *'; color: var(--vscode-errorForeground); }
  input, textarea, select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; border-radius: 2px; }
  input[type=number] { max-width: 160px; }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, transparent); max-width: 240px; }
  input:focus, textarea:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  textarea { resize: vertical; min-height: 64px; }
  textarea.code { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); tab-size: 2; white-space: pre; }
  .invalid { border-color: var(--vscode-inputValidation-errorBorder); }
  .field-error { color: var(--vscode-errorForeground); font-size: 0.9em; white-space: pre-wrap; }
  button { font: inherit; padding: 6px 14px; border: none; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.6; cursor: default; }
  .banner { padding: 8px 12px; margin-bottom: 16px; border-radius: 2px; border-left: 3px solid; }
  .banner.error { border-color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); }
  .banner.success { border-color: var(--vscode-testing-iconPassed, #388a34); background: var(--vscode-editor-inactiveSelectionBackground); }
  fieldset { border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #8884)); border-radius: 2px; padding: 8px 12px 10px; margin: 0 0 16px; }
  legend { font-weight: 600; padding: 0 4px; }
  .check { display: flex; align-items: flex-start; gap: 8px; margin-top: 6px; font-weight: normal; }
  .field:has(> .check) { margin-bottom: 10px; }
  .field:has(> .check) + .field:not(:has(> .check)) { margin-top: 20px; }
  .checkgroup { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0 16px; padding: 2px 0; }
  .checkgroup.invalid { outline: 1px solid var(--vscode-inputValidation-errorBorder); }
  .check input { margin: 2px 0 0; accent-color: var(--vscode-button-background); }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; font-weight: normal; }
  select.lookup { max-width: none; }
  .online-row { border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #8884)); border-radius: 2px;
    padding: 2px 12px 8px; margin-bottom: 20px; }
  .online-row .status { color: var(--vscode-errorForeground); }
  .existing { display: flex; flex-direction: column; gap: 4px; margin: 10px 0 2px 24px; }
  .existing-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .existing-row select { flex: 1 1 200px; max-width: none; }
  .existing-row select#existing-org { flex: 0 1 220px; }
  .editing { margin-top: 6px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .editing .badge { font-size: 0.85em; padding: 1px 6px; border-radius: 8px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); padding: 3px 10px; }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  select:disabled, input:disabled { opacity: 0.6; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
  <header>
    <img class="logo" src="${escapeHtml(logoUri)}" alt="" width="44" height="44">
    <div>
      <h1 id="title">New ${noun}</h1>
      <div class="target" id="target"></div>
      <div class="editing" id="editing" hidden>
        <span class="badge">EDIT</span><span id="editing-text"></span>
        <button type="button" class="secondary" id="new-object">New ${noun}</button>
      </div>
    </div>
  </header>
  <div class="banner" id="banner" hidden></div>
  <form id="form" novalidate>
    <div class="online-row">
      <label class="check"><input type="checkbox" id="online">
        <span>Online Mode<br><span class="hint" id="online-hint">${escapeHtml(onlineHint)}</span>
        <span class="hint status" id="online-status" hidden></span></span></label>${
          spec.existing
            ? `
      <div class="existing" id="existing" hidden>
        <label id="existing-label">Edit an existing ${noun}</label>
        <span class="hint">Load it into the form, change it, then save it back to AAP. A new name renames it.</span>
        <div class="existing-row">${
          spec.existing.organizationFilter
            ? `<select id="existing-org" aria-label="Organization"><option value="">All organizations</option></select>`
            : ''
        }
          <select id="existing-item" aria-labelledby="existing-label"></select>
          <button type="button" id="existing-load">Load</button>
        </div>
        <span class="field-error" id="existing-error" hidden></span>
      </div>`
            : ''
        }
    </div>
    ${spec.fields.map(renderField).join('')}
    <fieldset>
      <legend>Actions</legend>
      <label class="check"><input type="checkbox" id="useApi" checked>
        <span>Use AAP API<br><span class="hint" id="useApi-hint"></span></span></label>
      <label class="check"><input type="checkbox" id="generatePlaybook">
        <span>Generate Playbook<br><span class="hint" id="generatePlaybook-hint"></span></span></label>
    </fieldset>
    <button type="submit" id="submit"></button>
  </form>
<script nonce="${nonce}">
  const config = ${config};
  const vscode = acquireVsCodeApi();
  const form = document.getElementById('form');
  const submit = document.getElementById('submit');
  const banner = document.getElementById('banner');
  const useApi = document.getElementById('useApi');
  const generatePlaybook = document.getElementById('generatePlaybook');
  const fieldIds = Object.keys(config.defaults);
  const firstField = document.getElementById(fieldIds[0]);
  let busy = false;

  // Remember the chosen actions across reopenings of the form.
  const saved = vscode.getState();
  if (saved) {
    useApi.checked = saved.useApi;
    generatePlaybook.checked = saved.generatePlaybook;
  }

  // The AAP object being edited ({ id, name }), or null when the form creates a new one.
  let editing = null;
  function submitLabel() {
    const verb = editing ? 'Update' : 'Create';
    if (useApi.checked && generatePlaybook.checked) return verb + ' & generate playbook';
    if (generatePlaybook.checked) return 'Generate playbook';
    return verb + ' ' + config.noun;
  }
  // Header, hints and locked fields follow the mode (new object, or editing a loaded one).
  function updateMode() {
    document.getElementById('title').textContent = editing ? 'Edit ' + config.noun : 'New ' + config.noun;
    document.getElementById('editing').hidden = !editing;
    if (editing) document.getElementById('editing-text').textContent = '"' + editing.name + '" (id ' + editing.id + ')';
    document.getElementById('useApi-hint').textContent = editing
      ? 'Save the changes to "' + editing.name + '" on the connected platform.'
      : 'Create the ' + config.noun + ' now on the connected platform.';
    document.getElementById('generatePlaybook-hint').textContent = editing
      ? 'Open an infra.aap_configuration playbook that applies this ' + config.noun + ' (renaming it if the name changed). No login needed.'
      : 'Open an infra.aap_configuration playbook that creates this ' + config.noun + '. No login needed.';
    for (const id of config.existing ? config.existing.locked : []) {
      document.getElementById(id).disabled = !!editing;
      const errorEl = document.getElementById(id + '-error');
      if (editing) {
        errorEl.textContent = 'Cannot be changed on an existing ' + config.noun + '.';
        errorEl.className = 'hint';
      }
      errorEl.hidden = !editing;
      if (!editing) errorEl.className = 'field-error';
    }
    updateSubmit();
  }
  function updateSubmit() {
    submit.textContent = busy ? 'Working…' : submitLabel();
    submit.disabled = busy || (!useApi.checked && !generatePlaybook.checked);
  }
  for (const box of [useApi, generatePlaybook]) {
    box.addEventListener('change', () => {
      vscode.setState({ useApi: useApi.checked, generatePlaybook: generatePlaybook.checked });
      updateSubmit();
    });
  }

  function showBanner(kind, text) {
    banner.className = 'banner ' + kind;
    banner.textContent = text;
    banner.hidden = !text;
  }
  function clearErrors() {
    for (const id of fieldIds) {
      document.getElementById(id).classList.remove('invalid');
      if (config.lookups[id]) onlineSelect(id).classList.remove('invalid');
      document.getElementById(id + '-error').hidden = true;
    }
  }
  function showFieldErrors(fieldErrors) {
    let shown = false;
    for (const [id, messages] of Object.entries(fieldErrors)) {
      if (!fieldIds.includes(id)) continue;
      controlFor(id).classList.add('invalid');
      const el = document.getElementById(id + '-error');
      el.textContent = messages.join(' ');
      el.hidden = false;
      shown = true;
    }
    return shown;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    showBanner('', '');
    const values = {};
    for (const id of fieldIds) values[id] = readValue(id);
    vscode.postMessage({
      type: 'submit', values, useApi: useApi.checked, generatePlaybook: generatePlaybook.checked, editingId: editing ? editing.id : null,
    });
  });

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {
      case 'session':
        document.getElementById('target').textContent = msg.target
          ? 'Target: ' + msg.target
          : 'Not logged in. "Use AAP API" will ask you to log in; "Generate Playbook" works offline.';
        break;
      case 'busy':
        busy = true;
        updateSubmit();
        break;
      case 'online':
        onlineBox.disabled = false;
        onlineStatus.textContent = msg.error || '';
        onlineStatus.hidden = !msg.error;
        setOnlineUi(msg.enabled);
        break;
      case 'options':
        fillOptions(msg);
        break;
      case 'existingList':
        fillExisting(msg);
        break;
      case 'loaded':
        onLoaded(msg);
        break;
      case 'editingCleared':
        editing = null;
        updateMode();
        showBanner('error', msg.reason);
        break;
      case 'done': {
        busy = false;
        updateSubmit();
        const noun = config.noun.charAt(0).toUpperCase() + config.noun.slice(1);
        const done = [];
        if (msg.created) done.push(noun + ' "' + msg.name + '" created (id ' + msg.created.id + ').');
        if (msg.updated) done.push(noun + ' "' + msg.name + '" updated (id ' + msg.updated.id + ').');
        if (msg.playbook) done.push('Playbook for "' + msg.name + '" opened in the editor.');
        if (msg.error) {
          const inline = showFieldErrors(msg.error.fieldErrors);
          const problem = inline ? 'Please fix the errors below.' : msg.error.message;
          showBanner('error', done.concat(problem).join(' '));
        } else if (editing) {
          // Editing continues on the saved object, which may have been renamed.
          if (msg.updated) {
            editing.name = msg.name;
            updateMode();
            if (online) requestExisting(false);
          }
          showBanner('success', done.join(' '));
        } else {
          resetForm();
          if (msg.created && online) requestExisting(false);
          showBanner('success', done.join(' '));
          firstField.focus();
        }
        break;
      }
    }
  });

  function resetForm() {
    for (const id of fieldIds) writeValue(id, config.defaults[id]);
    applyConditions();
    if (online) requestOptions(lookupIds.filter((id) => config.lookups[id].dependsOn.length), false);
  }

  // ---- Editing existing objects (Online Mode) ----
  const existingBox = document.getElementById('existing');
  const existingOrg = document.getElementById('existing-org');
  const existingItem = document.getElementById('existing-item');
  const existingLoad = document.getElementById('existing-load');
  const existingError = document.getElementById('existing-error');
  let existingSeq = 0;
  let organizationsLoaded = false;

  function requestExisting(withOrganizations) {
    if (!existingBox) return;
    existingSeq++;
    existingItem.disabled = true;
    existingLoad.disabled = true;
    existingItem.replaceChildren(new Option('Loading…', ''));
    vscode.postMessage({
      type: 'listExisting', seq: existingSeq, organization: existingOrg ? existingOrg.value : '', withOrganizations,
    });
  }
  function fillExisting(msg) {
    if (!online || msg.seq !== existingSeq) return;
    existingError.hidden = !msg.error;
    if (msg.error) {
      existingError.textContent = msg.error;
      existingItem.replaceChildren(new Option('Could not load the list', ''));
      return;
    }
    if (msg.organizations && existingOrg) {
      const chosen = existingOrg.value;
      existingOrg.replaceChildren(new Option('All organizations', ''), ...msg.organizations.map((o) => new Option(o.label, String(o.id))));
      existingOrg.value = chosen;
      organizationsLoaded = true;
    }
    const chosen = existingItem.value;
    const options = msg.items.length
      ? [new Option('Select ' + (/^[aeiou]/.test(config.noun) ? 'an ' : 'a ') + config.noun + '…', ''), ...msg.items.map((o) => new Option(o.label, String(o.id)))]
      : [new Option('No ' + config.noun + ' found', '')];
    existingItem.replaceChildren(...options);
    existingItem.value = msg.items.some((o) => String(o.id) === chosen) ? chosen : '';
    existingItem.disabled = !msg.items.length;
    existingLoad.disabled = !existingItem.value;
  }
  function onLoaded(msg) {
    existingLoad.disabled = !existingItem.value;
    existingItem.disabled = false;
    if (msg.error) {
      existingError.textContent = 'Loading failed: ' + msg.error;
      existingError.hidden = false;
      return;
    }
    clearErrors();
    editing = msg.object;
    for (const id of fieldIds) {
      // Lists are rebuilt below; marking them unloaded keeps the loaded value as the one to select.
      if (config.lookups[id]) loaded[id] = false;
      writeValue(id, msg.values[id] !== undefined ? msg.values[id] : config.defaults[id]);
    }
    applyConditions();
    if (online) requestOptions(lookupIds);
    updateMode();
    showBanner('success', 'Loaded "' + editing.name + '" (id ' + editing.id + '). Saving updates it; change the name to rename it.');
  }
  if (existingBox) {
    if (existingOrg) existingOrg.addEventListener('change', () => requestExisting(false));
    existingItem.addEventListener('change', () => { existingLoad.disabled = !existingItem.value; });
    existingLoad.addEventListener('click', () => {
      if (!existingItem.value) return;
      existingError.hidden = true;
      existingLoad.disabled = true;
      existingItem.disabled = true;
      vscode.postMessage({ type: 'loadExisting', id: Number(existingItem.value) });
    });
  }
  document.getElementById('new-object').addEventListener('click', () => {
    editing = null;
    clearErrors();
    resetForm();
    updateMode();
    showBanner('', '');
    vscode.postMessage({ type: 'newObject' });
    firstField.focus();
  });

  function readValue(id) {
    if (isLookupActive(id)) {
      // While a list is (re)loading, the value it is meant to show still counts.
      return loaded[id] ? readSelect(id) : wanted[id] || '';
    }
    const el = document.getElementById(id);
    if (el.classList.contains('checkgroup')) {
      return [...el.querySelectorAll('input:checked')].map((box) => box.value).join(',');
    }
    return el.type === 'checkbox' ? String(el.checked) : el.value;
  }
  function writeValue(id, value) {
    const el = document.getElementById(id);
    if (el.classList.contains('checkgroup')) {
      const selected = value.split(',');
      for (const box of el.querySelectorAll('input')) box.checked = selected.includes(box.value);
    } else if (el.type === 'checkbox') {
      el.checked = value === 'true';
    } else {
      el.value = value;
    }
    if (config.lookups[id]) {
      wanted[id] = value;
      if (loaded[id]) setSelection(id, value);
    }
  }

  // ---- Online Mode: lookup fields become lists loaded from AAP ----
  const onlineBox = document.getElementById('online');
  const onlineStatus = document.getElementById('online-status');
  const lookupIds = Object.keys(config.lookups);
  let online = false;
  const wanted = {}; // value each list should show once loaded (typed text, or the previous selection)
  const loaded = {};
  const seqs = {}; // latest request per field, so a slow old answer cannot overwrite a newer one
  const keepUnknown = {}; // keep values AAP does not list (typed text), or drop them (dependency changed)

  function onlineSelect(id) {
    return document.getElementById(id + '__online');
  }
  function isLookupActive(id) {
    return online && !!config.lookups[id];
  }
  function controlFor(id) {
    return isLookupActive(id) ? onlineSelect(id) : document.getElementById(id);
  }
  function readSelect(id) {
    return [...onlineSelect(id).selectedOptions].map((o) => o.value).filter(Boolean).join('\\n');
  }
  function splitValues(value) {
    return (value || '').split('\\n').map((v) => v.trim()).filter(Boolean);
  }
  function setSelection(id, value) {
    const values = splitValues(value);
    for (const option of onlineSelect(id).options) option.selected = values.includes(option.value);
  }
  function currentValues() {
    const values = {};
    for (const id of fieldIds) values[id] = readValue(id);
    return values;
  }

  function requestOptions(ids, keep = true) {
    if (!ids.length) return;
    const values = currentValues();
    const fields = ids.map((id) => {
      if (loaded[id]) wanted[id] = readSelect(id);
      loaded[id] = false;
      keepUnknown[id] = keep;
      const select = onlineSelect(id);
      select.disabled = true;
      select.replaceChildren(new Option('Loading…', ''));
      seqs[id] = (seqs[id] || 0) + 1;
      return { id, seq: seqs[id] };
    });
    vscode.postMessage({ type: 'loadOptions', fields, values });
  }

  function fillOptions(msg) {
    const { id } = msg;
    if (!online || msg.seq !== seqs[id]) return;
    const lookup = config.lookups[id];
    const select = onlineSelect(id);
    const errorEl = document.getElementById(id + '-error');
    if (msg.error) {
      select.replaceChildren(new Option('Could not load the list', ''));
      errorEl.textContent = msg.error;
      errorEl.hidden = false;
      return;
    }
    const want = splitValues(wanted[id]);
    const known = new Set(msg.options.map((o) => o.value));
    const options = lookup.multiple ? [] : [new Option(lookup.required ? 'Select…' : '(none)', '')];
    for (const o of msg.options) options.push(new Option(o.label || o.value, o.value));
    // Keep values that AAP does not know (yet), clearly marked, instead of silently dropping them.
    if (keepUnknown[id]) for (const v of want) if (!known.has(v)) options.push(new Option(v + ' (not found in AAP)', v));
    if (!options.length) {
      const empty = new Option('Nothing available', '');
      empty.disabled = true;
      options.push(empty);
    }
    select.replaceChildren(...options);
    setSelection(id, wanted[id]);
    if (lookup.multiple) select.size = Math.min(8, Math.max(4, options.length));
    select.disabled = false;
    loaded[id] = true;
    errorEl.hidden = true;
  }

  function setOnlineUi(enabled) {
    if (enabled && online) {
      requestOptions(lookupIds); // already online: reload, e.g. after switching account
      requestExisting(true);
      return;
    }
    if (!enabled && !online) {
      onlineBox.checked = false; // e.g. the login was cancelled
      return;
    }
    online = enabled;
    onlineBox.checked = enabled;
    for (const id of lookupIds) {
      const text = document.getElementById(id);
      if (enabled) {
        wanted[id] = text.value;
        loaded[id] = false;
      } else {
        // Back to text: keep what was picked.
        text.value = loaded[id] ? readSelect(id) : wanted[id] ?? text.value;
        document.getElementById(id + '-error').hidden = true;
      }
      text.hidden = enabled;
      onlineSelect(id).hidden = !enabled;
      const multiHint = document.getElementById(id + '__multi');
      if (multiHint) multiHint.hidden = !enabled;
    }
    if (existingBox) existingBox.hidden = !enabled;
    if (enabled) {
      requestOptions(lookupIds);
      requestExisting(!organizationsLoaded);
    }
  }

  onlineBox.addEventListener('change', () => {
    onlineStatus.hidden = true;
    if (onlineBox.checked) {
      onlineBox.disabled = true; // until the extension confirms the login
      onlineBox.checked = false;
      vscode.postMessage({ type: 'online', enabled: true });
    } else {
      setOnlineUi(false);
      vscode.postMessage({ type: 'online', enabled: false });
    }
  });

  // Lists that depend on another field (e.g. playbooks on the project) reload when it changes.
  for (const field of new Set(lookupIds.flatMap((id) => config.lookups[id].dependsOn))) {
    const dependents = lookupIds.filter((id) => config.lookups[id].dependsOn.includes(field));
    // A value that does not exist for the new choice (e.g. another project's playbook) is dropped.
    const reload = () => {
      if (online) requestOptions(dependents, false);
    };
    document.getElementById(field).addEventListener('change', reload);
    if (config.lookups[field]) onlineSelect(field).addEventListener('change', reload);
  }
  // Show or hide fields whose showWhen condition depends on another field's value.
  function applyConditions() {
    for (const [id, cond] of Object.entries(config.conditions)) {
      const visible = cond.values.includes(readValue(cond.field));
      document.getElementById(id).closest('.field').hidden = !visible;
    }
  }
  for (const field of new Set(Object.values(config.conditions).map((c) => c.field))) {
    document.getElementById(field).addEventListener('change', applyConditions);
  }

  applyConditions();
  updateMode();
  vscode.postMessage({ type: 'ready' });
  firstField.focus();
</script>
</body>
</html>`;
}
