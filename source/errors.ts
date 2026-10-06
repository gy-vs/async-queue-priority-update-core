/**
Thrown when `queue.setPriority(id, priority)` targets a task that has already started running (and is therefore no longer in the queue).
*/
export class TaskRunningError extends Error {
	override get name(): string {
		return 'TaskRunningError';
	}

	constructor(id: string) {
		super(`Task with id \`${id}\` is already running and can no longer be reprioritized.`);
	}
}

/**
Thrown when `queue.setPriority(id, priority)` cannot find a task with the given `id` in the queue, for example because it was never added, already finished, or removed by `clear()`.
*/
export class TaskNotFoundError extends Error {
	override get name(): string {
		return 'TaskNotFoundError';
	}

	constructor(id: string) {
		super(`No queued task with id \`${id}\` was found.`);
	}
}

/**
Thrown by `queue.add()` when the given `id` already belongs to a queued or running task.
*/
export class DuplicateTaskIdError extends Error {
	override get name(): string {
		return 'DuplicateTaskIdError';
	}

	constructor(id: string) {
		super(`A task with id \`${id}\` has already been added. Wait for it to finish (or clear it) before adding another task with the same id.`);
	}
}
