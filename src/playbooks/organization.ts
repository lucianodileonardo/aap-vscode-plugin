import { OrganizationInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, toYaml } from './yaml';

/** Builds a playbook that creates the organization with infra.aap_configuration.gateway_organizations. */
export function organizationPlaybook(
  org: OrganizationInput,
  session: AapSession | undefined,
  verifyTls: boolean,
): string {
  return configurationPlaybook({
    title: `Creates the "${org.name}" organization in Ansible Automation Platform.`,
    playName: 'Create AAP organization',
    role: 'gateway_organizations',
    data: toYaml({
      aap_organizations: [{ name: org.name, description: org.description ?? '', state: 'present' }],
    }),
    session,
    verifyTls,
  });
}
