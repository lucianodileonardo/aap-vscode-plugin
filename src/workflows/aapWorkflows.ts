import { stringify } from 'yaml';
import { AapClient } from '../aapClient';
import { parseMapping } from '../resources/parse';
import {
  CatalogItem,
  DesignerLink,
  DesignerNode,
  DesignerWorkflow,
  LINK_TYPES,
  LaunchInfo,
  LookupItem,
  LookupKind,
  NodeKind,
  Ref,
  SurveyQuestion,
  WorkflowDetails,
  WorkflowProblem,
} from './types';

/** Reads and writes workflow job templates and their node graphs through the controller API. */

const API = 'api/controller/v2/';

/** List endpoint of each node kind's templates. */
const KIND_ENDPOINTS: Record<Exclude<NodeKind, 'workflow_approval'>, string> = {
  job_template: 'job_templates',
  workflow_job_template: 'workflow_job_templates',
  project: 'projects',
  inventory_source: 'inventory_sources',
  system_job_template: 'system_job_templates',
};

/** unified_job_type of a node's summary_fields.unified_job_template, mapped to the node kind. */
const UNIFIED_JOB_TYPES: Record<string, NodeKind> = {
  job: 'job_template',
  workflow_job: 'workflow_job_template',
  project_update: 'project',
  inventory_update: 'inventory_source',
  system_job: 'system_job_template',
  workflow_approval: 'workflow_approval',
};

