# Embedded BPMN editor

Process Navigator includes a BPMN 2.0 editor for draft process editions. The
editor is delivered with the frontend bundle and does not contact external web
services, so it can run inside the same closed network as 1C:ERP.

## Who can edit

The **Edit** command is shown only when all of these conditions are met:

- the selected edition is a draft;
- the current user has the `process.diagram.edit` permission;
- the process has a stored BPMN source.

In the demonstration permission matrix this includes the analyst,
administrator and super-administrator. A process owner controls the lifecycle
and publication but does not silently gain modelling rights.

## Editing workflow

1. Open an existing draft or create a new edition from the published process.
2. Select **Edit** in the process toolbar.
3. Use the palette to add BPMN elements and the context pad to connect or change
   them. Double-click labels to edit task, lane and sequence-flow names.
4. Use **Undo**, **Redo** and **Fit** while modelling.
5. Select **Save** to send the BPMN XML to the API.
6. Review the saved draft in the Process Navigator canvas.
7. Publish the draft using a user with lifecycle publication permission.

Closing the editor without saving leaves the stored draft unchanged.

## Validation and storage

The browser exports standard BPMN 2.0 XML. The API applies the same structural
validation used during import: supported BPMN elements, lane membership,
diagram bounds and sequence-flow waypoints must remain valid. Only after a
successful parse is the draft BPMN file replaced. Published and archived
versions are never edited in place.

The draft source endpoints are:

- `GET /api/processes/{processId}/draft/bpmn`
- `PUT /api/processes/{processId}/draft/bpmn`

Both endpoints use the same role and permission checks as the user interface.
