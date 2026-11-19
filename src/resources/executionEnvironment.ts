import { EE_PULL_OPTIONS, EePull, ExecutionEnvironmentInput } from '../aapClient';
import { executionEnvironmentPlaybook } from '../playbooks/executionEnvironment';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { text } from './existing';
import { credentialLookup, organizationLookup } from './lookups';

const PULL_LABELS: Record<EePull, string> = {
  '': 'Default (platform setting)',
  always: 'Always pull container before running',
  missing: 'Only pull the image if not present before running',
  never: 'Never pull container before running',
};

export const executionEnvironmentForm: ResourceFormSpec<ExecutionEnvironmentInput> = {
  viewType: 'aap.createExecutionEnvironment',
  noun: 'execution environment',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'image',
      label: 'Image',
      type: 'text',
      required: true,
      placeholder: 'registry.redhat.io/ansible-automation-platform-25/ee-supported-rhel9:latest',
      hint: 'Full image location, including the container registry, image name and version tag.',
    },
    {
      id: 'pull',
      label: 'Pull',
      type: 'select',
      defaultValue: '',
      options: EE_PULL_OPTIONS.map((value) => ({ value, label: PULL_LABELS[value] })),
    },
    {
      id: 'organization',
      label: 'Organization',
      type: 'text',
      hint: 'Leave empty for a global execution environment, available to all organizations (needs a superuser).',
      lookup: organizationLookup,
    },
    {
      id: 'credential',
      label: 'Registry credential',
      type: 'text',
      hint: 'A "Container Registry" credential, needed when the registry requires a login.',
      lookup: credentialLookup(['registry']),
    },
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const name = values.name.trim();
    if (!name) {
      fieldErrors.name = ['This field is required.'];
    }
    const image = values.image.trim();
    if (!image) {
      fieldErrors.image = ['This field is required.'];
    } else if (/\s/.test(image)) {
      fieldErrors.image = ['An image location cannot contain spaces.'];
    }
    const pull = values.pull as EePull;
    if (!EE_PULL_OPTIONS.includes(pull)) {
      fieldErrors.pull = ['Choose one of the listed options.'];
    }
    if (Object.keys(fieldErrors).length) {
      return { fieldErrors };
    }
    return {
      value: {
        name,
        description: values.description.trim(),
        image,
        pull,
        organization: values.organization.trim(),
        credential: values.credential.trim(),
      },
    };
  },
  create: (client, ee) => client.createExecutionEnvironment(ee),
  playbook: executionEnvironmentPlaybook,
  existing: {
    endpoint: 'api/controller/v2/execution_environments/',
    // Execution environments shipped with AAP (managed) cannot be changed.
    query: 'managed=false',
    organizationFilter: 'organization',
    async read(client, id) {
      const ee = await client.get<Record<string, unknown>>(`api/controller/v2/execution_environments/${id}/`);
      const [organization, credential] = await Promise.all([
        client.controllerName('organizations', ee.organization as number | null),
        client.controllerName('credentials', ee.credential as number | null),
      ]);
      return {
        values: {
          name: text(ee.name),
          description: text(ee.description),
          image: text(ee.image),
          pull: text(ee.pull),
          organization,
          credential,
        },
      };
    },
    update: (client, existing, ee) => client.updateExecutionEnvironment(existing.id, ee),
  },
};
