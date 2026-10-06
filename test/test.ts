/* eslint-disable no-new */
import EventEmitter from 'eventemitter3';
import test from 'ava';
import delay from 'delay';
import inRange from 'in-range';
import timeSpan from 'time-span';
import randomInt from 'random-int';
import pDefer, {type DeferredPromise} from 'p-defer';
import {TimeoutError} from 'p-timeout';
import PQueue, {
	AbortError,
	DuplicateTaskIdError,
	TaskNotFoundError,
	TaskRunningError,
	type Queue,
	type QueueAddOptions,
	type RunFunction,
} from '../source/index.js';

const fixture = Symbol('fixture');

test('.add()', async t => {
	const queue = new PQueue();
	const promise = queue.add(async () => fixture);
	t.is(queue.size, 0);
	t.is(queue.pending, 1);
	t.is(await promise, fixture);
});

test('.add() - limited concurrency', async t => {
	const queue = new PQueue({concurrency: 2});
	const promise = queue.add(async () => fixture);
	const promise2 = queue.add(async () => {
		await delay(100);
		return fixture;
	});
	const promise3 = queue.add(async () => fixture);
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	t.is(await promise, fixture);
	t.is(await promise2, fixture);
	t.is(await promise3, fixture);
});

test('.add() - concurrency: 1', async t => {
	const input = [
		[10, 300],
		[20, 200],
		[30, 100],
	];

	const end = timeSpan();
	const queue = new PQueue({concurrency: 1});

	const mapper = async ([value, ms]: readonly number[]) => queue.add(async () => {
		await delay(ms!);
		return value!;
	});

	// eslint-disable-next-line unicorn/no-array-callback-reference
	t.deepEqual(await Promise.all(input.map(mapper)), [10, 20, 30]);
	t.true(inRange(end(), {start: 590, end: 650}));
});

test('.add() - concurrency: 5', async t => {
	const concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async () => queue.add(async () => {
		running++;
		t.true(running <= concurrency);
		t.true(queue.pending <= concurrency);
		await delay(randomInt(30, 200));
		running--;
	}));

	await Promise.all(input);
});

test('.add() - update concurrency', async t => {
	let concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async (_value, index) => queue.add(async () => {
		running++;

		t.true(running <= concurrency);
		t.true(queue.pending <= concurrency);

		await delay(randomInt(30, 200));
		running--;

		if (index % 30 === 0) {
			queue.concurrency = --concurrency;
			t.is(queue.concurrency, concurrency);
		}
	}));

	await Promise.all(input);
});

test('.add() - priority', async t => {
	const result: number[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(0), {priority: 0});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(2), {priority: 1});
	queue.add(async () => result.push(3), {priority: 2});
	queue.add(async () => result.push(0), {priority: -1});
	await queue.onEmpty();
	t.deepEqual(result, [1, 3, 1, 2, 0, 0]);
});

test('.sizeBy() - priority', async t => {
	const queue = new PQueue();
	queue.pause();
	queue.add(async () => 0, {priority: 1});
	queue.add(async () => 0, {priority: 0});
	queue.add(async () => 0, {priority: 1});
	t.is(queue.sizeBy({priority: 1}), 2);
	t.is(queue.sizeBy({priority: 0}), 1);
	queue.clear();
	await queue.onEmpty();
	t.is(queue.sizeBy({priority: 1}), 0);
	t.is(queue.sizeBy({priority: 0}), 0);
});

test('.add() - timeout without throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: false});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	});
	queue.add(async () => {
		await delay(250);
		result.push('🦆');
	});
	queue.add(async () => {
		await delay(310);
		result.push('🐢');
	});
	queue.add(async () => {
		await delay(100);
		result.push('🐅');
	});
	queue.add(async () => {
		result.push('⚡️');
	});
	await queue.onIdle();
	t.deepEqual(result, ['⚡️', '🐅', '🦆']);
});

test.failing('.add() - timeout with throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: true});
	await t.throwsAsync(queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}));
	queue.add(async () => {
		await delay(200);
		result.push('🦆');
	});
	await queue.onIdle();
	t.deepEqual(result, ['🦆']);
});

