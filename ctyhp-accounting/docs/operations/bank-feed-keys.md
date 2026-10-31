# Bank feed keys

A bank feed connected through Plaid leaves OneBook holding an access token
for that bank. The token is stored sealed (AES-256-GCM) with
`BANK_FEED_ENCRYPTION_KEY`, never in plain text, in
`acc_bank_connection_secret`, one row per connection in each company.

Since 2.96 each sealed token:

- **names the key that sealed it**, by a short fingerprint, so a new key can
  be brought in while the old one is still read;
- **belongs to its own connection**: it is bound to the connection's Plaid
  item, so a sealed token copied onto another connection's row does not open.

Tokens sealed before 2.96 (`v1`) are still read. They are moved to the new
form by the reseal script below, run once after 2.96 is deployed.

## The two settings

| Setting | What it holds |
| --- | --- |
| `BANK_FEED_ENCRYPTION_KEY` | The key every new token is sealed with. At least 32 characters. |
| `BANK_FEED_ENCRYPTION_KEY_PREVIOUS` | Older keys still read while a rotation is under way, comma-separated. Empty the rest of the time. |

Both live in the Vercel project's environment variables (Production) and, for
running the script, in `.env.local` on the machine that runs it. Never in the
repository.

## After deploying 2.96, once

1. Put the production `BANK_FEED_ENCRYPTION_KEY` in `.env.local` beside
   `SUPABASE_DB_URL`.
2. Dry run: `node --env-file=.env.local scripts/reseal-bank-tokens.mjs`.
   It lists each company with connections and how many tokens it would
   reseal. Nothing is written.
3. `node --env-file=.env.local scripts/reseal-bank-tokens.mjs --commit`.
   Every company is written in one transaction.
4. Run the dry run again: it should report 0 to reseal.

## Rotating the key

Rotate when the key may have been seen by someone who should not have it, when
someone who knew it leaves, or on a schedule you set.

1. Generate a new key of at least 32 random characters.
2. In Vercel: set `BANK_FEED_ENCRYPTION_KEY` to the new key and
   `BANK_FEED_ENCRYPTION_KEY_PREVIOUS` to the old one. Redeploy. From now on
   new connections are sealed with the new key, and existing ones still open
   with the old one.
3. Put the same two values in `.env.local` and run the reseal script, dry run
   first, then with `--commit`.
4. Run the dry run again: 0 to reseal.
5. Remove `BANK_FEED_ENCRYPTION_KEY_PREVIOUS` from Vercel and `.env.local`, and
   redeploy. The old key no longer opens anything OneBook holds.

## When the script stops

The script changes nothing unless every token opens. A line such as
`FAIL co_example connection <id>: The bank token was sealed with a key OneBook
no longer holds (a1b2c3d4)` means the key that sealed that token is in neither
setting. Find it (the fingerprint names it), add it to
`BANK_FEED_ENCRYPTION_KEY_PREVIOUS`, and run again. If it cannot be found, that
connection has to be disconnected and connected again in Banking.
