import { ExistingObject, InventoryInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Name AAP gives the inventory source it creates for a constructed inventory. */
export const constructedSourceName = (inventory: string) => `Auto-created source for: ${inventory}`;

/**
 * Builds a playbook that creates the inventory with infra.aap_configuration.controller_inventories.
 * For a constructed inventory, the settings of its auto-created source (source vars, limit, cache
 * timeout, verbosity) are then set with controller_inventory_sources.
 */
export function inventoryPlaybook(
  inventory: InventoryInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: ExistingObject,
): string {
  const optional = (key: string, value: unknown, isSet: boolean) => (isSet ? { [key]: value } : {});
  const constructed = inventory.kind === 'constructed';
  const noun = `${constructed ? 'constructed ' : inventory.kind === 'smart' ? 'smart ' : ''}inventory`;
  const target = playbookTarget(noun, inventory.name, existing);
  const item = {
    ...target.nameKeys,
    description: inventory.description,
    organization: inventory.organization,
    ...optional('kind', inventory.kind, inventory.kind !== ''),
    ...optional('host_filter', inventory.hostFilter, inventory.kind === 'smart'),
    ...optional('input_inventories', inventory.inputInventories, constructed),
    ...optional('instance_groups', inventory.instanceGroups, inventory.instanceGroups.length > 0),
    prevent_instance_group_fallback: inventory.preventInstanceGroupFallback,
    ...optional('variables', inventory.variables, Object.keys(inventory.variables).length > 0),
    state: 'present',
  };
  const data: Record<string, unknown> = { controller_inventories: [item] };
  const notes: string[] = [...target.notes];
  if (constructed) {
    data.controller_inventory_sources = [
      {
        // An edited inventory's source keeps the name it has in AAP.
        name: existing?.extra?.sourceName || constructedSourceName(inventory.name),
        inventory: { name: inventory.name, organization: { name: inventory.organization } },
        // The role passes source_vars through a string filter, and the module parses JSON text.
        ...optional('source_vars', JSON.stringify(inventory.sourceVars), Object.keys(inventory.sourceVars).length > 0),
        ...optional('limit', inventory.limit, !!inventory.limit),
        update_cache_timeout: inventory.updateCacheTimeout,
        verbosity: inventory.verbosity,
      },
    ];
    if (notes.length) notes.push('');
    notes.push(
      'AAP creates the source of a constructed inventory itself, named after the inventory;',
      'controller_inventory_sources then sets its source vars, limit, cache timeout and verbosity.',
    );
  }
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    playName: 'Create AAP inventory',
    role: constructed ? ['controller_inventories', 'controller_inventory_sources'] : 'controller_inventories',
    data: toYaml(data),
    session,
    verifyTls,
    ...(notes.length ? { notes } : {}),
  });
}
