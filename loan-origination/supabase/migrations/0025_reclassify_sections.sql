-- 0025_reclassify_sections.sql
-- Restore the Loan Info field groupings to the DSCR Deal Dashboard layout.
--
-- When the Program Configuration sheet was introduced (0021), the sheet's "Section"
-- column reclassified a batch of fields. Two groups ended up in sections the Loan Info
-- view doesn't surface the way the dashboard did:
--   * Guarantor fields landed in section 'guarantor', which loan-data.tsx never renders
--     as a card — so guarantor info disappeared from Borrower Information.
--   * The closing figures stayed in the generic 'loan' section instead of the dedicated
--     'closing' (Closing Calculations) ledger card.
--
-- The app already carries the dashboard labels and the Borrower Info / Closing
-- Calculations section cards; only field_definitions.section was off. This resets it.
-- Per-loan values are untouched (they key off field_key, not section).

-- Guarantor info → Borrower Information
update public.field_definitions set section = 'borrower'
where key in (
  'guarantor_first_name',
  'guarantor_last_name',
  'guarantor_email',
  'guarantor_phone',
  'guarantor_fico',
  'guarantor_citizenship',
  'guarantor_ownership_pct',
  'guarantor_ssn',
  'guarantor_date_of_birth',
  'guarantor_mailing_address'
);

-- Closing figures → Closing Calculations
update public.field_definitions set section = 'closing'
where key in (
  'closing_date',
  'disbursement_date',
  'first_payment_date',
  'reserve_amount',
  'origination_fee_amount',
  'underwriting_fee',
  'legal_fee',
  'prepaid_interest',
  'closing_costs',
  'net_wire'
);
