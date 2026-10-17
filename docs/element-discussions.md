# BPMN element discussions

Every BPMN element has a discussion section in its context panel. It is intended
for practical clarifications, hand-off notes and questions that help participants
perform the process without adding visual noise to the diagram.

## Data model

A comment contains a stable ID, process and element IDs, authenticated user ID,
display name, text and server timestamp. Comments are stored under
`Data/Comments` and are installation-specific runtime data excluded from Git.

Comments are deliberately not stored in BPMN XML or versioned context JSON. A
diagram can therefore remain standards-compliant and a process can be republished
without losing its operational discussion.

## Access and limits

Users with normal process-view access can read and add comments. The server takes
the author from the current session rather than trusting client-provided identity.
Comment text is trimmed and limited to 2,000 characters.

The first iteration is append-only. Moderation, mentions, resolved threads and
notifications can be added later without changing the current comment contract.
