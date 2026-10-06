export type RunFunction = () => Promise<unknown>;

export type Queue<Element, Options> = {
	size: number;
	filter: (options: Readonly<Partial<Options>>) => Element[];
	dequeue: () => Element | undefined;
	enqueue: (run: Element, options?: Partial<Options>) => void;

	/**
	Change the priority of a queued task, identified by the `id` passed to `PQueue#add()`.

	Implement this optional method to make a custom queue class support `PQueue#setPriority()`. The task keeps its place in the queue storage and only its priority (and therefore its position) changes; the run function and the options of the original `add()` call are untouched.

	@returns `false` when no queued task with the given `id` exists, otherwise `true`.
	*/
	setPriority?: (id: string, priority: number) => boolean;
};
