import * as http from 'http';
import * as https from 'https';

/** AAP releases this extension supports. All of them front their services with the platform gateway. */
export const SUPPORTED_VERSIONS = ['2.5', '2.6', '2.7'] as const;
export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

export type AapCredentials =
  | { kind: 'basic'; username: string; password: string }
  | { kind: 'token'; token: string };

export interface AapClientOptions {
  baseUrl: string;
  verifyTls: boolean;
  timeoutMs: number;
}

export interface GatewayPing {
  version?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AapUser {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  is_superuser?: boolean;
  [key: string]: unknown;
}

export interface Organization {
  id: number;
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface OrganizationInput {
  name: string;
  description?: string;
}

/** Custom credential types can only be of kind "cloud" or "net". */
export const CREDENTIAL_TYPE_KINDS = ['cloud', 'net'] as const;

export interface CredentialType {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface CredentialTypeInput {
  name: string;
  description?: string;
  kind: (typeof CREDENTIAL_TYPE_KINDS)[number];
  inputs: Record<string, unknown>;
  injectors: Record<string, unknown>;
}

export interface Credential {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** Credential as entered by the user: organization and credential type are given by name. */
export interface CredentialInput {
  name: string;
  description?: string;
  organization: string;
  credentialType: string;
  inputs: Record<string, unknown>;
}

export interface InstanceGroup {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** An instance group, or a container group when isContainerGroup is set. */
export interface InstanceGroupInput {
  name: string;
  isContainerGroup: boolean;
  /** Container groups: name of a "Kubernetes/OpenShift API Bearer Token" credential; "" uses the pod's service account. */
  credential: string;
  /** Container groups: custom pod spec as YAML text; "" keeps the default. */
  podSpecOverride: string;
  /** Instance groups: automatic instance assignment policy. */
  policyInstanceMinimum: number;
  policyInstancePercentage: number;
  policyInstanceList: string[];
  /** 0 means no limit. */
  maxConcurrentJobs: number;
  maxForks: number;
}

/** Project source types; "" is a manual project (playbooks in a directory on the controller). */
export const PROJECT_SCM_TYPES = ['', 'git', 'svn', 'archive', 'insights'] as const;
export type ProjectScmType = (typeof PROJECT_SCM_TYPES)[number];

export interface Project {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** Project as entered by the user; organization, credential and execution environment are names. */
export interface ProjectInput {
  name: string;
  description: string;
  organization: string;
  scmType: ProjectScmType;
  scmUrl: string;
  scmBranch: string;
  scmRefspec: string;
  /** Source control credential name; "" for none. */
  credential: string;
  /** Manual projects: directory under the controller's projects root. */
  localPath: string;
  scmClean: boolean;
  scmDeleteOnUpdate: boolean;
  scmTrackSubmodules: boolean;
  scmUpdateOnLaunch: boolean;
  scmUpdateCacheTimeout: number;
  allowOverride: boolean;
  /** Execution environment name; "" for none. */
  defaultEnvironment: string;
  /** Source control update timeout in seconds; 0 means none. */
  timeout: number;
}

export const JOB_TYPES = ['run', 'check'] as const;

/** The "prompt on launch" switches of a job template (ask_<name>_on_launch). */
export const JOB_TEMPLATE_PROMPTS = [
  'inventory',
  'credential',
  'execution_environment',
  'instance_groups',
  'job_type',
  'scm_branch',
  'variables',
  'limit',
  'tags',
  'skip_tags',
  'verbosity',
  'forks',
  'job_slice_count',
  'timeout',
  'diff_mode',
] as const;
export type JobTemplatePrompt = (typeof JOB_TEMPLATE_PROMPTS)[number];

export interface JobTemplate {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** Job template as entered by the user; related objects are given by name. */
export interface JobTemplateInput {
  name: string;
  description: string;
  jobType: (typeof JOB_TYPES)[number];
  /** "" only allowed when the inventory is prompted on launch. */
  inventory: string;
  project: string;
  playbook: string;
  executionEnvironment: string;
  credentials: string[];
  instanceGroups: string[];
  /** Extra variables as YAML/JSON text, sent to the API as written. */
  extraVarsText: string;
  /** The same extra variables parsed, for the playbook. */
  extraVars: Record<string, unknown>;
  limit: string;
  scmBranch: string;
  jobTags: string;
  skipTags: string;
  /** 0 means the default. */
  forks: number;
  verbosity: number;
  timeout: number;
  jobSliceCount: number;
  becomeEnabled: boolean;
  diffMode: boolean;
  useFactCache: boolean;
  allowSimultaneous: boolean;
  preventInstanceGroupFallback: boolean;
  promptOnLaunch: JobTemplatePrompt[];
}

export const INVENTORY_KINDS = ['', 'smart', 'constructed'] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export interface Inventory {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** Inventory as entered by the user; organization, input inventories and instance groups are names. */
export interface InventoryInput {
  name: string;
  description: string;
  organization: string;
  /** "" regular, "smart" (hosts chosen by a filter) or "constructed" (built from input inventories). */
  kind: InventoryKind;
  /** Smart inventories: host filter, e.g. name__icontains=web. */
  hostFilter: string;
  /** Constructed inventories: input inventory names, in order. */
  inputInventories: string[];
  /** Constructed inventories: the ansible.builtin.constructed plugin configuration, as YAML text and parsed. */
  sourceVarsText: string;
  sourceVars: Record<string, unknown>;
  /** Constructed inventories: host pattern, cache timeout (seconds) and verbosity (0-2) of the update. */
  limit: string;
  updateCacheTimeout: number;
  verbosity: number;
  instanceGroups: string[];
  preventInstanceGroupFallback: boolean;
  /** Inventory variables as YAML/JSON text, sent to the API as written, and parsed for the playbook. */
  variablesText: string;
  variables: Record<string, unknown>;
}

/** Inventory source types (the AAP UI's "Source" choices). */
export const INVENTORY_SOURCE_TYPES = [
  'scm',
  'ec2',
  'gce',
  'azure_rm',
  'vmware',
  'satellite6',
  'openstack',
  'rhv',
  'controller',
  'insights',
  'terraform',
  'openshift_virtualization',
] as const;
export type InventorySourceType = (typeof INVENTORY_SOURCE_TYPES)[number];

export interface InventorySource {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** Inventory source as entered by the user; related objects are names. */
export interface InventorySourceInput {
  name: string;
  description: string;
  inventory: string;
  source: InventorySourceType;
  /** Sourced from a project: project name, inventory file path in it, and optional branch. */
  sourceProject: string;
  sourcePath: string;
  scmBranch: string;
  credential: string;
  executionEnvironment: string;
  sourceVarsText: string;
  sourceVars: Record<string, unknown>;
  verbosity: number;
  hostFilter: string;
  enabledVar: string;
  enabledValue: string;
  limit: string;
  overwrite: boolean;
  overwriteVars: boolean;
  updateOnLaunch: boolean;
  updateCacheTimeout: number;
  timeout: number;
}

/** Normal user, platform auditor (read-only everywhere) or superuser (platform administrator). */
export const USER_TYPES = ['normal', 'auditor', 'superuser'] as const;
export type UserType = (typeof USER_TYPES)[number];

/** A platform (gateway) user as entered; organizations are names. */
export interface UserInput {
  /** The username; called name so the form framework can treat it like other objects. */
  name: string;
  /** Empty when editing keeps the current password. */
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  userType: UserType;
  /** Organizations the user is a member of ("Organization Member" role). */
  organizations: string[];
}

/** A platform (gateway) team as entered; the organization is a name. */
export interface TeamInput {
  name: string;
  description: string;
  organization: string;
}

/** Gateway role definitions the user form assigns (the same ones ansible.platform.user uses). */
export const ORGANIZATION_MEMBER_ROLE = 'Organization Member';
export const PLATFORM_AUDITOR_ROLE = 'Platform Auditor';

interface RoleUserAssignment {
  id: number;
  object_id: string | number | null;
}

/** How an execution environment's image is pulled before a job runs ('' = the platform default). */
export const EE_PULL_OPTIONS = ['', 'always', 'missing', 'never'] as const;
export type EePull = (typeof EE_PULL_OPTIONS)[number];

/** Execution environment as entered; organization and credential are names ('' = none). */
export interface ExecutionEnvironmentInput {
  name: string;
  description: string;
  image: string;
  /** Empty makes it a global execution environment, available to every organization. */
  organization: string;
  /** Container registry credential for pulling the image. */
  credential: string;
  pull: EePull;
}

export interface ExecutionEnvironment {
  id: number;
  name: string;
}

/**
 * A custom role definition (AAP 2.5+ RBAC). `contentType` is the kind of object the role is
 * granted on, e.g. "awx.jobtemplate" or "shared.organization"; permissions look like
 * "awx.execute_jobtemplate".
 */
export interface RoleDefinitionInput {
  name: string;
  description?: string;
  contentType: string;
  permissions: string[];
}

export interface RoleDefinition {
  id: number;
  name: string;
}

/** An object loaded from AAP into a form to be edited (and possibly renamed). */
export interface ExistingObject {
  id: number;
  /** Its name in AAP when it was loaded; a different name in the form renames it. */
  name: string;
  /** Resource-specific facts, e.g. the name of a constructed inventory's source. */
  extra?: Record<string, string>;
}

function userBody(input: UserInput) {
  return {
    username: input.name,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    is_superuser: input.userType === 'superuser',
    // Left out when editing without a new password, so the current one is kept.
    ...(input.password ? { password: input.password } : {}),
  };
}

function organizationBody(input: OrganizationInput) {
  return { name: input.name, description: input.description ?? '' };
}

export class AapHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'AapHttpError';
  }

  /** Per-field validation errors from a 400 response, e.g. { name: ['... already exists.'] }. */
  get fieldErrors(): Record<string, string[]> {
    return parseFieldErrors(this.body);
  }
}

export class UnsupportedVersionError extends Error {
  constructor(readonly detected: string | undefined) {
    super(
      detected
        ? `AAP ${detected} is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}.`
        : `Could not determine the AAP version. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}.`,
    );
    this.name = 'UnsupportedVersionError';
  }
}

const TLS_ERROR_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function isTlsVerificationError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && TLS_ERROR_CODES.has(code);
}

/** Normalizes user input into a base URL without a trailing slash. Throws on invalid input. */
export function normalizeBaseUrl(input: string): string {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/** Maps a version string such as "2.5" or "2.6.20250604" to a supported release, if it is one. */
export function toSupportedVersion(version: string | undefined): SupportedVersion | undefined {
  const match = /^(\d+)\.(\d+)/.exec(version ?? '');
  if (!match) {
    return undefined;
  }
  const majorMinor = `${match[1]}.${match[2]}`;
  return (SUPPORTED_VERSIONS as readonly string[]).includes(majorMinor)
    ? (majorMinor as SupportedVersion)
    : undefined;
}

/**
 * Minimal client for the AAP platform gateway REST API (/api/gateway/v1/).
 * Uses Node's http/https modules directly so TLS verification can be toggled per client.
 */
export class AapClient {
  constructor(
    readonly options: AapClientOptions,
    private readonly credentials?: AapCredentials,
  ) {}

  /** Unauthenticated health check; also reports the platform version. */
  ping(): Promise<GatewayPing> {
    return this.request<GatewayPing>('GET', 'api/gateway/v1/ping/', { authenticate: false });
  }

  /**
   * Confirms the server is a platform gateway of a supported AAP release.
   * AAP 2.4 and earlier have no gateway, so the ping endpoint 404s there.
   */
  async detectVersion(): Promise<SupportedVersion> {
    let ping: GatewayPing;
    try {
      ping = await this.ping();
    } catch (err) {
      if (err instanceof AapHttpError && err.status === 404) {
        throw new UnsupportedVersionError('2.4 or earlier (no platform gateway API found)');
      }
      throw err;
    }
    const version = toSupportedVersion(ping.version);
    if (!version) {
      throw new UnsupportedVersionError(ping.version);
    }
    return version;
  }

  private versionCache?: Promise<SupportedVersion>;

  /** The AAP release, detected once per client. */
  version(): Promise<SupportedVersion> {
    if (!this.versionCache) {
      const detecting = this.detectVersion();
      // A failed detection (e.g. network) is retried on the next call.
      detecting.catch(() => (this.versionCache = undefined));
      this.versionCache = detecting;
    }
    return this.versionCache;
  }

  /**
   * API that owns custom roles: automation controller on AAP 2.5, the platform gateway from 2.6 on
   * (where roles of every service are managed centrally).
   */
  async rbacApi(): Promise<string> {
    return (await this.version()) === '2.5' ? 'api/controller/v2/' : 'api/gateway/v1/';
  }

  /** Permissions each content type accepts, e.g. { "awx.jobtemplate": ["awx.view_jobtemplate", ...] }. */
  async roleMetadata(): Promise<Record<string, string[]>> {
    const primary = await this.rbacApi();
    const other = primary === 'api/gateway/v1/' ? 'api/controller/v2/' : 'api/gateway/v1/';
    for (const api of [primary, other]) {
      try {
        const data = await this.request<{ allowed_permissions?: Record<string, string[]> }>('GET', `${api}role_metadata/`);
        if (data.allowed_permissions && Object.keys(data.allowed_permissions).length) {
          return data.allowed_permissions;
        }
      } catch (err) {
        if (!(err instanceof AapHttpError && err.status === 404)) {
          throw err;
        }
      }
    }
    // No metadata endpoint: the built-in roles together name every resource type and permission.
    const roles = await this.listAll<{ content_type: string | null; permissions?: string[] }>(`${primary}role_definitions/?managed=true`);
    const metadata: Record<string, string[]> = {};
    for (const role of roles) {
      if (role.content_type) {
        metadata[role.content_type] = [...new Set([...(metadata[role.content_type] ?? []), ...(role.permissions ?? [])])];
      }
    }
    if (!Object.keys(metadata).length) {
      throw new Error(`AAP did not report any role resource types (${primary}role_metadata/ and role_definitions/).`);
    }
    return metadata;
  }

  /** Returns the user the credentials belong to. Fails with 401 on bad credentials. */
  async me(): Promise<AapUser> {
    const data = await this.request<{ results?: AapUser[] } | AapUser>('GET', 'api/gateway/v1/me/');
    const user = 'results' in data && Array.isArray(data.results) ? data.results[0] : (data as AapUser);
    if (!user?.username) {
      throw new Error('Unexpected response from /api/gateway/v1/me/.');
    }
    return user;
  }

  // ---- Create and update ----
  // Each resource has a create (POST) and an update (PATCH of an existing object, which may also
  // rename it); both send the same body, built by a *Body method that resolves names to IDs first.

  /** Creates an organization in the platform gateway; it is synced to controller, EDA and hub. */
  createOrganization(input: OrganizationInput): Promise<Organization> {
    return this.request<Organization>('POST', 'api/gateway/v1/organizations/', { body: organizationBody(input) });
  }

  updateOrganization(id: number, input: OrganizationInput): Promise<Organization> {
    return this.request<Organization>('PATCH', `api/gateway/v1/organizations/${id}/`, { body: organizationBody(input) });
  }

  /** Creates a custom credential type in automation controller (reached through the gateway). */
  createCredentialType(input: CredentialTypeInput): Promise<CredentialType> {
    return this.request<CredentialType>('POST', 'api/controller/v2/credential_types/', { body: input });
  }

  updateCredentialType(id: number, input: CredentialTypeInput): Promise<CredentialType> {
    return this.request<CredentialType>('PATCH', `api/controller/v2/credential_types/${id}/`, { body: input });
  }

  /**
   * Creates a credential in automation controller. The organization and credential type names
   * are resolved to IDs first; an unknown name fails with a 400-style field error.
   */
  async createCredential(input: CredentialInput): Promise<Credential> {
    return this.request<Credential>('POST', 'api/controller/v2/credentials/', { body: await this.credentialBody(input) });
  }

  /** Updates a credential; inputs left as "$encrypted$" keep their stored secret value. */
  async updateCredential(id: number, input: CredentialInput): Promise<Credential> {
    return this.request<Credential>('PATCH', `api/controller/v2/credentials/${id}/`, { body: await this.credentialBody(input) });
  }

  private async credentialBody(input: CredentialInput) {
    const [organization, credentialType] = await Promise.all([
      this.findControllerId('organizations', input.organization, 'organization'),
      this.findControllerId('credential_types', input.credentialType, 'credential_type'),
    ]);
    return {
      name: input.name,
      description: input.description ?? '',
      organization,
      credential_type: credentialType,
      inputs: input.inputs,
    };
  }

  /** Creates an instance group or container group in automation controller. */
  async createInstanceGroup(input: InstanceGroupInput): Promise<InstanceGroup> {
    return this.request<InstanceGroup>('POST', 'api/controller/v2/instance_groups/', { body: await this.instanceGroupBody(input, false) });
  }

  async updateInstanceGroup(id: number, input: InstanceGroupInput): Promise<InstanceGroup> {
    return this.request<InstanceGroup>('PATCH', `api/controller/v2/instance_groups/${id}/`, { body: await this.instanceGroupBody(input, true) });
  }

  private async instanceGroupBody(input: InstanceGroupInput, update: boolean) {
    const common = {
      name: input.name,
      max_concurrent_jobs: input.maxConcurrentJobs,
      max_forks: input.maxForks,
    };
    return input.isContainerGroup
      ? {
          ...common,
          is_container_group: true,
          credential: input.credential ? await this.findControllerId('credentials', input.credential, 'credential') : null,
          // An empty override means the default pod spec; on update it clears a previous override.
          ...(input.podSpecOverride || update ? { pod_spec_override: input.podSpecOverride } : {}),
        }
      : {
          ...common,
          policy_instance_minimum: input.policyInstanceMinimum,
          policy_instance_percentage: input.policyInstancePercentage,
          policy_instance_list: input.policyInstanceList,
        };
  }

  /** Creates a project in automation controller; names are resolved to IDs first. */
  async createProject(input: ProjectInput): Promise<Project> {
    return this.request<Project>('POST', 'api/controller/v2/projects/', { body: await this.projectBody(input) });
  }

  async updateProject(id: number, input: ProjectInput): Promise<Project> {
    return this.request<Project>('PATCH', `api/controller/v2/projects/${id}/`, { body: await this.projectBody(input) });
  }

  private async projectBody(input: ProjectInput) {
    const [organization, credential, defaultEnvironment] = await Promise.all([
      this.findControllerId('organizations', input.organization, 'organization'),
      input.credential ? this.findControllerId('credentials', input.credential, 'credential') : null,
      input.defaultEnvironment
        ? this.findControllerId('execution_environments', input.defaultEnvironment, 'default_environment')
        : null,
    ]);
    return {
      name: input.name,
      description: input.description,
      organization,
      scm_type: input.scmType,
      scm_url: input.scmUrl,
      scm_branch: input.scmBranch,
      scm_refspec: input.scmRefspec,
      credential,
      ...(input.scmType === '' ? { local_path: input.localPath } : {}),
      scm_clean: input.scmClean,
      scm_delete_on_update: input.scmDeleteOnUpdate,
      scm_track_submodules: input.scmTrackSubmodules,
      scm_update_on_launch: input.scmUpdateOnLaunch,
      scm_update_cache_timeout: input.scmUpdateCacheTimeout,
      allow_override: input.allowOverride,
      default_environment: defaultEnvironment,
      timeout: input.timeout,
    };
  }

  /**
   * Creates a job template in automation controller, then attaches credentials and instance groups
   * (in the given order). All names are resolved before anything is created.
   */
  async createJobTemplate(input: JobTemplateInput): Promise<JobTemplate> {
    const { body, credentials, instanceGroups } = await this.jobTemplateBody(input);
    const template = await this.request<JobTemplate>('POST', 'api/controller/v2/job_templates/', { body });
    await this.afterCreate(`Job template "${template.name}" (id ${template.id})`, 'credentials or instance groups', async () => {
      await this.syncRelated(`job_templates/${template.id}/credentials/`, [], credentials, false);
      await this.syncRelated(`job_templates/${template.id}/instance_groups/`, [], instanceGroups, true);
    });
    return template;
  }

  /** Updates a job template; its credentials and instance groups are made to match the input. */
  async updateJobTemplate(id: number, input: JobTemplateInput): Promise<JobTemplate> {
    const { body, credentials, instanceGroups } = await this.jobTemplateBody(input);
    const template = await this.request<JobTemplate>('PATCH', `api/controller/v2/job_templates/${id}/`, { body });
    await this.syncRelated(`job_templates/${id}/credentials/`, await this.relatedIds(`job_templates/${id}/credentials/`), credentials, false);
    await this.syncRelated(`job_templates/${id}/instance_groups/`, await this.relatedIds(`job_templates/${id}/instance_groups/`), instanceGroups, true);
    return template;
  }

  private async jobTemplateBody(input: JobTemplateInput) {
    const lookupAll = (endpoint: string, names: string[], field: string) =>
      Promise.all(names.map((name) => this.findControllerId(endpoint, name, field)));
    const [inventory, project, executionEnvironment, credentials, instanceGroups] = await Promise.all([
      input.inventory ? this.findControllerId('inventories', input.inventory, 'inventory') : null,
      this.findControllerId('projects', input.project, 'project'),
      input.executionEnvironment
        ? this.findControllerId('execution_environments', input.executionEnvironment, 'execution_environment')
        : null,
      lookupAll('credentials', input.credentials, 'credentials'),
      lookupAll('instance_groups', input.instanceGroups, 'instance_groups'),
    ]);
    const prompts = Object.fromEntries(
      JOB_TEMPLATE_PROMPTS.map((prompt) => [`ask_${prompt}_on_launch`, input.promptOnLaunch.includes(prompt)]),
    );
    const body = {
      name: input.name,
      description: input.description,
      job_type: input.jobType,
      inventory,
      project,
      playbook: input.playbook,
      execution_environment: executionEnvironment,
      extra_vars: input.extraVarsText,
      limit: input.limit,
      scm_branch: input.scmBranch,
      job_tags: input.jobTags,
      skip_tags: input.skipTags,
      forks: input.forks,
      verbosity: input.verbosity,
      timeout: input.timeout,
      job_slice_count: input.jobSliceCount,
      become_enabled: input.becomeEnabled,
      diff_mode: input.diffMode,
      use_fact_cache: input.useFactCache,
      allow_simultaneous: input.allowSimultaneous,
      prevent_instance_group_fallback: input.preventInstanceGroupFallback,
      ...prompts,
    };
    return { body, credentials, instanceGroups };
  }

  /**
   * Creates an inventory: regular and smart ones through /inventories/, constructed ones through
   * /constructed_inventories/ (which also takes the settings of their auto-created source). Input
   * inventories and instance groups are then attached in the given order.
   */
  async createInventory(input: InventoryInput): Promise<Inventory> {
    const { body, inputInventories, instanceGroups } = await this.inventoryBody(input);
    const endpoint = input.kind === 'constructed' ? 'constructed_inventories' : 'inventories';
    const inventory = await this.request<Inventory>('POST', `api/controller/v2/${endpoint}/`, {
      body: { ...body, ...(input.kind === 'constructed' ? {} : { kind: input.kind }) },
    });
    await this.afterCreate(`Inventory "${inventory.name}" (id ${inventory.id})`, 'input inventories or instance groups', async () => {
      await this.syncRelated(`inventories/${inventory.id}/input_inventories/`, [], inputInventories, true);
      await this.syncRelated(`inventories/${inventory.id}/instance_groups/`, [], instanceGroups, true);
    });
    return inventory;
  }

  /**
   * Updates an inventory (its type cannot change); input inventories and instance groups are made
   * to match the input, in order.
   */
  async updateInventory(id: number, input: InventoryInput): Promise<Inventory> {
    const { body, inputInventories, instanceGroups } = await this.inventoryBody(input);
    const constructed = input.kind === 'constructed';
    const inventory = await this.request<Inventory>('PATCH', `api/controller/v2/${constructed ? 'constructed_inventories' : 'inventories'}/${id}/`, { body });
    if (constructed) {
      const current = await this.relatedIds(`inventories/${id}/input_inventories/`);
      await this.syncRelated(`inventories/${id}/input_inventories/`, current, inputInventories, true);
    }
    await this.syncRelated(`inventories/${id}/instance_groups/`, await this.relatedIds(`inventories/${id}/instance_groups/`), instanceGroups, true);
    return inventory;
  }

  private async inventoryBody(input: InventoryInput) {
    const lookupAll = (endpoint: string, names: string[], field: string) =>
      Promise.all(names.map((name) => this.findControllerId(endpoint, name, field)));
    const constructed = input.kind === 'constructed';
    const [organization, inputInventories, instanceGroups] = await Promise.all([
      this.findControllerId('organizations', input.organization, 'organization'),
      constructed ? lookupAll('inventories', input.inputInventories, 'input_inventories') : [],
      lookupAll('instance_groups', input.instanceGroups, 'instance_groups'),
    ]);
    const body = {
      name: input.name,
      description: input.description,
      organization,
      variables: input.variablesText,
      prevent_instance_group_fallback: input.preventInstanceGroupFallback,
      ...(constructed
        ? { source_vars: input.sourceVarsText, limit: input.limit, update_cache_timeout: input.updateCacheTimeout, verbosity: input.verbosity }
        : {}),
      ...(input.kind === 'smart' ? { host_filter: input.hostFilter } : {}),
    };
    return { body, inputInventories, instanceGroups };
  }

  /** Creates an inventory source in automation controller; names are resolved to IDs first. */
  async createInventorySource(input: InventorySourceInput): Promise<InventorySource> {
    return this.request<InventorySource>('POST', 'api/controller/v2/inventory_sources/', { body: await this.inventorySourceBody(input) });
  }

  async updateInventorySource(id: number, input: InventorySourceInput): Promise<InventorySource> {
    return this.request<InventorySource>('PATCH', `api/controller/v2/inventory_sources/${id}/`, { body: await this.inventorySourceBody(input) });
  }

  /** Creates an execution environment in automation controller; names are resolved to IDs first. */
  async createExecutionEnvironment(input: ExecutionEnvironmentInput): Promise<ExecutionEnvironment> {
    return this.request<ExecutionEnvironment>('POST', 'api/controller/v2/execution_environments/', {
      body: await this.executionEnvironmentBody(input),
    });
  }

  async updateExecutionEnvironment(id: number, input: ExecutionEnvironmentInput): Promise<ExecutionEnvironment> {
    return this.request<ExecutionEnvironment>('PATCH', `api/controller/v2/execution_environments/${id}/`, {
      body: await this.executionEnvironmentBody(input),
    });
  }

  private async executionEnvironmentBody(input: ExecutionEnvironmentInput) {
    const [organization, credential] = await Promise.all([
      input.organization ? this.findControllerId('organizations', input.organization, 'organization') : null,
      input.credential ? this.findControllerId('credentials', input.credential, 'credential') : null,
    ]);
    return {
      name: input.name,
      description: input.description,
      image: input.image,
      organization,
      credential,
      pull: input.pull,
    };
  }

  // ---- Platform users and teams (gateway). Organization membership and the platform auditor flag
  // are role assignments ("Organization Member" on each organization, "Platform Auditor" globally),
  // as the ansible.platform.user module does it.

  /** Creates a gateway user, then makes it a member of its organizations (and an auditor). */
  async createUser(input: UserInput): Promise<{ id: number; name: string }> {
    if (!input.password) {
      const message = 'A new user needs a password.';
      throw new AapHttpError(400, message, JSON.stringify({ password: [message] }));
    }
    // Resolve every name first, so nothing is created when one is wrong.
    const organizations = await this.gatewayIds('organizations', input.organizations, 'organizations');
    const user = await this.request<{ id: number; username: string }>('POST', 'api/gateway/v1/users/', { body: userBody(input) });
    await this.afterCreate(`User "${user.username}"`, 'organizations', () => this.syncUserRoles(user.id, organizations, input.userType === 'auditor'));
    return { id: user.id, name: user.username };
  }

  /** Updates a gateway user; organizations it should no longer belong to lose the membership. */
  async updateUser(id: number, input: UserInput): Promise<{ id: number; name: string }> {
    const organizations = await this.gatewayIds('organizations', input.organizations, 'organizations');
    const user = await this.request<{ id: number; username: string }>('PATCH', `api/gateway/v1/users/${id}/`, { body: userBody(input) });
    await this.syncUserRoles(id, organizations, input.userType === 'auditor');
    return { id: user.id, name: user.username };
  }

  /** Names of the organizations a user is a member of, and whether the user is a platform auditor. */
  async userRoles(userId: number): Promise<{ organizations: string[]; auditor: boolean }> {
    const [member, auditor] = await Promise.all([this.userAssignments(userId, ORGANIZATION_MEMBER_ROLE), this.userAssignments(userId, PLATFORM_AUDITOR_ROLE)]);
    const organizations = await Promise.all(
      member.map(async (a) => (await this.get<{ name: string }>(`api/gateway/v1/organizations/${a.object_id}/`)).name),
    );
    return { organizations: organizations.sort((a, b) => a.localeCompare(b)), auditor: auditor.length > 0 };
  }

  private async syncUserRoles(userId: number, organizations: number[], auditor: boolean): Promise<void> {
    const member = await this.userAssignments(userId, ORGANIZATION_MEMBER_ROLE);
    const current = new Map(member.map((a) => [Number(a.object_id), a.id]));
    for (const [organization, assignment] of current) {
      if (!organizations.includes(organization)) {
        await this.request('DELETE', `api/gateway/v1/role_user_assignments/${assignment}/`);
      }
    }
    const missing = organizations.filter((organization) => !current.has(organization));
    if (missing.length) {
      const role = await this.gatewayRoleId(ORGANIZATION_MEMBER_ROLE);
      for (const organization of missing) {
        await this.request('POST', 'api/gateway/v1/role_user_assignments/', {
          body: { role_definition: role, user: userId, object_id: String(organization) },
        });
      }
    }
    const audits = await this.userAssignments(userId, PLATFORM_AUDITOR_ROLE);
    if (auditor && !audits.length) {
      await this.request('POST', 'api/gateway/v1/role_user_assignments/', {
        body: { role_definition: await this.gatewayRoleId(PLATFORM_AUDITOR_ROLE), user: userId },
      });
    } else if (!auditor) {
      for (const audit of audits) {
        await this.request('DELETE', `api/gateway/v1/role_user_assignments/${audit.id}/`);
      }
    }
  }

  private async userAssignments(userId: number, roleName: string): Promise<RoleUserAssignment[]> {
    const role = await this.gatewayRoleId(roleName);
    return this.listAll<RoleUserAssignment>(`api/gateway/v1/role_user_assignments/?user=${userId}&role_definition=${role}`);
  }

  private readonly roleIds = new Map<string, Promise<number>>();

  /** ID of a built-in gateway role definition, looked up once per client. */
  private gatewayRoleId(roleName: string): Promise<number> {
    let id = this.roleIds.get(roleName);
    if (!id) {
      id = this.findId('api/gateway/v1/', 'role_definitions', roleName, 'role_definition');
      id.catch(() => this.roleIds.delete(roleName));
      this.roleIds.set(roleName, id);
    }
    return id;
  }

  /** Creates a gateway team in an organization. */
  async createTeam(input: TeamInput): Promise<{ id: number; name: string }> {
    return this.request('POST', 'api/gateway/v1/teams/', { body: await this.teamBody(input) });
  }

  async updateTeam(id: number, input: TeamInput): Promise<{ id: number; name: string }> {
    return this.request('PATCH', `api/gateway/v1/teams/${id}/`, { body: await this.teamBody(input) });
  }

  private async teamBody(input: TeamInput) {
    return {
      name: input.name,
      description: input.description,
      organization: await this.findId('api/gateway/v1/', 'organizations', input.organization, 'organization'),
    };
  }

  private gatewayIds(endpoint: string, names: string[], field: string): Promise<number[]> {
    return Promise.all(names.map((name) => this.findId('api/gateway/v1/', endpoint, name, field)));
  }

  /** Creates a custom role definition (controller on AAP 2.5, gateway on 2.6+). */
  async createRoleDefinition(input: RoleDefinitionInput): Promise<RoleDefinition> {
    return this.request<RoleDefinition>('POST', `${await this.rbacApi()}role_definitions/`, {
      body: {
        name: input.name,
        description: input.description ?? '',
        content_type: input.contentType,
        permissions: input.permissions,
      },
    });
  }

  /** Updates a custom role; its content type cannot change, so it is not sent. */
  async updateRoleDefinition(id: number, input: RoleDefinitionInput): Promise<RoleDefinition> {
    return this.request<RoleDefinition>('PATCH', `${await this.rbacApi()}role_definitions/${id}/`, {
      body: { name: input.name, description: input.description ?? '', permissions: input.permissions },
    });
  }

  private async inventorySourceBody(input: InventorySourceInput) {
    const scm = input.source === 'scm';
    const [inventory, sourceProject, credential, executionEnvironment] = await Promise.all([
      this.findControllerId('inventories', input.inventory, 'inventory'),
      scm ? this.findControllerId('projects', input.sourceProject, 'source_project') : null,
      input.credential ? this.findControllerId('credentials', input.credential, 'credential') : null,
      input.executionEnvironment
        ? this.findControllerId('execution_environments', input.executionEnvironment, 'execution_environment')
        : null,
    ]);
    return {
      name: input.name,
      description: input.description,
      inventory,
      source: input.source,
      ...(scm ? { source_project: sourceProject, source_path: input.sourcePath, scm_branch: input.scmBranch } : {}),
      credential,
      execution_environment: executionEnvironment,
      source_vars: input.sourceVarsText,
      verbosity: input.verbosity,
      host_filter: input.hostFilter,
      enabled_var: input.enabledVar,
      enabled_value: input.enabledValue,
      limit: input.limit,
      overwrite: input.overwrite,
      overwrite_vars: input.overwriteVars,
      update_on_launch: input.updateOnLaunch,
      update_cache_timeout: input.updateCacheTimeout,
      timeout: input.timeout,
    };
  }

  // ---- Related lists (credentials, instance groups, input inventories) ----

  /** IDs in a related list, in the order AAP keeps them (which is the preference order for instance groups). */
  async relatedIds(path: string): Promise<number[]> {
    return (await this.listAll<{ id: number }>(`api/controller/v2/${path}`)).map((item) => item.id);
  }

  /** Names in a related list, in AAP's order. */
  async relatedNames(path: string): Promise<string[]> {
    return (await this.listAll<{ name: string }>(`api/controller/v2/${path}`)).map((item) => item.name);
  }

  /**
   * Makes a related list hold `wanted`. Unordered lists only change the difference; for ordered ones
   * a different order means detaching everything and attaching again in order (AAP keeps attach order).
   * Removals go first, so e.g. a credential can be swapped for another of the same type.
   */
  private async syncRelated(path: string, current: number[], wanted: number[], ordered: boolean): Promise<void> {
    const url = `api/controller/v2/${path}`;
    const same = current.length === wanted.length && current.every((id, i) => (ordered ? wanted[i] === id : wanted.includes(id)));
    if (same) {
      return;
    }
    const remove = ordered ? current : current.filter((id) => !wanted.includes(id));
    const add = ordered ? wanted : wanted.filter((id) => !current.includes(id));
    for (const id of remove) {
      await this.request('POST', url, { body: { id, disassociate: true } });
    }
    for (const id of add) {
      await this.request('POST', url, { body: { id } });
    }
  }

  /** Runs the attach step after a create; a failure there says the object itself was created. */
  private async afterCreate(what: string, related: string, attach: () => Promise<void>): Promise<void> {
    try {
      await attach();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${what} was created, but attaching its ${related} failed: ${reason}`);
    }
  }

  // ---- Reading existing objects ----

  /** Reads one object, e.g. get('api/controller/v2/projects/5/'). */
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** Name of a controller object by ID ('' for null), e.g. a project's credential. */
  async controllerName(endpoint: string, id: number | null | undefined): Promise<string> {
    if (id === null || id === undefined) {
      return '';
    }
    return (await this.get<{ name: string }>(`api/controller/v2/${endpoint}/${id}/`)).name;
  }

  /** Fetches every item of a paginated list endpoint, following `next` links (up to 10,000 items). */
  async listAll<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | null = `${path}${path.includes('?') ? '&' : '?'}page_size=200`;
    for (let page = 0; next && page < 50; page++) {
      const data: { results: T[]; next: string | null } = await this.request('GET', next);
      results.push(...data.results);
      next = data.next;
    }
    return results;
  }

  /** Playbooks found in a project's last sync. */
  async projectPlaybooks(projectName: string): Promise<string[]> {
    const id = await this.findControllerId('projects', projectName, 'project');
    return this.request<string[]>('GET', `api/controller/v2/projects/${id}/playbooks/`);
  }

  /** Inventory files found in a project's last sync (for inventory sources sourced from a project). */
  async projectInventoryFiles(projectName: string): Promise<string[]> {
    const id = await this.findControllerId('projects', projectName, 'source_project');
    return this.request<string[]>('GET', `api/controller/v2/projects/${id}/inventories/`);
  }

  /** Looks up a controller object by exact name; unknown or ambiguous names fail with a field error. */
  private findControllerId(endpoint: string, name: string, field: string): Promise<number> {
    return this.findId('api/controller/v2/', endpoint, name, field);
  }

  /** ID of the object of an API (e.g. "api/gateway/v1/") with exactly this name. */
  private async findId(api: string, endpoint: string, name: string, field: string): Promise<number> {
    const page = await this.request<{ results: { id: number; name: string }[] }>(
      'GET',
      `${api}${endpoint}/?name=${encodeURIComponent(name)}`,
    );
    const matches = page.results.filter((item) => item.name === name);
    const plural = endpoint.replace(/_/g, ' ');
    const singular = plural.replace(/ies$/, 'y').replace(/s$/, '');
    if (matches.length !== 1) {
      const message = matches.length ? `Several ${plural} are named "${name}".` : `No ${singular} named "${name}" found.`;
      throw new AapHttpError(400, message, JSON.stringify({ [field]: [message] }));
    }
    return matches[0].id;
  }


  request<T>(
    method: string,
    path: string,
    { body, authenticate = true }: { body?: unknown; authenticate?: boolean } = {},
  ): Promise<T> {
    const url = new URL(path.replace(/^\/+/, ''), `${this.options.baseUrl}/`);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'aap-vscode',
    };
    if (authenticate) {
      if (!this.credentials) {
        return Promise.reject(new Error('Not logged in to Ansible Automation Platform.'));
      }
      headers.Authorization =
        this.credentials.kind === 'token'
          ? `Bearer ${this.credentials.token}`
          : `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString('base64')}`;
    }
    let payload: Buffer | undefined;
    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }

    const transport = url.protocol === 'http:' ? http : https;
    return new Promise<T>((resolve, reject) => {
      const req = transport.request(
        url,
        {
          method,
          headers,
          timeout: this.options.timeoutMs,
          rejectUnauthorized: this.options.verifyTls,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              const message = describeHttpError(status, text, res.headers.location);
              // A 404 says nothing without the URL; name it so the failing call can be found.
              reject(new AapHttpError(status, status === 404 ? `${message} (${method} ${url.pathname})` : message, text));
              return;
            }
            if (!text) {
              resolve(undefined as T);
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch {
              reject(new Error(`Expected JSON from ${url.pathname} but got: ${text.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Request to ${url.host} timed out.`)));
      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }
}

function describeHttpError(status: number, body: string, location?: string): string {
  let detail: string | undefined;
  try {
    const parsed = JSON.parse(body);
    detail = typeof parsed?.detail === 'string' ? parsed.detail : undefined;
  } catch {
    // Non-JSON error body; fall through to generic messages.
  }
  if (status === 401) {
    return detail ? `Authentication failed: ${detail}` : 'Authentication failed: invalid credentials.';
  }
  if (status === 403) {
    return detail ? `Permission denied: ${detail}` : 'Permission denied.';
  }
  if (status >= 300 && status < 400) {
    return `Server redirected to ${location ?? 'another location'}. Check the URL (use https:// and the gateway address).`;
  }
  if (status === 400 && !detail) {
    const fields = Object.entries(parseFieldErrors(body));
    if (fields.length) {
      return fields.map(([field, messages]) => `${field}: ${messages.join(' ')}`).join('; ');
    }
  }
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

/** Flattens an error value; nested errors such as { inputs: { username: [...] } } become "username: ...". */
function errorMessages(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(errorMessages);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => errorMessages(nested).map((message) => `${key}: ${message}`));
  }
  return [];
}

function parseFieldErrors(body: string | undefined): Record<string, string[]> {
  try {
    const parsed = JSON.parse(body ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string[]> = {};
    for (const [field, value] of Object.entries(parsed)) {
      const messages = errorMessages(value);
      if (messages.length) {
        result[field] = messages;
      }
    }
    return result;
  } catch {
    return {};
  }
}
