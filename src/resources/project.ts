import { PROJECT_SCM_TYPES, ProjectInput, ProjectScmType } from '../aapClient';
import { projectPlaybook } from '../playbooks/project';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { text } from './existing';
import { parseInteger } from './parse';
import { credentialLookup, executionEnvironmentLookup, organizationLookup } from './lookups';

/** Source types that sync from somewhere (everything except manual). */
const SYNCED: ProjectScmType[] = ['git', 'svn', 'archive', 'insights'];
/** Source types that take a URL. */
const WITH_URL: ProjectScmType[] = ['git', 'svn', 'archive'];
const when = (values: ProjectScmType[]) => ({ field: 'scm_type', values: values as string[] });

export const projectForm: ResourceFormSpec<ProjectInput> = {
  viewType: 'aap.createProject',
  noun: 'project',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'organization',
      label: 'Organization',
      type: 'text',
      required: true,
      hint: 'Name of the organization that owns the project.',
      lookup: organizationLookup,
    },
    {
      id: 'scm_type',
      label: 'Source control type',
      type: 'select',
      defaultValue: 'git',
      options: [
        { value: '', label: 'Manual' },
        { value: 'git', label: 'Git' },
        { value: 'svn', label: 'Subversion' },
        { value: 'archive', label: 'Remote Archive' },
        { value: 'insights', label: 'Red Hat Insights' },
      ],
    },
    {
      id: 'scm_url',
      label: 'Source control URL',
      type: 'text',
      required: true,
      placeholder: 'https://github.com/example/playbooks.git',
      showWhen: when(WITH_URL),
    },
    {
      id: 'scm_branch',
      label: 'Branch / tag / commit',
      type: 'text',
      hint: 'Leave empty for the default branch.',
      showWhen: when(['git', 'svn']),
    },
    {
      id: 'scm_refspec',
      label: 'Refspec',
      type: 'text',
      hint: 'Extra refs to fetch, e.g. refs/pull/*:refs/remotes/origin/pull/*',
      showWhen: when(['git']),
    },
    {
      id: 'credential',
      label: 'Source control credential',
      type: 'text',
      hint: 'Credential name (an Insights credential for Red Hat Insights). Leave empty for public repositories.',
      showWhen: when(SYNCED),
      lookup: credentialLookup(['scm', 'insights']),
    },
    {
      id: 'local_path',
      label: 'Playbook directory',
      type: 'text',
      required: true,
      hint: 'Directory with the playbooks under the controller\'s projects base path (/var/lib/awx/projects).',
      showWhen: when(['']),
    },
    {
      id: 'default_environment',
      label: 'Execution environment',
      type: 'text',
      hint: 'Name of the default execution environment for jobs using this project. Leave empty to use the organization\'s or the global default.',
      lookup: executionEnvironmentLookup,
    },
    { id: 'scm_clean', label: 'Clean', type: 'checkbox', hint: 'Remove local modifications before updating.', showWhen: when(SYNCED) },
    {
      id: 'scm_delete_on_update',
      label: 'Delete',
      type: 'checkbox',
      hint: 'Delete the local repository entirely before updating.',
      showWhen: when(SYNCED),
    },
    {
      id: 'scm_track_submodules',
      label: 'Track submodules',
      type: 'checkbox',
      hint: 'Update submodules to the latest commit on their tracked branch.',
      showWhen: when(['git']),
    },
    {
      id: 'scm_update_on_launch',
      label: 'Update revision on launch',
      type: 'checkbox',
      hint: 'Sync the project before every job that uses it.',
      showWhen: when(SYNCED),
    },
    {
      id: 'allow_override',
      label: 'Allow branch override',
      type: 'checkbox',
      hint: 'Let job templates and inventory sources pick a different branch or revision.',
      showWhen: when(WITH_URL),
    },
    {
      id: 'scm_update_cache_timeout',
      label: 'Cache timeout (seconds)',
      type: 'number',
      min: 0,
      defaultValue: '0',
      hint: 'With "Update revision on launch": how long a sync is reused. 0 syncs every time.',
      showWhen: when(SYNCED),
    },
    {
      id: 'timeout',
      label: 'Update timeout (seconds)',
      type: 'number',
      min: 0,
      defaultValue: '0',
      hint: 'Cancel a project sync after this long. 0 means no timeout.',
      showWhen: when(SYNCED),
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
    const scmType = values.scm_type as ProjectScmType;
    if (!PROJECT_SCM_TYPES.includes(scmType)) {
      fieldErrors.scm_type = ['Unknown source control type.'];
    }
    // Hidden fields keep whatever was typed before switching type; only the visible ones count.
    const applies = (types: ProjectScmType[]) => types.includes(scmType);
    const checked = (id: string, types: ProjectScmType[]) => applies(types) && values[id] === 'true';
    const project: ProjectInput = {
      name: required('name'),
      description: values.description.trim(),
      organization: required('organization'),
      scmType,
      scmUrl: applies(WITH_URL) ? required('scm_url') : '',
      scmBranch: applies(['git', 'svn']) ? values.scm_branch.trim() : '',
      scmRefspec: applies(['git']) ? values.scm_refspec.trim() : '',
      credential: applies(SYNCED) ? values.credential.trim() : '',
      localPath: applies(['']) ? required('local_path') : '',
      scmClean: checked('scm_clean', SYNCED),
      scmDeleteOnUpdate: checked('scm_delete_on_update', SYNCED),
      scmTrackSubmodules: checked('scm_track_submodules', ['git']),
      scmUpdateOnLaunch: checked('scm_update_on_launch', SYNCED),
      allowOverride: checked('allow_override', WITH_URL),
      scmUpdateCacheTimeout: applies(SYNCED)
        ? parseInteger(values.scm_update_cache_timeout, 'scm_update_cache_timeout', fieldErrors, { min: 0 })
        : 0,
      timeout: applies(SYNCED) ? parseInteger(values.timeout, 'timeout', fieldErrors, { min: 0 }) : 0,
      defaultEnvironment: values.default_environment.trim(),
    };
    return Object.keys(fieldErrors).length ? { fieldErrors } : { value: project };
  },
  create: (client, project) => client.createProject(project),
  playbook: projectPlaybook,
  existing: {
    endpoint: 'api/controller/v2/projects/',
    organizationFilter: 'organization',
    async read(client, id) {
      const project = await client.get<Record<string, unknown>>(`api/controller/v2/projects/${id}/`);
      const [organization, credential, defaultEnvironment] = await Promise.all([
        client.controllerName('organizations', project.organization as number | null),
        client.controllerName('credentials', project.credential as number | null),
        client.controllerName('execution_environments', project.default_environment as number | null),
      ]);
      const values: Record<string, string> = { organization, credential, default_environment: defaultEnvironment };
      for (const key of [
        'name', 'description', 'scm_type', 'scm_url', 'scm_branch', 'scm_refspec', 'local_path', 'scm_clean', 'scm_delete_on_update',
        'scm_track_submodules', 'scm_update_on_launch', 'allow_override', 'scm_update_cache_timeout', 'timeout',
      ]) {
        values[key] = text(project[key]);
      }
      return { values };
    },
    update: (client, existing, project) => client.updateProject(existing.id, project),
  },
};
