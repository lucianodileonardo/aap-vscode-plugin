import { USER_TYPES, UserInput, UserType } from '../aapClient';
import { userPlaybook } from '../playbooks/user';
import { getVaultSecret } from '../vaultPassword';
import { FieldErrors, ResourceFormSpec } from '../views/resourceFormPanel';
import { text } from './existing';
import { gatewayOrganizationsLookup } from './lookups';

const USER_TYPE_LABELS: Record<UserType, string> = {
  normal: 'Normal user',
  auditor: 'Platform auditor (read-only access to everything)',
  superuser: 'Platform administrator (superuser)',
};

const lines = (value: string) => [...new Set(value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean))];

export const userForm: ResourceFormSpec<UserInput> = {
  viewType: 'aap.createUser',
  noun: 'user',
  fields: [
    { id: 'name', label: 'Username', type: 'text', required: true },
    {
      id: 'password',
      label: 'Password',
      type: 'password',
      hint: 'Required for a new user. When editing, leave empty to keep the current password.',
    },
    { id: 'password_confirm', label: 'Confirm password', type: 'password' },
    { id: 'first_name', label: 'First name', type: 'text' },
    { id: 'last_name', label: 'Last name', type: 'text' },
    { id: 'email', label: 'Email', type: 'text', placeholder: 'user@example.com' },
    {
      id: 'user_type',
      label: 'User type',
      type: 'select',
      defaultValue: 'normal',
      options: USER_TYPES.map((value) => ({ value, label: USER_TYPE_LABELS[value] })),
    },
    {
      id: 'organizations',
      label: 'Organizations',
      type: 'textarea',
      hint: 'One per line. The user becomes a member ("Organization Member" role) of each.',
      lookup: gatewayOrganizationsLookup,
    },
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const name = values.name.trim();
    if (!name) {
      fieldErrors.name = ['This field is required.'];
    } else if (!/^[\w.@+-]+$/.test(name)) {
      fieldErrors.name = ['Use letters, digits and @ . + - _ only.'];
    }
    // Passwords are taken as typed: spaces can be part of them.
    if (values.password !== values.password_confirm) {
      fieldErrors.password_confirm = ['The passwords do not match.'];
    }
    const email = values.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) {
      fieldErrors.email = ['Enter a valid email address.'];
    }
    const userType = values.user_type as UserType;
    if (!USER_TYPES.includes(userType)) {
      fieldErrors.user_type = ['Choose one of the listed options.'];
    }
    if (Object.keys(fieldErrors).length) {
      return { fieldErrors };
    }
    return {
      value: {
        name,
        password: values.password,
        firstName: values.first_name.trim(),
        lastName: values.last_name.trim(),
        email,
        userType,
        organizations: lines(values.organizations),
      },
    };
  },
  create: (client, user) => client.createUser(user),
  async playbook(user, session, verifyTls, existing) {
    // The vault password is only needed when there is a password to encrypt.
    const vault = user.password ? await getVaultSecret() : undefined;
    if (user.password && !vault) {
      return undefined;
    }
    return userPlaybook(user, session, verifyTls, vault, existing);
  },
  existing: {
    endpoint: 'api/gateway/v1/users/',
    orderBy: 'username',
    async read(client, id) {
      const [user, roles] = await Promise.all([client.get<Record<string, unknown>>(`api/gateway/v1/users/${id}/`), client.userRoles(id)]);
      return {
        values: {
          name: text(user.username),
          password: '',
          password_confirm: '',
          first_name: text(user.first_name),
          last_name: text(user.last_name),
          email: text(user.email),
          user_type: user.is_superuser ? 'superuser' : roles.auditor ? 'auditor' : 'normal',
          organizations: roles.organizations.join('\n'),
        },
      };
    },
    update: (client, existing, user) => client.updateUser(existing.id, user),
  },
};
