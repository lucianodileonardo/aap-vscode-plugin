import { OrganizationInput } from '../aapClient';
import { organizationPlaybook } from '../playbooks/organization';
import { ResourceFormSpec } from '../views/resourceFormPanel';
import { parseList } from './parse';
import { credentialLookup, executionEnvironmentLookup, instanceGroupsLookup } from './lookups';

export const organizationForm: ResourceFormSpec<OrganizationInput> = {
  viewType: 'aap.createOrganization',
  noun: 'organization',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'galaxy_credentials',
      label: 'Galaxy credentials',
      type: 'textarea',
      hint: '"Ansible Galaxy/Automation Hub API Token" credentials, one per line, in the order collections are searched.',
      placeholder: 'Automation Hub\nAnsible Galaxy',
      lookup: credentialLookup(['galaxy_api_token'], true),
    },
    {
      id: 'default_environment',
      label: 'Default execution environment',
      type: 'text',
      hint: 'Optional. Used by the organization\'s jobs when the template and project set none.',
      lookup: executionEnvironmentLookup,
    },
    {
      id: 'instance_groups',
      label: 'Instance groups',
      type: 'textarea',
      hint: 'Optional. Instance group names in order of preference, one per line.',
      lookup: instanceGroupsLookup,
    },
  ],
  parse(values) {
    const name = values.name.trim();
    if (!name) {
      return { fieldErrors: { name: ['This field is required.'] } };
    }
    return {
      value: {
        name,
        description: values.description.trim(),
        galaxyCredentials: parseList(values.galaxy_credentials),
        defaultEnvironment: values.default_environment.trim(),
        instanceGroups: parseList(values.instance_groups),
      },
    };
  },
  create: (client, org) => client.createOrganization(org),
  playbook: organizationPlaybook,
  existing: {
    endpoint: 'api/gateway/v1/organizations/',
    async read(client, id) {
      const org = await client.get<{ name: string; description: string }>(`api/gateway/v1/organizations/${id}/`);
      // Galaxy credentials, execution environment and instance groups live on the controller copy.
      const settings = await client.organizationSettings(org.name);
      const original = {
        galaxyCredentials: settings.galaxyCredentials.join('\n'),
        defaultEnvironment: settings.defaultEnvironment,
        instanceGroups: settings.instanceGroups.join('\n'),
      };
      return {
        values: {
          name: org.name,
          description: org.description ?? '',
          galaxy_credentials: original.galaxyCredentials,
          default_environment: original.defaultEnvironment,
          instance_groups: original.instanceGroups,
        },
        extra: original,
      };
    },
    update: (client, existing, org) => client.updateOrganization(existing.id, org),
  },
};
