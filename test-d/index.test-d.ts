import {expectType} from 'tsd';
import PQueue from '../source/index.js';

const queue = new PQueue();

expectType<Promise<string | void>>(queue.add(async () => '🦄'));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: true}));
expectType<Promise<string | void>>(queue.add(async () => '🦄', {id: 'unicorn'}));
expectType<Promise<string | void>>(queue.add(async () => '🦄', {id: 42}));

expectType<void>(queue.setPriority('unicorn', 1));
expectType<void>(queue.setPriority(42, -1));
