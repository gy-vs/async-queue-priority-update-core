import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

export type PriorityQueueOptions = {
	priority?: number;
} & QueueAddOptions;

type Element = PriorityQueueOptions & {run: RunFunction};

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Element[] = [];

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		options = {
			priority: 0,
			...options,
		};

		this.#insert({
			priority: options.priority,
			id: options.id,
			run,
		});
	}

	/**
	Move the task with the given `id` to the position of `priority`.

	The task keeps its identity (the same run function and options) and is placed at the end of its new priority tier, behind every task that was already in that tier. Setting the same priority the task already has is a no-op and preserves its position, including the first-in-first-out order within the tier.

	@returns `false` when no queued task has the given `id`.
	*/
	setPriority(id: string, priority: number): boolean {
		const index = this.#queue.findIndex(element => element.id === id);

		if (index === -1) {
			return false;
		}

		const element = this.#queue[index]!;

		if (element.priority === priority) {
			return true;
		}

		this.#queue.splice(index, 1);
		element.priority = priority;
		this.#insert(element);

		return true;
	}

	dequeue(): RunFunction | undefined {
		const item = this.#queue.shift();
		return item?.run;
	}

	filter(options: Readonly<Partial<PriorityQueueOptions>>): RunFunction[] {
		return this.#queue.filter(
			(element: Readonly<PriorityQueueOptions>) =>
				(options.priority === undefined || element.priority === options.priority)
				&& (options.id === undefined || element.id === options.id),
		).map((element: Readonly<{run: RunFunction}>) => element.run);
	}

	get size(): number {
		return this.#queue.length;
	}

	#insert(element: Element): void {
		if (this.size === 0 || this.#queue[this.size - 1]!.priority! >= element.priority!) {
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
