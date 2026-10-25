// Mock integration implementations (R-NFR-8). Each returns clearly-simulated results.
// Swapped for real Drive/Gmail/pricing/e-sign providers in later phases.
import type {
  CreditProvider,
  DocumentStore,
  ESignProvider,
  MailService,
  PipelineProvider,
  PricingProvider,
} from './types';

export const mockDocumentStore: DocumentStore = {
  async createLoanFolder({ loanNumber, propertyAddress, borrowerName }) {
    return { folderId: `mock-folder:${loanNumber} ${propertyAddress} ${borrowerName}` };
  },
  async uploadDocument({ folderId, fileName }) {
    return { id: `mock-doc:${fileName}`, name: fileName, path: `${folderId}/${fileName}` };
  },
  async deleteDocument() {
    /* no-op (simulated) */
  },
  async listTemplates() {
    return [
      { id: 'tpl-termsheet', name: 'Term Sheet.docx', path: 'templates/Term Sheet.docx' },
      { id: 'tpl-application', name: 'Full Application.pdf', path: 'templates/Full Application.pdf' },
    ];
  },
};

export const mockMailService: MailService = {
  async draft({ to, subject, body }) {
    return { id: `mock-draft:${Date.now()}`, to, subject, body };
  },
  async send() {
    /* no-op (simulated); real send requires per-message human approval */
  },
};

export const mockPricingProvider: PricingProvider = {
  async price({ loanAmount, propertyValue }) {
    const ltv = propertyValue ? Math.round((loanAmount / propertyValue) * 100) : 0;
    return { rate: 10.5, termMonths: 24, points: 2, estimatedPayment: Math.round((loanAmount * 0.105) / 12), ltv };
  },
};

export const mockESignProvider: ESignProvider = {
  async sign({ documentId, ip, location }) {
    return { signedAt: new Date().toISOString(), ip, location, documentId };
  },
};

export const mockPipelineProvider: PipelineProvider = {
  async pushStage() {
    /* no-op (simulated) */
  },
};

export const mockCreditProvider: CreditProvider = {
  async pull() {
    return { simulated: true, score: 720 };
  },
};
