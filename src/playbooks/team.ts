import { ExistingObject, TeamInput } from '../aapClient';
import { AapSession } from '../auth';
import { configurationPlaybook, playbookTarget, toYaml } from './yaml';

/** Builds a playbook that creates the team with infra.aap_configuration.gateway_teams. */
export function teamPlaybook(team: TeamInput, session: AapSession | undefined, verifyTls: boolean, existing?: ExistingObject): string {
  const target = playbookTarget('team', team.name, existing);
  // A team is identified by name and organization; moving it names the old one and the new one.
  const before = existing?.extra?.organization;
  const moved = before !== undefined && before !== team.organization;
  const notes = [...target.notes];
  if (moved) {
    if (notes.length) notes.push('');
    notes.push(`Moves the team from "${before}" to "${team.organization}" (organization / new_organization).`);
  }
  return configurationPlaybook({
    title: `${target.title} in Ansible Automation Platform.`,
    notes,
    playName: 'Create AAP team',
    role: 'gateway_teams',
    data: toYaml({
      aap_teams: [
        {
          ...target.nameKeys,
          description: team.description,
          organization: moved ? before : team.organization,
          ...(moved ? { new_organization: team.organization } : {}),
          state: 'present',
        },
      ],
    }),
    session,
    verifyTls,
  });
}
