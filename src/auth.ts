import * as vscode from 'vscode';
import {
  AapClient,
  AapCredentials,
  AapUser,
  SupportedVersion,
  isTlsVerificationError,
  normalizeBaseUrl,
} from './aapClient';

const SECRET_KEY = 'aap.credentials';
const STATE_KEY = 'aap.session';

/** Non-secret connection details, kept in globalState. Credentials live in SecretStorage. */
export interface AapSession {
  baseUrl: string;
  version: SupportedVersion;
  authKind: AapCredentials['kind'];
  username: string;
}

/** Owns the login state and hands out authenticated clients to the rest of the extension. */
export class AuthManager implements vscode.Disposable {
  private session: AapSession | undefined;
  private client: AapClient | undefined;
  private readonly onDidChangeSessionEmitter = new vscode.EventEmitter<AapSession | undefined>();
  readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  get currentSession(): AapSession | undefined {
    return this.session;
  }

  /** Authenticated client for the current session, without prompting. */
  getClientIfLoggedIn(): AapClient | undefined {
    return this.client;
  }

  /** Authenticated client for the current session; prompts for login when there is none. */
  async getClient(): Promise<AapClient | undefined> {
    if (!this.client) {
      await this.login();
    }
    return this.client;
  }

  /** Re-validates stored credentials at startup without prompting. */
  async restore(): Promise<void> {
    const stored = this.context.globalState.get<AapSession>(STATE_KEY);
    const secret = await this.context.secrets.get(SECRET_KEY);
    if (!stored || !secret) {
      return;
    }
    try {
      const credentials = JSON.parse(secret) as AapCredentials;
      const client = new AapClient(clientOptions(stored.baseUrl), credentials);
      const version = await client.detectVersion();
      const user = await client.me();
      this.setSession({ ...stored, version, username: user.username }, client);
      this.log.info(`Restored session for ${user.username} on ${stored.baseUrl} (AAP ${version}).`);
    } catch (err) {
      this.log.warn(`Could not restore AAP session for ${stored.baseUrl}: ${errorMessage(err)}`);
    }
  }

  async login(): Promise<AapSession | undefined> {
    const config = vscode.workspace.getConfiguration('aap');
    const rawUrl = await vscode.window.showInputBox({
      title: 'AAP Login (1/3): Platform URL',
      prompt: 'Platform gateway URL of Ansible Automation Platform 2.5, 2.6 or 2.7',
      placeHolder: 'https://aap.example.com',
      value: this.session?.baseUrl ?? config.get<string>('url') ?? '',
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          normalizeBaseUrl(value);
          return undefined;
        } catch {
          return 'Enter a valid URL';
        }
      },
    });
    if (!rawUrl) {
      return undefined;
    }
    const baseUrl = normalizeBaseUrl(rawUrl);

    const version = await this.withProgress('Contacting Ansible Automation Platform…', () =>
      this.detectVersionWithTlsFallback(baseUrl),
    );
    if (!version) {
      return undefined;
    }

    const credentials = await promptCredentials(this.session?.authKind === 'basic' ? this.session.username : undefined);
    if (!credentials) {
      return undefined;
    }

    const client = new AapClient(clientOptions(baseUrl), credentials);
    let user: AapUser;
    try {
      user = await this.withProgress('Authenticating…', () => client.me());
    } catch (err) {
      this.log.error(`Login to ${baseUrl} failed: ${errorMessage(err)}`);
      const retry = await vscode.window.showErrorMessage(`AAP login failed: ${errorMessage(err)}`, 'Retry');
      return retry ? this.login() : undefined;
    }

    await this.context.secrets.store(SECRET_KEY, JSON.stringify(credentials));
    const session: AapSession = { baseUrl, version, authKind: credentials.kind, username: user.username };
    await this.context.globalState.update(STATE_KEY, session);
    if (config.get<string>('url') !== baseUrl) {
      await config.update('url', baseUrl, vscode.ConfigurationTarget.Global);
    }
    this.setSession(session, client);
    this.log.info(`Logged in as ${user.username} on ${baseUrl} (AAP ${version}, ${credentials.kind} auth).`);
    vscode.window.showInformationMessage(`Logged in to AAP ${version} as ${user.username}.`);
    return session;
  }

  async logout(): Promise<void> {
    const previous = this.session;
    await this.context.secrets.delete(SECRET_KEY);
    await this.context.globalState.update(STATE_KEY, undefined);
    this.setSession(undefined, undefined);
    if (previous) {
      this.log.info(`Logged out of ${previous.baseUrl}.`);
      vscode.window.showInformationMessage('Logged out of Ansible Automation Platform.');
    }
  }

  dispose(): void {
    this.onDidChangeSessionEmitter.dispose();
  }

  private setSession(session: AapSession | undefined, client: AapClient | undefined): void {
    this.session = session;
    this.client = client;
    this.onDidChangeSessionEmitter.fire(session);
  }

  /** Detects the AAP version; on a certificate error, offers to turn off TLS verification and retries. */
  private async detectVersionWithTlsFallback(baseUrl: string): Promise<SupportedVersion | undefined> {
    try {
      return await new AapClient(clientOptions(baseUrl)).detectVersion();
    } catch (err) {
      this.log.error(`Version check for ${baseUrl} failed: ${errorMessage(err)}`);
      if (isTlsVerificationError(err) && clientOptions(baseUrl).verifyTls) {
        const choice = await vscode.window.showWarningMessage(
          `The TLS certificate of ${new URL(baseUrl).host} could not be verified (${errorMessage(err)}).`,
          { modal: true, detail: 'Disable TLS verification (setting "aap.verifyTls")? Only do this for trusted lab servers.' },
          'Disable Verification',
        );
        if (choice) {
          await vscode.workspace.getConfiguration('aap').update('verifyTls', false, vscode.ConfigurationTarget.Global);
          return this.detectVersionWithTlsFallback(baseUrl);
        }
        return undefined;
      }
      vscode.window.showErrorMessage(`AAP login failed: ${errorMessage(err)}`);
      return undefined;
    }
  }

  private withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
  }
}

async function promptCredentials(lastUsername?: string): Promise<AapCredentials | undefined> {
  const method = await vscode.window.showQuickPick(
    [
      { label: '$(person) Username and password', method: 'basic' as const },
      { label: '$(key) API token', detail: 'Personal access token created in AAP (Access Management → Users → Tokens)', method: 'token' as const },
    ],
    { title: 'AAP Login (2/3): Authentication method', ignoreFocusOut: true },
  );
  if (!method) {
    return undefined;
  }

  if (method.method === 'token') {
    const token = await vscode.window.showInputBox({
      title: 'AAP Login (3/3): API token',
      prompt: 'Paste your AAP API token',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Token is required'),
    });
    return token ? { kind: 'token', token: token.trim() } : undefined;
  }

  const username = await vscode.window.showInputBox({
    title: 'AAP Login (3/3): Username',
    value: lastUsername,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Username is required'),
  });
  if (!username) {
    return undefined;
  }
  const password = await vscode.window.showInputBox({
    title: `AAP Login (3/3): Password for ${username.trim()}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value ? undefined : 'Password is required'),
  });
  return password ? { kind: 'basic', username: username.trim(), password } : undefined;
}

function clientOptions(baseUrl: string) {
  const config = vscode.workspace.getConfiguration('aap');
  return {
    baseUrl,
    verifyTls: config.get<boolean>('verifyTls', true),
    timeoutMs: config.get<number>('requestTimeoutSeconds', 30) * 1000,
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
