import * as vscode from 'vscode';
import { AapSession, AuthManager } from './auth';
import { credentialForm } from './resources/credential';
import { credentialTypeForm } from './resources/credentialType';
import { containerGroupForm, instanceGroupForm } from './resources/instanceGroup';
import { inventoryForm } from './resources/inventory';
import { inventorySourceForm } from './resources/inventorySource';
import { jobTemplateForm } from './resources/jobTemplate';
import { organizationForm } from './resources/organization';
import { projectForm } from './resources/project';
import { FormContext, ResourceFormPanel, ResourceFormSpec } from './views/resourceFormPanel';
import { WorkflowDesignerPanel } from './views/workflowDesignerPanel';

/** Every "create" form: registered as a command and listed in the status bar menu. */
const FORMS: { command: string; label: string; spec: ResourceFormSpec<{ name: string }> }[] = [
  { command: 'aap.createOrganization', label: '$(organization) Create organization', spec: organizationForm },
  { command: 'aap.createCredentialType', label: '$(key) Create credential type', spec: credentialTypeForm },
  { command: 'aap.createCredential', label: '$(lock) Create credential', spec: credentialForm },
  { command: 'aap.createInstanceGroup', label: '$(server-environment) Create instance group', spec: instanceGroupForm },
  { command: 'aap.createContainerGroup', label: '$(package) Create container group', spec: containerGroupForm },
  { command: 'aap.createProject', label: '$(repo) Create project', spec: projectForm },
  { command: 'aap.createInventory', label: '$(list-tree) Create inventory', spec: inventoryForm },
  { command: 'aap.createInventorySource', label: '$(cloud-download) Create inventory source', spec: inventorySourceForm },
  { command: 'aap.createJobTemplate', label: '$(rocket) Create job template', spec: jobTemplateForm },
];

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Ansible Automation Platform', { log: true });
  const auth = new AuthManager(context, log);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = 'aap.showConnection';
  const renderStatus = (session: AapSession | undefined) => {
    if (session) {
      statusBar.text = `$(server) AAP: ${session.username}`;
      statusBar.tooltip = `${session.baseUrl}\nAAP ${session.version} · ${session.authKind === 'token' ? 'API token' : 'username/password'}`;
    } else {
      statusBar.text = '$(server) AAP: Log in';
      statusBar.tooltip = 'Log in to Ansible Automation Platform';
    }
    vscode.commands.executeCommand('setContext', 'aap.loggedIn', !!session);
  };
  renderStatus(undefined);
  statusBar.show();
  const formContext: FormContext = { extensionUri: context.extensionUri, auth, log };

  context.subscriptions.push(
    log,
    auth,
    statusBar,
    auth.onDidChangeSession(renderStatus),
    vscode.commands.registerCommand('aap.login', () => auth.login()),
    vscode.commands.registerCommand('aap.logout', () => auth.logout()),
    ...FORMS.map(({ command, spec }) => vscode.commands.registerCommand(command, () => ResourceFormPanel.show(spec, formContext))),
    vscode.commands.registerCommand('aap.workflowDesigner', () => WorkflowDesignerPanel.show(formContext)),
    vscode.commands.registerCommand('aap.showConnection', async () => {
      const session = auth.currentSession;
      if (!session) {
        await auth.login();
        return;
      }
      const choice = await vscode.window.showQuickPick(
        [
          ...FORMS.map(({ command, label }) => ({ label, action: command })),
          { label: '$(type-hierarchy) Workflow designer', action: 'aap.workflowDesigner' },
          { label: '', kind: vscode.QuickPickItemKind.Separator, action: '' },
          { label: '$(account) Switch account / server', action: 'login' },
          { label: '$(sign-out) Log out', action: 'logout' },
          { label: '$(output) Show log', action: 'log' },
        ],
        { title: `${session.username} @ ${session.baseUrl} (AAP ${session.version})` },
      );
      const form = FORMS.find(({ command }) => command === choice?.action);
      if (form) {
        ResourceFormPanel.show(form.spec, formContext);
      } else if (choice?.action === 'aap.workflowDesigner') {
        await WorkflowDesignerPanel.show(formContext);
      } else if (choice?.action === 'login') {
        await auth.login();
      } else if (choice?.action === 'logout') {
        await auth.logout();
      } else if (choice?.action === 'log') {
        log.show();
      }
    }),
  );

  // Not awaited: an unreachable server must not hold up activation.
  void auth.restore();
}

export function deactivate(): void {}
