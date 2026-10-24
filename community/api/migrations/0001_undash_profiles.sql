-- Rewrite en/em dashes in stored profile documents to plain punctuation.
-- Covers literal characters and JSON \u escapes. Idempotent.
UPDATE profiles
SET document =
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(document,
    ' — ', ': '), '—', ': '),
    ' \u2014 ', ': '), '\u2014', ': '),
    ' – ', ' to '), '–', ' to '),
    ' \u2013 ', ' to '), '\u2013', ' to ')
WHERE instr(document, '—') > 0 OR instr(document, '–') > 0
   OR instr(document, '\u2014') > 0 OR instr(document, '\u2013') > 0;
