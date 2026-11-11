# Ansible Automation Platform for VSCodium / VS Code

Work with Red Hat Ansible Automation Platform **2.5, 2.6 and 2.7** from the editor.

## Features

### Login
- **AAP: Log In** — asks for the platform gateway URL, checks the AAP version, then logs in with
  either **username/password** or an **API token**.
- **AAP: Log Out** — removes the stored credentials.
- Status bar item shows who you are logged in as; click it to switch account, log out or open the log.
- Credentials go in the editor's SecretStorage (OS keyring), never in settings. The session is
  checked again at startup.
- AAP 2.4 and earlier (no platform gateway) and versions newer than 2.7 are rejected.

### Organizations
**AAP: Create Organization** opens a form (name, description) in an editor tab, also reachable
from the status bar menu. Choose one or both actions:

- **Use AAP API** — creates the organization right away through the platform gateway API. Errors
  from AAP (e.g. a name that already exists) are shown next to the field. Needs a login with rights
  to create organizations (e.g. a platform admin).
- **Generate Playbook** — opens an unsaved playbook that creates the same organization with the
  `infra.aap_configuration.gateway_organizations` role. Works without logging in. No secrets are
  written to it:
  ```bash
  ansible-galaxy collection install infra.aap_configuration ansible.platform ansible.controller
  AAP_PASSWORD=... ansible-playbook create_org.yml     # or AAP_TOKEN=... for token logins
  ```
  `ansible.platform` and `ansible.controller` come from Red Hat Automation Hub. `AAP_HOSTNAME` /
  `AAP_USERNAME` override the defaults taken from your current login.

### Credential types
**AAP: Create Credential Type** opens the same kind of form, with the same **Use AAP API** /
**Generate Playbook** actions, for a custom credential type in automation controller:

- **Name**, **Description**, **Kind** (`cloud` or `net`, the only kinds allowed for custom types)
- **Input configuration** and **Injector configuration** in YAML or JSON, as in the AAP UI.
  Templates must be quoted, e.g. `MY_TOKEN: '{{ api_token }}'`.

The API call is `POST /api/controller/v2/credential_types/`. The playbook uses the
`infra.aap_configuration.controller_credential_types` role; injector templates are written as
`!unsafe` so Ansible passes them to AAP unchanged.

### Credentials
**AAP: Create Credential** — same form and actions, for a credential in automation controller:

- **Name**, **Description**, **Organization** and **Credential type** (by name, e.g. `Machine`)
- **Inputs** as a YAML or JSON mapping of the credential type's fields, e.g.
  `username: deploy` / `password: s3cr3t` (multi-line keys with `ssh_key_data: |`).

With **Use AAP API**, the organization and credential type names are looked up and the credential
is created with `POST /api/controller/v2/credentials/`.

With **Generate Playbook**, the data is **vaulted**: every string input is encrypted inline with
Ansible Vault (`!vault |`, AES256, the same format as `ansible-vault encrypt_string`), so the
playbook can be committed safely. Booleans and numbers stay plain to keep their type. The vault
password is asked for (twice) each time, or read from `aap.vaultPasswordFile`; `aap.vaultId`
adds a vault ID label. The playbook uses `infra.aap_configuration.controller_credentials` with
secure logging on. Run it with `--ask-vault-pass`, `--vault-password-file <file>` or
`--vault-id <label>@prompt`.

### Instance groups and container groups
**AAP: Create Instance Group** and **AAP: Create Container Group** — same form and actions,
for automation controller instance groups (`POST /api/controller/v2/instance_groups/`, playbook
role `infra.aap_configuration.controller_instance_groups`):

- **Instance group**: name, policy instance minimum, policy instance percentage (0–100), policy
  instance list (host names, one per line), max concurrent jobs and max forks (0 = no limit).
- **Container group**: name, optional **Kubernetes/OpenShift API Bearer Token** credential (by
  name; empty uses the service account of the pod AAP runs in), optional **pod spec override**
  in YAML/JSON (sent exactly as written; written as a readable `|` block in the playbook), max
  concurrent jobs and max forks.

### Projects
**AAP: Create Project** — same form and actions (`POST /api/controller/v2/projects/`, playbook
role `infra.aap_configuration.controller_projects`). The form adapts to the source control type
(Manual, Git, Subversion, Remote Archive, Red Hat Insights) and only shows the settings that
apply: URL, branch, refspec, source control credential, playbook directory (manual), execution
environment, the Clean / Delete / Track submodules / Update on launch / Allow branch override
options, cache timeout and update timeout. Organization, credential and execution environment
are given by name and looked up when using the API.

