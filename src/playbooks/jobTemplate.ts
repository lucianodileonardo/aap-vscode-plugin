import { JobTemplateInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the job template with infra.aap_configuration.controller_job_templates. */
export function jobTemplatePlaybook(
  template: JobTemplateInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const target = playbookTarget('job template', template.name, existing);
  // Optional settings are only written when set, so the playbook mirrors what was entered.
  const optional = (key: string, value: unknown, isSet: boolean) => (isSet ? { [key]: value } : {});
  const item = {
    ...target.nameKeys,
    description: template.description,
    job_type: template.jobType,
    ...optional('inventory', template.inventory, !!template.inventory),
    project: template.project,
    playbook: template.playbook,
    ...optional('execution_environment', template.executionEnvironment, !!template.executionEnvironment),
    ...optional('credentials', template.credentials, template.credentials.length > 0),
    ...optional('instance_groups', template.instanceGroups, template.instanceGroups.length > 0),
    ...optional('extra_vars', template.extraVars, Object.keys(template.extraVars).length > 0),
    ...optional('limit', template.limit, !!template.limit),
    ...optional('scm_branch', template.scmBranch, !!template.scmBranch),
    ...optional('job_tags', template.jobTags, !!template.jobTags),
    ...optional('skip_tags', template.skipTags, !!template.skipTags),
    ...optional('forks', template.forks, template.forks > 0),
    verbosity: template.verbosity,
    ...optional('timeout', template.timeout, template.timeout > 0),
    ...optional('job_slice_count', template.jobSliceCount, template.jobSliceCount > 1),
    become_enabled: template.becomeEnabled,
    diff_mode: template.diffMode,
    use_fact_cache: template.useFactCache,
    allow_simultaneous: template.allowSimultaneous,
    prevent_instance_group_fallback: template.preventInstanceGroupFallback,
    ...Object.fromEntries(template.promptOnLaunch.map((prompt) => [`ask_${prompt}_on_launch`, true])),
    state: 'present',
  };
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes: target.notes,
    playName: 'Create AAP job template',
    role: 'controller_job_templates',
    data: toYaml({ controller_templates: [item] }),
    session,
    verifyTls,
  });
}
