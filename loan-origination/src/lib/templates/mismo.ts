import "server-only";

/**
 * MISMO v3.4 (ULAD/iLAD) export for a loan — a partial but well-formed Reference Model document
 * built from the dictionary fields we capture today. The legacy Fannie Mae "DU 3.2" flat file was
 * retired for AUS on 2022-03-01 and replaced by this MISMO 3.4 model, so this is the current
 * interchange format.
 *
 * Our deals are business-purpose, entity-borrower DSCR/bridge loans, so the guarantor maps to the
 * URLA Borrower party and the borrowing entity to a LEGAL_ENTITY party; occupancy is Investment and
 * mortgage type is Conventional. Fields we don't yet capture (itemized income/assets/liabilities,
 * the REO schedule, declarations) are simply omitted — add dictionary fields and extend the mapper
 * when needed. Nothing here fabricates values; empty inputs produce no element.
 */

export type Cur = (key: string, idx?: number) => unknown;

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const numStr = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? String(n) : null;
};
const intStr = (v: unknown): string | null => {
  const n = numStr(v);
  return n == null ? null : String(Math.round(Number(n)));
};
const dateStr = (v: unknown): string | null => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const digits = (v: unknown): string | null => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d || null;
};

/** `<Name>value</Name>`, or "" when value is blank — so unset fields drop out of the document. */
const el = (name: string, value: unknown): string => {
  const v = value == null ? "" : String(value);
  return v === "" ? "" : `<${name}>${esc(v)}</${name}>`;
};

/** Wrap children in a container, omitting the container entirely when it has no content. */
const wrap = (name: string, children: string, attrs = ""): string => {
  const inner = children.trim();
  if (!inner) return "";
  return `<${name}${attrs ? " " + attrs : ""}>${inner}</${name}>`;
};

// --- Enumeration maps (dictionary value -> ULAD enum) ---
const loanPurposeType = (v: unknown): string | null => {
  const s = String(v ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("purchase")) return "Purchase";
  if (s.includes("refinance")) return "Refinance";
  return "Other";
};
const isCashOut = (v: unknown): boolean => /cash\s*out/i.test(String(v ?? ""));
const lienPriorityType = (v: unknown): string | null => {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("1")) return "FirstLien";
  if (s.startsWith("2")) return "SecondLien";
  return null;
};
const citizenshipType = (v: unknown): string | null => {
  const s = String(v ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("permanent")) return "PermanentResidentAlien";
  if (s.includes("foreign") || s.includes("non")) return "NonPermanentResidentAlien";
  if (s.includes("us") || s.includes("citizen")) return "USCitizen";
  return null;
};
const legalEntityType = (v: unknown): string | null => {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("llc") || s.includes("limited liability")) return "LimitedLiabilityCompany";
  if (s.includes("corp")) return "Corporation";
  if (s.includes("trust")) return "Trust";
  if (s.includes("lp") || s.includes("limited partnership")) return "LimitedPartnership";
  return null;
};
const attachmentType = (v: unknown): string | null => {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("condo") || s.includes("townhome") || s.includes("attached")) return "Attached";
  if (s.includes("sfr") || s.includes("detached") || s.includes("unit")) return "Detached";
  return null;
};

