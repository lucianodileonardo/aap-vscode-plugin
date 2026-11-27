import { TeamInput } from '../aapClient';
import { teamPlaybook } from '../playbooks/team';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { text } from './existing';
import { gatewayOrganizationLookup } from './lookups';

export const teamForm: ResourceFormSpec<TeamInput> = {
  viewType: 'aap.createTeam',
  noun: 'team',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'organization',
      label: 'Organization',
      type: 'text',
      required: true,
      hint: 'Name of the organization the team belongs to.',
      lookup: gatewayOrganizationLookup,
    },
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const name = values.name.trim();
    const organization = values.organization.trim();
    if (!name) fieldErrors.name = ['This field is required.'];
    if (!organization) fieldErrors.organization = ['This field is required.'];
    if (Object.keys(fieldErrors).length) {
      return { fieldErrors };
    }
    return { value: { name, description: values.description.trim(), organization } };
  },
  create: (client, team) => client.createTeam(team),
  playbook: teamPlaybook,
  existing: {
    endpoint: 'api/gateway/v1/teams/',
    async read(client, id) {
      const team = await client.get<Record<string, unknown>>(`api/gateway/v1/teams/${id}/`);
      const organization = (await client.get<{ name: string }>(`api/gateway/v1/organizations/${team.organization}/`)).name;
      return {
        values: { name: text(team.name), description: text(team.description), organization },
        // Teams are found by name within their organization: the playbook needs the original one.
        extra: { organization },
      };
    },
    update: (client, existing, team) => client.updateTeam(existing.id, team),
  },
};
