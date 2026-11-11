import { AapSession } from '../auth';
import { VaultedString, vaultEncrypt } from '../vault';
import { VaultSecret } from '../vaultPassword';
import { ValidatedWorkflow } from '../workflows/aapWorkflows';
import { DesignerNode, LINK_TYPES, Ref } from '../workflows/types';
import { configurationPlaybook, toYaml } from './yaml';

/** AAP returns this instead of stored secrets, such as survey password answers. */
const ENCRYPTED = '$encrypted$';

/** Survey password answers the playbook must encrypt (those AAP hides cannot be exported). */
export function hasSecretAnswers({ workflow }: ValidatedWorkflow): boolean {
  return workflow.nodes.some((node) => secretAnswers(node).some(([, value]) => value !== ENCRYPTED));
}

function secretAnswers(node: DesignerNode): [string, unknown][] {
  return Object.entries(node.survey).filter(([variable, value]) => node.passwordVariables?.includes(variable) && value !== '');
}

export interface WorkflowPlaybook {
  text: string;
  /** Survey password answers left out because AAP does not reveal them, as "<node>: <variable>". */
  omittedSecrets: string[];
}

/**
 * Builds a playbook that recreates the workflow with infra.aap_configuration: controller_labels
 * creates the labels it uses, then controller_workflow_job_templates the workflow and its nodes.
 * Survey password answers are encrypted with Ansible Vault (`vault` must be given when there are any).
 */
