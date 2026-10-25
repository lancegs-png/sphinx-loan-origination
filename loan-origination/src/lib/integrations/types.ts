// Integration interfaces (design §3, §8.3, R-NFR-6).
// Real implementations (Drive, Gmail) land in later phases; mocks live in mocks.ts.
// Keeping these behind interfaces lets the mocked prototype pieces be swapped without
// touching core flow logic.

export interface StoredFile {
  id: string;
  name: string;
  path: string;
  driveFileId?: string;
}

export interface DocumentStore {
  createLoanFolder(args: {
    loanNumber: string;
    propertyAddress: string;
    borrowerName: string;
  }): Promise<{ folderId: string }>;
  uploadDocument(args: {
    folderId: string;
    fileName: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredFile>;
  deleteDocument(args: { driveFileId: string }): Promise<void>;
  listTemplates(): Promise<StoredFile[]>;
}

export interface MailDraft {
  id: string;
  to: string[];
  subject: string;
  body: string;
}

export interface MailService {
  // Drafts only; a human approves before send (R-MAIL-4).
  draft(args: { to: string[]; subject: string; body: string }): Promise<MailDraft>;
  send(args: { draftId: string }): Promise<void>;
}

export interface Quote {
  rate: number;
  termMonths: number;
  points: number;
  estimatedPayment: number;
  ltv: number;
}

export interface PricingProvider {
  price(args: {
    programKey: string;
    loanAmount: number;
    propertyValue: number;
  }): Promise<Quote>;
}

export interface SignatureResult {
  signedAt: string;
  ip: string;
  location: string;
  documentId: string;
}

export interface ESignProvider {
  sign(args: {
    documentId: string;
    signerUserId: string;
    ip: string;
    location: string;
  }): Promise<SignatureResult>;
}

export interface PipelineProvider {
  pushStage(args: { loanNumber: string; stage: string }): Promise<void>;
}

export interface CreditProvider {
  pull(args: { borrowerName: string }): Promise<{ simulated: true; score: number }>;
}
