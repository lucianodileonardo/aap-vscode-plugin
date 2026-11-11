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

  /** Returns the user the credentials belong to. Fails with 401 on bad credentials. */
  async me(): Promise<AapUser> {
    const data = await this.request<{ results?: AapUser[] } | AapUser>('GET', 'api/gateway/v1/me/');
    const user = 'results' in data && Array.isArray(data.results) ? data.results[0] : (data as AapUser);
    if (!user?.username) {
      throw new Error('Unexpected response from /api/gateway/v1/me/.');
    }
    return user;
  }

  /** Creates an organization in the platform gateway; it is synced to controller, EDA and hub. */
  createOrganization(input: OrganizationInput): Promise<Organization> {
    return this.request<Organization>('POST', 'api/gateway/v1/organizations/', { body: input });
  }

  /** Creates a custom credential type in automation controller (reached through the gateway). */
  createCredentialType(input: CredentialTypeInput): Promise<CredentialType> {
    return this.request<CredentialType>('POST', 'api/controller/v2/credential_types/', { body: input });
  }

  /**
   * Creates a credential in automation controller. The organization and credential type names
   * are resolved to IDs first; an unknown name fails with a 400-style field error.
   */
  async createCredential(input: CredentialInput): Promise<Credential> {
    const [organization, credentialType] = await Promise.all([
      this.findControllerId('organizations', input.organization, 'organization'),
      this.findControllerId('credential_types', input.credentialType, 'credential_type'),
    ]);
    return this.request<Credential>('POST', 'api/controller/v2/credentials/', {
      body: {
        name: input.name,
        description: input.description ?? '',
        organization,
        credential_type: credentialType,
        inputs: input.inputs,
      },
    });
  }

  /** Creates an instance group or container group in automation controller. */
  async createInstanceGroup(input: InstanceGroupInput): Promise<InstanceGroup> {
    const common = {
      name: input.name,
      max_concurrent_jobs: input.maxConcurrentJobs,
      max_forks: input.maxForks,
    };
    const body = input.isContainerGroup
      ? {
          ...common,
          is_container_group: true,
          credential: input.credential ? await this.findControllerId('credentials', input.credential, 'credential') : null,
          ...(input.podSpecOverride ? { pod_spec_override: input.podSpecOverride } : {}),
        }
      : {
          ...common,
          policy_instance_minimum: input.policyInstanceMinimum,
          policy_instance_percentage: input.policyInstancePercentage,
          policy_instance_list: input.policyInstanceList,
        };
    return this.request<InstanceGroup>('POST', 'api/controller/v2/instance_groups/', { body });
  }

  /** Creates a project in automation controller; names are resolved to IDs first. */
  async createProject(input: ProjectInput): Promise<Project> {
    const [organization, credential, defaultEnvironment] = await Promise.all([
      this.findControllerId('organizations', input.organization, 'organization'),
      input.credential ? this.findControllerId('credentials', input.credential, 'credential') : null,
      input.defaultEnvironment
        ? this.findControllerId('execution_environments', input.defaultEnvironment, 'default_environment')
        : null,
    ]);
    return this.request<Project>('POST', 'api/controller/v2/projects/', {
      body: {
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
      },
    });
  }

  /**
   * Creates a job template in automation controller, then attaches credentials and instance groups
   * (in the given order). All names are resolved before anything is created.
   */
  async createJobTemplate(input: JobTemplateInput): Promise<JobTemplate> {
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
    const template = await this.request<JobTemplate>('POST', 'api/controller/v2/job_templates/', {
      body: {
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
      },
    });
    // Sequential, so the instance group order (which sets preference) is kept.
    try {
      for (const id of credentials) {
        await this.request('POST', `api/controller/v2/job_templates/${template.id}/credentials/`, { body: { id } });
      }
      for (const id of instanceGroups) {
        await this.request('POST', `api/controller/v2/job_templates/${template.id}/instance_groups/`, { body: { id } });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Job template "${template.name}" (id ${template.id}) was created, but attaching its credentials or instance groups failed: ${reason}`,
      );
    }
    return template;
  }

  /**
   * Creates an inventory: regular and smart ones through /inventories/, constructed ones through
   * /constructed_inventories/ (which also takes the settings of their auto-created source). Input
   * inventories and instance groups are then attached in the given order.
   */
  async createInventory(input: InventoryInput): Promise<Inventory> {
    const lookupAll = (endpoint: string, names: string[], field: string) =>
      Promise.all(names.map((name) => this.findControllerId(endpoint, name, field)));
    const constructed = input.kind === 'constructed';
    const [organization, inputInventories, instanceGroups] = await Promise.all([
      this.findControllerId('organizations', input.organization, 'organization'),
      constructed ? lookupAll('inventories', input.inputInventories, 'input_inventories') : [],
      lookupAll('instance_groups', input.instanceGroups, 'instance_groups'),
    ]);
    const common = {
      name: input.name,
      description: input.description,
      organization,
      variables: input.variablesText,
      prevent_instance_group_fallback: input.preventInstanceGroupFallback,
    };
    const inventory = constructed
      ? await this.request<Inventory>('POST', 'api/controller/v2/constructed_inventories/', {
          body: {
            ...common,
            source_vars: input.sourceVarsText,
            limit: input.limit,
            update_cache_timeout: input.updateCacheTimeout,
            verbosity: input.verbosity,
          },
        })
      : await this.request<Inventory>('POST', 'api/controller/v2/inventories/', {
          body: { ...common, kind: input.kind, ...(input.kind === 'smart' ? { host_filter: input.hostFilter } : {}) },
        });
    // Sequential, so the order (which matters for both) is kept.
    try {
      for (const id of inputInventories) {
        await this.request('POST', `api/controller/v2/inventories/${inventory.id}/input_inventories/`, { body: { id } });
      }
      for (const id of instanceGroups) {
        await this.request('POST', `api/controller/v2/inventories/${inventory.id}/instance_groups/`, { body: { id } });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Inventory "${inventory.name}" (id ${inventory.id}) was created, but attaching its input inventories or instance groups failed: ${reason}`,
      );
    }
    return inventory;
  }

  /** Creates an inventory source in automation controller; names are resolved to IDs first. */
  async createInventorySource(input: InventorySourceInput): Promise<InventorySource> {
    const scm = input.source === 'scm';
    const [inventory, sourceProject, credential, executionEnvironment] = await Promise.all([
      this.findControllerId('inventories', input.inventory, 'inventory'),
      scm ? this.findControllerId('projects', input.sourceProject, 'source_project') : null,
      input.credential ? this.findControllerId('credentials', input.credential, 'credential') : null,
      input.executionEnvironment
        ? this.findControllerId('execution_environments', input.executionEnvironment, 'execution_environment')
        : null,
    ]);
    return this.request<InventorySource>('POST', 'api/controller/v2/inventory_sources/', {
      body: {
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
      },
    });
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
  private async findControllerId(endpoint: string, name: string, field: string): Promise<number> {
    const page = await this.request<{ results: { id: number; name: string }[] }>(
      'GET',
      `api/controller/v2/${endpoint}/?name=${encodeURIComponent(name)}`,
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
              reject(new AapHttpError(status, describeHttpError(status, text, res.headers.location), text));
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