test('.add() - change timeout in between', async t => {
	const result: string[] = [];
	const initialTimeout = 50;
	const newTimeout = 200;
	const queue = new PQueue({timeout: initialTimeout, throwOnTimeout: false, concurrency: 2});
	queue.add(async () => {
		const {timeout} = queue;
		t.deepEqual(timeout, initialTimeout);
		await delay(300);
		result.push('🐌');
	});
	queue.timeout = newTimeout;
	queue.add(async () => {
		const {timeout} = queue;
		t.deepEqual(timeout, newTimeout);
		await delay(100);
		result.push('🐅');
	});
	await queue.onIdle();
	t.deepEqual(result, ['🐅']);
});

test('.onEmpty()', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => 0);
	queue.add(async () => 0);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	await queue.onEmpty();
	t.is(queue.size, 0);

	queue.add(async () => 0);
	queue.add(async () => 0);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	await queue.onEmpty();
	t.is(queue.size, 0);

	// Test an empty queue
	await queue.onEmpty();
	t.is(queue.size, 0);
});

test('.onIdle()', async t => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('.onSizeLessThan()', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));

	await queue.onSizeLessThan(4);
	t.is(queue.size, 3);
	t.is(queue.pending, 1);

	await queue.onSizeLessThan(2);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);

	await queue.onSizeLessThan(10);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);

	await queue.onSizeLessThan(1);
	t.is(queue.size, 0);
	t.is(queue.pending, 1);
});

test('.onIdle() - no pending', async t => {
	const queue = new PQueue();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);

	// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
	t.is(await queue.onIdle(), undefined);
});

test('.clear()', t => {
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	queue.clear();
	t.is(queue.size, 0);
});

test('.addAll()', async t => {
	const queue = new PQueue();
	const fn = async (): Promise<symbol> => fixture;
	const functions = [fn, fn];
	const promise = queue.addAll(functions);
	t.is(queue.size, 0);
	t.is(queue.pending, 2);
	t.deepEqual(await promise, [fixture, fixture]);
});

test('enforce number in options.concurrency', t => {
	t.throws(
		() => {
			new PQueue({concurrency: 0});
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			new PQueue({concurrency: undefined});
		},
		{instanceOf: TypeError},
	);

	t.notThrows(() => {
		new PQueue({concurrency: 1});
	});

	t.notThrows(() => {
		new PQueue({concurrency: 10});
	});

	t.notThrows(() => {
		new PQueue({concurrency: Number.POSITIVE_INFINITY});
	});
});

test('enforce number in queue.concurrency', t => {
	t.throws(
		() => {
			(new PQueue()).concurrency = 0;
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			// @ts-expect-error Testing
			(new PQueue()).concurrency = undefined;
		},
		{instanceOf: TypeError},
	);

	t.notThrows(() => {
		(new PQueue()).concurrency = 1;
	});

	t.notThrows(() => {
		(new PQueue()).concurrency = 10;
	});

	t.notThrows(() => {
		(new PQueue()).concurrency = Number.POSITIVE_INFINITY;
	});
});

test('enforce number in options.intervalCap', t => {
	t.throws(
		() => {
			new PQueue({intervalCap: 0});
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			new PQueue({intervalCap: undefined});
		},
		{instanceOf: TypeError},
	);

	t.notThrows(() => {
		new PQueue({intervalCap: 1});
	});

	t.notThrows(() => {
		new PQueue({intervalCap: 10});
	});

	t.notThrows(() => {
		new PQueue({intervalCap: Number.POSITIVE_INFINITY});
	});
});

test('enforce finite in options.interval', t => {
	t.throws(
		() => {
			new PQueue({interval: -1});
		},
		{instanceOf: TypeError},
	);

	t.throws(
		() => {
			new PQueue({interval: undefined});
		},
		{instanceOf: TypeError},
	);

	t.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});

	t.notThrows(() => {
		new PQueue({interval: 0});
	});

	t.notThrows(() => {
		new PQueue({interval: 10});
	});

	t.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});
});

test('autoStart: false', t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	t.is(queue.size, 4);
	t.is(queue.pending, 0);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 2);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.clear();
	t.is(queue.size, 0);
});

