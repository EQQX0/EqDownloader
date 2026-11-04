import { runEngineContract } from './engine.contract';
import { FakeEngine } from './fake';

runEngineContract('FakeEngine', () => new FakeEngine({ delayMs: 0 }));
