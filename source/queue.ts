export type RunFunction = () => Promise<unknown>;

export type Queue<Element, Options> = {
	size: number;
	filter: (options: Readonly<Partial<Options>>) => Element[];
	dequeue: () => Element | undefined;
	enqueue: (run: Element, options?: Partial<Options>) => void;

	/**
	Changes the priority of an already enqueued element.

	Optional. When implemented, `p-queue` calls it from `PQueue#setPriority()` with the
	`id` the element was enqueued with and its new priority. Queue classes that do not
	implement this method keep working as before, but `queue.setPriority()` rejects with
	a `QueueDoesNotSupportSetPriorityError` when called.
	*/
	setPriority?: (id: string, priority: number) => void;
};
