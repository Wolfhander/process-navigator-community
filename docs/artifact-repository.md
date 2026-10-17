# Artifact repository

The artifact repository provides one controlled source for instructions,
regulations, forms and document templates used by process participants. It is
local to Process Navigator and requires no internet connection.

## User workflow

1. Open a draft and select a BPMN element.
2. Open its context editor.
3. Under **Materials and templates**, select **File**.
4. Choose a file, enter its name, kind and version, then upload it.
5. Save the element context.

The context stores a stable reference such as `artifact:artifact-...`, not the
binary file. A participant selecting that material receives the referenced
version directly from the repository.

## Versioning

Repository versions are immutable. Uploading a new version creates another
version record and marks it as the current approved version. Older files remain
available for audit and for process editions that explicitly refer to them.
Uploading the same version twice is rejected.

The current UI creates a new artifact during upload. Reusing an existing
artifact and promoting a later version will be exposed in a subsequent library
management screen; the backend model already supports multiple versions.

## Storage

Runtime files are stored below `Data/Artifacts` and are excluded from Git. Each
artifact has metadata, immutable version directories and binary content. File
names supplied by users are retained only as download names and are never used
as server paths.

## API

- `GET /api/artifacts` lists repository metadata.
- `POST /api/artifacts` uploads a file and creates a version.
- `GET /api/artifacts/{artifactId}/content?version=...` downloads a version.

Uploads require `process.context.edit`. Repository reading is available to
normal process viewers. Files are limited to 20 MB in this reference version.
