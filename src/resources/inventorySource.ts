import { INVENTORY_SOURCE_TYPES, InventorySourceInput, InventorySourceType } from '../aapClient';
import { inventorySourcePlaybook } from '../playbooks/inventorySource';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import {
  executionEnvironmentLookup,
  inventoryFileLookup,
  inventorySourceCredentialLookup,
  projectLookup,
  regularInventoryLookup,
} from './lookups';
import { text, variablesText } from './existing';
import { parseInteger, parseMapping } from './parse';

const SOURCE_LABELS: Record<InventorySourceType, string> = {
  scm: 'Sourced from a Project',
  ec2: 'Amazon EC2',
  gce: 'Google Compute Engine',
  azure_rm: 'Microsoft Azure Resource Manager',
  vmware: 'VMware vCenter',
  satellite6: 'Red Hat Satellite 6',
  openstack: 'OpenStack',
  rhv: 'Red Hat Virtualization',
  controller: 'Red Hat Ansible Automation Platform',
  insights: 'Red Hat Insights',
  terraform: 'Terraform State',
  openshift_virtualization: 'OpenShift Virtualization',
};

const SOURCE_VARS_EXAMPLE = 'regions:\n  - eu-west-1\nfilters:\n  instance-state-name: running\nkeyed_groups:\n  - key: tags.Role\n    prefix: role';