test('.start() - return this', async t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 3);
	t.is(queue.pending, 0);
	await queue.start().onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('.start() - not paused', t => {
	const queue = new PQueue();

	t.falsy(queue.isPaused);

	queue.start();

	t.falsy(queue.isPaused);
});

test('.pause()', t => {
	const queue = new PQueue({concurrency: 2});

	queue.pause();
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	t.is(queue.size, 5);
	t.is(queue.pending, 0);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 3);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.add(async () => delay(20_000));
	queue.pause();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.clear();
	t.is(queue.size, 0);
});

test('.add() sync/async mixed tasks', async t => {
	const queue = new PQueue({concurrency: 1});
	queue.add(() => 'sync 1');
	queue.add(async () => delay(1000));
	queue.add(() => 'sync 2');
	queue.add(() => fixture);
	t.is(queue.size, 3);
	t.is(queue.pending, 1);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test.failing('.add() - handle task throwing error', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(() => 'sync 1');
	await t.throwsAsync(
		queue.add(
			() => {
				throw new Error('broken');
			},
		),
		{message: 'broken'},
	);
	queue.add(() => 'sync 2');

	t.is(queue.size, 2);

	await queue.onIdle();
});

test('.add() - handle task promise failure', async t => {
	const queue = new PQueue({concurrency: 1});

	await t.throwsAsync(
		queue.add(
			async () => {
				throw new Error('broken');
			},
		),
		{message: 'broken'},
	);

	queue.add(() => 'task #1');

	t.is(queue.pending, 1);

	await queue.onIdle();

	t.is(queue.pending, 0);
});

test('.addAll() sync/async mixed tasks', async t => {
	const queue = new PQueue();

	const functions: Array<() => (string | Promise<void> | Promise<unknown>)> = [
		() => 'sync 1',
		async () => delay(2000),
		() => 'sync 2',
		async () => fixture,
	];

	const promise = queue.addAll(functions);

	t.is(queue.size, 0);
	t.is(queue.pending, 4);
	t.deepEqual(await promise, ['sync 1', undefined, 'sync 2', fixture]);
});

test('should resolve empty when size is zero', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	// It should take 1 seconds to resolve all tasks
	for (let index = 0; index < 100; index++) {
		queue.add(async () => delay(10));
	}

	(async () => {
		await queue.onEmpty();
		t.is(queue.size, 0);
	})();

	queue.start();

	// Pause at 0.5 second
	setTimeout(
		async () => {
			queue.pause();
			await delay(10);
			queue.start();
		},
		500,
	);

	await queue.onIdle();
});

test('.add() - throttled', async t => {
	const result: number[] = [];
	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});
	queue.add(async () => result.push(1));
	queue.start();
	await delay(250);
	queue.add(async () => result.push(2));
	t.deepEqual(result, [1]);
	await delay(300);
	t.deepEqual(result, [1, 2]);
});

test('.add() - throttled, carryoverConcurrencyCount false', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		carryoverConcurrencyCount: false,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(550);
		t.is(queue.pending, 2);
		t.deepEqual(result, []);
	})();

	(async () => {
		await delay(650);
		t.is(queue.pending, 1);
		t.deepEqual(result, [0]);
	})();

	await delay(1250);
	t.deepEqual(result, values);
});

test('.add() - throttled, carryoverConcurrencyCount true', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		carryoverConcurrencyCount: true,
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(100);
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	})();

	(async () => {
		await delay(550);
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	})();

	(async () => {
		await delay(650);
		t.deepEqual(result, [0]);
		t.is(queue.pending, 0);
	})();

	(async () => {
		await delay(1550);
		t.deepEqual(result, [0]);
	})();

	await delay(1650);
	t.deepEqual(result, values);
});

test('.add() - throttled 10, concurrency 5', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 5,
		intervalCap: 10,
		interval: 1000,
		autoStart: false,
	});

	const firstValue = [...Array.from({length: 5}).keys()];
	const secondValue = [...Array.from({length: 10}).keys()];
	const thirdValue = [...Array.from({length: 13}).keys()];

	for (const value of thirdValue) {
		queue.add(async () => {
			await delay(300);
			result.push(value);
		});
	}

	queue.start();

	t.deepEqual(result, []);

	(async () => {
		await delay(400);
		t.deepEqual(result, firstValue);
		t.is(queue.pending, 5);
	})();

	(async () => {
		await delay(700);
		t.deepEqual(result, secondValue);
	})();

	(async () => {
		await delay(1200);
		t.is(queue.pending, 3);
		t.deepEqual(result, secondValue);
	})();

	await delay(1400);
	t.deepEqual(result, thirdValue);
});

