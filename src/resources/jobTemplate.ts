import { JOB_TEMPLATE_PROMPTS, JOB_TYPES, JobTemplateInput, JobTemplatePrompt } from '../aapClient';
import { jobTemplatePlaybook } from '../playbooks/jobTemplate';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { parseInteger, parseList, parseMapping } from './parse';
import { credentialLookup, executionEnvironmentLookup, instanceGroupsLookup, inventoryLookup, playbookLookup, projectLookup } from './lookups';

const PROMPT_LABELS: Record<JobTemplatePrompt, string> = {
  inventory: 'Inventory',
  credential: 'Credentials',
  execution_environment: 'Execution environment',
  instance_groups: 'Instance groups',
  job_type: 'Job type',
  scm_branch: 'Source control branch',
  variables: 'Variables',
  limit: 'Limit',
  tags: 'Job tags',
  skip_tags: 'Skip tags',
  verbosity: 'Verbosity',
  forks: 'Forks',
  job_slice_count: 'Job slicing',
  timeout: 'Timeout',
  diff_mode: 'Show changes',
};

export const jobTemplateForm: ResourceFormSpec<JobTemplateInput> = {
  viewType: 'aap.createJobTemplate',
  noun: 'job template',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'job_type',
      label: 'Job type',
      type: 'select',
      defaultValue: 'run',
      options: [
        { value: 'run', label: 'Run' },
        { value: 'check', label: 'Check' },
      ],
    },
    {
      id: 'inventory',
      label: 'Inventory',
      type: 'text',
      required: true,
      hint: 'Inventory name. May be left empty only when the inventory is prompted on launch.',
      lookup: inventoryLookup,
    },
    { id: 'project', label: 'Project', type: 'text', required: true, hint: 'Project name.', lookup: projectLookup },
    {
      id: 'playbook',
      label: 'Playbook',
      type: 'text',
      required: true,
      placeholder: 'site.yml',
      hint: 'Path of the playbook inside the project.',
      lookup: playbookLookup,
    },
    {
      id: 'execution_environment',
      label: 'Execution environment',
      type: 'text',
      hint: 'Execution environment name. Leave empty for the project\'s default.',
      lookup: executionEnvironmentLookup,
    },
    {
      id: 'credentials',
      label: 'Credentials',
      type: 'textarea',
      hint: 'Credential names, one per line.',
      placeholder: 'Prod SSH\nVault password',
      lookup: credentialLookup(undefined, true),
    },
    {
      id: 'instance_groups',
      label: 'Instance groups',
      type: 'textarea',
      hint: 'Instance group names in order of preference, one per line. Leave empty to use the inventory\'s or organization\'s.',
      lookup: instanceGroupsLookup,
    },
    {
      id: 'extra_vars',
      label: 'Variables',
      type: 'code',
      hint: 'Extra variables as YAML or JSON.',
      placeholder: 'app_version: 1.2.3\nrestart_services: true',
    },
    { id: 'limit', label: 'Limit', type: 'text', hint: 'Host pattern restricting which hosts the job runs on.' },
    { id: 'scm_branch', label: 'Source control branch', type: 'text', hint: 'Only if the project allows branch override.' },
    { id: 'job_tags', label: 'Job tags', type: 'text', hint: 'Comma-separated tags to run.' },
    { id: 'skip_tags', label: 'Skip tags', type: 'text', hint: 'Comma-separated tags to skip.' },
    {
      id: 'verbosity',
      label: 'Verbosity',
      type: 'select',
      defaultValue: '0',
      options: ['Normal', 'Verbose', 'More verbose', 'Debug', 'Connection debug', 'WinRM debug'].map((label, level) => ({
        value: String(level),
        label: `${level} (${label})`,
      })),
    },
    { id: 'forks', label: 'Forks', type: 'number', min: 0, defaultValue: '0', hint: '0 uses the Ansible default (5).' },
    { id: 'job_slice_count', label: 'Job slicing', type: 'number', min: 1, defaultValue: '1', hint: 'Split the job into this many slices running in parallel.' },
    { id: 'timeout', label: 'Timeout (seconds)', type: 'number', min: 0, defaultValue: '0', hint: '0 means no timeout.' },
    { id: 'become_enabled', label: 'Privilege escalation', type: 'checkbox', hint: 'Run the playbook with become.' },
    { id: 'diff_mode', label: 'Show changes', type: 'checkbox', hint: 'Run in diff mode.' },
    { id: 'use_fact_cache', label: 'Enable fact storage', type: 'checkbox', hint: 'Cache gathered facts between jobs.' },
    { id: 'allow_simultaneous', label: 'Concurrent jobs', type: 'checkbox', hint: 'Allow several jobs from this template to run at once.' },
    {
      id: 'prevent_instance_group_fallback',
      label: 'Prevent instance group fallback',
      type: 'checkbox',
      hint: 'Use only this template\'s instance groups, never the inventory\'s or organization\'s.',
    },
    {
      id: 'prompt_on_launch',
      label: 'Prompt on launch',
      type: 'checkgroup',
      options: JOB_TEMPLATE_PROMPTS.map((prompt) => ({ value: prompt, label: PROMPT_LABELS[prompt] })),
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
    const promptOnLaunch = values.prompt_on_launch
      .split(',')
      .filter((p): p is JobTemplatePrompt => (JOB_TEMPLATE_PROMPTS as readonly string[]).includes(p));
    const jobType = values.job_type as JobTemplateInput['jobType'];
    if (!JOB_TYPES.includes(jobType)) {
      fieldErrors.job_type = ['Must be run or check.'];
    }
    const inventory = promptOnLaunch.includes('inventory') ? values.inventory.trim() : required('inventory');
    const extraVarsText = values.extra_vars.trim() ? values.extra_vars.replace(/\s+$/, '') + '\n' : '';
    const extraVars = parseMapping(extraVarsText, 'extra_vars', fieldErrors) ?? {};
    const template: JobTemplateInput = {
      name: required('name'),
      description: values.description.trim(),
      jobType,
      inventory,
      project: required('project'),
      playbook: required('playbook'),
      executionEnvironment: values.execution_environment.trim(),
      credentials: parseList(values.credentials),
      instanceGroups: parseList(values.instance_groups),
      extraVarsText,
      extraVars,
      limit: values.limit.trim(),
      scmBranch: values.scm_branch.trim(),
      jobTags: values.job_tags.trim(),
      skipTags: values.skip_tags.trim(),
      forks: parseInteger(values.forks, 'forks', fieldErrors, { min: 0 }),
      verbosity: parseInteger(values.verbosity, 'verbosity', fieldErrors, { min: 0, max: 5 }),
      timeout: parseInteger(values.timeout, 'timeout', fieldErrors, { min: 0 }),
      jobSliceCount: parseInteger(values.job_slice_count, 'job_slice_count', fieldErrors, { min: 1, fallback: 1 }),
      becomeEnabled: values.become_enabled === 'true',
      diffMode: values.diff_mode === 'true',
      useFactCache: values.use_fact_cache === 'true',
      allowSimultaneous: values.allow_simultaneous === 'true',
      preventInstanceGroupFallback: values.prevent_instance_group_fallback === 'true',
      promptOnLaunch,
    };
    return Object.keys(fieldErrors).length ? { fieldErrors } : { value: template };
  },
  create: (client, template) => client.createJobTemplate(template),
  playbook: jobTemplatePlaybook,
};
