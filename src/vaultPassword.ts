import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeVaultPassword } from './vault';

export interface VaultSecret {
  password: string;
  /** Vault ID label written into the vault header; "" for none. */
  vaultId: string;
}

/**
 * Returns the vault password to encrypt generated playbook data with: read from
 * `aap.vaultPasswordFile` when set, otherwise asked for (twice, to catch typos).
 * Resolves to undefined when the user cancels the prompt.
 */
export async function getVaultSecret(): Promise<VaultSecret | undefined> {
  const config = vscode.workspace.getConfiguration('aap');
  const vaultId = config.get<string>('vaultId', '').trim();
  const passwordFile = config.get<string>('vaultPasswordFile', '').trim();
  if (passwordFile) {
    const file = resolvePath(passwordFile);
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch (err) {
      throw new Error(`Cannot read vault password file ${file} (setting "aap.vaultPasswordFile"): ${(err as Error).message}`);
    }
    const password = normalizeVaultPassword(content);
    if (!password) {
      throw new Error(`Vault password file ${file} is empty.`);
    }
    return { password, vaultId };
  }

  const label = vaultId ? ` (vault ID "${vaultId}")` : '';
  const password = await vscode.window.showInputBox({
    title: `Vault password${label}`,
    prompt: 'Password used to encrypt the values in the generated playbook with Ansible Vault',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (normalizeVaultPassword(value) ? undefined : 'Password is required'),
  });
  if (password === undefined) {
    return undefined;
  }
  const confirmation = await vscode.window.showInputBox({
    title: `Confirm vault password${label}`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value === password ? undefined : 'Passwords do not match'),
  });
  if (confirmation === undefined) {
    return undefined;
  }
  return { password: normalizeVaultPassword(password), vaultId };
}

/** Expands "~" and resolves relative paths against the first workspace folder. */
function resolvePath(file: string): string {
  const expanded = file === '~' || file.startsWith('~/') ? path.join(os.homedir(), file.slice(1)) : file;
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? path.join(folder.uri.fsPath, expanded) : path.resolve(expanded);
}
