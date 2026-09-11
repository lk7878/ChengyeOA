-- SPEC-016 approval multilevel provision: upgrade the CONTRACT_CHANGE definition
-- to a real two-node chain (主管初审 MANAGER → 合伙人终审 PARTNER).
-- The top-level approverRule column is intentionally left untouched — nodeSchema is
-- authoritative for multilevel flows (Task 3 consumes it), and a plain UPDATE with a
-- WHERE guard is inherently idempotent (no conflict target needed).

UPDATE "approval_definition"
SET "nodeSchema" = '[{"name":"主管初审","approverRule":{"type":"ROLE","roleCodes":["MANAGER"]}},{"name":"合伙人终审","approverRule":{"type":"ROLE","roleCodes":["PARTNER"]}}]'::jsonb
WHERE "code" = 'CONTRACT_CHANGE';
