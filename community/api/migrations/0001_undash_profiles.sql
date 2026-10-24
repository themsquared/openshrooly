-- Rewrite en/em dashes in stored profile documents to plain punctuation.
-- Idempotent: a second run finds nothing left to replace.
UPDATE profiles
SET document = REPLACE(REPLACE(document, '—', ': '), '–', ' to ')
WHERE instr(document, '—') > 0 OR instr(document, '–') > 0;