### Inventories
**AAP: Create Inventory** — same form and actions. **Inventory type** picks one of the three kinds
the AAP UI offers, and the form shows only that kind's settings:

- **Inventory** (`POST /api/controller/v2/inventories/`): name, description, organization,
  instance groups (in order of preference), prevent instance group fallback, variables (YAML/JSON).
- **Smart inventory**: the same plus a required **smart host filter** (e.g. `name__icontains=web`).
- **Constructed inventory** (`POST /api/controller/v2/constructed_inventories/`): the same plus
  **input inventories** (in order; later ones override variables of earlier ones), **source vars**
  (the `ansible.builtin.constructed` plugin configuration: groups, keyed_groups, compose...),
  limit, cache timeout and verbosity.

With the API, names are resolved first, then input inventories and instance groups are attached
in the given order. The playbook uses `infra.aap_configuration.controller_inventories`. For a
constructed inventory, AAP creates the inventory's source itself (named
`Auto-created source for: <inventory>`), so the playbook then sets its source vars, limit, cache
timeout and verbosity with `controller_inventory_sources`.

### Inventory sources
**AAP: Create Inventory Source** — same form and actions (`POST /api/controller/v2/inventory_sources/`,
playbook role `infra.aap_configuration.controller_inventory_sources`): name, description, inventory
(a regular one: smart and constructed inventories cannot have sources), **source** (Sourced from a
Project, Amazon EC2, Google Compute Engine, Azure Resource Manager, VMware vCenter, Satellite 6,
OpenStack, Red Hat Virtualization, Red Hat Ansible Automation Platform, Insights, Terraform State,
OpenShift Virtualization), credential, execution environment, verbosity, host filter, enabled
variable/value, limit, overwrite, overwrite variables, update on launch (with cache timeout),
timeout and source variables (the inventory plugin options, YAML/JSON). A project source also
takes the **project**, the **inventory file** and an optional branch.

### Job templates
**AAP: Create Job Template** — same form and actions (`POST /api/controller/v2/job_templates/`,
playbook role `infra.aap_configuration.controller_job_templates`, list `controller_templates`):
name, description, job type, inventory, project, playbook, execution environment, credentials and
instance groups (one name per line), extra variables (YAML/JSON), limit, source control branch,
job/skip tags, verbosity, forks, job slicing, timeout, the privilege escalation / show changes /
fact storage / concurrent jobs / instance group fallback options, and **Prompt on launch** for
15 settings. The inventory may be left empty when it is prompted on launch.

With the API, every name is resolved first (unknown or ambiguous names are reported and nothing
is created); credentials and instance groups are then attached in the given order.

### Online Mode (all forms)
Each form has an **Online Mode** checkbox (off by default). Turning it on requires an AAP login —
asked for only if there is none yet; the login is shared by all forms and the status bar, so
logging in from the job template form also serves the project form. Fields that name AAP
objects then become lists loaded from AAP instead of text boxes:

| Form | Lists |
|---|---|
| Credential | organization, credential type |
| Instance group | policy instance list (instances, multi-select) |
| Container group | credential (Kubernetes/OpenShift bearer token credentials) |
| Project | organization, source control credential (SCM/Insights), execution environment |
| Inventory | organization, input inventories (multi-select, constructed only), instance groups (multi-select) |
| Inventory source | inventory (regular inventories), project, inventory file (reloads when the project changes), credential (only the types the chosen source takes), execution environment |
| Job template | inventory, project, playbook (reloads when the project changes), execution environment, credentials and instance groups (multi-select) |

