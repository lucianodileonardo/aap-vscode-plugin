import { CREDENTIAL_TYPE_KINDS, CredentialTypeInput } from '../aapClient';
import { credentialTypePlaybook } from '../playbooks/credentialType';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { text, yamlText } from './existing';
import { parseMapping } from './parse';

const INPUTS_EXAMPLE = `fields:
  - id: api_token
    type: string
    label: API Token
    secret: true
required:
  - api_token`;

const INJECTORS_EXAMPLE = `env:
  MY_API_TOKEN: '{{ api_token }}'`;

export const credentialTypeForm: ResourceFormSpec<CredentialTypeInput> = {
  viewType: 'aap.createCredentialType',
  noun: 'credential type',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'kind',
      label: 'Kind',
      type: 'select',
      defaultValue: 'cloud',
      options: CREDENTIAL_TYPE_KINDS.map((kind) => ({ value: kind, label: kind })),
      hint: 'Custom credential types can only be "cloud" or "net".',
    },
    {
      id: 'inputs',
      label: 'Input configuration',
      type: 'code',
      hint: 'YAML or JSON. The fields users fill in when creating a credential of this type.',
      placeholder: INPUTS_EXAMPLE,
    },
    {
      id: 'injectors',
      label: 'Injector configuration',
      type: 'code',
      hint: 'YAML or JSON. How the input values are passed to jobs (env, extra_vars, file).',
      placeholder: INJECTORS_EXAMPLE,
    },
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const name = values.name.trim();
    if (!name) {
      fieldErrors.name = ['This field is required.'];
    }
    const kind = values.kind as CredentialTypeInput['kind'];
    if (!CREDENTIAL_TYPE_KINDS.includes(kind)) {
      fieldErrors.kind = [`Must be one of: ${CREDENTIAL_TYPE_KINDS.join(', ')}.`];
    }
    const inputs = parseMapping(values.inputs, 'inputs', fieldErrors);
    const injectors = parseMapping(values.injectors, 'injectors', fieldErrors);
    if (Object.keys(fieldErrors).length || !inputs || !injectors) {
      return { fieldErrors };
    }
    return { value: { name, description: values.description.trim(), kind, inputs, injectors } };
  },
  create: (client, credentialType) => client.createCredentialType(credentialType),
  playbook: credentialTypePlaybook,
  existing: {
    endpoint: 'api/controller/v2/credential_types/',
    // Built-in (managed) credential types cannot be changed.
    query: 'managed=false',
    async read(client, id) {
      const type = await client.get<Record<string, unknown>>(`api/controller/v2/credential_types/${id}/`);
      return {
        values: {
          name: text(type.name),
          description: text(type.description),
          kind: text(type.kind),
          inputs: yamlText(type.inputs),
          injectors: yamlText(type.injectors),
        },
      };
    },
    update: (client, existing, credentialType) => client.updateCredentialType(existing.id, credentialType),
  },
};
