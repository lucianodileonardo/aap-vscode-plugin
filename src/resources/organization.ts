import { OrganizationInput } from '../aapClient';
import { organizationPlaybook } from '../playbooks/organization';
import { ResourceFormSpec } from '../views/resourceFormPanel';

export const organizationForm: ResourceFormSpec<OrganizationInput> = {
  viewType: 'aap.createOrganization',
  noun: 'organization',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
  ],
  parse(values) {
    const name = values.name.trim();
    if (!name) {
      return { fieldErrors: { name: ['This field is required.'] } };
    }
    return { value: { name, description: values.description.trim() } };
  },
  create: (client, org) => client.createOrganization(org),
  playbook: organizationPlaybook,
  existing: {
    endpoint: 'api/gateway/v1/organizations/',
    async read(client, id) {
      const org = await client.get<{ name: string; description: string }>(`api/gateway/v1/organizations/${id}/`);
      return { values: { name: org.name, description: org.description ?? '' } };
    },
    update: (client, existing, org) => client.updateOrganization(existing.id, org),
  },
};
