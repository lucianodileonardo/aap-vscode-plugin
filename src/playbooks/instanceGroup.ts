import { InstanceGroupInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the instance or container group with infra.aap_configuration.controller_instance_groups. */
export function instanceGroupPlaybook(
  group: InstanceGroupInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const noun = group.isContainerGroup ? 'container group' : 'instance group';
  const target = playbookTarget(noun, group.name, existing);
  const item = group.isContainerGroup
    ? {
        ...target.nameKeys,
        is_container_group: true,
        ...(group.credential ? { credential: group.credential } : {}),
        ...(group.podSpecOverride ? { pod_spec_override: group.podSpecOverride } : {}),
        max_concurrent_jobs: group.maxConcurrentJobs,
        max_forks: group.maxForks,
        state: 'present',
      }
    : {
        ...target.nameKeys,
        policy_instance_minimum: group.policyInstanceMinimum,
        policy_instance_percentage: group.policyInstancePercentage,
        ...(group.policyInstanceList.length ? { policy_instance_list: group.policyInstanceList } : {}),
        max_concurrent_jobs: group.maxConcurrentJobs,
        max_forks: group.maxForks,
        state: 'present',
      };
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes: target.notes,
    playName: `Create AAP ${noun}`,
    role: 'controller_instance_groups',
    data: toYaml({ controller_instance_groups: [item] }),
    session,
    verifyTls,
  });
}
