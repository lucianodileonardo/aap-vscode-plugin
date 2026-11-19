import { RoleDefinitionInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/**
 * Builds a playbook that creates the custom role. AAP 2.5 keeps custom roles in automation
 * controller (infra.aap_configuration.controller_role_definitions); 2.6 and later in the platform
 * gateway (gateway_role_definitions). Without a session the gateway role is used.
 */
export function roleDefinitionPlaybook(
  role: RoleDefinitionInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const controller = session?.version === '2.5';
  const variable = controller ? 'controller_role_definitions' : 'gateway_role_definitions';
  const target = playbookTarget('role', role.name, existing);
  const notes = [...target.notes];
  if (!session) {
    notes.push('Written for AAP 2.6+ (gateway_role_definitions). On AAP 2.5 use the', 'controller_role_definitions role and variable instead.');
  }
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes,
    playName: 'Create AAP role',
    role: variable,
    data: toYaml({
      [variable]: [
        {
          ...target.nameKeys,
          description: role.description ?? '',
          content_type: role.contentType,
          permissions: role.permissions,
          state: 'present',
        },
      ],
    }),
    session,
    verifyTls,
  });
}
