/**
Thrown when {@link PQueue.setPriority} is called for a task that has already started running.
*/
export class TaskRunningError extends Error {
	readonly id: string;

	constructor(id: string) {
		super(`The task with \`id\` \`${id}\` is already running and its priority can no longer be changed.`);
		this.name = 'TaskRunningError';
		this.id = id;
	}
}

/**
Thrown when {@link PQueue.setPriority} is called with an `id` that does not match any queued task.

This happens when no task with that `id` was added, it has already finished, or it was removed by `clear()`.
*/
export class TaskNotFoundError extends Error {
	readonly id: string;

	constructor(id: string) {
		super(`Could not find a queued task with \`id\` \`${id}\`.`);
		this.name = 'TaskNotFoundError';
		this.id = id;
	}
}

/**
Thrown by {@link PQueue.add} when a task is added with an `id` that is still used by another queued or running task.
*/
export class DuplicateTaskIdError extends Error {
	readonly id: string;

	constructor(id: string) {
		super(`A task with \`id\` \`${id}\` already exists. Each \`id\` must be unique among queued and running tasks.`);
		this.name = 'DuplicateTaskIdError';
		this.id = id;
	}
}

/**
Thrown when {@link PQueue.setPriority} is used together with a custom QueueClass that does not implement the optional `setPriority` method.
*/
export class QueueDoesNotSupportSetPriorityError extends Error {
	constructor(queueClassName: string) {
		super(`\`setPriority()\` is not supported by the QueueClass \`${queueClassName}\` because it does not implement the optional \`setPriority(id, priority)\` method. See the "Custom QueueClass" section of the readme.`);
		this.name = 'QueueDoesNotSupportSetPriorityError';
	}
}
