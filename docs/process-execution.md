# Process execution

The first execution layer records facts without turning BPMN into a workflow
engine. A published process can have many independent instances. Each instance
stores the process version, start time, initiator and task states.

Users with execution permission open **Выполнения**, start an instance and select
it as the current execution. Task cards then provide **Начать шаг** and
**Завершить шаг** actions. In-progress tasks are amber and completed tasks are
green on the full BPMN canvas.

Execution files are stored under `Data/Executions` and ignored by Git. Later 1C
adapters will write the same facts automatically from ERP document creation,
approval, posting and payment events. Manual tracking remains useful for physical
or organizational steps that leave no ERP document.

An in-progress task can record a factual text result, the output information
objects that were actually produced and file attachments stored in the managed
artifact repository. The server, not only the UI, blocks completion while a
required output binding is missing. Up to 40 output objects and 20 attachments
can be recorded per task iteration; the result text is limited to 4000
characters.

Returning a route for rework archives the factual result, recorded objects and
attachments with the previous iteration. The new iteration starts without a
current result so an old document cannot accidentally satisfy the corrected
pass. Repository files remain immutable and downloadable from the archived
iteration.

When a task becomes reachable, the instance stores its availability timestamp,
the current revision's norm text and parsed work/wait duration. This snapshot is
not changed when a later process revision edits the norm. Starting and completing
the task records queue time, active work time, total active duration and overdue
minutes. Lifecycle pauses are subtracted from actual time; on resume they shift
the due date of every available unfinished task. Day-based free-text norms use
eight hours per working day. Linking these operational due dates to a saved
calendar schedule is tracked separately by decomposition item 62.

`GET /api/processes/{processId}/instances/{instanceId}/timeline` returns a unified
newest-first event stream. It includes instance lifecycle, step availability and
status, archived iterations, recorded results and attachments, branch decisions,
returns and command executions tied to the instance.

`PUT /api/processes/{processId}/instances/{instanceId}/steps/{elementId}/assignment`
assigns or transfers an unfinished task to an active user already allowed for
its BPMN lane. A reason between 3 and 500 characters is required. The assigned
user (`AssignedUserId`) remains separate from the user who actually starts or
completes the task (`UserId`). Every transfer adds an immutable timeline event
with the previous and new assignee snapshots, reason, actor and timestamp.

An active instance can be paused or cancelled from the execution list. Pause and
cancel require a reason and append an immutable lifecycle event with the user and
timestamp. Paused instances can be resumed; cancelled and completed instances are
read-only. Existing step facts, branch decisions and return history are retained.

The route validator finds strongly connected components in the BPMN graph. A
cycle is accepted as controlled only when an exclusive gateway inside the cycle
has a labelled edge leading outside it. Controlled cycles produce a warning;
cycles without such an exit produce a publication-blocking error.
