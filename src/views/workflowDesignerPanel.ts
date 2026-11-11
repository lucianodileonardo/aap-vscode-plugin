import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AapClient } from '../aapClient';
import { AuthManager, errorMessage } from '../auth';
import { hasSecretAnswers, workflowPlaybook } from '../playbooks/workflow';
import { getVaultSecret } from '../vaultPassword';
import {
  SaveProgress,
  WorkflowSaveError,
  launchInfo,
  listCatalog,
  listLookup,
  listWorkflows,
  loadWorkflow,
  saveWorkflow,
  validateWorkflow,
} from '../workflows/aapWorkflows';
import { DesignerWorkflow, LOOKUP_KINDS, LookupKind, NODE_KINDS, NodeKind, WorkflowProblem } from '../workflows/types';
import { FormContext } from './resourceFormPanel';

type FromWebview =
  | { type: 'ready' }
  | { type: 'title'; name: string; dirty: boolean }
  | { type: 'request'; id: number; method: string; params: Record<string, unknown> };

type ToWebview =
  | { type: 'session'; session: { target: string; server: string } | null }
  | { type: 'response'; id: number; result?: unknown; error?: string };

export interface SaveResponse {
  /** Problems found before anything was saved or generated. */
  problems?: WorkflowProblem[];
  playbook?: boolean;
  /** Set when the API save ran, also on failure: what was created, so the designer can retry. */
  progress?: SaveProgress;
  /** The workflow as now stored in AAP, after a successful API save. */
  workflow?: DesignerWorkflow;
  error?: string;
}

/**
 * Visual editor for workflow job templates, working live against AAP like the platform's own
 * workflow visualizer: it loads workflows and the templates nodes can run from AAP, and saves
 * the graph back through the API and/or as an infra.aap_configuration playbook.
 */
