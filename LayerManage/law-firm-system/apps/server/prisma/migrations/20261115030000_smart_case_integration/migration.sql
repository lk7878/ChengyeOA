-- AlterTable
ALTER TABLE "personal_file" ADD COLUMN     "contentVersion" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "size" SET DEFAULT 0,
ALTER COLUMN "size" SET DATA TYPE DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "smart_case_code" (
    "hash" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "assuranceLevel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smart_case_code_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "smart_case_session" (
    "hash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "assuranceLevel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "smart_case_session_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "personal_file_version" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_file_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_file_upload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "fileId" TEXT,
    "expectedVersion" INTEGER,
    "total" DOUBLE PRECISION NOT NULL,
    "offset" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resultId" TEXT,
    "resultVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_file_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_case_archive" (
    "key" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileVersion" INTEGER NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "smart_case_archive_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "smart_case_session_userId_idx" ON "smart_case_session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "personal_file_version_fileId_version_key" ON "personal_file_version"("fileId", "version");

-- CreateIndex
CREATE INDEX "personal_file_upload_ownerId_idx" ON "personal_file_upload"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "smart_case_archive_caseFileId_key" ON "smart_case_archive"("caseFileId");
