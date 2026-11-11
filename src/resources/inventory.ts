import { INVENTORY_KINDS, InventoryInput, InventoryKind } from '../aapClient';
import { inventoryPlaybook } from '../playbooks/inventory';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { inputInventoriesLookup, instanceGroupsLookup, organizationLookup } from './lookups';
import { parseInteger, parseList, parseMapping } from './parse';

const CONSTRUCTED_EXAMPLE = `plugin: ansible.builtin.constructed
strict: false
groups:
  webservers: "'web' in group_names"
keyed_groups:
  - key: ansible_distribution
    prefix: os`;

const when = (values: InventoryKind[]) => ({ field: 'kind', values: values as string[] });

/** Trims trailing blank space and ends non-empty YAML text with one newline. */
const yamlText = (text: string) => (text.trim() ? text.replace(/\s+$/, '') + '\n' : '');

export const inventoryForm: ResourceFormSpec<InventoryInput> = {
  viewType: 'aap.createInventory',
  noun: 'inventory',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'organization',
      label: 'Organization',
      type: 'text',
      required: true,
      hint: 'Name of the organization that owns the inventory.',
      lookup: organizationLookup,
    },
    {
      id: 'kind',
      label: 'Inventory type',
      type: 'select',
      defaultValue: '',
      options: [
        { value: '', label: 'Inventory' },
        { value: 'smart', label: 'Smart inventory' },
        { value: 'constructed', label: 'Constructed inventory' },
      ],
    },
    {
      id: 'host_filter',
      label: 'Smart host filter',
      type: 'text',
      required: true,
      placeholder: 'name__icontains=web',
      hint: 'Selects hosts from all inventories of the organization, e.g. name__startswith=db or groups__name=prod.',
      showWhen: when(['smart']),
    },
    {
      id: 'input_inventories',
      label: 'Input inventories',
      type: 'textarea',
      required: true,
      placeholder: 'RHEL hosts\nWindows hosts',
      hint: 'Inventory names, one per line. The order matters: later inventories override variables of earlier ones.',
      showWhen: when(['constructed']),
      lookup: inputInventoriesLookup,
    },
    {
      id: 'source_vars',
      label: 'Source vars',
      type: 'code',
      placeholder: CONSTRUCTED_EXAMPLE,
      hint: 'Configuration of the ansible.builtin.constructed plugin (groups, keyed_groups, compose...) as YAML or JSON.',
      showWhen: when(['constructed']),
    },
    {
      id: 'limit',
      label: 'Limit',
      type: 'text',
      hint: 'Host pattern restricting which hosts of the input inventories are included.',
      showWhen: when(['constructed']),
    },
    {
      id: 'update_cache_timeout',
      label: 'Cache timeout (seconds)',
      type: 'number',
      min: 0,
      defaultValue: '0',
      hint: 'How long an update is reused before jobs update the inventory again. 0 updates every time.',
      showWhen: when(['constructed']),
    },
    {
      id: 'verbosity',
      label: 'Verbosity',
      type: 'select',
      defaultValue: '1',
      options: [
        { value: '0', label: '0 (Warning)' },
        { value: '1', label: '1 (Info)' },
        { value: '2', label: '2 (Debug)' },
      ],
      showWhen: when(['constructed']),
    },
    {
      id: 'instance_groups',
      label: 'Instance groups',
      type: 'textarea',
      hint: 'Instance group names in order of preference, one per line. Leave empty to use the organization\'s.',
      lookup: instanceGroupsLookup,
    },
    {
      id: 'prevent_instance_group_fallback',
      label: 'Prevent instance group fallback',
      type: 'checkbox',
      hint: 'Jobs using this inventory run only on its instance groups, never on the organization\'s.',
    },
    {
      id: 'variables',
      label: 'Variables',
      type: 'code',
      placeholder: 'ansible_user: deploy\nntp_server: ntp.example.com',
      hint: 'Inventory variables as YAML or JSON.',
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
    const kind = values.kind as InventoryKind;
    if (!INVENTORY_KINDS.includes(kind)) {
      fieldErrors.kind = ['Unknown inventory type.'];
    }
    const constructed = kind === 'constructed';
    const inputInventories = constructed ? parseList(values.input_inventories) : [];
    if (constructed && !inputInventories.length) {
      fieldErrors.input_inventories = ['A constructed inventory needs at least one input inventory.'];
    }
    // Hidden fields keep whatever was typed before switching type; only the visible ones count.
    const sourceVarsText = constructed ? yamlText(values.source_vars) : '';
    const variablesText = yamlText(values.variables);
    const inventory: InventoryInput = {
      name: required('name'),
      description: values.description.trim(),
      organization: required('organization'),
      kind,
      hostFilter: kind === 'smart' ? required('host_filter') : '',
      inputInventories,
      sourceVarsText,
      sourceVars: parseMapping(sourceVarsText, 'source_vars', fieldErrors) ?? {},
      limit: constructed ? values.limit.trim() : '',
      updateCacheTimeout: constructed ? parseInteger(values.update_cache_timeout, 'update_cache_timeout', fieldErrors, { min: 0 }) : 0,
      verbosity: constructed ? parseInteger(values.verbosity, 'verbosity', fieldErrors, { min: 0, max: 2, fallback: 1 }) : 1,
      instanceGroups: parseList(values.instance_groups),
      preventInstanceGroupFallback: values.prevent_instance_group_fallback === 'true',
      variablesText,
      variables: parseMapping(variablesText, 'variables', fieldErrors) ?? {},
    };
    return Object.keys(fieldErrors).length ? { fieldErrors } : { value: inventory };
  },
  create: (client, inventory) => client.createInventory(inventory),
  playbook: inventoryPlaybook,
};
