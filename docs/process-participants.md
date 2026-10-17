# Process participants

BPMN lanes describe stable process roles such as **Инициатор**, **Финансы** or
**Склад**. Personnel changes must not require redrawing the process, so concrete
users are assigned separately from BPMN XML.

Owners, administrators and super-administrators use **Ответственные** in the
process toolbar. A lane may have no users, one user or several users. The normal
task context displays the role from the process model and the currently assigned
people in a dedicated **Назначенные сотрудники** section.

Every user assigned to at least one lane can enable **Мои шаги** in the process
toolbar. The complete BPMN remains visible, while the user's lanes, tasks and
connected flows become the visual focus. This is a presentation filter only: it
does not change the process model or assignments.

Assignments are stored locally in `Data/Assignments` and are ignored by Git.
The API validates lane IDs against the current BPMN model and accepts only active
directory users. A future 1C adapter can replace user IDs with 1C user,
department or access-group references while preserving the lane assignment API.
