import { OrganizationInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the organization with infra.aap_configuration.gateway_organizations. */
export function organizationPlaybook(
  org: OrganizationInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const target = playbookTarget('organization', org.name, existing);
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes: target.notes,
    playName: 'Create AAP organization',
    role: 'gateway_organizations',
    data: toYaml({
      aap_organizations: [{ ...target.nameKeys, description: org.description ?? '', state: 'present' }],
    }),
    session,
    verifyTls,
  });
}