Text typed before going online is preselected (unknown names are kept, marked "not found in
AAP"); turning Online Mode off copies the picked values back into the text boxes. Lists reload
when you switch account, and online forms drop back to text boxes when you log out.

### Workflow designer
**AAP: Workflow Designer** (also in the status bar menu) is a visual editor for workflow job
templates that works connected to AAP, like the platform's own workflow visualizer. It uses the
shared login (asking for one if needed); if you log out, the designer waits for a new login
and keeps your unsaved changes.

- **Open or create:** pick a workflow from the list to edit it, or start a new one. **Details**
  holds the workflow job template settings: name, description, organization, inventory, limit,
  source control branch, labels (new ones are created on save), job/skip tags, extra variables,
  each with *Prompt on launch*, plus concurrent jobs and webhooks (GitHub, GitLab, Bitbucket
  Data Center, with an optional token credential).
- **Nodes:** job template, workflow job template, project sync, inventory source sync,
  management job, and approval (name, description, timeout). Use **+** on START or on a node to
  add a step after it, choosing whether it runs *on success*, *on failure* or *always*.
  - Templates are picked from searchable lists loaded from AAP.
  - When a template prompts on launch, the node offers exactly those prompts: inventory,
    credentials, execution environment, instance groups, labels, job type, branch, limit, tags,
    verbosity, forks, slicing, timeout, show changes and variables. The template's defaults are
    shown as hints.
  - Surveys are filled in with their defaults, and required answers are enforced.
  - Each node also has **convergence** (any/all parents) and an optional **node alias**.
  - Cleanup management jobs take *days of data to keep*.
- **Links:** **Link to…** connects a node to another one. Click a link to change its type or
  remove it. Links that would create a loop or repeat a pair are refused.
- **Removing a node** re-attaches its children to its parents, as in AAP. **Remove all** clears
  the graph.
- **Canvas:** automatic left-to-right layout (long links route around nodes), drag to move
  nodes, pan, scroll to zoom, fit to screen, re-arrange, and a legend. Keys: <kbd>Del</kbd>
  removes the selection, <kbd>Ctrl/Cmd+Z</kbd> undoes a graph change, <kbd>Esc</kbd> cancels.
- **Use AAP API** saves the workflow: it creates or updates the template, deletes removed nodes,
  creates new ones, updates only the changed ones, and adds or removes links. As in AAP, this
  is not atomic. If a step fails, what was already saved is remembered, so saving again
  continues without creating duplicates.
- **Generate Playbook** opens an infra.aap_configuration playbook. `controller_labels` creates
  the labels, then `controller_workflow_job_templates` creates the workflow, with
  `workflow_nodes` describing the whole graph and `destroy_current_nodes: true`. Survey password
  answers are encrypted with Ansible Vault. AAP never returns stored passwords
  (`$encrypted$`), so those answers are left out and listed in the playbook header.
- **Not covered:** editing the workflow's own survey, notifications, schedules and access roles.
  Those are separate tabs in AAP.

## Generated playbooks
Every generated playbook uses a role from
[infra.aap_configuration](https://galaxy.ansible.com/ui/repo/published/infra/aap_configuration/)
and is built by `configurationPlaybook()` in `src/playbooks/yaml.ts`, which supplies the shared
header, connection variables (`aap_hostname`, `aap_username`/`aap_password` or `aap_token`,
`aap_validate_certs`) and the role call. `toYaml()` writes the role data and tags any string
containing Jinja as `!unsafe`.

## Adding a new "create" form
Each form is a `ResourceFormSpec` in `src/resources/` (fields, validation, API call, playbook;
fields naming AAP objects get a `lookup` from `src/resources/lookups.ts` for Online Mode),
rendered by the shared `ResourceFormPanel` in `src/views/resourceFormPanel.ts`, which also adds
the header with the extension logo (`media/logo.png`, drawn from `media/logo.svg`; also the tab icon and, as `media/icon.png`, the extension icon). Add the
form to the `FORMS` table in `src/extension.ts` (command + status bar menu) and declare the
command in `package.json`.

The workflow designer is not a form; it is built from these pieces:

| File | Contents |
|---|---|
| `src/views/workflowDesignerPanel.ts` | the panel; request/response messages with the webview |
| `src/workflows/aapWorkflows.ts` | AAP access: load, lists, launch info, validation, diff save |
| `src/workflows/types.ts` | the shared model |
| `src/playbooks/workflow.ts` | the playbook |
| `media/workflowDesigner.js` and `media/workflowDesigner.css` | the webview |

## Settings
| Setting | Default | Description |
|---|---|---|
| `aap.url` | `""` | Default gateway URL at login |
| `aap.verifyTls` | `true` | Verify the server certificate (turn off only for self-signed lab installs) |
| `aap.requestTimeoutSeconds` | `30` | HTTP request timeout |
| `aap.vaultPasswordFile` | `""` | Vault password file for encrypting generated playbooks; empty = ask each time |
| `aap.vaultId` | `""` | Optional vault ID label for encrypted values |

## Development
```bash
npm install
npm run compile      # type-check + bundle with esbuild (or: npm run watch)
npm run package      # builds aap-vscode-<version>.vsix
codium --install-extension aap-vscode-0.1.0.vsix
```
Press **F5** in VSCodium/VS Code to start an Extension Development Host.
