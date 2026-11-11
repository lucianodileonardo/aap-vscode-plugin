import { CredentialInput } from '../aapClient';
import { AapSession } from '../auth';
import { VaultedString, vaultEncrypt } from '../vault';
import { VaultSecret } from '../vaultPassword';
import { configurationPlaybook, toYaml } from './yaml';

/**
 * Builds a playbook that creates the credential with infra.aap_configuration.controller_credentials.
 * Every string input value is encrypted with Ansible Vault; non-string values (booleans, numbers)
 * stay plain so they keep their type.
 */
export function credentialPlaybook(
  credential: CredentialInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  vault: VaultSecret,
): string {
  const inputs = Object.fromEntries(
    Object.entries(credential.inputs).map(([key, value]) => [
      key,
      typeof value === 'string' ? new VaultedString(vaultEncrypt(value, vault.password, vault.vaultId)) : value,
    ]),
  );
  return configurationPlaybook({
    title: `Creates the "${credential.name}" credential in Ansible Automation Platform.`,
    playName: 'Create AAP credential',
    role: 'controller_credentials',
    data: toYaml({
      // Keeps the role from printing credential data in task output.
      controller_configuration_credentials_secure_logging: true,
      controller_credentials: [
        {
          name: credential.name,
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
