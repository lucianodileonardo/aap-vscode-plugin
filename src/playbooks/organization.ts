import { OrganizationInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, PlaybookRole, playbookTarget, toYaml } from './yaml';

/** Variable holding the controller settings, passed to controller_organizations as its aap_organizations. */
const SETTINGS_VAR = 'aap_organization_controller_settings';

/**
 * Builds a playbook that creates the organization with infra.aap_configuration.gateway_organizations,
 * then sets its galaxy credentials, default execution environment and instance groups with
 * controller_organizations (which on AAP 2.5+ only changes organizations the gateway created).
 */
export function organizationPlaybook(
  org: OrganizationInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string; extra?: Record<string, string> },
): string {
  const target = playbookTarget('organization', org.name, existing);
  const notes = [...target.notes];
  const hasSettings = org.galaxyCredentials.length > 0 || !!org.defaultEnvironment || org.instanceGroups.length > 0;
  const data: Record<string, unknown> = {
    aap_organizations: [{ ...target.nameKeys, description: org.description ?? '', state: 'present' }],
  };
  const roles: PlaybookRole[] = ['gateway_organizations'];
  if (hasSettings) {
    // A separate list under the final name: after a rename by gateway_organizations, controller
    // already knows the organization by its new name, so name/new_name must not reach it.
    data[SETTINGS_VAR] = [
      {
        name: org.name,
        ...(org.galaxyCredentials.length ? { galaxy_credentials: org.galaxyCredentials } : {}),
        ...(org.defaultEnvironment ? { default_environment: org.defaultEnvironment } : {}),
        ...(org.instanceGroups.length ? { instance_groups: org.instanceGroups } : {}),
        state: 'present',
      },
    ];
    roles.push({ name: 'controller_organizations', vars: { aap_organizations: `"{{ ${SETTINGS_VAR} }}"` } });
    if (notes.length) notes.push('');
    notes.push(
      'controller_organizations sets the galaxy credentials, default execution environment and',
      'instance groups once the gateway has synced the organization to automation controller.',
    );
  }
  // The role only adds what is listed: settings removed in the form stay in AAP.
  const before = existing?.extra;
  const removed = before
    ? [
        ...lines(before.galaxyCredentials).filter((name) => !org.galaxyCredentials.includes(name)).map((name) => `galaxy credential "${name}"`),
        ...(before.defaultEnvironment && !org.defaultEnvironment ? [`default execution environment "${before.defaultEnvironment}"`] : []),
        ...lines(before.instanceGroups).filter((name) => !org.instanceGroups.includes(name)).map((name) => `instance group "${name}"`),
      ]
    : [];
  if (removed.length) {
    if (notes.length) notes.push('');
    notes.push('The playbook does not remove settings that are left out; remove these in AAP:', ...removed.map((item) => `  - ${item}`));
  }
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes,
    playName: 'Create AAP organization',
    role: roles,
    data: toYaml(data),
    session,
    verifyTls,
  });
}

function lines(text: string | undefined): string[] {
  return text ? text.split('\n').filter(Boolean) : [];
}
