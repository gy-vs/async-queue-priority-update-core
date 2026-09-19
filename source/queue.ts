export type RunFunction = () => Promise<unknown>;

export type Queue<Element, Options> = {
	size: number;
	filter: (options: Readonly<Partial<Options>>) => Element[];
	dequeue: () => Element | undefined;
	enqueue: (run: Element, options?: Partial<Options>) => void;
	/**
	Update the priority of a waiting item identified by its explicit `id`.

	Only required when the queue is used with `PQueue#setPriority()`. The item's
	`run` function and enqueue options must stay intact; only its position in the
	queue may change.
	*/
	setPriority?: (id: string | number, priority: number) => void;
};
