CREATE SEQUENCE lead_follow_serial_seq;
ALTER TABLE lead_follow ADD COLUMN "serialNo" INTEGER, ADD COLUMN profile JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "enteredAt" TIMESTAMP(3), ADD COLUMN "updatedAt" TIMESTAMP(3);
WITH numbered AS (SELECT id, row_number() OVER (ORDER BY "createdAt", id)::integer AS n FROM lead_follow)
UPDATE lead_follow f SET "serialNo"=n.n, "enteredAt"=f."createdAt", "updatedAt"=f."createdAt" FROM numbered n WHERE f.id=n.id;
SELECT setval('lead_follow_serial_seq', COALESCE((SELECT max("serialNo") FROM lead_follow),0)+1, false);
ALTER SEQUENCE lead_follow_serial_seq OWNED BY lead_follow."serialNo";
ALTER TABLE lead_follow ALTER COLUMN "serialNo" SET DEFAULT nextval('lead_follow_serial_seq'), ALTER COLUMN "serialNo" SET NOT NULL,
  ALTER COLUMN "enteredAt" SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN "enteredAt" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET NOT NULL;
CREATE UNIQUE INDEX "lead_follow_serialNo_key" ON lead_follow("serialNo");
