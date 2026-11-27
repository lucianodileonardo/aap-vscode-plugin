import { RoleDefinitionInput } from '../aapClient';
import { roleDefinitionPlaybook } from '../playbooks/roleDefinition';
import { FieldErrors, FieldLookup, ResourceFormSpec } from '../views/resourceFormPanel';
import { text } from './existing';

/** Readable names of the models roles apply to (the part after the app label). */
const MODEL_LABELS: Record<string, string> = {
  organization: 'Organization',
  team: 'Team',
  credential: 'Credential',
  executionenvironment: 'Execution environment',
  instancegroup: 'Instance group',
  inventory: 'Inventory',
  jobtemplate: 'Job template',
  notificationtemplate: 'Notification template',
  project: 'Project',
  workflowjobtemplate: 'Workflow job template',
  activation: 'Rulebook activation',
  credentialinputsource: 'Credential input source',
  decisionenvironment: 'Decision environment',
  edacredential: 'EDA credential',
  eventstream: 'Event stream',
  ansiblerepository: 'Ansible repository',
  collectionremote: 'Collection remote',
  containernamespace: 'Container namespace',
  containerrepository: 'Container repository',
  namespace: 'Namespace',
  task: 'Task',
};

/** The AAP service each app label belongs to, as the AAP UI names them. */
const SERVICE_LABELS: Record<string, string> = {
  shared: 'Platform',
  awx: 'Automation Execution',
  eda: 'Automation Decisions',
  galaxy: 'Automation Content',
};

const CONTENT_TYPE = /^[a-z_]+\.[a-z_]+$/;
const PERMISSION = /^[a-z_]+\.[a-z]+_[a-z_]+$/;

function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

/** "awx.jobtemplate" -> "Job template — Automation Execution (awx.jobtemplate)". */
function contentTypeLabel(contentType: string): string {
  const [app, model] = contentType.split('.');
  const service = SERVICE_LABELS[app];
  return `${modelLabel(model)}${service ? ` — ${service}` : ''} (${contentType})`;
}

/** "awx.execute_jobtemplate" -> "Execute job template (awx.execute_jobtemplate)". */
function permissionLabel(permission: string): string {
  const match = /^[a-z_]+\.([a-z]+)_([a-z_]+)$/.exec(permission);
  if (!match) {
    return permission;
  }
  const [, action, model] = match;
  return `${action[0].toUpperCase()}${action.slice(1)} ${modelLabel(model).toLowerCase()} (${permission})`;
}

/** Content types roles can be created for, from AAP's role metadata. */
const contentTypeLookup: FieldLookup = {
  async load(client) {
    const metadata = await client.roleMetadata();
    return Object.keys(metadata)
      .sort((a, b) => contentTypeLabel(a).localeCompare(contentTypeLabel(b)))
      .map((contentType) => ({ value: contentType, label: contentTypeLabel(contentType) }));
  },
};

/** Permissions the chosen content type accepts (its own and those of the objects it contains). */
const permissionsLookup: FieldLookup = {
  multiple: true,
  dependsOn: ['contentType'],
  async load(client, values) {
    const contentType = values.contentType?.trim();
    if (!contentType) {
      return [];
    }
    const permissions = (await client.roleMetadata())[contentType] ?? [];
    return [...permissions].sort().map((permission) => ({ value: permission, label: permissionLabel(permission) }));
  },
};

export const roleDefinitionForm: ResourceFormSpec<RoleDefinitionInput> = {
  viewType: 'aap.createRole',
  noun: 'role',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Job Template Runner' },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'contentType',
      label: 'Resource type',
      type: 'text',
      required: true,
      placeholder: 'awx.jobtemplate',
      hint:
        'The kind of object the role is granted on, e.g. awx.jobtemplate, awx.inventory, awx.project, ' +
        'awx.credential, awx.workflowjobtemplate, shared.organization, shared.team. Cannot be changed later.',
      lookup: contentTypeLookup,
    },
    {
      id: 'permissions',
      label: 'Permissions',
      type: 'textarea',
      required: true,
      placeholder: 'awx.view_jobtemplate\nawx.execute_jobtemplate',
      hint:
        'One per line. Include the view permission of the resource type (e.g. awx.view_jobtemplate). ' +
        'An organization role can also hold permissions on the objects it contains (e.g. awx.add_project).',
      lookup: permissionsLookup,
    },
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const name = values.name.trim();
    if (!name) {
      fieldErrors.name = ['This field is required.'];
    }
    const contentType = values.contentType.trim();
    if (!contentType) {
      fieldErrors.contentType = ['This field is required.'];
    } else if (!CONTENT_TYPE.test(contentType)) {
      fieldErrors.contentType = ['Use the form app.model, e.g. awx.jobtemplate.'];
    }
    const permissions = [...new Set(values.permissions.split(/[\n,]/).map((p) => p.trim()).filter(Boolean))];
    const malformed = permissions.filter((p) => !PERMISSION.test(p));
    if (!permissions.length) {
      fieldErrors.permissions = ['Choose at least one permission.'];
    } else if (malformed.length) {
      fieldErrors.permissions = [`Use the form app.action_model, e.g. awx.view_jobtemplate. Not valid: ${malformed.join(', ')}.`];
    }
    if (Object.keys(fieldErrors).length) {
      return { fieldErrors };
    }
    return { value: { name, description: values.description.trim(), contentType, permissions } };
  },
  create: (client, role) => client.createRoleDefinition(role),
  playbook: roleDefinitionPlaybook,
  existing: {
    endpoint: async (client) => `${await client.rbacApi()}role_definitions/`,
    // Built-in (managed) roles cannot be changed.
    query: 'managed=false',
    lockedFields: ['contentType'],
    async read(client, id) {
      const role = await client.get<Record<string, unknown>>(`${await client.rbacApi()}role_definitions/${id}/`);
      return {
        values: {
          name: text(role.name),
          description: text(role.description),
          contentType: text(role.content_type),
          permissions: Array.isArray(role.permissions) ? role.permissions.map(String).join('\n') : '',
        },
      };
    },
    update: (client, existing, role) => client.updateRoleDefinition(existing.id, role),
  },
};
