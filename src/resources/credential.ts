import { CredentialInput } from '../aapClient';
import { credentialPlaybook } from '../playbooks/credential';
import { getVaultSecret } from '../vaultPassword';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { parseMapping } from './parse';
import { credentialTypeLookup, organizationLookup } from './lookups';

const INPUTS_EXAMPLE = `username: deploy
password: s3cr3t
become_method: sudo`;

export const credentialForm: ResourceFormSpec<CredentialInput> = {
  viewType: 'aap.createCredential',
  noun: 'credential',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'organization',
      label: 'Organization',
      type: 'text',
      required: true,
      hint: 'Name of the organization that owns the credential.',
      lookup: organizationLookup,
    },
    {
      id: 'credential_type',
      label: 'Credential type',
      type: 'text',
      required: true,
      hint: 'Name of the credential type, e.g. "Machine", "Source Control" or a custom type.',
      lookup: credentialTypeLookup,
    },
    {
      id: 'inputs',
      label: 'Inputs',
      type: 'code',
      hint: 'YAML or JSON mapping of the credential type\'s input fields. String values are encrypted with Ansible Vault in the generated playbook.',
      placeholder: INPUTS_EXAMPLE,
    },
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const required = (id: string) => {
      const value = values[id].trim();
      if (!value) {
        fieldErrors[id] = ['This field is required.'];
      }
      return value;
    };
    const name = required('name');
    const organization = required('organization');
    const credentialType = required('credential_type');
    const inputs = parseMapping(values.inputs, 'inputs', fieldErrors);
    const nested = inputs && Object.keys(inputs).filter((key) => typeof inputs[key] === 'object' && inputs[key] !== null);
    if (nested?.length) {
      fieldErrors.inputs = [`Input values must be plain values, not lists or mappings: ${nested.join(', ')}.`];
    }
    if (Object.keys(fieldErrors).length || !inputs) {
      return { fieldErrors };
    }
    return { value: { name, description: values.description.trim(), organization, credentialType, inputs } };
  },
  create: (client, credential) => client.createCredential(credential),
  async playbook(credential, session, verifyTls) {
    const vault = await getVaultSecret();
    return vault && credentialPlaybook(credential, session, verifyTls, vault);
  },
};
