import { AapClient } from '../aapClient';
import { FieldLookup, LookupOption } from '../views/resourceFormPanel';

/** Lookups for form fields that name AAP objects; used in Online Mode. */

interface NamedItem {
  name: string;
  summary_fields?: { organization?: { name: string }; credential_type?: { name: string } };
}

/** Lists a controller endpoint by name; the organization is shown when the item has one. */
function controllerNames(endpoint: string): (client: AapClient) => Promise<LookupOption[]> {
  return async (client) =>
    (await client.listAll<NamedItem>(`api/controller/v2/${endpoint}/?order_by=name`)).map((item) => ({
      value: item.name,
      label: item.summary_fields?.organization ? `${item.name} (${item.summary_fields.organization.name})` : item.name,
    }));
}

export const organizationLookup: FieldLookup = { load: controllerNames('organizations') };
export const credentialTypeLookup: FieldLookup = { load: controllerNames('credential_types') };
export const executionEnvironmentLookup: FieldLookup = { load: controllerNames('execution_environments') };
export const inventoryLookup: FieldLookup = { load: controllerNames('inventories') };
export const projectLookup: FieldLookup = { load: controllerNames('projects') };
export const instanceGroupsLookup: FieldLookup = { load: controllerNames('instance_groups'), multiple: true };

/**
 * Credentials, optionally only of some credential type namespaces (the credential's `kind`, e.g.
 * "scm", "insights", "kubernetes_bearer_token"). Labels show the credential type.
 */
export function credentialLookup(kinds?: string[], multiple = false): FieldLookup {
  return {
    multiple,
    async load(client) {
      const credentials = await client.listAll<NamedItem & { kind: string }>('api/controller/v2/credentials/?order_by=name');
      return credentials
        .filter((credential) => !kinds || kinds.includes(credential.kind))
        .map((credential) => ({
          value: credential.name,
          label: `${credential.name} (${credential.summary_fields?.credential_type?.name ?? credential.kind})`,
        }));
    },
  };
}

/** Instances that can join an instance group (hop nodes cannot run jobs). */
export const instancesLookup: FieldLookup = {
  multiple: true,
  async load(client) {
    const instances = await client.listAll<{ hostname: string; node_type: string }>('api/controller/v2/instances/?order_by=hostname');
    return instances
      .filter((instance) => instance.node_type !== 'hop')
      .map((instance) => ({ value: instance.hostname, label: `${instance.hostname} (${instance.node_type})` }));
  },
};

/** Playbooks of the project chosen in the form's "project" field. */
export const playbookLookup: FieldLookup = {
  dependsOn: ['project'],
  async load(client, values) {
    const project = values.project?.trim();
    return project ? (await client.projectPlaybooks(project)).map((playbook) => ({ value: playbook })) : [];
  },
};

/** Regular inventories only: smart and constructed inventories cannot have inventory sources. */
export const regularInventoryLookup: FieldLookup = {
  async load(client) {
    const inventories = await client.listAll<NamedItem & { kind: string }>('api/controller/v2/inventories/?order_by=name');
    return inventories
      .filter((inventory) => inventory.kind === '')
      .map((inventory) => ({
        value: inventory.name,
        label: inventory.summary_fields?.organization ? `${inventory.name} (${inventory.summary_fields.organization.name})` : inventory.name,
      }));
  },
};

/** Input inventories of a constructed inventory (any inventory but another constructed one), in order. */
export const inputInventoriesLookup: FieldLookup = {
  multiple: true,
  async load(client) {
    const inventories = await client.listAll<NamedItem & { kind: string }>('api/controller/v2/inventories/?order_by=name');
    return inventories
      .filter((inventory) => inventory.kind !== 'constructed')
      .map((inventory) => ({
        value: inventory.name,
        label: `${inventory.name}${inventory.kind === 'smart' ? ' [smart]' : ''}${
          inventory.summary_fields?.organization ? ` (${inventory.summary_fields.organization.name})` : ''
        }`,
      }));
  },
};

/** Credential type namespace (the credential's `kind`) that each inventory source type takes. */
export const INVENTORY_SOURCE_CREDENTIAL_KINDS: Record<string, string> = {
  ec2: 'aws',
  gce: 'gce',
  azure_rm: 'azure_rm',
  vmware: 'vmware',
  satellite6: 'satellite6',
  openstack: 'openstack',
  rhv: 'rhv',
  controller: 'controller',
  insights: 'insights',
  terraform: 'terraform',
  openshift_virtualization: 'kubernetes_bearer_token',
};

/**
 * Credentials for the source chosen in the form's "source" field: the matching cloud credential
 * type, or for a project source any credential of a "cloud" kind type (built-in or custom).
 */
export const inventorySourceCredentialLookup: FieldLookup = {
  dependsOn: ['source'],
  async load(client, values) {
    const source = values.source ?? '';
    const credentials = await client.listAll<NamedItem & { kind: string; credential_type: number }>(
      'api/controller/v2/credentials/?order_by=name',
    );
    let keep: (credential: { kind: string; credential_type: number }) => boolean;
    if (source === 'scm') {
      const cloudTypes = new Set(
        (await client.listAll<{ id: number }>('api/controller/v2/credential_types/?kind=cloud')).map((type) => type.id),
      );
      keep = (credential) => cloudTypes.has(credential.credential_type);
    } else {
      const kind = INVENTORY_SOURCE_CREDENTIAL_KINDS[source];
      // Older controller releases named this credential type namespace "tower".
      keep = (credential) => credential.kind === kind || (kind === 'controller' && credential.kind === 'tower');
    }
    return credentials.filter(keep).map((credential) => ({
      value: credential.name,
      label: `${credential.name} (${credential.summary_fields?.credential_type?.name ?? credential.kind})`,
    }));
  },
};

/** Inventory files of the project chosen in the form's "source_project" field. */
export const inventoryFileLookup: FieldLookup = {
  dependsOn: ['source_project'],
  async load(client, values) {
    const project = values.source_project?.trim();
    return project ? (await client.projectInventoryFiles(project)).map((file) => ({ value: file })) : [];
  },
};