export const inventorySourceForm: ResourceFormSpec<InventorySourceInput> = {
  viewType: 'aap.createInventorySource',
  noun: 'inventory source',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'inventory',
      label: 'Inventory',
      type: 'text',
      required: true,
      hint: 'Name of the (regular) inventory the source fills with hosts and groups.',
      lookup: regularInventoryLookup,
    },
    {
      id: 'source',
      label: 'Source',
      type: 'select',
      defaultValue: 'scm',
      options: INVENTORY_SOURCE_TYPES.map((value) => ({ value, label: SOURCE_LABELS[value] })),
    },
    {
      id: 'source_project',
      label: 'Project',
      type: 'text',
      required: true,
      hint: 'Project that holds the inventory file.',
      showWhen: { field: 'source', values: ['scm'] },
      lookup: projectLookup,
    },
    {
      id: 'source_path',
      label: 'Inventory file',
      type: 'text',
      required: true,
      placeholder: 'inventories/prod/hosts.yml',
      hint: 'Path of the inventory file or directory inside the project.',
      showWhen: { field: 'source', values: ['scm'] },
      lookup: inventoryFileLookup,
    },
    {
      id: 'scm_branch',
      label: 'Source control branch',
      type: 'text',
      hint: 'Only if the project allows branch override. Leave empty for the project\'s branch.',
      showWhen: { field: 'source', values: ['scm'] },
    },
    {
      id: 'credential',
      label: 'Credential',
      type: 'text',
      hint: 'Credential name for the source (e.g. an Amazon Web Services credential for EC2). Most cloud sources need one; for a project source it is optional.',
      lookup: inventorySourceCredentialLookup,
    },
    {
      id: 'execution_environment',
      label: 'Execution environment',
      type: 'text',
      hint: 'Execution environment name. Leave empty for the default.',
      lookup: executionEnvironmentLookup,
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
    },
    {
      id: 'host_filter',
      label: 'Host filter',
      type: 'text',
      hint: 'Regular expression; only matching host names are imported.',
    },
    { id: 'enabled_var', label: 'Enabled variable', type: 'text', placeholder: 'status.power_state', hint: 'Host variable that tells whether a host is enabled.' },
    { id: 'enabled_value', label: 'Enabled value', type: 'text', placeholder: 'powered_on', hint: 'Value of the enabled variable for enabled hosts; other values disable the host.' },
    { id: 'limit', label: 'Limit', type: 'text', hint: 'Host pattern restricting which hosts are imported.' },
    { id: 'overwrite', label: 'Overwrite', type: 'checkbox', hint: 'Remove hosts and groups no longer in the source.' },
    { id: 'overwrite_vars', label: 'Overwrite variables', type: 'checkbox', hint: 'Replace host and group variables with the source\'s instead of merging them.' },
    { id: 'update_on_launch', label: 'Update on launch', type: 'checkbox', hint: 'Sync the source before every job that uses the inventory.' },
    {
      id: 'update_cache_timeout',
      label: 'Cache timeout (seconds)',
      type: 'number',
      min: 0,
      defaultValue: '0',
      hint: 'With "Update on launch": how long a sync is reused. 0 syncs every time.',
      showWhen: { field: 'update_on_launch', values: ['true'] },
    },
    { id: 'timeout', label: 'Timeout (seconds)', type: 'number', min: 0, defaultValue: '0', hint: 'Cancel a sync after this long. 0 means no timeout.' },
    {
      id: 'source_vars',
      label: 'Source variables',
      type: 'code',
      placeholder: SOURCE_VARS_EXAMPLE,
      hint: 'Options of the source\'s inventory plugin as YAML or JSON (e.g. regions, filters, keyed_groups).',
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
    const source = values.source as InventorySourceType;
    if (!INVENTORY_SOURCE_TYPES.includes(source)) {
      fieldErrors.source = ['Unknown source.'];
    }
    const scm = source === 'scm';
    const updateOnLaunch = values.update_on_launch === 'true';
    const sourceVarsText = values.source_vars.trim() ? values.source_vars.replace(/\s+$/, '') + '\n' : '';
    const inventorySource: InventorySourceInput = {
      name: required('name'),
      description: values.description.trim(),
      inventory: required('inventory'),
      source,
      // Hidden fields keep whatever was typed before switching source; only the visible ones count.
      sourceProject: scm ? required('source_project') : '',
      sourcePath: scm ? required('source_path') : '',
      scmBranch: scm ? values.scm_branch.trim() : '',
      credential: values.credential.trim(),
      executionEnvironment: values.execution_environment.trim(),
      sourceVarsText,
      sourceVars: parseMapping(sourceVarsText, 'source_vars', fieldErrors) ?? {},
      verbosity: parseInteger(values.verbosity, 'verbosity', fieldErrors, { min: 0, max: 2, fallback: 1 }),
      hostFilter: values.host_filter.trim(),
      enabledVar: values.enabled_var.trim(),
      enabledValue: values.enabled_value.trim(),
      limit: values.limit.trim(),
      overwrite: values.overwrite === 'true',
      overwriteVars: values.overwrite_vars === 'true',
      updateOnLaunch,
      updateCacheTimeout: updateOnLaunch ? parseInteger(values.update_cache_timeout, 'update_cache_timeout', fieldErrors, { min: 0 }) : 0,
      timeout: parseInteger(values.timeout, 'timeout', fieldErrors, { min: 0 }),
    };
    return Object.keys(fieldErrors).length ? { fieldErrors } : { value: inventorySource };
  },
  create: (client, inventorySource) => client.createInventorySource(inventorySource),
  playbook: inventorySourcePlaybook,
  existing: {
    endpoint: 'api/controller/v2/inventory_sources/',
    // The sources AAP creates for constructed inventories are edited with the inventory.
    query: 'not__source=constructed',
    organizationFilter: 'inventory__organization',
    async read(client, id) {
      const source = await client.get<Record<string, unknown>>(`api/controller/v2/inventory_sources/${id}/`);
      const [inventory, sourceProject, credential, executionEnvironment] = await Promise.all([
        client.controllerName('inventories', source.inventory as number | null),
        client.controllerName('projects', source.source_project as number | null),
        client.controllerName('credentials', source.credential as number | null),
        client.controllerName('execution_environments', source.execution_environment as number | null),
      ]);
      const values: Record<string, string> = {
        inventory,
        source_project: sourceProject,
        credential,
        execution_environment: executionEnvironment,
        source_vars: variablesText(source.source_vars),
      };
      for (const key of [
        'name', 'description', 'source', 'source_path', 'scm_branch', 'verbosity', 'host_filter', 'enabled_var', 'enabled_value', 'limit',
        'overwrite', 'overwrite_vars', 'update_on_launch', 'update_cache_timeout', 'timeout',
      ]) {
        values[key] = text(source[key]);
      }
      return { values };
    },
    update: (client, existing, inventorySource) => client.updateInventorySource(existing.id, inventorySource),
  },
};
