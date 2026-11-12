import { CredentialInput } from '../aapClient';
import { AapSession } from '../auth';
import { VaultedString, vaultEncrypt } from '../vault';
import { VaultSecret } from '../vaultPassword';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** What AAP returns instead of a stored secret input; sent back, it keeps the stored value. */
export const ENCRYPTED = '$encrypted$';

/**
 * Builds a playbook that creates the credential with infra.aap_configuration.controller_credentials.
 * Every string input value is encrypted with Ansible Vault; non-string values (booleans, numbers)
 * stay plain so they keep their type. "$encrypted$" (a secret AAP did not reveal, in a credential
 * loaded for editing) is written as is: AAP then keeps the stored value.
 */
export function credentialPlaybook(
  credential: CredentialInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  vault: VaultSecret,
  existing?: { name: string },
): string {
  const kept: string[] = [];
  const inputs = Object.fromEntries(
    Object.entries(credential.inputs).map(([key, value]) => {
      if (value === ENCRYPTED) {
        kept.push(key);
        return [key, value];
      }
      return [key, typeof value === 'string' ? new VaultedString(vaultEncrypt(value, vault.password, vault.vaultId)) : value];
    }),
  );
  const target = playbookTarget('credential', credential.name, existing);
  const notes = [...target.notes];
  if (kept.length) {
    if (notes.length) notes.push('');
    notes.push(
      `AAP does not reveal stored secrets; ${kept.join(', ')} ${kept.length === 1 ? 'is' : 'are'} left as "${ENCRYPTED}", which keeps`,
      'the value stored in AAP. Replace it with the real value to recreate the credential elsewhere.',
    );
  }
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes,
    playName: 'Create AAP credential',
    role: 'controller_credentials',
    data: toYaml({
      // Keeps the role from printing credential data in task output.
      controller_configuration_credentials_secure_logging: true,
      controller_credentials: [
        {
          ...target.nameKeys,
          description: credential.description ?? '',
          organization: credential.organization,
          credential_type: credential.credentialType,
          ...(Object.keys(inputs).length ? { inputs } : {}),
          state: 'present',
        },
      ],
    }),
    session,
    verifyTls,
    vaultId: vault.vaultId,
  });
}