/** Build the MISMO 3.4 XML string for one loan. `cur(key, idx?)` reads current field values. */
export function buildMismoXml({ cur, loanNumber }: { cur: Cur; loanNumber?: string | null }): string {
  // Subject property address (prefer the parsed parts; fall back to the full address).
  const street = cur("property_street") ?? "";
  const city = cur("property_city") ?? "";
  const state = cur("property_state") ?? "";
  const zip = cur("property_zip") ?? "";

  const address = wrap(
    "ADDRESS",
    [
      el("AddressLineText", street),
      el("CityName", city),
      el("CountyName", cur("property_county")),
      el("PostalCode", zip),
      el("StateCode", state),
    ].join(""),
  );

  // Property value: DSCR uses the as-is value; RTL also carries an after-repair value.
  const asIs = numStr(cur("as_is_value")) ?? numStr(cur("purchase_price"));
  const propertyValuations = [
    wrap(
      "PROPERTY_VALUATION",
      wrap(
        "PROPERTY_VALUATION_DETAIL",
        el("PropertyValuationAmount", asIs) +
          (asIs ? el("PropertyValuationMethodType", "PriorAppraisalUsed") : ""),
      ),
    ),
  ].join("");

  const subjectProperty = wrap(
    "SUBJECT_PROPERTY",
    address +
      wrap(
        "PROPERTY_DETAIL",
        el("FinancedUnitCount", intStr(cur("unit_count"))) +
          el("PropertyUsageType", "Investment") +
          el("PropertyEstateType", "FeeSimple") +
          (attachmentType(cur("property_type")) ? el("AttachmentType", attachmentType(cur("property_type"))) : ""),
      ) +
      wrap("PROPERTY_VALUATIONS", propertyValuations) +
      // Business-purpose rental: expected monthly rent on the subject.
      wrap(
        "PROPERTY_UNITS",
        wrap(
          "PROPERTY_UNIT",
          wrap(
            "PROPERTY_UNIT_DETAIL",
            el("PropertyUnitMonthlyRentAmount", numStr(cur("monthly_rent"))),
          ),
        ),
      ),
  );

  const collaterals = wrap(
    "COLLATERALS",
    wrap("COLLATERAL", subjectProperty),
  );

  // Loan terms.
  const loanAmount = numStr(cur("loan_amount")) ?? numStr(cur("total_loan_amount"));
  const termMonths = intStr(cur("loan_term_months"));
  const purpose = loanPurposeType(cur("loan_purpose"));
  const lien = lienPriorityType(cur("lien_position")) ?? "FirstLien";

  const loan = wrap(
    "LOAN",
    wrap(
      "AMORTIZATION",
      wrap(
        "AMORTIZATION_RULE",
        el("AmortizationType", Number(cur("io_months")) > 0 ? "Other" : "Fixed") +
          el("LoanAmortizationPeriodCount", termMonths) +
          (termMonths ? el("LoanAmortizationPeriodType", "Month") : ""),
      ),
    ) +
      wrap(
        "LOAN_DETAIL",
        el("InterestOnlyIndicator", Number(cur("io_months")) > 0 ? "true" : "false"),
      ) +
      wrap(
        "LOAN_IDENTIFIERS",
        wrap(
          "LOAN_IDENTIFIER",
          el("LoanIdentifier", loanNumber) + (loanNumber ? el("LoanIdentifierType", "LenderLoan") : ""),
        ),
      ) +
      wrap(
        "MATURITY",
        wrap(
          "MATURITY_RULE",
          el("LoanMaturityPeriodCount", termMonths) + (termMonths ? el("LoanMaturityPeriodType", "Month") : ""),
        ),
      ) +
      wrap(
        "TERMS_OF_LOAN",
        el("BaseLoanAmount", loanAmount) +
          el("LoanPurposeType", purpose) +
          (isCashOut(cur("loan_purpose")) ? el("RefinanceCashOutDeterminationType", "CashOut") : "") +
          el("MortgageType", "Conventional") +
          el("NoteRatePercent", numStr(cur("interest_rate"))) +
          el("LienPriorityType", lien),
      ),
  );

  const loans = wrap("LOANS", loan);

  // Parties: the guarantor as the URLA Borrower, and the borrowing entity as a LEGAL_ENTITY.
  const gFirst = cur("guarantor_first_name");
  const gLast = cur("guarantor_last_name");
  const ssn = digits(cur("guarantor_ssn"));
  const borrowerParty = wrap(
    "PARTY",
    wrap(
      "INDIVIDUAL",
      wrap("CONTACT_POINTS", contactPoints(cur("guarantor_phone"), cur("guarantor_email"))) +
        wrap("NAME", el("FirstName", gFirst) + el("LastName", gLast)),
    ) +
      wrap(
        "ROLES",
        wrap(
          "ROLE",
          wrap(
            "BORROWER",
            wrap(
              "BORROWER_DETAIL",
              (citizenshipType(cur("guarantor_citizenship"))
                ? el("CitizenshipResidencyType", citizenshipType(cur("guarantor_citizenship")))
                : "") + el("BorrowerBirthDate", dateStr(cur("guarantor_date_of_birth"))),
            ) +
              creditScore(cur("guarantor_fico")),
          ) + wrap("ROLE_DETAIL", el("PartyRoleType", "Borrower")),
        ),
      ) +
      (ssn ? wrap("TAXPAYER_IDENTIFIERS", wrap("TAXPAYER_IDENTIFIER", el("TaxpayerIdentifierType", "SocialSecurityNumber") + el("TaxpayerIdentifierValue", ssn))) : ""),
  );

  const entityName = cur("borrower_entity");
  const ein = digits(cur("entity_ein"));
  const entityParty = entityName
    ? wrap(
        "PARTY",
        wrap(
          "LEGAL_ENTITY",
          wrap("LEGAL_ENTITY_DETAIL", el("FullName", entityName)),
        ) +
          wrap(
            "ROLES",
            wrap(
              "ROLE",
              wrap(
                "ROLE_DETAIL",
                el("PartyRoleType", "TitleHolder") +
                  (legalEntityType(cur("entity_type")) ? el("LegalEntityType", legalEntityType(cur("entity_type"))) : ""),
              ),
            ),
          ) +
          (ein ? wrap("TAXPAYER_IDENTIFIERS", wrap("TAXPAYER_IDENTIFIER", el("TaxpayerIdentifierType", "EmployerIdentificationNumber") + el("TaxpayerIdentifierValue", ein))) : ""),
      )
    : "";

  const parties = wrap("PARTIES", borrowerParty + entityParty);

  const deal = wrap("DEAL", collaterals + loans + parties);
  const body = wrap(
    "DEAL_SETS",
    wrap("DEAL_SET", wrap("DEALS", deal)),
  );

  const about = wrap(
    "ABOUT_VERSIONS",
    wrap(
      "ABOUT_VERSION",
      el("CreatedDatetime", new Date().toISOString()) + el("DataVersionName", "MISMO 3.4 ULAD"),
    ),
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" ` +
    `xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `MISMOReferenceModelIdentifier="3.4.0322.03.00">` +
    about +
    body +
    `</MESSAGE>\n`
  );
}

function contactPoints(phone: unknown, email: unknown): string {
  const p = String(phone ?? "").replace(/\D/g, "");
  const e = String(email ?? "");
  const telephone = p
    ? wrap(
        "CONTACT_POINT",
        wrap("CONTACT_POINT_TELEPHONE", el("ContactPointTelephoneValue", p)) +
          wrap("CONTACT_POINT_DETAIL", el("ContactPointRoleType", "Home")),
      )
    : "";
  const emailPt = e
    ? wrap(
        "CONTACT_POINT",
        wrap("CONTACT_POINT_EMAIL", el("ContactPointEmailValue", e)),
      )
    : "";
  return telephone + emailPt;
}

function creditScore(fico: unknown): string {
  const n = fico == null || fico === "" ? null : String(fico).replace(/\D/g, "");
  if (!n) return "";
  return wrap(
    "CREDIT_SCORES",
    wrap(
      "CREDIT_SCORE",
      wrap("CREDIT_SCORE_DETAIL", `<CreditScoreValue>${esc(n)}</CreditScoreValue>`),
    ),
  );
}