test('.add() - throttled finish and resume', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 1,
		intervalCap: 2,
		interval: 2000,
		autoStart: false,
	});

	const values = [0, 1];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(1000);
		t.deepEqual(result, firstValue);

		queue.add(async () => {
			await delay(100);
			result.push(2);
		});
	})();

	(async () => {
		await delay(1500);
		t.deepEqual(result, firstValue);
	})();

	await delay(2200);
	t.deepEqual(result, secondValue);
});

test('pause should work when throttled', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 2,
		intervalCap: 2,
		interval: 1000,
		autoStart: false,
	});

	const values = [0, 1, 2, 3];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2, 3];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(300);
		t.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(600);
		queue.pause();
	})();

	(async () => {
		await delay(1400);
		t.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(1500);
		queue.start();
	})();

	(async () => {
		await delay(2200);
		t.deepEqual(result, secondValue);
	})();

	await delay(2500);
});

test('clear interval on pause', async t => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	queue.add(() => {
		queue.pause();
	});

	queue.add(() => 'task #1');

	await delay(300);

	t.is(queue.size, 1);
});

test('should be an event emitter', t => {
	const queue = new PQueue();
	t.true(queue instanceof EventEmitter);
});

test('should emit active event per item', async t => {
	const items = [0, 1, 2, 3, 4];
	const queue = new PQueue();

	let eventCount = 0;
	queue.on('active', () => {
		eventCount++;
	});

	for (const item of items) {
		queue.add(() => item);
	}

	await queue.onIdle();

	t.is(eventCount, items.length);
});

test('should emit idle event when idle', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('idle', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));
	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 0);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);
});

test('should emit empty event when empty', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('empty', () => {
		timesCalled++;
	});

	const {resolve: resolveJob1, promise: job1Promise} = pDefer();
	const {resolve: resolveJob2, promise: job2Promise} = pDefer();

	const job1 = queue.add(async () => job1Promise);
	const job2 = queue.add(async () => job2Promise);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	t.is(timesCalled, 0);

	resolveJob1();
	await job1;

	t.is(queue.size, 0);
	t.is(queue.pending, 1);
	t.is(timesCalled, 0);

	resolveJob2();
	await job2;

	t.is(queue.size, 0);
	t.is(queue.pending, 0);
	t.is(timesCalled, 1);
});

test('should emit add event when adding task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('add', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 2);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);
});

test('should emit next event when completing task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('next', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 0);

	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);
});

test('should emit completed / error events', async t => {
	const queue = new PQueue({concurrency: 1});

	let errorEvents = 0;
	let completedEvents = 0;
	queue.on('error', () => {
		errorEvents++;
	});
	queue.on('completed', () => {
		completedEvents++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 0);
	t.is(completedEvents, 0);

	const job2 = queue.add(async () => {
		await delay(1);
		throw new Error('failure');
	});

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(errorEvents, 0);
	t.is(completedEvents, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 0);
	t.is(completedEvents, 1);

	await t.throwsAsync(job2);

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 1);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 1);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 2);
});

test('should verify timeout overrides passed to add', async t => {
	const queue = new PQueue({timeout: 200, throwOnTimeout: true});

	await t.throwsAsync(queue.add(async () => {
		await delay(400);
	}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(400);
	}, {throwOnTimeout: false}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(400);
	}, {timeout: 600}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(100);
	}));

	await t.throwsAsync(queue.add(async () => {
		await delay(100);
	}, {timeout: 50}));

	await queue.onIdle();
});

test('should skip an aborted job', async t => {
	const queue = new PQueue();
	const controller = new AbortController();

	controller.abort();
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	await t.throwsAsync(queue.add(() => {}, {signal: controller.signal}), {
		instanceOf: DOMException,
	});
});

test('should pass AbortSignal instance to job', async t => {
	const queue = new PQueue();
	const controller = new AbortController();

	await queue.add(async ({signal}) => {
		t.is(controller.signal, signal!);
	}, {signal: controller.signal});
});

