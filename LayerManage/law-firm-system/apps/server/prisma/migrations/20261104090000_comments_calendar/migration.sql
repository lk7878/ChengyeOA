ALTER TABLE "collab_comment" ADD COLUMN "tableId" TEXT;
UPDATE "collab_comment" c SET "tableId" = r."tableId" FROM "collab_record" r WHERE c."recordId" = r.id;
ALTER TABLE "collab_comment" ALTER COLUMN "tableId" SET NOT NULL;
ALTER TABLE "collab_comment" DROP CONSTRAINT "collab_comment_recordId_fkey";
ALTER TABLE "collab_comment" ADD CONSTRAINT "collab_comment_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "collab_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collab_comment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "collab_comment_tableId_recordId_createdAt_idx" ON "collab_comment"("tableId", "recordId", "createdAt");
CREATE TABLE "calendar_event" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "title" TEXT NOT NULL,
 "description" TEXT NOT NULL DEFAULT '', "location" TEXT NOT NULL DEFAULT '',
 "startAt" TIMESTAMP(3) NOT NULL, "endAt" TIMESTAMP(3) NOT NULL,
 "important" BOOLEAN NOT NULL DEFAULT false, "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
 "tableId" TEXT, "recordId" TEXT, "version" INTEGER NOT NULL DEFAULT 1, "cancelledAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "calendar_event_time_check" CHECK ("endAt" > "startAt"),
 CONSTRAINT "calendar_event_visibility_check" CHECK ("visibility" IN ('PRIVATE','INVITEES','PUBLIC'))
);
CREATE INDEX "calendar_event_startAt_endAt_idx" ON "calendar_event"("startAt","endAt");
CREATE INDEX "calendar_event_ownerId_idx" ON "calendar_event"("ownerId");
CREATE TABLE "calendar_invitation" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL, "userId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "respondedAt" TIMESTAMP(3),
 CONSTRAINT "calendar_invitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "calendar_invitation_status_check" CHECK ("status" IN ('PENDING','ACCEPTED','DECLINED','TENTATIVE'))
);
CREATE UNIQUE INDEX "calendar_invitation_eventId_userId_key" ON "calendar_invitation"("eventId","userId");
CREATE INDEX "calendar_invitation_userId_status_idx" ON "calendar_invitation"("userId","status");
CREATE TABLE "calendar_reminder" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL, "minutesBefore" INTEGER NOT NULL, "dueAt" TIMESTAMP(3) NOT NULL, "processedAt" TIMESTAMP(3),
 CONSTRAINT "calendar_reminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "calendar_reminder_eventId_minutesBefore_key" ON "calendar_reminder"("eventId","minutesBefore");
CREATE INDEX "calendar_reminder_processedAt_dueAt_idx" ON "calendar_reminder"("processedAt","dueAt");
