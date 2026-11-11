/**
 * Workflow designer model, shared by the extension and the designer webview (as JSON).
 * Related objects are carried as id + name, so the API save uses ids and the playbook uses names
 * without looking anything up again.
 */

/** Kinds of workflow node, named like the `type` of a unified job template. */
export const NODE_KINDS = [
  'job_template',
  'workflow_job_template',
  'project',
  'inventory_source',
  'system_job_template',
  'workflow_approval',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const LINK_TYPES = ['success', 'failure', 'always'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** A reference to an AAP object. `organization` is the owning organization's name, when it has one. */
export interface Ref {
  id: number;
  name: string;
  organization?: string | null;
}

/** The resource a node runs. Inventory sources also carry their inventory, needed to find them by name. */
export interface NodeResource extends Ref {
  inventory?: Ref | null;
  /** Management jobs: e.g. "cleanup_jobs"; those starting with "cleanup_" take a "days" value. */
  jobType?: string;
}

export interface ApprovalSettings {
  /** The workflow approval template behind an existing approval node. */
  templateId?: number;
  name: string;
  description: string;
  /** Seconds before the approval expires and fails; 0 means never. */
  timeout: number;
}

/** Values a node supplies for its template's "prompt on launch" settings. Unset means the template's default. */
export interface NodePrompts {
  inventory?: Ref | null;
  credentials?: Ref[];
  executionEnvironment?: Ref | null;
  instanceGroups?: Ref[];
  labels?: Ref[];
  scmBranch?: string;
  jobType?: string;
  jobTags?: string;
  skipTags?: string;
  limit?: string;
  diffMode?: boolean | null;
  verbosity?: number | null;
  forks?: number | null;
  jobSliceCount?: number | null;
  timeout?: number | null;
  /** Extra variables as YAML/JSON text; merged with the survey answers into the node's extra_data. */
  variables?: string;
}

export interface DesignerNode {
  /** Designer-local key: "n<id>" for nodes loaded from AAP, "new-<n>" for nodes not saved yet. */
  key: string;
  /** AAP node id, once saved. */
  id?: number;
  /** Unique within the workflow; shown as the node alias when it is not a generated UUID. */
  identifier: string;
  kind: NodeKind;
  /** Missing on approval nodes, and on nodes whose resource was deleted in AAP. */
  resource?: NodeResource | null;
  approval?: ApprovalSettings;
  /** Convergence "All": run only when every parent link fires. */
  allParentsMustConverge: boolean;
  prompts: NodePrompts;
  /** Survey answers keyed by variable; merged into extra_data. */
  survey: Record<string, unknown>;
  /** Management cleanup jobs: days of data to keep (extra_data.days). */
  days?: number | null;
  /** Survey variables of type password: vaulted in playbooks. */
  passwordVariables?: string[];
  /** Changed since loaded from AAP; only changed nodes are updated on save. */
  dirty?: boolean;
  /** Canvas position set by dragging; otherwise laid out automatically. */
  x?: number;
  y?: number;
}

export interface DesignerLink {
  from: string;
  to: string;
  type: LinkType;
}

/** Workflow job template settings (the "Details" of the designer). */
export interface WorkflowDetails {
  /** Missing for a workflow not created yet. */
  id?: number;
  name: string;
  description: string;
  organization: Ref | null;
  inventory: Ref | null;
  limit: string;
  scmBranch: string;
  /** Existing labels by reference; labels not in AAP yet have id 0 and are created on save. */
  labels: Ref[];
  jobTags: string;
  skipTags: string;
  /** YAML/JSON text, sent to AAP as written. */
  extraVars: string;
  askInventory: boolean;
  askLimit: boolean;
  askScmBranch: boolean;
  askLabels: boolean;
  askTags: boolean;
  askSkipTags: boolean;
  askVariables: boolean;
  allowSimultaneous: boolean;
  /** "" when webhooks are off; otherwise "github", "gitlab" or "bitbucket_dc". */
  webhookService: string;
  webhookCredential: Ref | null;
}

export interface DesignerWorkflow {
  details: WorkflowDetails;
  nodes: DesignerNode[];
  links: DesignerLink[];
}

/** One question of a job or workflow template survey, as returned by .../survey_spec/. */
export interface SurveyQuestion {
  question_name: string;
  question_description?: string;
  variable: string;
  type: 'text' | 'textarea' | 'password' | 'integer' | 'float' | 'multiplechoice' | 'multiselect';
  required: boolean;
  default?: unknown;
  choices?: string | string[];
  min?: number | null;
  max?: number | null;
}

/** What a node may prompt for, from the template's .../launch/ endpoint. */
export interface LaunchInfo {
  /** Prompt names enabled on the template, e.g. "inventory", "credential", "variables". */
  asks: string[];
  /** The template's own values, shown as defaults. */
  defaults: Record<string, unknown>;
  /** The template has no inventory, so the node must supply one. */
  inventoryNeeded: boolean;
  survey: SurveyQuestion[];
}

/** An entry of a "pick a resource" list. */
export interface CatalogItem extends NodeResource {
  description?: string;
}

/** An entry of a prompt or details list (inventories, credentials, ...). */
export interface LookupItem extends Ref {
  /** Credentials: the credential type namespace, e.g. "ssh", "github_token". */
  kind?: string;
  /** Shown after the name, e.g. the credential type. */
  detail?: string;
}

export const LOOKUP_KINDS = [
  'organizations',
  'inventories',
  'credentials',
  'execution_environments',
  'instance_groups',
  'labels',
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

/** A problem found before saving; `node` is the node key, `field` the form field. */
export interface WorkflowProblem {
  node?: string;
  field?: string;
  message: string;
}