export function workflowPlaybook(
  validated: ValidatedWorkflow,
  session: AapSession | undefined,
  verifyTls: boolean,
  vault: VaultSecret | undefined,
): WorkflowPlaybook {
  const { workflow, extraVars, extraData } = validated;
  const { details, nodes, links } = workflow;
  const organization = details.organization!.name;
  const set = (key: string, value: unknown, isSet: boolean) => (isSet ? { [key]: value } : {});
  const named = (ref: Ref) => ({ name: ref.name, ...(ref.organization ? { organization: { name: ref.organization } } : {}) });
  const identifierOf = new Map(nodes.map((node) => [node.key, node.identifier]));
  const omittedSecrets: string[] = [];
  let vaulted = false;

  const workflowNodes = nodes.map((node) => {
    const p = node.prompts;
    const data = { ...extraData.get(node.key)! };
    for (const [variable, value] of secretAnswers(node)) {
      if (value === ENCRYPTED) {
        omittedSecrets.push(`${node.identifier}: ${variable}`);
        delete data[variable];
      } else {
        data[variable] = new VaultedString(vaultEncrypt(String(value), vault!.password, vault!.vaultId));
        vaulted = true;
      }
    }
    const related: Record<string, unknown> = {};
    for (const type of LINK_TYPES) {
      const children = links.filter((link) => link.from === node.key && link.type === type);
      if (children.length) {
        related[`${type}_nodes`] = children.map((link) => ({ identifier: identifierOf.get(link.to) }));
      }
    }
    Object.assign(
      related,
      set('credentials', p.credentials?.map(named), !!p.credentials?.length),
      set('labels', p.labels?.map(named), !!p.labels?.length),
      set('instance_groups', p.instanceGroups?.map((group) => ({ name: group.name })), !!p.instanceGroups?.length),
    );
    return {
      identifier: node.identifier,
      unified_job_template: unifiedJobTemplate(node),
      all_parents_must_converge: node.allParentsMustConverge,
      ...set('inventory', p.inventory && named(p.inventory), !!p.inventory),
      ...set('execution_environment', p.executionEnvironment && { name: p.executionEnvironment.name }, !!p.executionEnvironment),
      ...set('scm_branch', p.scmBranch, !!p.scmBranch),
      ...set('job_type', p.jobType, !!p.jobType),
      ...set('job_tags', p.jobTags, !!p.jobTags),
      ...set('skip_tags', p.skipTags, !!p.skipTags),
      ...set('limit', p.limit, !!p.limit),
      ...set('diff_mode', p.diffMode, p.diffMode != null),
      ...set('verbosity', p.verbosity, p.verbosity != null),
      ...set('forks', p.forks, p.forks != null),
      ...set('job_slice_count', p.jobSliceCount, p.jobSliceCount != null),
      ...set('timeout', p.timeout, p.timeout != null),
      ...set('extra_data', data, Object.keys(data).length > 0),
      ...set('related', related, Object.keys(related).length > 0),
    };
  });

  const item = {
    name: details.name.trim(),
    description: details.description,
    organization,
    ...set('inventory', details.inventory?.name, !!details.inventory),
    ...set('limit', details.limit, !!details.limit),
    ...set('scm_branch', details.scmBranch, !!details.scmBranch),
    ...set('labels', details.labels.map((label) => label.name), details.labels.length > 0),
    ...set('job_tags', details.jobTags, !!details.jobTags),
    ...set('skip_tags', details.skipTags, !!details.skipTags),
    ...set('extra_vars', extraVars, Object.keys(extraVars).length > 0),
    ask_inventory_on_launch: details.askInventory,
    ask_limit_on_launch: details.askLimit,
    ask_scm_branch_on_launch: details.askScmBranch,
    ask_labels_on_launch: details.askLabels,
    ask_tags_on_launch: details.askTags,
    ask_skip_tags_on_launch: details.askSkipTags,
    ask_variables_on_launch: details.askVariables,
    allow_simultaneous: details.allowSimultaneous,
    ...set('webhook_service', details.webhookService, !!details.webhookService),
    ...set('webhook_credential', details.webhookCredential?.name, !!details.webhookService && !!details.webhookCredential),
    // The nodes below are the whole graph: existing nodes are replaced rather than merged.
    destroy_current_nodes: true,
    state: 'present',
    workflow_nodes: workflowNodes,
  };

  // Labels must exist before the workflow (or a node) can use them.
  const labels = new Map<string, { name: string; organization: string }>();
  for (const label of details.labels) {
    labels.set(`${label.name}\n${organization}`, { name: label.name, organization });
  }
  for (const label of nodes.flatMap((node) => node.prompts.labels ?? [])) {
    if (label.organization) {
      labels.set(`${label.name}\n${label.organization}`, { name: label.name, organization: label.organization });
    }
  }
  const data = {
    ...set('controller_labels', [...labels.values()], labels.size > 0),
    controller_workflows: [item],
  };
  const notes = [
    `The workflow_nodes list is the complete graph (${nodes.length} node${nodes.length === 1 ? '' : 's'}): with`,
    'destroy_current_nodes the existing nodes of the workflow are deleted and recreated from it.',
  ];
  if (omittedSecrets.length) {
    notes.push(
      '',
      'AAP does not reveal stored survey passwords; these answers are left out, add them to extra_data:',
      ...omittedSecrets.map((entry) => `  - ${entry}`),
    );
  }
  return {
    text: configurationPlaybook({
      title: `Creates the "${item.name}" workflow job template and its nodes in Ansible Automation Platform.`,
      playName: 'Create AAP workflow job template',
      role: labels.size ? ['controller_labels', 'controller_workflow_job_templates'] : 'controller_workflow_job_templates',
      data: toYaml(data),
      session,
      verifyTls,
      notes,
      ...(vaulted ? { vaultId: vault!.vaultId } : {}),
    }),
    omittedSecrets,
  };
}

/** The node's unified_job_template entry, in the format of the controller export. */
function unifiedJobTemplate(node: DesignerNode): Record<string, unknown> {
  if (node.kind === 'workflow_approval') {
    return {
      name: node.approval!.name.trim(),
      type: 'workflow_approval',
      description: node.approval!.description,
      timeout: node.approval!.timeout,
    };
  }
  const resource = node.resource!;
  if (node.kind === 'inventory_source') {
    // The module finds inventory sources by name within the organization of their inventory.
    const organization = resource.inventory?.organization;
    return { name: resource.name, type: node.kind, ...(organization ? { inventory: { organization: { name: organization } } } : {}) };
  }
  return {
    name: resource.name,
    type: node.kind,
    ...(resource.organization ? { organization: { name: resource.organization } } : {}),
  };
}
