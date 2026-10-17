# Process commands and the ERP adapter boundary

Actions configured in an element context are no longer passive buttons. The UI
asks the API to execute the exact action stored in the published process model.
The server rejects unknown processes, elements, actions and action kinds.

## Endpoint

`POST /api/processes/{processId}/elements/{elementId}/actions/{actionId}/execute`

The optional `instanceId` in the request connects the invocation to a concrete
process execution. The response contains status, message, external reference,
user and timestamp. Recent results are available through the element command
journal endpoint.

## Supported command kinds

- `ERP` — routed to the local 1C adapter boundary;
- `REPORT` — report navigation or generation;
- `URL` — approved link navigation;
- `FILE` — file navigation.

The current offline ERP implementation deliberately simulates acceptance and
returns a `1C-DEMO-*` reference. This proves the complete interaction, security
and audit trail without requiring access to a live ERP database.

## 1C integration

A production adapter will translate the stable action ID and target into an
allowed 1C command, call the local integration endpoint, and return the created
document reference or opened navigation context. BPMN XML and element context do
not need to change when that adapter replaces the simulation.

Command facts are stored under `Data/Commands` and are excluded from source
control because they are installation-specific runtime data.
