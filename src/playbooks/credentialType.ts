import { CredentialTypeInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, toYaml } from './yaml';

/** Builds a playbook that creates the credential type with infra.aap_configuration.controller_credential_types. */
export function credentialTypePlaybook(
  credentialType: CredentialTypeInput,
  session: AapSession | undefined,
  verifyTls: boolean,
): string {
  const { name, description, kind, inputs, injectors } = credentialType;
  return configurationPlaybook({
    title: `Creates the "${name}" credential type in Ansible Automation Platform.`,
    playName: 'Create AAP credential type',
    role: 'controller_credential_types',
    data: toYaml({
      controller_credential_types: [
        {
          name,
          description: description ?? '',
          kind,
          // Empty schemas are left out so the role's defaults apply.
          ...(Object.keys(inputs).length ? { inputs } : {}),
          ...(Object.keys(injectors).length ? { injectors } : {}),
          state: 'present',
        },
      ],
    }),
    session,
    verifyTls,
  });
}
