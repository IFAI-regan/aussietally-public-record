# AussieTally public result record

Dated copies of public, grouped voting results, with SHA-256 checksums. No phone numbers, accounts, individual votes or private research drafts are published here.

The daily job reads public Supabase views with a public read-only key. It validates version 3 result payloads and checksums, saves each exact UTF-8 payload without a trailing newline, and refuses to overwrite historical files. Only a successful job commits the updated manifest and files together. The launch test question and all demo questions are excluded.

## Check a record

Open `manifest.json`, then download a referenced file and its `.sha256` file. Run `shasum -a 256 <file>.json` and compare the output. GitHub commit history records when copies were published. A downloaded copy can be compared later without accessing AussieTally's database.

This repository is operated by AussieTally. It is an external public record, not an independent audit or an immutable log. Administrators of this GitHub repository can change its history. Checksums show whether file contents match; they do not prove voter identity or that the original tally was correct. Anyone can retain their own copies.

Publication runs daily. A newly captured database snapshot may not appear until the next successful run. Workflow failures retain the previous published files. See Actions for job results and timestamps.

Before launch, the manifest may be empty because no real questions have been published. Fake data is never substituted for a real record.
