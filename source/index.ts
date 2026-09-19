import {EventEmitter} from 'eventemitter3';
import pTimeout, {TimeoutError} from 'p-timeout';
import {type Queue, type RunFunction, type TaskId} from './queue.js';
import PriorityQueue from './priority-queue.js';
import {type QueueAddOptions, type Options, type TaskOptions} from './options.js';

type Task<TaskResultType> =
	| ((options: TaskOptions) => PromiseLike<TaskResultType>)
	| ((options: TaskOptions) => TaskResultType);

type EventName = 'active' | 'idle' | 'empty' | 'add' | 'next' | 'completed' | 'error';

/**
Promise queue with concurrency control.
*/
export default class PQueue<QueueType extends Queue<RunFunction, EnqueueOptionsType> = PriorityQueue, EnqueueOptionsType extends QueueAddOptions = QueueAddOptions> extends EventEmitter<EventName> { // eslint-disable-line @typescript-eslint/naming-convention, unicorn/prefer-event-target
	readonly #carryoverConcurrencyCount: boolean;

	readonly #isIntervalIgnored: boolean;

	#intervalCount = 0;

	readonly #intervalCap: number;

	readonly #interval: number;

	#intervalEnd = 0;

	#intervalId?: NodeJS.Timeout;

	#timeoutId?: NodeJS.Timeout;

	#queue: QueueType;

	readonly #queueClass: new () => QueueType;

	#pending = 0;

	// The `!` is needed because of https://github.com/microsoft/TypeScript/issues/32194
	#concurrency!: number;

	#isPaused: boolean;

	readonly #throwOnTimeout: boolean;

	// Explicit ids of tasks that are still waiting in the queue.
	readonly #waitingIds = new Set<TaskId>();

	// Explicit ids of tasks that have started and are still running.
	readonly #pendingIds = new Set<TaskId>();

	/**
	Per-operation timeout in milliseconds. Operations fulfill once `timeout` elapses if they haven't already.

	Applies to each future operation.
	*/
	timeout?: number;

	// TODO: The `throwOnTimeout` option should affect the return types of `add()` and `addAll()`
	constructor(options?: Options<QueueType, EnqueueOptionsType>) {
		super();

		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
		options = {
			carryoverConcurrencyCount: false,
			intervalCap: Number.POSITIVE_INFINITY,
			interval: 0,
			concurrency: Number.POSITIVE_INFINITY,
			autoStart: true,
			queueClass: PriorityQueue,
			...options,
		} as Options<QueueType, EnqueueOptionsType>;

		if (!(typeof options.intervalCap === 'number' && options.intervalCap >= 1)) {
			throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${options.intervalCap?.toString() ?? ''}\` (${typeof options.intervalCap})`);
		}

