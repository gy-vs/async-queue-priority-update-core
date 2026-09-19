import {type Queue, type RunFunction, type TaskId} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

export type PriorityQueueOptions = {
	priority?: number;
} & QueueAddOptions;

type Element = {
	id?: TaskId;
	priority: number;
	run: RunFunction;
	// Monotonically increasing insertion sequence number, used as a stable tie-breaker between equal priorities.
	insertionOrder: number;
};

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Element[] = [];

	#nextInsertionOrder = 0;

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		options = {
			priority: 0,
			...options,
		};

		const element: Element = {
			id: options.id,
			priority: options.priority!,
			run,
			insertionOrder: this.#nextInsertionOrder++,
		};

		if (this.size && this.#queue[this.size - 1]!.priority >= options.priority!) {
			this.#queue.push(element);
			return;
		}

		const index = lowerBound(
			this.#queue, element,
			(a: Readonly<Element>, b: Readonly<Element>) =>
				(b.priority - a.priority) || (a.insertionOrder - b.insertionOrder),
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

	setPriority(id: TaskId, priority: number): void {
		const index = this.#queue.findIndex(element => element.id === id);

		if (index === -1) {
			throw new Error(`No task with the id \`${String(id)}\` is waiting in the queue`);
		}

		const [element] = this.#queue.splice(index, 1);
		element!.priority = priority;

		const newIndex = lowerBound(
			this.#queue,
			element!,
			(a: Readonly<Element>, b: Readonly<Element>) =>
				(b.priority - a.priority) || (a.insertionOrder - b.insertionOrder),
		);
		this.#queue.splice(newIndex, 0, element!);
	}

	get size(): number {
		return this.#queue.length;
	}
}
