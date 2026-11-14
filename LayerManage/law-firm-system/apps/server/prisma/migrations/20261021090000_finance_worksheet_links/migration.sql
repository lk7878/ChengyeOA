ALTER TABLE payment ADD COLUMN "invoiceNo" TEXT,
  ADD COLUMN "invoiceStatus" TEXT NOT NULL DEFAULT 'NOT_ISSUED',
  ADD COLUMN "voucherFiles" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE refund_request ADD COLUMN "sourceRecordId" TEXT,
  ADD COLUMN "actualAmount" DECIMAL(18,2), ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "voucherFiles" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "recipientName" TEXT, ADD COLUMN "recipientBank" TEXT, ADD COLUMN "recipientAccount" TEXT;
CREATE UNIQUE INDEX "refund_request_sourceRecordId_key" ON refund_request("sourceRecordId");
ALTER TABLE refund_request ADD CONSTRAINT "refund_request_sourceRecordId_fkey"
  FOREIGN KEY ("sourceRecordId") REFERENCES collab_record(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE refund_allocation (
  "refundId" TEXT NOT NULL REFERENCES refund_request(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "paymentId" TEXT NOT NULL REFERENCES payment(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  amount DECIMAL(18,2) NOT NULL CHECK (amount > 0), PRIMARY KEY ("refundId", "paymentId")
);