test('aborting multiple jobs at the same time', async t => {
	const queue = new PQueue({concurrency: 1});

	const controller1 = new AbortController();
	const controller2 = new AbortController();

	const task1 = queue.add(async () => new Promise(() => {}), {signal: controller1.signal}); // eslint-disable-line @typescript-eslint/no-empty-function
	const task2 = queue.add(async () => new Promise(() => {}), {signal: controller2.signal}); // eslint-disable-line @typescript-eslint/no-empty-function

	setTimeout(() => {
		controller1.abort();
		controller2.abort();
	}, 0);

	await t.throwsAsync(task1, {instanceOf: DOMException});
	await t.throwsAsync(task2, {instanceOf: DOMException});
	t.like(queue, {size: 0, pending: 0});
});

test('.add() - id is accepted and the same promise is settled', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const promise = queue.add(async () => fixture, {id: 'export-1', priority: 0});

	queue.setPriority('export-1', 5);
	queue.start();

	t.is(await promise, fixture);

	// The id becomes reusable after the task settles.
	await t.notThrowsAsync(queue.add(async () => fixture, {id: 'export-1'}));
});

test('.add() - duplicate id while queued rejects with DuplicateTaskIdError', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	const first = queue.add(async () => 'first', {id: 'dup'});
	const secondPromise = queue.add(async () => 'second', {id: 'dup'});

	await t.throwsAsync(secondPromise, {instanceOf: DuplicateTaskIdError});

	// The rejected duplicate never entered the queue.
	t.is(queue.size, 1);
	queue.start();
	t.is(await first, 'first');
});

test('.add() - duplicate id while running rejects with DuplicateTaskIdError', async t => {
	const queue = new PQueue({concurrency: 1});
	const {resolve, promise: blocker} = pDefer<string>();
	const first = queue.add(async () => blocker, {id: 'running-dup'});
	await Promise.resolve();

	await t.throwsAsync(queue.add(async () => 'second', {id: 'running-dup'}), {instanceOf: DuplicateTaskIdError});

	resolve('first');
	t.is(await first, 'first');
});

test('.add() - duplicate id rejection is not affected by later adds with the same id', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	queue.add(async () => 'first', {id: 'dup'});
	const duplicate = queue.add(async () => 'second', {id: 'dup'});
	const duplicate2 = queue.add(async () => 'third', {id: 'dup'});

	await t.throwsAsync(duplicate, {instanceOf: DuplicateTaskIdError});
	await t.throwsAsync(duplicate2, {instanceOf: DuplicateTaskIdError});

	queue.start();
	t.is(queue.size, 0);
});

test('.setPriority() - moves a queued task ahead of lower-priority tasks', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];

	queue.add(async () => order.push('a'), {id: 'a', priority: 0});
	queue.add(async () => order.push('b'), {id: 'b', priority: 0});
	queue.add(async () => order.push('c'), {id: 'c', priority: 0});

	queue.setPriority('c', 10);
	queue.start();
	await queue.onIdle();

	t.deepEqual(order, ['c', 'a', 'b']);
});

test('.setPriority() - moves a queued task behind higher-priority tasks', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];

	queue.add(async () => order.push('a'), {id: 'a', priority: 5});
	queue.add(async () => order.push('b'), {id: 'b', priority: 5});
	queue.add(async () => order.push('c'), {id: 'c', priority: 5});

	queue.setPriority('a', 0);
	queue.start();
	await queue.onIdle();

	t.deepEqual(order, ['b', 'c', 'a']);
});

test('.setPriority() - moved task goes behind tasks already in the target tier', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];

	queue.add(async () => order.push('a'), {id: 'a', priority: 0});
	queue.add(async () => order.push('b'), {id: 'b', priority: 0});
	queue.add(async () => order.push('hi1'), {id: 'hi1', priority: 5});
	queue.add(async () => order.push('hi2'), {id: 'hi2', priority: 5});
	queue.add(async () => order.push('c'), {id: 'c', priority: 0});

	// `a` is promoted but joins the tier behind hi1 and hi2.
	queue.setPriority('a', 5);
	// `c` is demoted but joins the remaining tier behind `b`.
	queue.setPriority('c', 0);
	queue.start();
	await queue.onIdle();

	t.deepEqual(order, ['hi1', 'hi2', 'a', 'b', 'c']);
});

