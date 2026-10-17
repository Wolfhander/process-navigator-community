# Global process search

The header search opens a single navigation surface for both visible BPMN content
and the supporting information stored outside the diagram.

## Indexed information

- process names and owners;
- BPMN element names, descriptions and responsible roles;
- artifact names, kinds and versions;
- action labels, kinds and configured targets.

Only published process versions are searched. Draft content remains isolated
until publication, which prevents unapproved instructions or process changes from
appearing to ordinary users.

## Navigation

Results identify their type and containing process. Selecting a result in the
current process focuses its BPMN element immediately. Selecting a result in a
different process first loads that published diagram and then opens the target
element context. A process-level result opens the process overview.

The first implementation searches the local repository at request time. A future
database-backed installation can replace this with a persistent full-text index
without changing the frontend contract.
