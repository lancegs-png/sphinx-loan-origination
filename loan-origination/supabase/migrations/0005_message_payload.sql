-- 0005_message_payload.sql
-- Lets an AI message carry a structured payload (e.g. an inline intake form spec:
-- a small group of fields / dropdowns rendered in the chat). Plain messages leave it null.

alter table public.messages add column if not exists payload jsonb;