test('.setPriority() - same priority is a no-op and keeps FIFO position', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];

	queue.add(async () => order.push('a'), {id: 'a', priority: 0});
	queue.add(async () => order.push('b'), {id: 'b', priority: 0});
	queue.add(async () => order.push('c'), {id: 'c', priority: 0});

	t.notThrows(() => {
		queue.setPriority('a', 0);
	});

	queue.start();
	await queue.onIdle();

	t.deepEqual(order, ['a', 'b', 'c']);
});

test('.setPriority() - order is deterministic across repeated calls', async t => {
	const ids = ['a', 'b', 'c', 'd'];
	const sequences: string[][] = [];

	for (let run = 0; run < 3; run++) {
		const queue = new PQueue({concurrency: 1, autoStart: false});
		const order: string[] = [];

		for (const id of ids) {
			queue.add(async () => order.push(id), {id, priority: 0});
		}

		queue.setPriority('d', 2);
		queue.setPriority('b', 1);
		queue.setPriority('d', 1);
		queue.start();
		// eslint-disable-next-line no-await-in-loop
		await queue.onIdle();
		sequences.push(order);
	}

	for (const order of sequences) {
		t.deepEqual(order, ['b', 'd', 'a', 'c']);
	}
});

test('.setPriority() - respects concurrency when reordering while running', async t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});
	const order: string[] = [];

	const deferreds: Array<DeferredPromise<void>> = [];
	const makeRunningTask = (id: string) => {
		const deferred = pDefer<void>();
		deferreds.push(deferred);
		queue.add(async () => {
			await deferred.promise;
			order.push(id);
		}, {id});
	};

	makeRunningTask('running1');
	makeRunningTask('running2');
	queue.add(async () => order.push('low1'), {id: 'low1', priority: 0});
	queue.add(async () => order.push('low2'), {id: 'low2', priority: 0});
	queue.add(async () => order.push('urgent'), {id: 'urgent', priority: 0});

	queue.start();
	t.is(queue.pending, 2);

	queue.setPriority('urgent', 10);
	deferreds[0]!.resolve();
	deferreds[1]!.resolve();
	await queue.onIdle();

	// The already-running tasks are not preempted, but the promoted task jumps ahead of the low-priority ones.
	t.deepEqual([...order].sort(), ['low1', 'low2', 'running1', 'running2', 'urgent']);
	t.true(order.indexOf('urgent') < order.indexOf('low1'));
	t.true(order.indexOf('urgent') < order.indexOf('low2'));
	t.true(order.indexOf('low1') < order.indexOf('low2'));
});

test('.setPriority() - sizeBy() reflects the new priority immediately', t => {
	const queue = new PQueue({autoStart: false});

	queue.add(async () => 0, {id: 'a', priority: 0});
	queue.add(async () => 0, {id: 'b', priority: 0});
	queue.add(async () => 0, {id: 'c', priority: 1});

	t.is(queue.sizeBy({priority: 0}), 2);
	t.is(queue.sizeBy({priority: 1}), 1);

	queue.setPriority('a', 1);

	t.is(queue.sizeBy({priority: 0}), 1);
	t.is(queue.sizeBy({priority: 1}), 2);
	t.is(queue.size, 3);
});

test('.setPriority() - sizeBy() can find a task by id', t => {
	const queue = new PQueue({autoStart: false});
	queue.add(async () => 0, {id: 'a', priority: 3});

	t.is(queue.sizeBy({id: 'a'}), 1);
	t.is(queue.sizeBy({id: 'a', priority: 3}), 1);
	t.is(queue.sizeBy({id: 'a', priority: 0}), 0);
	t.is(queue.sizeBy({id: 'missing'}), 0);
});

test('.setPriority() - changed order applies after pause/start', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];

	queue.add(async () => order.push('a'), {id: 'a'});
	queue.add(async () => order.push('b'), {id: 'b'});
	queue.add(async () => order.push('c'), {id: 'c'});

	queue.setPriority('c', 10);
	queue.setPriority('a', -10);

	queue.start();
	await queue.onIdle();

	t.deepEqual(order, ['c', 'b', 'a']);
});

