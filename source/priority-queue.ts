import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

export type PriorityQueueOptions = {
	priority?: number;
} & QueueAddOptions;

type Element = {
	id?: string | number;
	priority?: number;
	order: number;
	run: RunFunction;
};

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Element[] = [];

	#enqueueCount = 0;

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		options = {
			priority: 0,
			...options,
		};

		const element: Element = {
			id: options.id,
			priority: options.priority,
			order: this.#enqueueCount++,
			run,
		};

		if (this.size && this.#queue[this.size - 1]!.priority! >= options.priority!) {
			this.#queue.push(element);
			return;
		}

		const index = lowerBound(
			this.#queue, element,
			(a: Readonly<PriorityQueueOptions>, b: Readonly<PriorityQueueOptions>) => b.priority! - a.priority!,
		);
		this.#queue.splice(index, 0, element);
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

	/**
	Update the priority of the waiting item with the given `id`.

	The item keeps its original `run`, options, `id` and insertion order, so
	items at the same priority keep their relative order.
	*/
	setPriority(id: string | number, priority: number): void {
		const index = this.#queue.findIndex(element => element.id === id);

		if (index === -1) {
			throw new Error(`No waiting operation with the given \`id\` exists: \`${id.toString()}\``);
		}

		const [element] = this.#queue.splice(index, 1) as [Element];
		element.priority = priority;

		const targetIndex = lowerBound(
			this.#queue, element,
			(a: Element, b: Element) => {
				if (b.priority !== a.priority) {
					return b.priority! - a.priority!;
				}

				// Same priority keeps the original insertion order, even after an update.
				return a.order - b.order;
			},
		);
		this.#queue.splice(targetIndex, 0, element);
	}

	get size(): number {
		return this.#queue.length;
	}
}
