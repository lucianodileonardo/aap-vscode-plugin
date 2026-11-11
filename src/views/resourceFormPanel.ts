import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AapClient, AapHttpError } from '../aapClient';
import { AapSession, AuthManager, errorMessage } from '../auth';

export type FieldErrors = Record<string, string[]>;

export interface FormField {
  id: string;
  label: string;
  /**
   * Checkbox values are passed to parse() as "true" / "false"; a checkgroup (a grid of checkboxes
   * built from `options`) as the comma-separated values of the checked boxes.
   */
  type: 'text' | 'number' | 'textarea' | 'code' | 'select' | 'checkbox' | 'checkgroup';
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
  /** Builds the playbook text; may prompt the user (e.g. for a vault password) and resolve to undefined if cancelled. */
  playbook(value: T, session: AapSession | undefined, verifyTls: boolean): string | undefined | Promise<string | undefined>;
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'online'; enabled: boolean }
  | { type: 'loadOptions'; fields: { id: string; seq: number }[]; values: Record<string, string> }
  | { type: 'submit'; values: Record<string, string>; useApi: boolean; generatePlaybook: boolean };

interface SubmitError {
  message: string;
  fieldErrors: FieldErrors;
}

type ToWebview =
  | { type: 'session'; target: string | undefined }
  | { type: 'busy' }
  | { type: 'online'; enabled: boolean; error?: string }
  | { type: 'options'; id: string; seq: number; options?: LookupOption[]; error?: string }
  | { type: 'done'; name: string; created?: { id: number }; playbook: boolean; error?: SubmitError };

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
    const { useApi, generatePlaybook } = msg;
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
        if (!(await this.openPlaybook(value))) {
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
    try {
      const created = await this.spec.create(client, value);
      this.log.info(`Created ${this.spec.noun} "${created.name}" (id ${created.id}) on ${client.options.baseUrl}.`);
      this.post({ type: 'done', name: created.name, created: { id: created.id }, playbook });
      vscode.window.showInformationMessage(`${titleCase(this.spec.noun)} "${created.name}" created.`);
    } catch (err) {
      this.log.error(`Creating ${this.spec.noun} "${value.name}" failed: ${errorMessage(err)}`);
      const fieldErrors = err instanceof AapHttpError ? err.fieldErrors : {};
      this.post({ type: 'done', name: value.name, playbook, error: { message: errorMessage(err), fieldErrors } });
    }
  }

  /** Opens the generated playbook in a new unsaved editor beside the form. Returns false if cancelled. */
  private async openPlaybook(value: T): Promise<boolean> {
    const verifyTls = vscode.workspace.getConfiguration('aap').get<boolean>('verifyTls', true);
    const content = await this.spec.playbook(value, this.auth.currentSession, verifyTls);
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

  /** Login changes reach every open form: online forms reload their lists, or go offline on logout. */
  private onSessionChanged(): void {
    this.postSession();
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
  const config = JSON.stringify({ noun: spec.noun, defaults, conditions, lookups }).replace(/</g, '\\u003c');
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
  [hidden] { display: none !important; }
</style>
</head>
<body>
  <header>
    <img class="logo" src="${escapeHtml(logoUri)}" alt="" width="44" height="44">
    <div>
      <h1>New ${noun}</h1>
      <div class="target" id="target"></div>
    </div>
  </header>
  <div class="banner" id="banner" hidden></div>
  <form id="form" novalidate>
    <div class="online-row">
      <label class="check"><input type="checkbox" id="online">
        <span>Online Mode<br><span class="hint" id="online-hint">${escapeHtml(onlineHint)}</span>
        <span class="hint status" id="online-status" hidden></span></span></label>
    </div>
    ${spec.fields.map(renderField).join('')}
    <fieldset>
      <legend>Actions</legend>
      <label class="check"><input type="checkbox" id="useApi" checked>
        <span>Use AAP API<br><span class="hint">Create the ${noun} now on the connected platform.</span></span></label>
      <label class="check"><input type="checkbox" id="generatePlaybook">
        <span>Generate Playbook<br><span class="hint">Open an infra.aap_configuration playbook that creates this ${noun}. No login needed.</span></span></label>
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

  function submitLabel() {
    if (useApi.checked && generatePlaybook.checked) return 'Create & generate playbook';
    if (generatePlaybook.checked) return 'Generate playbook';
    return 'Create ' + config.noun;
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
    vscode.postMessage({ type: 'submit', values, useApi: useApi.checked, generatePlaybook: generatePlaybook.checked });
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
      case 'done': {
        busy = false;
        updateSubmit();
        const noun = config.noun.charAt(0).toUpperCase() + config.noun.slice(1);
        const done = [];
        if (msg.created) done.push(noun + ' "' + msg.name + '" created (id ' + msg.created.id + ').');
        if (msg.playbook) done.push('Playbook for "' + msg.name + '" opened in the editor.');
        if (msg.error) {
          const inline = showFieldErrors(msg.error.fieldErrors);
          const problem = inline ? 'Please fix the errors below.' : msg.error.message;
          showBanner('error', done.concat(problem).join(' '));
        } else {
          for (const id of fieldIds) writeValue(id, config.defaults[id]);
          applyConditions();
          if (online) requestOptions(lookupIds.filter((id) => config.lookups[id].dependsOn.length), false);
          showBanner('success', done.join(' '));
          firstField.focus();
        }
        break;
      }
    }
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
    if (enabled) requestOptions(lookupIds);
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
  updateSubmit();
  vscode.postMessage({ type: 'ready' });
  firstField.focus();
</script>
</body>
</html>`;
}
