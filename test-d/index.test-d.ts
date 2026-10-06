import {expectType, expectAssignable, expectError} from 'tsd';
import PQueue, {type Queue, type QueueAddOptions, type RunFunction} from '../source/index.js';

const queue = new PQueue();

expectType<Promise<string | void>>(queue.add(async () => '🦄'));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: true}));

// The `id` option is an optional string.
// eslint-disable-next-line @typescript-eslint/no-empty-function
expectType<Promise<void>>(queue.add(async () => {}, {id: 'export-1'}));
// eslint-disable-next-line @typescript-eslint/no-empty-function
expectError(queue.add(async () => {}, {id: 42}));

// `setPriority()` exists on the default queue.
expectType<void>(queue.setPriority('export-1', 5));
expectError(queue.setPriority(42, 5));

// A custom queue only needs enqueue, dequeue, size and filter;
// it does not have to implement setPriority.
class MinimalCustomQueue implements Queue<RunFunction, QueueAddOptions> {
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	enqueue(): void {}

	dequeue(): RunFunction | undefined {
		return undefined;
	}

	get size(): number {
		return 0;
	}

	filter(): RunFunction[] {
		return [];
	}
}

const customQueue = new PQueue({queueClass: MinimalCustomQueue});
expectType<number>(customQueue.size);
expectType<number>(customQueue.sizeBy({}));
// eslint-disable-next-line @typescript-eslint/no-empty-function
expectAssignable<Promise<void>>(customQueue.add(async () => {}));

// A third-party queue that opts in implements the public setPriority contract.
class PriorityCapableCustomQueue implements Queue<RunFunction, QueueAddOptions> {
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	enqueue(): void {}

	dequeue(): RunFunction | undefined {
		return undefined;
	}

	get size(): number {
		return 0;
	}

	filter(): RunFunction[] {
		return [];
	}

	setPriority(id: string, priority: number): boolean {
		void id;
		void priority;
		return false;
	}
}

const capableQueue = new PQueue({queueClass: PriorityCapableCustomQueue});
expectType<void>(capableQueue.setPriority('id', 1));

// Custom enqueue options can extend the base options, including `id`.
type CustomOptions = QueueAddOptions & {readonly tenant: string};
type TenantQueue = Queue<RunFunction, CustomOptions>;

class TenantRoundRobinQueue implements TenantQueue {
	enqueue(run: RunFunction, options?: Partial<CustomOptions>): void {
		void run;
		void options;
	}

	dequeue(): RunFunction | undefined {
		return undefined;
	}

	get size(): number {
		return 0;
	}

	filter(): RunFunction[] {
		return [];
	}

	setPriority(id: string, priority: number): boolean {
		void id;
		void priority;
		return true;
	}
}

const tenantQueue = new PQueue<TenantRoundRobinQueue, CustomOptions>({queueClass: TenantRoundRobinQueue});
// eslint-disable-next-line @typescript-eslint/no-empty-function
expectAssignable<Promise<void>>(tenantQueue.add(async () => {}, {id: 'a', tenant: 'acme'}));
expectType<void>(tenantQueue.setPriority('a', 9));
expectType<number>(tenantQueue.sizeBy({tenant: 'acme'}));
