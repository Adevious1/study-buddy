import { mockRepository } from './mockRepository';
import type { Repository } from './repository';

// Single seam. SP2 swaps this for an API-backed implementation.
export const repository: Repository = mockRepository;
export type { Repository } from './repository';
