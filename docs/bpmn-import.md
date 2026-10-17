# BPMN import contract

Process Navigator keeps visual process structure and ERP context in separate files.

## Source files

- `*.bpmn` is the source of truth for process identity, names, lanes, flow nodes,
  sequence flows, labels and BPMN DI geometry.
- `*.context.json` stores Process Navigator data keyed by immutable BPMN element
  IDs: responsibilities, duration standards, artifacts and ERP actions.

Editing context data never rewrites the BPMN document. A BPMN file remains
portable to other BPMN 2.0 tools.

## Supported elements in version 0.4

- horizontal lanes;
- start and end events;
- task, user task, manual task, service task, send task and receive task;
- business-rule task, call activity and collapsed subprocess as task-like nodes;
- exclusive gateways;
- sequence flows and their labels;
- BPMN DI bounds and waypoints.

## Validation

The API rejects a diagram with HTTP `422` when:

- the requested process is missing or duplicated;
- a process has no lanes or supported nodes;
- a flow node belongs to no lane or to several lanes;
- a node has no BPMN DI shape or bounds;
- a sequence flow references a missing or unsupported node;
- a sequence flow has no BPMN DI edge or fewer than two waypoints;
- required identifiers or numeric coordinates are invalid.

## API

- `GET /api/processes` returns the available process catalog.
- `GET /api/processes/{id}` parses BPMN and merges its element contexts.
- `GET /api/processes/{id}/bpmn` returns the unmodified BPMN XML source.
- `POST /api/processes/import` accepts multipart fields `bpmnFile` and optional
  `contextFile`, validates them and stores a new draft process.
- `POST /api/processes/import-package` accepts a ZIP package, finds BPMN files
  and matching Markdown passports, and imports every valid process as a draft.
- `POST /api/processes/{id}/draft` creates the next draft from the published edition.
- `PUT /api/processes/{id}/draft` replaces and validates the draft files.
- `POST /api/processes/{id}/publish` archives the active edition and publishes the draft.
- `GET /api/processes/{id}/versions` returns published, draft and archived revisions.
- `GET /api/processes/{id}/versions/{version}` loads an archived revision for read-only viewing.
- `GET /api/health` reports API availability.

Uploaded BPMN files are limited to 2 MB. The process identifier must be unique
and contain only Latin letters, digits, dots, underscores or hyphens. When the
context file is omitted, Process Navigator creates an empty draft context and
reports how many diagram elements still need descriptions or actions.

## Package import

The recommended package layout is:

```text
package.zip
├── bpmn/
│   ├── PROCESS-01_Name.bpmn
│   └── PROCESS-02_Name.bpmn
└── passports/
    ├── PROCESS-01_Name.md
    └── PROCESS-02_Name.md
```

Folders may be nested. A passport is matched to a BPMN file by the process code
at the start of its file name. Each imported draft receives:

- the original BPMN 2.0 XML and geometry;
- an element context generated from BPMN names and documentation;
- a link to the source package and source files;
- the Markdown process passport, when it is present;
- the leading department from the passport as the preliminary owner.

Package files are limited to 50 MB and 500 entries. Existing process IDs are
skipped rather than overwritten, so retrying the same package is safe. The
result lists imported, skipped and failed files separately. Organizational lane
bindings must be reviewed before publication because source packages may use
department abbreviations that are not yet linked to stable organization nodes.

The next import increment will add intermediate events, parallel gateways,
message flows, pools and full version management.
