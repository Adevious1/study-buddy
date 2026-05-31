import { apiRepository } from './apiRepository';
import type { Repository } from './repository';
export const repository: Repository = apiRepository;
export type { Repository } from './repository';
export { ApiError } from './apiRepository';
