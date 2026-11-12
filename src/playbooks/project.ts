import { ProjectInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the project with infra.aap_configuration.controller_projects. */
export function projectPlaybook(
  project: ProjectInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const target = playbookTarget('project', project.name, existing);
  const synced = project.scmType !== '';
  // Optional text settings are only written when set, so the playbook mirrors what was entered.
  const optional = (key: string, value: string) => (value ? { [key]: value } : {});
  const item = {
    ...target.nameKeys,
    description: project.description,
    organization: project.organization,
    scm_type: project.scmType || 'manual',
    ...optional('scm_url', project.scmUrl),
    ...optional('scm_branch', project.scmBranch),
    ...optional('scm_refspec', project.scmRefspec),
    ...optional('credential', project.credential),
    ...optional('local_path', project.localPath),
    ...optional('default_environment', project.defaultEnvironment),
    ...(synced
      ? {
          scm_clean: project.scmClean,
          scm_delete_on_update: project.scmDeleteOnUpdate,
          ...(project.scmType === 'git' ? { scm_track_submodules: project.scmTrackSubmodules } : {}),
          scm_update_on_launch: project.scmUpdateOnLaunch,
          ...(project.scmUpdateOnLaunch ? { scm_update_cache_timeout: project.scmUpdateCacheTimeout } : {}),
          ...(project.scmType !== 'insights' ? { allow_override: project.allowOverride } : {}),
          timeout: project.timeout,
        }
      : {}),
    state: 'present',
  };
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes: target.notes,
    playName: 'Create AAP project',
    role: 'controller_projects',
    data: toYaml({ controller_projects: [item] }),
    session,
    verifyTls,
  });
}