export class WorkflowDesignerPanel {
  private static current: WorkflowDesignerPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static async show({ extensionUri, auth, log }: FormContext): Promise<void> {
    if (WorkflowDesignerPanel.current) {
      WorkflowDesignerPanel.current.panel.reveal();
      return;
    }
    // The designer only works connected: ask for the (shared) login up front.
    if (!(await auth.getClient())) {
      void vscode.window.showWarningMessage('The workflow designer needs a login to Ansible Automation Platform.');
      return;
    }
    const media = vscode.Uri.joinPath(extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel('aap.workflowDesigner', 'AAP: Workflow Designer', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media],
    });
    panel.iconPath = vscode.Uri.joinPath(media, 'logo.png');
    WorkflowDesignerPanel.current = new WorkflowDesignerPanel(panel, media, auth, log);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    media: vscode.Uri,
    private readonly auth: AuthManager,
    private readonly log: vscode.LogOutputChannel,
  ) {
    const uri = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
    panel.webview.html = renderHtml({
      nonce: crypto.randomBytes(16).toString('base64'),
      cspSource: panel.webview.cspSource,
      logo: uri('logo.png'),
      script: uri('workflowDesigner.js'),
      style: uri('workflowDesigner.css'),
    });
    panel.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(msg), undefined, this.disposables);
    auth.onDidChangeSession(() => this.postSession(), undefined, this.disposables);
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    if (msg.type === 'ready') {
      this.postSession();
      return;
    }
    if (msg.type === 'title') {
      this.panel.title = `${msg.dirty ? '● ' : ''}AAP Workflow: ${msg.name || 'New workflow'}`;
      return;
    }
    try {
      const result = await this.handle(msg.method, msg.params);
      this.post({ type: 'response', id: msg.id, result });
    } catch (err) {
      this.log.warn(`Workflow designer: ${msg.method} failed: ${errorMessage(err)}`);
      this.post({ type: 'response', id: msg.id, error: errorMessage(err) });
    }
  }

  private async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'login') {
      return !!(await this.auth.login());
    }
    if (method === 'save') {
      return this.save(params.workflow as DesignerWorkflow, !!params.useApi, !!params.generatePlaybook);
    }
    const client = this.requireClient();
    switch (method) {
      case 'listWorkflows':
        return listWorkflows(client);
      case 'loadWorkflow':
        return loadWorkflow(client, Number(params.id));
      case 'catalog':
        return listCatalog(client, nodeKind(params.kind, false));
      case 'lookup': {
        const kind = params.kind as LookupKind;
        if (!LOOKUP_KINDS.includes(kind)) {
          throw new Error(`Unknown list "${kind}".`);
        }
        return listLookup(client, kind);
      }
      case 'launchInfo':
        return launchInfo(client, nodeKind(params.kind, true), Number(params.id));
      default:
        throw new Error(`Unknown request "${method}".`);
    }
  }

  private requireClient(): AapClient {
    const client = this.auth.getClientIfLoggedIn();
    if (!client) {
      throw new Error('Not logged in to Ansible Automation Platform.');
    }
    return client;
  }

  private async save(workflow: DesignerWorkflow, useApi: boolean, generatePlaybook: boolean): Promise<SaveResponse> {
    if (!useApi && !generatePlaybook) {
      return { error: 'Select "Use AAP API", "Generate Playbook" or both.' };
    }
    const checked = validateWorkflow(workflow);
    if ('problems' in checked) {
      return { problems: checked.problems };
    }
    const validated = checked.value;
    const name = workflow.details.name.trim();
    const response: SaveResponse = {};

    if (generatePlaybook) {
      try {
        const vault = hasSecretAnswers(validated) ? await getVaultSecret() : undefined;
        if (hasSecretAnswers(validated) && !vault) {
          return { error: 'Playbook generation cancelled.' };
        }
        const verifyTls = vscode.workspace.getConfiguration('aap').get<boolean>('verifyTls', true);
        const playbook = workflowPlaybook(validated, this.auth.currentSession, verifyTls, vault);
        const language = (await vscode.languages.getLanguages()).includes('ansible') ? 'ansible' : 'yaml';
        const doc = await vscode.workspace.openTextDocument({ language, content: playbook.text });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        this.log.info(`Generated playbook for workflow "${name}".`);
        if (playbook.omittedSecrets.length) {
          void vscode.window.showWarningMessage(
            `AAP does not reveal stored survey passwords; ${playbook.omittedSecrets.length} answer(s) were left out of the playbook (listed in its header).`,
          );
        }
        response.playbook = true;
      } catch (err) {
        this.log.error(`Generating playbook for workflow "${name}" failed: ${errorMessage(err)}`);
        return { error: `Generating playbook failed: ${errorMessage(err)}` };
      }
    }

    if (useApi) {
      const client = await this.auth.getClient();
      if (!client) {
        return { ...response, error: 'Log in to Ansible Automation Platform first.' };
      }
      try {
        response.progress = await saveWorkflow(client, validated);
        this.log.info(`Saved workflow "${name}" (id ${response.progress.workflowId}) on ${client.options.baseUrl}.`);
        response.workflow = await loadWorkflow(client, response.progress.workflowId!);
        void vscode.window.showInformationMessage(`Workflow "${name}" saved.`);
      } catch (err) {
        this.log.error(`Saving workflow "${name}" failed: ${errorMessage(err)}`);
        if (err instanceof WorkflowSaveError) {
          response.progress = err.progress;
        }
        response.error = errorMessage(err);
      }
    }
    return response;
  }

  private postSession(): void {
    const session = this.auth.currentSession;
    this.post({
      type: 'session',
      session: session ? { target: `${session.username} @ ${session.baseUrl} (AAP ${session.version})`, server: session.baseUrl } : null,
    });
  }

  private post(msg: ToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    WorkflowDesignerPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}

function nodeKind(value: unknown, allowApproval: true): NodeKind;
function nodeKind(value: unknown, allowApproval: false): Exclude<NodeKind, 'workflow_approval'>;
function nodeKind(value: unknown, allowApproval: boolean): NodeKind {
  const kind = value as NodeKind;
  if (!NODE_KINDS.includes(kind) || (!allowApproval && kind === 'workflow_approval')) {
    throw new Error(`Unknown node type "${String(value)}".`);
  }
  return kind;
}

