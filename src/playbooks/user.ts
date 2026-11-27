import { ORGANIZATION_MEMBER_ROLE, PLATFORM_AUDITOR_ROLE, UserInput } from '../aapClient';
import { AapSession } from '../auth';
import { VaultedString, vaultEncrypt } from '../vault';
import { VaultSecret } from '../vaultPassword';
import { configurationPlaybook, toYaml } from './yaml';

/**
 * Builds a playbook that creates the user with infra.aap_configuration.gateway_users, then gives it
 * its organization memberships and the auditor role with gateway_role_user_assignments (the role
 * assignments that replace the deprecated organizations / is_platform_auditor user options).
 * The password is encrypted with Ansible Vault; without one, the stored password is kept.
 */
export function userPlaybook(
  user: UserInput,
  session: AapSession | undefined,
  verifyTls: boolean,
  vault: VaultSecret | undefined,
  existing?: { name: string },
): string {
  const notes: string[] = [];
  if (existing && existing.name !== user.name) {
    notes.push(
      `The gateway_users role cannot rename users: rename "${existing.name}" to "${user.name}" in AAP`,
      'first, or this playbook creates a separate user.',
    );
  }
  if (existing) {
    if (notes.length) notes.push('');
    notes.push('Role assignments are only added: memberships removed in the form stay in AAP.');
  }
  const assignments = [
    ...(user.organizations.length ? [{ role_definition: ORGANIZATION_MEMBER_ROLE, user: user.name, object_ids: user.organizations }] : []),
    ...(user.userType === 'auditor' ? [{ role_definition: PLATFORM_AUDITOR_ROLE, user: user.name }] : []),
  ];
  const optional = (key: string, value: string) => (value ? { [key]: value } : {});
  const account = {
    username: user.name,
    ...(user.password && vault
      ? { password: new VaultedString(vaultEncrypt(user.password, vault.password, vault.vaultId)) }
      : { update_secrets: false }),
    ...optional('first_name', user.firstName),
    ...optional('last_name', user.lastName),
    ...optional('email', user.email),
    is_superuser: user.userType === 'superuser',
    state: 'present',
  };
  const verb = existing ? 'Creates or updates' : 'Creates';
  return configurationPlaybook({
    title: `${verb} the "${user.name}" user in Ansible Automation Platform.`,
    notes,
    playName: 'Create AAP user',
    role: assignments.length ? ['gateway_users', 'gateway_role_user_assignments'] : 'gateway_users',
    data: toYaml({
      aap_user_accounts: [account],
      ...(assignments.length ? { gateway_role_user_assignments: assignments } : {}),
    }),
    session,
    verifyTls,
    ...(user.password && vault ? { vaultId: vault.vaultId } : {}),
  });
}
