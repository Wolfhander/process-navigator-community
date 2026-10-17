# Process execution analytics

Process Navigator calculates operational indicators from process instances; the
BPMN diagram remains the definition and does not store execution facts.

## Available indicators

The analytics dialog shows total, active and completed instances and the average
end-to-end duration of completed instances. Every BPMN task also shows completed
and active occurrences, average and maximum actual duration, and the number of
occurrences that exceeded the configured norm.

Tasks with violations are shown first. Selecting any row closes the dialog and
selects the corresponding task on the full BPMN diagram.

## Norms

The first iteration parses a numeric value followed by a supported Russian unit:

- minutes (`мин`);
- hours (`час`);
- days (`день`, `дн`) interpreted as eight working hours.

An active task is overdue when the elapsed time from its start exceeds the norm.
A completed task is overdue when its actual duration exceeded the norm. Tasks
without a recognized norm still receive factual duration statistics but are not
classified as overdue.

## Access

The endpoint `GET /api/processes/{processId}/analytics` and its interface action
require `analytics.view`. It is currently granted to managers, process owners,
administrators and super-administrators.

## Current boundary

The data is stored locally with the process instances. A later 1C adapter can
feed the same execution model from document creation, posting, approval and other
ERP events without changing the analytics interface.
