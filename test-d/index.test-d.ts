import {expectType, expectAssignable} from 'tsd';
import PQueue, {
	DuplicateTaskIdError,
	QueueDoesNotSupportSetPriorityError,
	TaskNotFoundError,
	TaskRunningError,
	type Queue,
	type QueueAddOptions,
	type RunFunction,
} from '../source/index.js';

const queue = new PQueue();

expectType<Promise<string | void>>(queue.add(async () => '🦄'));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: true}));
expectType<Promise<string | void>>(queue.add(async () => '🦄', {id: 'export-42', priority: 1}));

expectType<void>(queue.setPriority('export-42', 2));

// A custom QueueClass with only the base methods must still be accepted.
class CustomQueueClass {
	enqueue(run: RunFunction): void {
		void run;
	}

	dequeue(): RunFunction | undefined {
		return undefined;
	}

	get size(): number {
		return 0;
	}

	filter(_options: Readonly<Partial<QueueAddOptions>>): RunFunction[] {
		return [];
	}
}

// eslint-disable-next-line no-new
new PQueue({queueClass: CustomQueueClass});

// `setPriority` is an optional part of the public Queue contract.
const minimalQueue: Queue<RunFunction, QueueAddOptions> = new CustomQueueClass();
expectType<number>(minimalQueue.size);
expectType<((id: string, priority: number) => void) | undefined>(minimalQueue.setPriority);

// A custom queue that wants to support reprioritization implements the same signature.
class PriorityAwareQueueClass extends CustomQueueClass {
	setPriority(id: string, priority: number): void {
		void id;
		void priority;
	}
}

const priorityQueue: Queue<RunFunction, QueueAddOptions> = new PriorityAwareQueueClass();
expectAssignable<(id: string, priority: number) => void>(priorityQueue.setPriority!);
new PQueue({queueClass: PriorityAwareQueueClass}).setPriority('task', 1);

// Error classes are exported and distinguishable.
const notFound = new TaskNotFoundError('id');
const running = new TaskRunningError('id');
const duplicate = new DuplicateTaskIdError('id');
const unsupported = new QueueDoesNotSupportSetPriorityError('QueueClass');
expectType<string>(notFound.id);
expectType<string>(running.id);
expectType<string>(duplicate.id);
expectAssignable<Error>(unsupported);
