-- SPEC-042 Task 1: 案件文件/证据台账表 case_file
-- base64 上传落盘：fileName 仅存元数据（落盘用 UUID 文件名防路径穿越）。
-- case 级联删除（案件删 → 文件记录删；磁盘文件由服务层 remove 显式清理）。

CREATE TABLE "case_file" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_file_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_file_caseId_idx" ON "case_file"("caseId");

ALTER TABLE "case_file" ADD CONSTRAINT "case_file_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
