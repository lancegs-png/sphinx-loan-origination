// Provider registry (design §3). Returns the active implementation for each integration.
// For the prototype these are mocks; later phases swap in Drive/Gmail/pricing/e-sign by config.
import {
  mockCreditProvider,
  mockDocumentStore,
  mockESignProvider,
  mockMailService,
  mockPipelineProvider,
  mockPricingProvider,
} from './mocks';

export const integrations = {
  documents: mockDocumentStore,
  mail: mockMailService,
  pricing: mockPricingProvider,
  esign: mockESignProvider,
  pipeline: mockPipelineProvider,
  credit: mockCreditProvider,
};
