import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

export type PriorityQueueOptions = {
	priority?: number;
} & QueueAddOptions;

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Array<PriorityQueueOptions & {run: RunFunction}> = [];

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		options = {
			priority: 0,
			...options,
		};

		const element = {
			id: options.id,
			priority: options.priority,
			run,
		};

		this.#insert(element);
	}

	dequeue(): RunFunction | undefined {
		const item = this.#queue.shift();
		return item?.run;
	}

	filter(options: Readonly<Partial<PriorityQueueOptions>>): RunFunction[] {
		return this.#queue.filter(
			(element: Readonly<PriorityQueueOptions>) => element.priority === options.priority,
		).map((element: Readonly<{run: RunFunction}>) => element.run);
	}

	setPriority(id: string, priority: number): void {
		const index = this.#queue.findIndex(element => element.id === id);

		if (index === -1 || this.#queue[index]!.priority === priority) {
			return;
		}

		const [element] = this.#queue.splice(index, 1) as [PriorityQueueOptions & {run: RunFunction}];
		element.priority = priority;

		let destination = 0;
		while (destination < this.#queue.length && this.#queue[destination]!.priority! >= priority) {
			destination++;
		}

		// Insert behind every element already in the target priority tier, preserving FIFO within the tier.
		this.#queue.splice(destination, 0, element);
	}

	get size(): number {
		return this.#queue.length;
	}

	#insert(element: PriorityQueueOptions & {run: RunFunction}): void {
		if (this.size && this.#queue[this.size - 1]!.priority! >= element.priority!) {
			this.#queue.push(element);
			return;
		}

		const index = lowerBound(
			this.#queue, element,
			(a: Readonly<PriorityQueueOptions>, b: Readonly<PriorityQueueOptions>) => b.priority! - a.priority!,
		);
		this.#queue.splice(index, 0, element);
	}
}
