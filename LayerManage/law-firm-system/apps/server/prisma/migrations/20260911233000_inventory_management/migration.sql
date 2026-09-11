-- CreateTable
CREATE TABLE "inventory_item" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "specification" TEXT,
    "location" TEXT,
    "stock" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "minimumStock" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ENABLED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movement" (
    "id" TEXT NOT NULL,
    "documentNo" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemSpecification" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "beforeStock" DECIMAL(18,3) NOT NULL,
    "afterStock" DECIMAL(18,3) NOT NULL,
    "employeeId" TEXT,
    "employeeName" TEXT,
    "organizationId" TEXT,
    "organizationPath" TEXT,
    "source" TEXT,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stocktake" (
    "id" TEXT NOT NULL,
    "documentNo" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "bookStock" DECIMAL(18,3) NOT NULL,
    "actualStock" DECIMAL(18,3) NOT NULL,
    "difference" DECIMAL(18,3) NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_code_key" ON "inventory_item"("code");

-- CreateIndex
CREATE INDEX "inventory_item_kind_status_idx" ON "inventory_item"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movement_documentNo_key" ON "inventory_movement"("documentNo");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movement_requestKey_key" ON "inventory_movement"("requestKey");

-- CreateIndex
CREATE INDEX "inventory_movement_itemId_occurredAt_idx" ON "inventory_movement"("itemId", "occurredAt");

-- CreateIndex
CREATE INDEX "inventory_movement_action_itemKind_occurredAt_idx" ON "inventory_movement"("action", "itemKind", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stocktake_documentNo_key" ON "inventory_stocktake"("documentNo");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stocktake_requestKey_key" ON "inventory_stocktake"("requestKey");

-- CreateIndex
CREATE INDEX "inventory_stocktake_itemId_occurredAt_idx" ON "inventory_stocktake"("itemId", "occurredAt");

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocktake" ADD CONSTRAINT "inventory_stocktake_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE inventory_item ADD CONSTRAINT inventory_nonnegative_stock CHECK (stock >= 0 AND "minimumStock" >= 0);
ALTER TABLE inventory_item ADD CONSTRAINT inventory_kind_status CHECK (kind IN ('OFFICE','CUSTOMIZED') AND status IN ('ENABLED','DISABLED'));
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_balance CHECK ("beforeStock" >= 0 AND "afterStock" >= 0 AND "afterStock" = "beforeStock" + quantity);
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_direction CHECK ((action = 'INBOUND' AND quantity > 0 AND "employeeId" IS NULL) OR (action = 'OUTBOUND' AND quantity < 0 AND "employeeId" IS NOT NULL) OR (action = 'ADJUST' AND quantity <> 0));
ALTER TABLE inventory_stocktake ADD CONSTRAINT inventory_stocktake_balance CHECK ("bookStock" >= 0 AND "actualStock" >= 0 AND difference = "actualStock" - "bookStock");
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES ('permission:menu.inventory','menu.inventory','物品管理','MENU','menu','view','LOW','/inventory','ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES ('permission:inventory.read','inventory.read','查看物品及库存台账','ACTION','inventory','read','LOW',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES ('permission:inventory.manage','inventory.manage','管理物品资料','ACTION','inventory','manage','MEDIUM',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES ('permission:inventory.inbound','inventory.inbound','登记物品入库','ACTION','inventory','inbound','MEDIUM',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES ('permission:inventory.outbound','inventory.outbound','登记领用出库','ACTION','inventory','outbound','MEDIUM',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES ('permission:inventory.stocktake','inventory.stocktake','盘点和调整库存','ACTION','inventory','stocktake','HIGH',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
INSERT INTO permission (id,code,name,type,resource,action,"riskLevel",path,status,version,"createdAt","updatedAt") VALUES ('permission:inventory.export','inventory.export','导出物品管理台账','ACTION','inventory','export','MEDIUM',NULL,'ENABLED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(code) DO NOTHING;