test('.setPriority() - task keeps its timeout option after being moved', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	const blocker = pDefer<void>();
	queue.add(async () => blocker.promise, {id: 'blocker'});

	const moved = queue.add(async () => delay(100), {id: 'moved', timeout: 50, throwOnTimeout: true});
	queue.setPriority('moved', 10);
	queue.start();

	await t.throwsAsync(moved, {instanceOf: TimeoutError});
	blocker.resolve();
});

test('.setPriority() - task keeps its signal option after being moved', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	const controller = new AbortController();
	const blocker = pDefer<void>();
	queue.add(async () => blocker.promise, {id: 'blocker'});

	const moved = queue.add(async () => delay(10_000), {id: 'moved', signal: controller.signal});
	queue.setPriority('moved', 10);
	queue.start();

	controller.abort();
	await t.throwsAsync(moved, {instanceOf: DOMException});
	blocker.resolve();
});

test('.setPriority() - resolved result goes to the original add() promise', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	const promise = queue.add(async () => fixture, {id: 'moved', priority: 0});
	queue.setPriority('moved', 10);
	queue.start();

	t.is(await promise, fixture);
});

test('.setPriority() - unknown id throws TaskNotFoundError', t => {
	const queue = new PQueue({autoStart: false});
	queue.add(async () => 0, {id: 'present'});

	const error = t.throws(() => {
		queue.setPriority('missing', 1);
	}, {instanceOf: TaskNotFoundError});

	t.is(error!.name, 'TaskNotFoundError');
	t.true(error!.message.includes('missing'));
});

test('.setPriority() - running task throws TaskRunningError', async t => {
	const queue = new PQueue({concurrency: 1});
	const {resolve, promise} = pDefer();
	const task = queue.add(async () => promise, {id: 'running'});
	await Promise.resolve();

	const error = t.throws(() => {
		queue.setPriority('running', 1);
	}, {instanceOf: TaskRunningError});

	t.is(error!.name, 'TaskRunningError');
	t.true(error!.message.includes('running'));

	resolve();
	await task;

	// Finished task is no longer found either.
	t.throws(() => {
		queue.setPriority('running', 1);
	}, {instanceOf: TaskNotFoundError});
});

test('.setPriority() - non-finite priority throws TypeError and leaves the task in place', t => {
	const queue = new PQueue({autoStart: false});
	queue.add(async () => 0, {id: 'a', priority: 0});

	for (const priority of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
		t.throws(() => {
			queue.setPriority('a', priority);
		}, {instanceOf: TypeError});
	}

	t.is(queue.sizeBy({priority: 0}), 1);
	t.is(queue.sizeBy({priority: 1}), 0);
});

test('.add() - non-string id throws TypeError', async t => {
	const queue = new PQueue();

	await t.throwsAsync(
		// @ts-expect-error Testing invalid id type
		queue.add(async () => 0, {id: ''}),
		{instanceOf: TypeError},
	);
});

test('.clear() - previously queued ids can no longer be found or reprioritized', t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	queue.add(async () => 0, {id: 'a'});
	queue.add(async () => 0, {id: 'b'});

	queue.clear();

	t.throws(() => {
		queue.setPriority('a', 1);
	}, {instanceOf: TaskNotFoundError});
});

test('.clear() - queued ids are reusable, running ids stay reserved until settled', async t => {
	const queue = new PQueue({concurrency: 1});
	const {resolve, promise} = pDefer();
	const runningTask = queue.add(async () => promise, {id: 'running'});
	// `clear()` orphans queued tasks, so hold on to the promise instead of awaiting it.
	const orphanedTask = queue.add(async () => 'queued', {id: 'queued'});
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	orphanedTask.catch(() => {});
	await Promise.resolve();

	queue.clear();

	t.throws(() => {
		queue.setPriority('queued', 1);
	}, {instanceOf: TaskNotFoundError});

	// The running task still occupies the concurrency slot, so this only queues.
	const newQueued = queue.add(async () => 'new-queued', {id: 'queued'});
	await t.throwsAsync(queue.add(async () => 0, {id: 'running'}), {instanceOf: DuplicateTaskIdError});

	resolve();
	await runningTask;
	t.is(await newQueued, 'new-queued');
});

