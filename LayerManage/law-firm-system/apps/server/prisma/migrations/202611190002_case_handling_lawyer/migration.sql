-- Keep original field IDs, permissions, views and legacy case values.
WITH changed AS (
  UPDATE collab_field f SET type = 'USER'
  FROM collab_table t
  WHERE f."tableId" = t.id AND t.source = 'CASES'
    AND f.options->>'businessKey' = 'intake.handlingLawyer' AND f.type <> 'USER'
  RETURNING f."tableId"
)
UPDATE collab_table SET "schemaVersion" = "schemaVersion" + 1
WHERE id IN (SELECT "tableId" FROM changed);
