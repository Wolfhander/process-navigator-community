# Access control

Commit 0008 introduces the authorization boundary that later 1C and enterprise
identity integrations will use. The current implementation provides six demo
profiles. Commit 0012 sends the selected user ID in
`X-Process-Navigator-User`; the earlier role header remains a compatibility
fallback. The API, rather than
the browser, is the final authority for every modifying operation.

| Role | Primary permissions |
| --- | --- |
| Executor | View processes, run configured actions |
| Manager | Executor permissions and process analytics |
| Analyst | Import BPMN, create drafts, edit diagrams and element context |
| Process owner | Create drafts, edit context, publish, view analytics |
| Administrator | Manage processes, publication, execution and users |
| Super administrator | All platform and system permissions |

The user switcher and local directory are intended for the reference demo and
closed-network pilot. Production identity
will replace the header with an authenticated user supplied by 1C or the
company identity provider, while preserving the same permission names and API
checks.
