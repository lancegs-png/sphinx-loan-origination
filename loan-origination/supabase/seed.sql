-- seed.sql — demo data for the M1 walking skeleton.
-- Run AFTER you have signed up in the app with the email below (so a profile exists).
-- It promotes that user to Admin, seeds the six loan programs, and creates one demo loan
-- with a shared-chat message, an AI message, and a lender-only internal note.

do $$
declare
  admin_email text := 'lancegs@gmail.com';   -- <-- change if you sign up with a different email
  admin_id uuid;
  prog_id uuid;
  demo_loan_id uuid;
begin
  select id into admin_id from public.profiles where email = admin_email;
  if admin_id is null then
    raise notice 'No profile for % yet. Sign up in the app first, then re-run this seed.', admin_email;
    return;
  end if;

  update public.profiles
     set is_lending_team = true,
         lender_user_type = 'admin',
         full_name = coalesce(full_name, 'Lance (Admin)')
   where id = admin_id;

  insert into public.loan_programs (name, loan_type_key, public_info) values
    ('Bridge', 'bridge', 'Short-term bridge financing secured by real estate.'),
    ('Fix and Flip', 'fix_and_flip', 'Acquisition plus rehab financing for resale.'),
    ('New Construction', 'new_construction', 'Ground-up construction financing.'),
    ('DSCR', 'dscr', 'Rental loans qualified on property cash flow.'),
    ('Commercial Bridge', 'commercial_bridge', 'Short-term commercial property financing.'),
    ('Commercial Permanent', 'commercial_permanent', 'Long-term commercial financing.')
  on conflict (loan_type_key) do nothing;

  select id into prog_id from public.loan_programs where loan_type_key = 'dscr';

  if not exists (select 1 from public.loans) then
    insert into public.loans
      (program_id, account_manager_id, stage, loan_type, loan_amount,
       property_address, borrower_name, expected_close_date, created_by)
    values
      (prog_id, admin_id, 'processing', 'DSCR', 750000,
       '123 Example St, Austin, TX', 'Acme Holdings LLC', current_date + 21, admin_id)
    returning id into demo_loan_id;

    insert into public.deal_participants (loan_id, user_id, participant_role, added_by)
    values (demo_loan_id, admin_id, 'lending_team', admin_id);

    insert into public.messages (loan_id, sender_kind, sender_role, body) values
      (demo_loan_id, 'system', 'system', 'Welcome to the deal. Current stage: Processing.'),
      (demo_loan_id, 'ai', 'ai', 'I am the record keeper for this loan. Ask me anything about it.');

    insert into public.internal_notes (loan_id, author_id, body)
    values (demo_loan_id, admin_id,
            'INTERNAL: targeting exit with note buyer at 102. Not visible to the borrower.');

    raise notice 'Demo loan created.';
  end if;
end $$;