/** Node kinds that can have launch prompts and surveys. */
const PROMPTING_KINDS: NodeKind[] = ['job_template', 'workflow_job_template'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* eslint-disable @typescript-eslint/no-explicit-any -- raw API payloads */
type ApiObject = Record<string, any>;

interface ApiNode extends ApiObject {
  id: number;
  identifier: string;
  unified_job_template: number | null;
  success_nodes: number[];
  failure_nodes: number[];
  always_nodes: number[];
}

function orgName(item: ApiObject | undefined): string | null {
  return item?.summary_fields?.organization?.name ?? null;
}

function toRef(item: ApiObject): Ref {
  return { id: item.id, name: item.name, organization: orgName(item) };
}

/** Runs fn over items with at most `limit` requests in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Fetches objects of an endpoint by id, in chunks, keyed by id. */
async function byIds(client: AapClient, endpoint: string, ids: Iterable<number | null | undefined>): Promise<Map<number, ApiObject>> {
  const unique = [...new Set([...ids].filter((id): id is number => typeof id === 'number'))];
  const chunks: number[][] = [];
  for (let i = 0; i < unique.length; i += 100) {
    chunks.push(unique.slice(i, i + 100));
  }
  const pages = await mapLimit(chunks, 4, (chunk) => client.listAll<ApiObject>(`${API}${endpoint}/?id__in=${chunk.join(',')}`));
  return new Map(pages.flat().map((item) => [item.id as number, item]));
}

export async function listWorkflows(client: AapClient): Promise<Ref[]> {
  return (await client.listAll<ApiObject>(`${API}workflow_job_templates/?order_by=name`)).map(toRef);
}

/** Templates a node of the given kind can run. */
export async function listCatalog(client: AapClient, kind: Exclude<NodeKind, 'workflow_approval'>): Promise<CatalogItem[]> {
  const items = await client.listAll<ApiObject>(`${API}${KIND_ENDPOINTS[kind]}/?order_by=name`);
  if (kind === 'inventory_source') {
    // Inventory sources are found by name within their inventory; the playbook needs its organization.
    const inventories = await byIds(client, 'inventories', items.map((item) => item.inventory));
    return items.map((item) => ({ ...catalogItem(item), inventory: inventoryRef(inventories.get(item.inventory)) }));
  }
  return items.map(catalogItem);
}

function catalogItem(item: ApiObject): CatalogItem {
  return {
    ...toRef(item),
    description: item.description || undefined,
    ...(item.job_type && item.type === 'system_job_template' ? { jobType: item.job_type } : {}),
  };
}

function inventoryRef(inventory: ApiObject | undefined): Ref | null {
  return inventory ? toRef(inventory) : null;
}

/** Choices for the details form and the node prompts. */
export async function listLookup(client: AapClient, kind: LookupKind): Promise<LookupItem[]> {
  if (kind === 'credentials') {
    const credentials = await client.listAll<ApiObject>(`${API}credentials/?order_by=name`);
    return credentials.map((item) => ({
      ...toRef(item),
      kind: item.kind,
      detail: item.summary_fields?.credential_type?.name ?? item.kind,
    }));
  }
  const order = kind === 'labels' ? 'name,organization' : 'name';
  return (await client.listAll<ApiObject>(`${API}${kind}/?order_by=${order}`)).map(toRef);
}

/** What a node running this template may prompt for. */
export async function launchInfo(client: AapClient, kind: NodeKind, id: number): Promise<LaunchInfo> {
  if (!PROMPTING_KINDS.includes(kind)) {
    return { asks: [], defaults: {}, inventoryNeeded: false, survey: [] };
  }
  const endpoint = KIND_ENDPOINTS[kind as 'job_template' | 'workflow_job_template'];
  let launch: ApiObject;
  try {
    launch = await client.request<ApiObject>('GET', `${API}${endpoint}/${id}/launch/`);
  } catch {
    // Users without execute permission cannot read .../launch/; the template itself has the switches.
    const template = await client.request<ApiObject>('GET', `${API}${endpoint}/${id}/`);
    launch = { ...template, defaults: {}, inventory_needed_to_start: !template.inventory && template.ask_inventory_on_launch };
  }
  const asks = Object.keys(launch)
    .filter((key) => /^ask_.+_on_launch$/.test(key) && launch[key] === true)
    .map((key) => key.slice(4, -10));
  return {
    asks,
    defaults: launch.defaults ?? {},
    inventoryNeeded: !!launch.inventory_needed_to_start,
    survey: launch.survey_enabled ? await surveySpec(client, endpoint, id) : [],
  };
}

async function surveySpec(client: AapClient, endpoint: string, id: number): Promise<SurveyQuestion[]> {
  const spec = await client.request<{ spec?: SurveyQuestion[] }>('GET', `${API}${endpoint}/${id}/survey_spec/`);
  return spec?.spec ?? [];
}

/** Loads a workflow job template and its node graph. */
export async function loadWorkflow(client: AapClient, id: number): Promise<DesignerWorkflow> {
  const [wf, labels, apiNodes] = await Promise.all([
    client.request<ApiObject>('GET', `${API}workflow_job_templates/${id}/`),
    client.listAll<ApiObject>(`${API}workflow_job_templates/${id}/labels/`),
    client.listAll<ApiNode>(`${API}workflow_job_templates/${id}/workflow_nodes/`),
  ]);

  const kindOf = (node: ApiNode): NodeKind | undefined => {
    const type = node.summary_fields?.unified_job_template?.unified_job_type;
    return type ? UNIFIED_JOB_TYPES[type] : undefined;
  };
  // Fetch every referenced object once, by kind.
  const templates = new Map<NodeKind, Map<number, ApiObject>>();
  await Promise.all(
    (Object.keys(KIND_ENDPOINTS) as (keyof typeof KIND_ENDPOINTS)[]).map(async (kind) => {
      const ids = apiNodes.filter((node) => kindOf(node) === kind).map((node) => node.unified_job_template);
      templates.set(kind, ids.length ? await byIds(client, KIND_ENDPOINTS[kind], ids) : new Map());
    }),
  );
  const inventorySources = [...templates.get('inventory_source')!.values()];
  const [inventories, environments, approvals] = await Promise.all([
    byIds(client, 'inventories', [...apiNodes.map((node) => node.inventory), ...inventorySources.map((source) => source.inventory)]),
    byIds(client, 'execution_environments', apiNodes.map((node) => node.execution_environment)),
    mapLimit(
      apiNodes.filter((node) => kindOf(node) === 'workflow_approval'),
      6,
      async (node) => [node.id, await client.request<ApiObject>('GET', `${API}workflow_approval_templates/${node.unified_job_template}/`)] as const,
    ).then((entries) => new Map(entries)),
  ]);
  // Survey variables of each template with a survey, to split a node's extra_data into answers and variables.
  const surveys = new Map<string, SurveyQuestion[]>();
  await mapLimit(
    PROMPTING_KINDS.flatMap((kind) =>
      [...templates.get(kind)!.values()].filter((t) => t.survey_enabled).map((t) => ({ kind, id: t.id as number })),
    ),
    6,
    async ({ kind, id: templateId }) => {
      surveys.set(`${kind}:${templateId}`, await surveySpec(client, KIND_ENDPOINTS[kind as 'job_template'], templateId).catch(() => []));
    },
  );
  // Prompted credentials, labels and instance groups live in sub-lists of each node.
  const related = new Map<number, { credentials: Ref[]; labels: Ref[]; instanceGroups: Ref[] }>();
  await mapLimit(
    apiNodes.filter((node) => PROMPTING_KINDS.includes(kindOf(node)!)),
    6,
    async (node) => {
      const sub = (name: string) => client.listAll<ApiObject>(`${API}workflow_job_template_nodes/${node.id}/${name}/`).then((items) => items.map(toRef));
      const [credentials, nodeLabels, instanceGroups] = await Promise.all([sub('credentials'), sub('labels'), sub('instance_groups')]);
      related.set(node.id, { credentials, labels: nodeLabels, instanceGroups });
    },
  );

  const nodes = apiNodes.map((node): DesignerNode => {
    const kind = kindOf(node) ?? 'job_template';
    const template = kind === 'workflow_approval' ? undefined : templates.get(kind)?.get(node.unified_job_template ?? -1);
    const extraData: Record<string, unknown> = { ...(node.extra_data ?? {}) };
    const questions = surveys.get(`${kind}:${node.unified_job_template}`) ?? [];
    const survey: Record<string, unknown> = {};
    for (const question of questions) {
      if (question.variable in extraData) {
        survey[question.variable] = extraData[question.variable];
        delete extraData[question.variable];
      }
    }
    let days: number | null = null;
    if (kind === 'system_job_template' && typeof extraData.days === 'number') {
      days = extraData.days;
      delete extraData.days;
    }
    const approval = approvals.get(node.id);
    const extra = related.get(node.id);
    const ref = (map: Map<number, ApiObject>, refId: number | null) => (refId != null && map.get(refId) ? toRef(map.get(refId)!) : refId != null ? { id: refId, name: `#${refId}` } : null);
    return {
      key: `n${node.id}`,
      id: node.id,
      identifier: node.identifier,
      kind,
      resource:
        template &&
        (kind === 'inventory_source'
          ? { ...toRef(template), inventory: inventoryRef(inventories.get(template.inventory)) }
          : { ...toRef(template), ...(kind === 'system_job_template' ? { jobType: template.job_type } : {}) }),
      ...(kind === 'workflow_approval'
        ? {
            approval: {
              templateId: node.unified_job_template ?? undefined,
              name: approval?.name ?? node.summary_fields?.unified_job_template?.name ?? '',
              description: approval?.description ?? '',
              timeout: approval?.timeout ?? 0,
            },
          }
        : {}),
      allParentsMustConverge: !!node.all_parents_must_converge,
      prompts: {
        inventory: ref(inventories, node.inventory),
        executionEnvironment: ref(environments, node.execution_environment),
        credentials: extra?.credentials ?? [],
        labels: extra?.labels ?? [],
        instanceGroups: extra?.instanceGroups ?? [],
        scmBranch: node.scm_branch ?? '',
        jobType: node.job_type ?? '',
        jobTags: node.job_tags ?? '',
        skipTags: node.skip_tags ?? '',
        limit: node.limit ?? '',
        diffMode: node.diff_mode ?? null,
        verbosity: node.verbosity ?? null,
        forks: node.forks ?? null,
        jobSliceCount: node.job_slice_count ?? null,
        timeout: node.timeout ?? null,
        variables: Object.keys(extraData).length ? stringify(extraData) : '',
      },
      survey,
      passwordVariables: questions.filter((q) => q.type === 'password').map((q) => q.variable),
      days,
    };
  });

  const keyOf = new Map(apiNodes.map((node) => [node.id, `n${node.id}`]));
  const links: DesignerLink[] = apiNodes.flatMap((node) =>
    LINK_TYPES.flatMap((type) =>
      (node[`${type}_nodes`] as number[])
        .filter((child) => keyOf.has(child))
        .map((child) => ({ from: `n${node.id}`, to: keyOf.get(child)!, type })),
    ),
  );

  const details: WorkflowDetails = {
    id: wf.id,
    name: wf.name,
    description: wf.description ?? '',
    organization: wf.summary_fields?.organization ? toRef(wf.summary_fields.organization) : null,
    inventory: wf.summary_fields?.inventory ? toRef(wf.summary_fields.inventory) : null,
    limit: wf.limit ?? '',
    scmBranch: wf.scm_branch ?? '',
    labels: labels.map(toRef),
    jobTags: wf.job_tags ?? '',
    skipTags: wf.skip_tags ?? '',
    extraVars: wf.extra_vars && wf.extra_vars !== '---' ? wf.extra_vars : '',
    askInventory: !!wf.ask_inventory_on_launch,
    askLimit: !!wf.ask_limit_on_launch,
    askScmBranch: !!wf.ask_scm_branch_on_launch,
    askLabels: !!wf.ask_labels_on_launch,
    askTags: !!wf.ask_tags_on_launch,
    askSkipTags: !!wf.ask_skip_tags_on_launch,
    askVariables: !!wf.ask_variables_on_launch,
    allowSimultaneous: !!wf.allow_simultaneous,
    webhookService: wf.webhook_service ?? '',
    webhookCredential: wf.summary_fields?.webhook_credential ? toRef(wf.summary_fields.webhook_credential) : null,
  };
  return { details, nodes, links };
}

/** True for identifiers AAP (or the designer) generated, which are not shown as aliases. */
export function isGeneratedIdentifier(identifier: string): boolean {
  return UUID.test(identifier);
}

export interface ValidatedWorkflow {
  workflow: DesignerWorkflow;
  /** Parsed workflow extra variables. */
  extraVars: Record<string, unknown>;
  /** Each node's extra_data (variables + survey answers + days), by node key. */
  extraData: Map<string, Record<string, unknown>>;
}

/** Checks a workflow before it is saved or turned into a playbook. */
export function validateWorkflow(workflow: DesignerWorkflow): { value: ValidatedWorkflow } | { problems: WorkflowProblem[] } {
  const problems: WorkflowProblem[] = [];
  const { details, nodes, links } = workflow;
  if (!details.name.trim()) {
    problems.push({ field: 'name', message: 'The workflow needs a name.' });
  }
  if (!details.organization) {
    problems.push({ field: 'organization', message: 'The workflow needs an organization.' });
  }
  if (details.webhookService && !['github', 'gitlab', 'bitbucket_dc'].includes(details.webhookService)) {
    problems.push({ field: 'webhookService', message: `Unknown webhook service "${details.webhookService}".` });
  }
  const errors: Record<string, string[]> = {};
  const extraVars = parseMapping(details.extraVars, 'extraVars', errors) ?? {};
  if (errors.extraVars) {
    problems.push({ field: 'extraVars', message: `Extra variables: ${errors.extraVars.join(' ')}` });
  }

  const extraData = new Map<string, Record<string, unknown>>();
  const identifiers = new Map<string, string>();
  for (const node of nodes) {
    const label = nodeLabel(node);
    const problem = (message: string, field?: string) => problems.push({ node: node.key, field, message: `${label}: ${message}` });
    if (!node.identifier.trim()) {
      problem('the node alias cannot be empty.', 'identifier');
    } else if (identifiers.has(node.identifier)) {
      problem(`the alias "${node.identifier}" is already used by another node.`, 'identifier');
    }
    identifiers.set(node.identifier, node.key);
    if (node.kind === 'workflow_approval') {
      if (!node.approval?.name.trim()) {
        problem('an approval needs a name.', 'approvalName');
      }
    } else if (!node.resource) {
      problem('choose what this node runs (its resource no longer exists in AAP).', 'resource');
    }
    const nodeErrors: Record<string, string[]> = {};
    const variables = parseMapping(node.prompts.variables ?? '', 'variables', nodeErrors);
    if (!variables) {
      problem(`extra variables: ${nodeErrors.variables.join(' ')}`, 'variables');
      continue;
    }
    extraData.set(node.key, {
      ...variables,
      ...node.survey,
      ...(node.kind === 'system_job_template' && node.days != null ? { days: node.days } : {}),
    });
  }

  const keys = new Set(nodes.map((node) => node.key));
  const pairs = new Set<string>();
  for (const link of links) {
    if (!keys.has(link.from) || !keys.has(link.to)) {
      problems.push({ message: 'A link points to a node that no longer exists.' });
    } else if (pairs.has(`${link.from}>${link.to}`)) {
      problems.push({ node: link.to, message: 'Two links join the same pair of nodes.' });
    }
    pairs.add(`${link.from}>${link.to}`);
  }
  if (hasCycle(nodes, links)) {
    problems.push({ message: 'The workflow has a loop; links must not lead back to an earlier node.' });
  }
  return problems.length ? { problems } : { value: { workflow, extraVars, extraData } };
}

export function nodeLabel(node: DesignerNode): string {
  if (node.kind === 'workflow_approval') {
    return `Approval "${node.approval?.name || 'unnamed'}"`;
  }
  return node.resource ? `"${node.resource.name}"` : 'A node with a deleted resource';
}

function hasCycle(nodes: DesignerNode[], links: DesignerLink[]): boolean {
  const children = new Map<string, string[]>(nodes.map((node) => [node.key, []]));
  links.forEach((link) => children.get(link.from)?.push(link.to));
  const state = new Map<string, 1 | 2>();
  const visit = (key: string): boolean => {
    if (state.get(key) === 1) return true;
    if (state.get(key) === 2) return false;
    state.set(key, 1);
    const cyclic = (children.get(key) ?? []).some(visit);
    state.set(key, 2);
    return cyclic;
  };
  return nodes.some((node) => visit(node.key));
}

/** What a save did so far; returned on failure too, so a retry does not create nodes twice. */
export interface SaveProgress {
  workflowId?: number;
  /** AAP ids of nodes created by this save, by designer key. */
  created: Record<string, number>;
  /** Approval template ids created by this save, by designer key. */
  approvals: Record<string, number>;
  /** Labels created by this save. */
  labels: Ref[];
}

export class WorkflowSaveError extends Error {
  constructor(
    message: string,
    readonly progress: SaveProgress,
  ) {
    super(message);
    this.name = 'WorkflowSaveError';
  }
}

/**
 * Creates or updates the workflow job template, then brings its nodes and links in AAP in line
 * with the designer: removed nodes are deleted, new ones created, changed ones updated, and links
 * added or removed. Like the AAP designer, this is not atomic; on failure the progress so far is
 * reported so the designer can retry without duplicating nodes.
 */
export async function saveWorkflow(client: AapClient, validated: ValidatedWorkflow): Promise<SaveProgress> {
  const progress: SaveProgress = { created: {}, approvals: {}, labels: [] };
  let step = 'saving the workflow settings';
  try {
    const { workflow, extraData } = validated;
    const { details } = workflow;
    const body = {
      name: details.name.trim(),
      description: details.description,
      organization: details.organization!.id,
      inventory: details.inventory?.id ?? null,
      limit: details.limit,
      scm_branch: details.scmBranch,
      job_tags: details.jobTags,
      skip_tags: details.skipTags,
      extra_vars: details.extraVars,
      ask_inventory_on_launch: details.askInventory,
      ask_limit_on_launch: details.askLimit,
      ask_scm_branch_on_launch: details.askScmBranch,
      ask_labels_on_launch: details.askLabels,
      ask_tags_on_launch: details.askTags,
      ask_skip_tags_on_launch: details.askSkipTags,
      ask_variables_on_launch: details.askVariables,
      allow_simultaneous: details.allowSimultaneous,
      webhook_service: details.webhookService,
      webhook_credential: details.webhookService ? (details.webhookCredential?.id ?? null) : null,
    };
    const saved = details.id
      ? await client.request<ApiObject>('PATCH', `${API}workflow_job_templates/${details.id}/`, { body })
      : await client.request<ApiObject>('POST', `${API}workflow_job_templates/`, { body });
    const wfId: number = saved.id;
    progress.workflowId = wfId;
    const wfPath = `${API}workflow_job_templates/${wfId}`;

    step = 'updating the workflow labels';
    const currentLabels = details.id ? await client.listAll<ApiObject>(`${wfPath}/labels/`) : [];
    const wantedLabels = new Set(details.labels.filter((label) => label.id).map((label) => label.id));
    for (const label of currentLabels.filter((label) => !wantedLabels.has(label.id))) {
      await client.request('POST', `${wfPath}/labels/`, { body: { id: label.id, disassociate: true } });
    }
    const currentIds = new Set(currentLabels.map((label) => label.id as number));
    for (const label of details.labels) {
      if (!label.id) {
        // Creates the label in the workflow's organization, or reuses one of that name.
        const created = await client.request<ApiObject>('POST', `${wfPath}/labels/`, {
          body: { name: label.name, organization: details.organization!.id },
        });
        progress.labels.push(toRef(created ?? { id: 0, name: label.name }));
      } else if (!currentIds.has(label.id)) {
        await client.request('POST', `${wfPath}/labels/`, { body: { id: label.id } });
      }
    }

    step = 'reading the current nodes';
    const serverNodes = details.id ? await client.listAll<ApiNode>(`${wfPath}/workflow_nodes/`) : [];
    const keep = new Set(workflow.nodes.map((node) => node.id).filter((id) => id !== undefined));
    for (const node of serverNodes.filter((node) => !keep.has(node.id))) {
      step = `removing node "${node.summary_fields?.unified_job_template?.name ?? node.identifier}"`;
      await client.request('DELETE', `${API}workflow_job_template_nodes/${node.id}/`);
    }
    const serverIds = new Set(serverNodes.map((node) => node.id));

    const ids = new Map<string, number>();
    for (const node of workflow.nodes) {
      step = `saving ${nodeLabel(node)}`;
      const payload = nodePayload(node, extraData.get(node.key)!);
      const exists = node.id !== undefined && serverIds.has(node.id);
      let nodeId: number;
      if (exists) {
        nodeId = node.id!;
        if (node.dirty) {
          await client.request('PATCH', `${API}workflow_job_template_nodes/${nodeId}/`, { body: payload });
        }
      } else {
        const created = await client.request<ApiObject>('POST', `${wfPath}/workflow_nodes/`, { body: payload });
        nodeId = created.id;
        progress.created[node.key] = nodeId;
      }
      ids.set(node.key, nodeId);
      if (node.kind === 'workflow_approval') {
        const approval = { name: node.approval!.name.trim(), description: node.approval!.description, timeout: node.approval!.timeout };
        if (exists && node.approval!.templateId) {
          if (node.dirty) {
            await client.request('PATCH', `${API}workflow_approval_templates/${node.approval!.templateId}/`, { body: approval });
          }
        } else {
          const template = await client.request<ApiObject>('POST', `${API}workflow_job_template_nodes/${nodeId}/create_approval_template/`, {
            body: approval,
          });
          progress.approvals[node.key] = template.id;
        }
      }
      if (PROMPTING_KINDS.includes(node.kind) && (!exists || node.dirty)) {
        const nodePath = `${API}workflow_job_template_nodes/${nodeId}`;
        await syncRelated(client, `${nodePath}/credentials/`, node.prompts.credentials ?? [], !exists, false);
        await syncRelated(client, `${nodePath}/labels/`, node.prompts.labels ?? [], !exists, false);
        await syncRelated(client, `${nodePath}/instance_groups/`, node.prompts.instanceGroups ?? [], !exists, true);
      }
    }

    step = 'updating the links';
    const current = new Set<string>();
    if (details.id) {
      for (const node of await client.listAll<ApiNode>(`${wfPath}/workflow_nodes/`)) {
        for (const type of LINK_TYPES) {
          (node[`${type}_nodes`] as number[]).forEach((child) => current.add(`${node.id}:${type}:${child}`));
        }
      }
    }
    const wanted = new Set(workflow.links.map((link) => `${ids.get(link.from)}:${link.type}:${ids.get(link.to)}`));
    const linkRequest = (key: string, disassociate: boolean) => {
      const [from, type, to] = key.split(':');
      return client.request('POST', `${API}workflow_job_template_nodes/${from}/${type}_nodes/`, {
        body: { id: Number(to), ...(disassociate ? { disassociate: true } : {}) },
      });
    };
    // Removals first, so a re-pointed link never forms a loop with the old one.
    for (const key of [...current].filter((key) => !wanted.has(key))) {
      await linkRequest(key, true);
    }
    for (const key of [...wanted].filter((key) => !current.has(key))) {
      await linkRequest(key, false);
    }
    return progress;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new WorkflowSaveError(`Failed while ${step}: ${reason}`, progress);
  }
}

/** Node fields sent to AAP; unset prompts are sent as null so a cleared value is cleared in AAP too. */
function nodePayload(node: DesignerNode, extraData: Record<string, unknown>): ApiObject {
  const p = node.prompts;
  return {
    identifier: node.identifier,
    ...(node.kind === 'workflow_approval' ? {} : { unified_job_template: node.resource?.id ?? null }),
    all_parents_must_converge: node.allParentsMustConverge,
    inventory: p.inventory?.id ?? null,
    execution_environment: p.executionEnvironment?.id ?? null,
    scm_branch: p.scmBranch || null,
    job_type: p.jobType || null,
    job_tags: p.jobTags || null,
    skip_tags: p.skipTags || null,
    limit: p.limit || null,
    diff_mode: p.diffMode ?? null,
    verbosity: p.verbosity ?? null,
    forks: p.forks ?? null,
    job_slice_count: p.jobSliceCount ?? null,
    timeout: p.timeout ?? null,
    extra_data: extraData,
  };
}

/** Makes a node's sub-list (credentials, labels, instance groups) match `wanted`; `ordered` keeps the order. */
async function syncRelated(client: AapClient, path: string, wanted: Ref[], isNew: boolean, ordered: boolean): Promise<void> {
  const current = isNew ? [] : (await client.listAll<ApiObject>(path)).map((item) => item.id as number);
  const wantedIds = wanted.map((ref) => ref.id);
  const same = current.length === wantedIds.length && current.every((id, i) => id === wantedIds[i]);
  if (same || (!ordered && current.length === wantedIds.length && current.every((id) => wantedIds.includes(id)))) {
    return;
  }
  // Order matters for instance groups, so they are re-attached from scratch when it changes.
  const remove = ordered ? current : current.filter((id) => !wantedIds.includes(id));
  const add = ordered ? wantedIds : wantedIds.filter((id) => !current.includes(id));
  for (const id of remove) {
    await client.request('POST', path, { body: { id, disassociate: true } });
  }
  for (const id of add) {
    await client.request('POST', path, { body: { id } });
  }
}