test('.setPriority() - custom queue without setPriority works otherwise and throws on setPriority', t => {
	class CustomQueue implements Queue<RunFunction, QueueAddOptions> {
		readonly items: RunFunction[] = [];

		enqueue(run: RunFunction): void {
			this.items.push(run);
		}

		dequeue(): RunFunction | undefined {
			return this.items.shift();
		}

		get size(): number {
			return this.items.length;
		}

		filter(): RunFunction[] {
			return this.items;
		}
	}

	const queue = new PQueue({concurrency: 1, queueClass: CustomQueue});
	t.notThrows(() => {
		queue.add(async () => 'one');
		queue.add(async () => 'two', {id: 'two'});
	});
	t.is(queue.size, 1);
	t.is(queue.sizeBy({}), 1);

	const error = t.throws(() => {
		queue.setPriority('two', 5);
	}, {instanceOf: TypeError});

	t.true(error!.message.includes('setPriority'));
	t.true(error!.message.includes('CustomQueue'));
});

test('.setPriority() - custom queue implementing setPriority is supported', async t => {
	class PriorityCapableQueue implements Queue<RunFunction, QueueAddOptions> {
		readonly items: Array<{run: RunFunction; priority: number; id?: string}> = [];

		enqueue(run: RunFunction, options?: Partial<QueueAddOptions>): void {
			this.items.push({
				run,
				priority: options?.priority ?? 0,
				id: options?.id,
			});
		}

		dequeue(): RunFunction | undefined {
			if (this.items.length === 0) {
				return undefined;
			}

			let bestIndex = 0;
			for (const [index, item] of this.items.entries()) {
				if (item.priority > this.items[bestIndex]!.priority) {
					bestIndex = index;
				}
			}

			const [item] = this.items.splice(bestIndex, 1);
			return item!.run;
		}

		get size(): number {
			return this.items.length;
		}

		filter(options: Readonly<Partial<QueueAddOptions>>): RunFunction[] {
			return this.items
				.filter(item => (options.priority === undefined || item.priority === options.priority))
				.map(item => item.run);
		}

		setPriority(id: string, priority: number): boolean {
			const item = this.items.find(candidate => candidate.id === id);
			if (item === undefined) {
				return false;
			}

			item.priority = priority;
			return true;
		}
	}

	const queue = new PQueue({concurrency: 1, autoStart: false, queueClass: PriorityCapableQueue});
	const order: string[] = [];

	queue.add(async () => order.push('a'), {id: 'a', priority: 0});
	queue.add(async () => order.push('b'), {id: 'b', priority: 0});
	queue.add(async () => order.push('c'), {id: 'c', priority: 0});

	t.notThrows(() => {
		queue.setPriority('c', 10);
	});

	queue.start();
	await queue.onIdle();

	t.is(order[0], 'c');
	t.is(queue.sizeBy({priority: 10}), 0);
});

test('.setPriority() - id is released after a queued task aborts before running', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	const blocker = pDefer<string>();
	const blockerTask = queue.add(async () => blocker.promise, {id: 'blocker'});

	const controller = new AbortController();
	const aborted = queue.add(async () => delay(10_000), {id: 'aborted', signal: controller.signal});

	queue.start();
	// Abort while the task is still waiting behind the blocker.
	controller.abort();
	blocker.resolve('done');

	t.is(await blockerTask, 'done');
	await t.throwsAsync(aborted, {instanceOf: DOMException});

	// The id is released immediately, before rejection handlers run.
	t.throws(() => {
		queue.setPriority('aborted', 1);
	}, {instanceOf: TaskNotFoundError});

	// The settled task no longer blocks the id.
	const reused = queue.add(async () => 'again', {id: 'aborted'});
	t.is(await reused, 'again');

	await queue.onIdle();
});

test('.addAll() - the same id on every function rejects all but the first', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	await t.throwsAsync(queue.addAll([async () => 1, async () => 2, async () => 3], {id: 'shared'}), {instanceOf: DuplicateTaskIdError});

	t.is(queue.size, 1);
	queue.start();
	await queue.onIdle();
});
