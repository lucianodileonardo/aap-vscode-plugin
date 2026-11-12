import { InventorySourceInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the inventory source with infra.aap_configuration.controller_inventory_sources. */
export function inventorySourcePlaybook(
  source: InventorySourceInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const target = playbookTarget('inventory source', source.name, existing);
  // Optional settings are only written when set, so the playbook mirrors what was entered.
  const optional = (key: string, value: unknown, isSet: boolean) => (isSet ? { [key]: value } : {});
  const item = {
    ...target.nameKeys,
    description: source.description,
    inventory: source.inventory,
    source: source.source,
    ...optional('source_project', source.sourceProject, !!source.sourceProject),
    ...optional('source_path', source.sourcePath, !!source.sourcePath),
    ...optional('scm_branch', source.scmBranch, !!source.scmBranch),
    ...optional('credential', source.credential, !!source.credential),
    ...optional('execution_environment', source.executionEnvironment, !!source.executionEnvironment),
    // The role passes source_vars through a string filter, and the module parses JSON text.
    ...optional('source_vars', JSON.stringify(source.sourceVars), Object.keys(source.sourceVars).length > 0),
    verbosity: source.verbosity,
    ...optional('host_filter', source.hostFilter, !!source.hostFilter),
    ...optional('enabled_var', source.enabledVar, !!source.enabledVar),
    ...optional('enabled_value', source.enabledValue, !!source.enabledValue),
    ...optional('limit', source.limit, !!source.limit),
    overwrite: source.overwrite,
    overwrite_vars: source.overwriteVars,
    update_on_launch: source.updateOnLaunch,
    ...optional('update_cache_timeout', source.updateCacheTimeout, source.updateOnLaunch),
    timeout: source.timeout,
    state: 'present',
  };
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes: target.notes,
    playName: 'Create AAP inventory source',
    role: 'controller_inventory_sources',
    data: toYaml({ controller_inventory_sources: [item] }),
    session,
    verifyTls,
  });
}