function renderHtml({ nonce, cspSource, logo, script, style }: { nonce: string; cspSource: string; logo: string; script: string; style: string }): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Workflow Designer</title>
<link rel="stylesheet" href="${style}">
</head>
<body>
  <header>
    <img class="logo" src="${logo}" alt="" width="44" height="44">
    <div class="title">
      <h1>Workflow Designer <span id="wf-name"></span><span id="dirty" class="dirty" hidden title="Unsaved changes">●</span></h1>
      <div class="target" id="target"></div>
    </div>
  </header>
  <div class="toolbar" role="toolbar" aria-label="Workflow">
    <label class="inline">Workflow
      <select id="wf-select" aria-label="Open a workflow"></select></label>
    <button type="button" id="new" class="secondary" title="Start a new workflow job template">New</button>
    <button type="button" id="reload" class="secondary" title="Discard changes and reload from AAP">Reload</button>
    <span class="sep"></span>
    <button type="button" id="details" class="secondary" title="Workflow job template settings">Details</button>
    <button type="button" id="add-root" class="secondary" title="Add a step that runs at the start">Add step</button>
    <button type="button" id="remove-all" class="secondary danger" title="Remove every node">Remove all</button>
    <span class="spacer"></span>
    <label class="check" title="Save the workflow and its nodes in AAP"><input type="checkbox" id="useApi" checked> Use AAP API</label>
    <label class="check" title="Open an infra.aap_configuration playbook that recreates this workflow"><input type="checkbox" id="generatePlaybook"> Generate Playbook</label>
    <button type="button" id="save">Save</button>
  </div>
  <div class="banner" id="banner" role="status" hidden></div>
  <main>
    <div class="canvas-wrap" id="canvas-wrap">
      <svg id="canvas" tabindex="0" aria-label="Workflow graph">
        <defs>
          <marker id="arrow-success" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow success"/></marker>
          <marker id="arrow-failure" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow failure"/></marker>
          <marker id="arrow-always" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow always"/></marker>
          <marker id="arrow-start" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow start"/></marker>
        </defs>
        <g id="viewport"><g id="edges"></g><g id="nodes"></g></g>
      </svg>
      <div class="zoom" role="group" aria-label="View">
        <button type="button" id="zoom-in" class="icon" title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" id="zoom-out" class="icon" title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" id="fit" class="icon" title="Fit to screen" aria-label="Fit to screen">⤢</button>
        <button type="button" id="layout" class="icon" title="Arrange automatically" aria-label="Arrange automatically">⇶</button>
        <button type="button" id="legend-toggle" class="icon" title="Legend" aria-label="Legend">?</button>
      </div>
      <div class="legend" id="legend" hidden>
        <div class="legend-title">Legend</div>
        <div><span class="badge k-job_template">JT</span> Job template</div>
        <div><span class="badge k-workflow_job_template">WF</span> Workflow job template</div>
        <div><span class="badge k-project">P</span> Project sync</div>
        <div><span class="badge k-inventory_source">I</span> Inventory source sync</div>
        <div><span class="badge k-system_job_template">M</span> Management job</div>
        <div><span class="badge k-workflow_approval">A</span> Approval</div>
        <div><span class="line success"></span> Run on success</div>
        <div><span class="line failure"></span> Run on failure</div>
        <div><span class="line always"></span> Run always</div>
        <div><span class="conv">ALL</span> Runs only when all parents finish as linked</div>
      </div>
      <div class="hint-bar" id="hint-bar" hidden></div>
      <div class="overlay" id="overlay" hidden>
        <div class="overlay-box">
          <p id="overlay-text"></p>
          <button type="button" id="login">Log in</button>
        </div>
      </div>
    </div>
    <aside id="side" aria-live="polite"></aside>
  </main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
