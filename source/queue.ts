export type RunFunction = () => Promise<unknown>;

/**
Explicit task identifier used by `.add()` and `.setPriority()`.
*/
export type TaskId = string | number;

export type Queue<Element, Options> = {
	size: number;
	filter: (options: Readonly<Partial<Options>>) => Element[];
	dequeue: () => Element | undefined;
	enqueue: (run: Element, options?: Partial<Options>) => void;
	/**
	Update the priority of a waiting task, identified by its explicit `id`, so that the queue's dequeue order immediately reflects the new value.

	Must only mutate the task's priority (and its position); the run function and other options must stay untouched.
	*/
	setPriority: (id: TaskId, priority: number) => void;
};
