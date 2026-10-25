# Setup — M1 Walking Skeleton

This is the first milestone of the chat-driven loan origination prototype: **auth + roles + Row-Level Security + a shared real-time chat on a deal**, plus the lender **Pipeline home** and **Add Loan**. See `../specs/` for the full spec.

## Prerequisites

- Node 20+ (tested on 24), npm.
- A free **Supabase** project (https://supabase.com) — no Docker needed.

## 1. Create a Supabase project

1. Create a new project; note the **Project URL** and keys from **Project Settings → API**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
2. Copy them into `.env.local` (replace the placeholders).

## 2. Apply the schema

In the Supabase dashboard → **SQL Editor**, run these files in order (paste contents and run):

1. `supabase/migrations/0001_core_schema.sql`
2. `supabase/migrations/0002_rls_policies.sql`

## 3. Configure auth

In **Authentication → URL Configuration**, add redirect URLs:

- `http://localhost:3000/auth/callback`

For **Google login** (optional for M1): Authentication → Providers → Google, add your OAuth client ID/secret, and add the callback shown there to your Google Cloud console. Magic-link and password work without this.

> Tip: for fast local testing, turn **off** "Confirm email" under Authentication → Providers → Email, so password sign-up logs you in immediately.

## 4. Run the app

```bash
npm run dev
```

Open http://localhost:3000 → you'll be sent to `/login`. Sign in with a magic link (or password).

## 5. Seed demo data

After signing in once (so your profile exists), edit `supabase/seed.sql` if your email differs, then run it in the SQL Editor. It promotes you to **Admin**, seeds the six loan programs, and creates one demo loan with a shared-chat message, an AI message, and a lender-only internal note.

Reload the app → you'll land on the **Pipeline** home and can open the demo loan.

## What to try (M1 acceptance)

- **Pipeline home + Add Loan:** the lender lands on the pipeline; "Add Loan" starts a new deal chat.
- **Real-time chat:** open the same loan in two browser windows; messages appear live in both.
- **The internal-notes wall:** the "Internal Notes" tab and "Internal (team only)" messages are visible to the lending team. (To prove the wall, invite a borrower account to the deal — later-phase UI — or query as a borrower; RLS blocks internal rows.)
- **Access control:** a user who isn't a participant on a loan cannot open it (RLS returns nothing → not found).
