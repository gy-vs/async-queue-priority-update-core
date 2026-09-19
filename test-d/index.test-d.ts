import {expectAssignable, expectError, expectType} from 'tsd';
import PQueue, {type Queue, type QueueAddOptions} from '../source/index.js';

const queue = new PQueue();

expectType<Promise<string | void>>(queue.add(async () => '🦄'));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: true}));

// Explicit ids and priorities
expectType<Promise<string | void>>(queue.add(async () => '🦄', {id: 'unicorn', priority: 1}));
expectType<Promise<string | void>>(queue.add(async () => '🦄', {id: 42}));

expectType<void>(queue.setPriority('unicorn', 2));
expectType<void>(queue.setPriority(42, 2));

// `id` must be a string or number
expectError(queue.add(async () => '🦄', {id: {}}));
expectError(queue.setPriority({}, 1));

// `priority` must be a finite number
expectError(queue.setPriority('unicorn', '1'));

// The queueClass extension interface supports `setPriority`
expectAssignable<Queue<() => Promise<unknown>, QueueAddOptions>>({
	size: 0,
	filter() {
		return [];
	},
	dequeue() {
		return undefined;
	},
	enqueue() {
		// Empty
	},
	setPriority(_id: string | number, _priority: number) {
		// Empty
	},
});
