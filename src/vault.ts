import * as crypto from 'crypto';

/** A value encrypted with Ansible Vault; serialized by toYaml as an inline `!vault |` block. */
export class VaultedString {
  constructor(readonly vaultText: string) {}
}

/**
 * Encrypts text the same way `ansible-vault encrypt_string` does (format 1.1, or 1.2 when a
 * vault ID is given): PBKDF2-SHA256 key derivation, AES-256-CTR with PKCS7 padding, HMAC-SHA256.
 */
export function vaultEncrypt(plaintext: string, password: string, vaultId?: string): string {
  const salt = crypto.randomBytes(32);
  const derived = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 10000, 80, 'sha256');
  const key1 = derived.subarray(0, 32);
  const key2 = derived.subarray(32, 64);
  const iv = derived.subarray(64, 80);

  const data = Buffer.from(plaintext, 'utf8');
  const padLength = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(padLength, padLength)]);
  const cipher = crypto.createCipheriv('aes-256-ctr', key1, iv);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const hmac = crypto.createHmac('sha256', key2).update(ciphertext).digest();

  const body = Buffer.from([salt.toString('hex'), hmac.toString('hex'), ciphertext.toString('hex')].join('\n')).toString('hex');
  const header = vaultId && vaultId !== 'default' ? `$ANSIBLE_VAULT;1.2;AES256;${vaultId}` : '$ANSIBLE_VAULT;1.1;AES256';
  const lines = [header];
  for (let i = 0; i < body.length; i += 80) {
    lines.push(body.slice(i, i + 80));
  }
  return lines.join('\n');
}

/** Ansible trims surrounding whitespace from vault passwords; do the same so they match. */
export function normalizeVaultPassword(password: string): string {
  return password.trim();
}
