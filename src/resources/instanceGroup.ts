import { InstanceGroupInput } from '../aapClient';
import { instanceGroupPlaybook } from '../playbooks/instanceGroup';
import { FieldErrors, FormField, ResourceFormSpec } from '../views/resourceFormPanel';
import { parseInteger, parseList, parseMapping } from './parse';
import { credentialLookup, instancesLookup } from './lookups';

const POD_SPEC_EXAMPLE = `apiVersion: v1
kind: Pod
metadata:
  namespace: aap
spec:
  serviceAccountName: default
  automountServiceAccountToken: false
  containers:
    - image: registry.redhat.io/ansible-automation-platform-25/ee-minimal-rhel9:latest
      name: worker
      args:
        - ansible-runner
        - worker
        - --private-data-dir=/runner`;

const capacityFields: FormField[] = [
  { id: 'max_concurrent_jobs', label: 'Max concurrent jobs', type: 'number', min: 0, defaultValue: '0', hint: '0 means no limit.' },
  { id: 'max_forks', label: 'Max forks', type: 'number', min: 0, defaultValue: '0', hint: '0 means no limit.' },
];

export const instanceGroupForm: ResourceFormSpec<InstanceGroupInput> = {
  viewType: 'aap.createInstanceGroup',
  noun: 'instance group',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    {
      id: 'policy_instance_minimum',
      label: 'Policy instance minimum',
      type: 'number',
      min: 0,
      defaultValue: '0',
      hint: 'Minimum number of instances automatically assigned to this group when new instances come online.',
    },
    {
      id: 'policy_instance_percentage',
      label: 'Policy instance percentage',
      type: 'number',
      min: 0,
      max: 100,
      defaultValue: '0',
      hint: 'Minimum percentage of all instances automatically assigned to this group when new instances come online.',
    },
    {
      id: 'policy_instance_list',
      label: 'Policy instance list',
      type: 'textarea',
      hint: 'Host names of instances always assigned to this group, one per line.',
      placeholder: 'exec-node-1.example.com\nexec-node-2.example.com',
      lookup: instancesLookup,
    },
    ...capacityFields,
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const name = requiredName(values, fieldErrors);
    const group: InstanceGroupInput = {
      name,
      isContainerGroup: false,
      credential: '',
      podSpecOverride: '',
      policyInstanceMinimum: parseInteger(values.policy_instance_minimum, 'policy_instance_minimum', fieldErrors, { min: 0 }),
      policyInstancePercentage: parseInteger(values.policy_instance_percentage, 'policy_instance_percentage', fieldErrors, { min: 0, max: 100 }),
      policyInstanceList: parseList(values.policy_instance_list),
      ...parseCapacity(values, fieldErrors),
    };
    return Object.keys(fieldErrors).length ? { fieldErrors } : { value: group };
  },
  create: (client, group) => client.createInstanceGroup(group),
  playbook: instanceGroupPlaybook,
};

export const containerGroupForm: ResourceFormSpec<InstanceGroupInput> = {
  viewType: 'aap.createContainerGroup',
  noun: 'container group',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    {
      id: 'credential',
      label: 'Credential',
      type: 'text',
      hint: 'Name of a "Kubernetes/OpenShift API Bearer Token" credential. Leave empty to use the service account of the pod AAP runs in.',
      lookup: credentialLookup(['kubernetes_bearer_token']),
    },
    {
      id: 'pod_spec_override',
      label: 'Pod spec override',
      type: 'code',
      hint: 'Optional YAML or JSON pod specification. Leave empty to use the default pod spec.',
      placeholder: POD_SPEC_EXAMPLE,
    },
    ...capacityFields,
  ],
  parse(values) {
    const fieldErrors: FieldErrors = {};
    const name = requiredName(values, fieldErrors);
    // The pod spec is sent as text, exactly as written; parsing only checks that it is a valid mapping.
    const podSpecOverride = values.pod_spec_override.trim() ? values.pod_spec_override.replace(/\s+$/, '') + '\n' : '';
    parseMapping(podSpecOverride, 'pod_spec_override', fieldErrors);
    const group: InstanceGroupInput = {
      name,
      isContainerGroup: true,
      credential: values.credential.trim(),
      podSpecOverride,
      policyInstanceMinimum: 0,
      policyInstancePercentage: 0,
      policyInstanceList: [],
      ...parseCapacity(values, fieldErrors),
    };
    return Object.keys(fieldErrors).length ? { fieldErrors } : { value: group };
  },
  create: (client, group) => client.createInstanceGroup(group),
  playbook: instanceGroupPlaybook,
};

function requiredName(values: Record<string, string>, fieldErrors: FieldErrors): string {
  const name = values.name.trim();
  if (!name) {
    fieldErrors.name = ['This field is required.'];
  }
  return name;
}

function parseCapacity(values: Record<string, string>, fieldErrors: FieldErrors) {
  return {
    maxConcurrentJobs: parseInteger(values.max_concurrent_jobs, 'max_concurrent_jobs', fieldErrors, { min: 0 }),
    maxForks: parseInteger(values.max_forks, 'max_forks', fieldErrors, { min: 0 }),
  };
}