		if (options.interval === undefined || !(Number.isFinite(options.interval) && options.interval >= 0)) {
			throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${options.interval?.toString() ?? ''}\` (${typeof options.interval})`);
		}

		this.#carryoverConcurrencyCount = options.carryoverConcurrencyCount!;
		this.#isIntervalIgnored = options.intervalCap === Number.POSITIVE_INFINITY || options.interval === 0;
		this.#intervalCap = options.intervalCap;
		this.#interval = options.interval;
		this.#queue = new options.queueClass!();
		this.#queueClass = options.queueClass!;
		this.concurrency = options.concurrency!;
		this.timeout = options.timeout;
		this.#throwOnTimeout = options.throwOnTimeout === true;
		this.#isPaused = options.autoStart === false;
	}

	get #doesIntervalAllowAnother(): boolean {
		return this.#isIntervalIgnored || this.#intervalCount < this.#intervalCap;
	}

	get #doesConcurrentAllowAnother(): boolean {
		return this.#pending < this.#concurrency;
	}

	#next(): void {
		this.#pending--;
		this.#tryToStartAnother();
		this.emit('next');
	}

	#onResumeInterval(): void {
		this.#onInterval();
		this.#initializeIntervalIfNeeded();
		this.#timeoutId = undefined;
	}

	get #isIntervalPaused(): boolean {
		const now = Date.now();

		if (this.#intervalId === undefined) {
			const delay = this.#intervalEnd - now;
			if (delay < 0) {
				// Act as the interval was done
				// We don't need to resume it here because it will be resumed on line 160
				this.#intervalCount = (this.#carryoverConcurrencyCount) ? this.#pending : 0;
			} else {
				// Act as the interval is pending
				if (this.#timeoutId === undefined) {
					this.#timeoutId = setTimeout(
						() => {
							this.#onResumeInterval();
						},
						delay,
					);
				}

				return true;
			}
		}

		return false;
	}

	#tryToStartAnother(): boolean {
		if (this.#queue.size === 0) {
			// We can clear the interval ("pause")
			// Because we can redo it later ("resume")
			if (this.#intervalId) {
				clearInterval(this.#intervalId);
			}

			this.#intervalId = undefined;

			this.emit('empty');

			if (this.#pending === 0) {
				this.emit('idle');
			}

			return false;
		}

		if (!this.#isPaused) {
			const canInitializeInterval = !this.#isIntervalPaused;
			if (this.#doesIntervalAllowAnother && this.#doesConcurrentAllowAnother) {
				const job = this.#queue.dequeue();
				if (!job) {
					return false;
				}

				this.emit('active');
				job();

				if (canInitializeInterval) {
					this.#initializeIntervalIfNeeded();
				}

				return true;
			}
		}

		return false;
	}

	#initializeIntervalIfNeeded(): void {
		if (this.#isIntervalIgnored || this.#intervalId !== undefined) {
			return;
		}

		this.#intervalId = setInterval(
			() => {
				this.#onInterval();
			},
			this.#interval,
		);

		this.#intervalEnd = Date.now() + this.#interval;
	}

	#onInterval(): void {
		if (this.#intervalCount === 0 && this.#pending === 0 && this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = undefined;
		}

		this.#intervalCount = this.#carryoverConcurrencyCount ? this.#pending : 0;
		this.#processQueue();
	}

	/**
	Executes all queued functions until it reaches the limit.
	*/
	#processQueue(): void {
		// eslint-disable-next-line no-empty
		while (this.#tryToStartAnother()) {}
	}

	get concurrency(): number {
		return this.#concurrency;
	}

	set concurrency(newConcurrency: number) {
		if (!(typeof newConcurrency === 'number' && newConcurrency >= 1)) {
			throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${newConcurrency}\` (${typeof newConcurrency})`);
		}

		this.#concurrency = newConcurrency;

		this.#processQueue();
	}

	async #throwOnAbort(signal: AbortSignal): Promise<never> {
		return new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => {
				reject(signal.reason);
			}, {once: true});
		});
	}

	/**
	Adds a sync or async task to the queue. Always returns a promise.
	*/
	async add<TaskResultType>(function_: Task<TaskResultType>, options: {throwOnTimeout: true} & Exclude<EnqueueOptionsType, 'throwOnTimeout'>): Promise<TaskResultType>;
	async add<TaskResultType>(function_: Task<TaskResultType>, options?: Partial<EnqueueOptionsType>): Promise<TaskResultType | void>;
	async add<TaskResultType>(function_: Task<TaskResultType>, options: Partial<EnqueueOptionsType> = {}): Promise<TaskResultType | void> {
		options = {
			timeout: this.timeout,
			throwOnTimeout: this.#throwOnTimeout,
			...options,
		};

		const {id} = options;

		if (id !== undefined) {
			if (typeof id === 'number' && Number.isNaN(id)) {
				throw new TypeError('Expected `id` to be a string or a number other than `NaN`');
			}

			if (typeof id !== 'string' && typeof id !== 'number') {
				throw new TypeError(`Expected \`id\` to be a string or number, got \`${String(id)}\` (${typeof id})`);
			}

			if (this.#waitingIds.has(id) || this.#pendingIds.has(id)) {
				throw new Error(`A task with the id \`${String(id)}\` is already queued or running`);
			}
		}

		return new Promise((resolve, reject) => {
			if (id !== undefined) {
				this.#waitingIds.add(id);
			}

			this.#queue.enqueue(async () => {
				if (id !== undefined) {
					this.#waitingIds.delete(id);
					this.#pendingIds.add(id);
				}

				this.#pending++;
				this.#intervalCount++;

				try {
					options.signal?.throwIfAborted();

					let operation = function_({signal: options.signal});

					if (options.timeout) {
						operation = pTimeout(Promise.resolve(operation), {milliseconds: options.timeout});
					}

					if (options.signal) {
						operation = Promise.race([operation, this.#throwOnAbort(options.signal)]);
					}

					const result = await operation;
					resolve(result);
					this.emit('completed', result);
				} catch (error: unknown) {
					if (error instanceof TimeoutError && !options.throwOnTimeout) {
						resolve();
						return;
					}

					reject(error);
					this.emit('error', error);
				} finally {
					if (id !== undefined) {
						this.#pendingIds.delete(id);
					}

					this.#next();
				}
			}, options);

			this.emit('add');

			this.#tryToStartAnother();
		});
	}

	/**
	Same as `.add()`, but accepts an array of sync or async functions.

	@returns A promise that resolves when all functions are resolved.
	*/
	async addAll<TaskResultsType>(
		functions: ReadonlyArray<Task<TaskResultsType>>,
		options?: {throwOnTimeout: true} & Partial<Exclude<EnqueueOptionsType, 'throwOnTimeout'>>,
	): Promise<TaskResultsType[]>;
	async addAll<TaskResultsType>(
		functions: ReadonlyArray<Task<TaskResultsType>>,
		options?: Partial<EnqueueOptionsType>,
	): Promise<Array<TaskResultsType | void>>;
	async addAll<TaskResultsType>(
		functions: ReadonlyArray<Task<TaskResultsType>>,
		options?: Partial<EnqueueOptionsType>,
	): Promise<Array<TaskResultsType | void>> {
		return Promise.all(functions.map(async function_ => this.add(function_, options)));
	}

	/**
	Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)
	*/
	start(): this {
		if (!this.#isPaused) {
			return this;
		}

		this.#isPaused = false;

		this.#processQueue();
		return this;
	}

	/**
	Put queue execution on hold.
	*/
	pause(): void {
		this.#isPaused = true;
	}

	/**
	Update the priority of a waiting task.

	The task is identified by the explicit `id` given to `.add()`, and it must still be waiting in the queue. The new priority takes effect immediately: the queue's dequeue order reflects it on the next start. The task's promise and options are unaffected, and updating to the same priority preserves its original insertion order among tasks of that priority.

	@param id - The `id` of the task as given to `.add()`.
	@param priority - New priority. Must be a finite number.
	*/
	setPriority(id: TaskId, priority: number): void {
		if (typeof id === 'number' && Number.isNaN(id)) {
			throw new TypeError('Expected `id` to be a string or a number other than `NaN`');
		}

		if (typeof id !== 'string' && typeof id !== 'number') {
			throw new TypeError(`Expected \`id\` to be a string or number, got \`${String(id)}\` (${typeof id})`);
		}

		if (!(typeof priority === 'number' && Number.isFinite(priority))) {
			throw new TypeError(`Expected \`priority\` to be a finite number, got \`${priority}\` (${typeof priority})`);
		}

		if (this.#pendingIds.has(id)) {
			throw new Error(`Cannot update the priority of task \`${String(id)}\` because it has already started running`);
		}

		if (!this.#waitingIds.has(id)) {
			throw new Error(`No waiting task with the id \`${String(id)}\`. It may have finished, never had an explicit \`id\`, or never been added`);
		}

		this.#queue.setPriority(id, priority);
	}

	/**
	Clear the queue.
	*/
	clear(): void {
		this.#queue = new this.#queueClass();
		this.#waitingIds.clear();
	}

	/**
	Can be called multiple times. Useful if you for example add additional items at a later time.

	@returns A promise that settles when the queue becomes empty.
	*/
	async onEmpty(): Promise<void> {
		// Instantly resolve if the queue is empty
		if (this.#queue.size === 0) {
			return;
		}

		await this.#onEvent('empty');
	}

	/**
	@returns A promise that settles when the queue size is less than the given limit: `queue.size < limit`.

	If you want to avoid having the queue grow beyond a certain size you can `await queue.onSizeLessThan()` before adding a new item.

	Note that this only limits the number of items waiting to start. There could still be up to `concurrency` jobs already running that this call does not include in its calculation.
	*/
	async onSizeLessThan(limit: number): Promise<void> {
		// Instantly resolve if the queue is empty.
		if (this.#queue.size < limit) {
			return;
		}

		await this.#onEvent('next', () => this.#queue.size < limit);
	}

	/**
	The difference with `.onEmpty` is that `.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.

	@returns A promise that settles when the queue becomes empty, and all promises have completed; `queue.size === 0 && queue.pending === 0`.
	*/
	async onIdle(): Promise<void> {
		// Instantly resolve if none pending and if nothing else is queued
		if (this.#pending === 0 && this.#queue.size === 0) {
			return;
		}

		await this.#onEvent('idle');
	}

	async #onEvent(event: EventName, filter?: () => boolean): Promise<void> {
		return new Promise(resolve => {
			const listener = () => {
				if (filter && !filter()) {
					return;
				}

				this.off(event, listener);
				resolve();
			};

			this.on(event, listener);
		});
	}

	/**
	Size of the queue, the number of queued items waiting to run.
	*/
	get size(): number {
		return this.#queue.size;
	}

	/**
	Size of the queue, filtered by the given options.

	For example, this can be used to find the number of items remaining in the queue with a specific priority level.
	*/
	sizeBy(options: Readonly<Partial<EnqueueOptionsType>>): number {
		// eslint-disable-next-line unicorn/no-array-callback-reference
		return this.#queue.filter(options).length;
	}

	/**
	Number of running items (no longer in the queue).
	*/
	get pending(): number {
		return this.#pending;
	}

	/**
	Whether the queue is currently paused.
	*/
	get isPaused(): boolean {
		return this.#isPaused;
	}
}

export type {Queue, TaskId} from './queue.js';
export {type QueueAddOptions, type Options} from './options.js';
