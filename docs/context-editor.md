# Context editing

Process Navigator keeps the visual BPMN model clean. Instructions, roles,
norms, artifacts and ERP commands are stored in a separate context document,
keyed by the immutable BPMN element ID.

## Workflow

1. Open a draft as an analyst, process owner, administrator or
   super-administrator with the `process.context.edit` permission.
2. Select any task, event or gateway on the process canvas.
3. Select the pencil button in the context panel.
4. Edit the description, responsible role and duration norm.
5. For a task, describe its inputs, expected result, verifiable completion criterion and participant instructions.
6. For a simple legacy description, select the execution mode: manual, outside an information system, or inside a named information system. Work time and waiting time are recorded separately from the overall norm.
7. In **Systems and transfer channels**, add every medium used at the step. A channel can be an information system, e-mail, paper document, telephone call, memo, meeting or another medium. Mark it as primary, alternative or parallel, and specify whether it is an input, the work environment or an output.
8. List supporting participant departments if needed. The responsible department is still determined by the BPMN lane; this list does not replace the lane organization binding.
9. Add, update or remove materials and configured actions.
10. Save the context. The diagram remains selected and immediately displays the
   updated information.

Published and archived editions remain read-only. Context changes become
visible to regular employees only after the draft is published.

## Artifacts

Each artifact has:

- a display name;
- a kind, such as instruction, regulation or template;
- a version;
- an optional repository reference.

The reference is intentionally storage-neutral. A later 1C adapter can resolve
it to a value-storage object, attached file, approved template or another
internal repository without changing the BPMN model.

## Actions

Each action has a stable ID, display label, kind and optional target. Supported
configuration kinds are currently ERP, report, file and URL. The target may
contain a future adapter command such as `Document.SupplierOrder` or another
configuration-independent identifier.

## API and validation

Context is saved through:

`PUT /api/processes/{processId}/draft/elements/{elementId}/context`

The API requires `process.context.edit`, verifies that the draft and BPMN
element exist, limits field and collection sizes, requires unique action IDs,
validates the complete process against a temporary context file and replaces
the stored context atomically only after validation succeeds.

Existing context JSON remains compatible: all new fields are optional. Empty values are normalized on the server, repeated inputs and participant departments are removed, and every list is limited to 20 values. Publication validation reports missing inputs, result, completion criterion, execution mode, and the system name for system-based tasks as recommendations. These recommendations do not by themselves block publication.

Channel identifiers must be unique inside an element. A channel of kind `system` requires a system name. The server accepts `primary`, `alternative`, and `parallel` flows and `input`, `work`, and `output` directions. This structure allows a single task to describe, for example, an electronic record in 1C:ERP and a paper copy transferred in parallel.
