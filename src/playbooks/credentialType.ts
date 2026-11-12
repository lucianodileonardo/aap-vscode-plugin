import { CredentialTypeInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the credential type with infra.aap_configuration.controller_credential_types. */
export function credentialTypePlaybook(
  credentialType: CredentialTypeInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const { name, description, kind, inputs, injectors } = credentialType;
  const target = playbookTarget('credential type', name, existing);
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes: target.notes,
    playName: 'Create AAP credential type',
    role: 'controller_credential_types',
    data: toYaml({
      controller_credential_types: [
        {
          ...target.nameKeys,
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
