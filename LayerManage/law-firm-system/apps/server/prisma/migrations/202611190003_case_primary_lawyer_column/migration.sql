-- Reuse the canonical field so stored field permissions and existing view references survive.
DO $$
DECLARE
  case_table record;
  lawyer collab_field%ROWTYPE;
  anchor collab_field%ROWTYPE;
  target_position integer;
  field_name text;
  suffix integer;
  shared_view record;
  columns_after jsonb;
BEGIN
  FOR case_table IN SELECT id FROM collab_table WHERE source = 'CASES' FOR UPDATE LOOP
    SELECT * INTO lawyer FROM collab_field WHERE "tableId" = case_table.id
      AND options->>'businessKey' = 'lawyerId' ORDER BY archived, position, id LIMIT 1;
    SELECT * INTO anchor FROM collab_field WHERE "tableId" = case_table.id
      AND options->>'businessKey' = 'intake.handlingLawyer' AND NOT archived ORDER BY position, id LIMIT 1;

    IF lawyer.id IS NULL OR lawyer.archived OR lawyer.type <> 'USER'
       OR (anchor.id IS NOT NULL AND lawyer.position <> anchor.position - 1) THEN
      target_position := anchor.position;
      IF target_position IS NULL THEN
        SELECT coalesce(max(position) + 1, 0) INTO target_position FROM collab_field WHERE "tableId" = case_table.id;
      ELSE
        UPDATE collab_field SET position = position + 1 WHERE "tableId" = case_table.id
          AND position >= target_position AND id IS DISTINCT FROM lawyer.id;
      END IF;
      field_name := coalesce(lawyer.name, '主办律师');
      suffix := 0;
      WHILE EXISTS (SELECT 1 FROM collab_field WHERE "tableId" = case_table.id AND NOT archived
                    AND name = field_name AND id IS DISTINCT FROM lawyer.id) LOOP
        suffix := suffix + 1;
        field_name := '主办律师（案件' || CASE WHEN suffix = 1 THEN '' ELSE suffix::text END || '）';
      END LOOP;
      IF lawyer.id IS NULL THEN
        INSERT INTO collab_field (id, "tableId", name, type, options, position)
          VALUES (gen_random_uuid()::text, case_table.id, field_name, 'USER',
                  '{"businessSource":"CASES","businessKey":"lawyerId"}', target_position)
          RETURNING * INTO lawyer;
      ELSE
        UPDATE collab_field SET archived = false, type = 'USER', position = target_position, name = field_name
          WHERE id = lawyer.id;
      END IF;
      UPDATE collab_table SET "schemaVersion" = "schemaVersion" + 1 WHERE id = case_table.id;
    END IF;

    FOR shared_view IN SELECT id, config FROM collab_view WHERE "tableId" = case_table.id AND shared
        AND "isDefault" AND jsonb_typeof(config->'visibleFields') = 'array' FOR UPDATE LOOP
      WITH retained AS (
        SELECT value, pos FROM jsonb_array_elements_text(shared_view.config->'visibleFields')
          WITH ORDINALITY AS old(value, pos) WHERE value <> lawyer.id
      ), arranged AS (
        SELECT value, pos, 1 AS tie FROM retained
        UNION ALL
        SELECT lawyer.id, coalesce(min(pos) FILTER (WHERE value = anchor.id), max(pos) + 1, 1), 0 FROM retained
      )
      SELECT jsonb_agg(value ORDER BY pos, tie) INTO columns_after FROM arranged;
      UPDATE collab_view SET config = jsonb_set(config, '{visibleFields}', columns_after), version = version + 1
        WHERE id = shared_view.id AND config->'visibleFields' IS DISTINCT FROM columns_after;
    END LOOP;
  END LOOP;
END $$;
