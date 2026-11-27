import { ExecutionEnvironmentInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the execution environment with infra.aap_configuration.controller_execution_environments. */
export function executionEnvironmentPlaybook(
  ee: ExecutionEnvironmentInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  existing?: { name: string },
): string {
  const target = playbookTarget('execution environment', ee.name, existing);
  // Optional settings are only written when set; an empty pull keeps the platform default.
  const optional = (key: string, value: string) => (value ? { [key]: value } : {});
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes: target.notes,
    playName: 'Create AAP execution environment',
    role: 'controller_execution_environments',
    data: toYaml({
      controller_execution_environments: [
        {
          ...target.nameKeys,
          description: ee.description,
          image: ee.image,
          ...optional('pull', ee.pull),
          ...optional('organization', ee.organization),
          ...optional('credential', ee.credential),
          state: 'present',
        },
      ],
    }),
    session,
    verifyTls,
  });
}
