# 数据模型与迁移清单

> 2026-11-06 实现基线：dcf8447d。由 [export-current.ts](../tools/export-current.ts) 从源码生成；不是生产数据库数据或本轮测试报告。

唯一权威 schema：[源码](../../../LayerManage/law-firm-system/apps/server/prisma/schema.prisma)。125 个模型，89 个迁移目录；目录存在不等于目标数据库已应用。下列字段包含 Prisma 关系字段，关系字段不等于数据库实体列。String 状态的全部合法值须继续核对对应领域服务。

## Organization

数据库表：`organization`。

| 字段或约束 | 类型/定义 |
|---|---|
| qualityPolicies | QualitySamplingPolicy[] |
| sopTemplates | SopTemplate[] |
| collabWorkspaces | CollabWorkspace[]   @relation("CollabOrganization") |
| inventoryMovements | InventoryMovement[] |
| id | String              @id @default(uuid()) |
| code | String              @unique |
| name | String |
| type | String // FIRM \| HQ_CENTER \| DEPARTMENT \| BRANCH \| GROUP |
| parentId | String? |
| managerEmployeeId | String? |
| path | String              @unique |
| level | Int                 @default(0) |
| sort | Int                 @unique @default(dbgenerated("next_organization_sort()")) |
| status | String              @default("ENABLED") // ENABLED \| DISABLED |
| version | Int                 @default(1) |
| createdAt | DateTime            @default(now()) |
| updatedAt | DateTime            @updatedAt |
| parent | Organization?         @relation("OrgHierarchy", fields: [parentId], references: [id]) |
| children | Organization[]        @relation("OrgHierarchy") |
| manager | Employee?             @relation("OrganizationManager", fields: [managerEmployeeId], references: [id], onDelete: Restrict) |
| positions | Position[] |
| assignments | EmployeeAssignment[] |
| professionalTeams | ProfessionalTeam[] |
| dataScopes | DataScope[] |
| dataScopeTargets | DataScopeTarget[] |
| systemInitialization | SystemInitialization? @relation("RootOrganization") |
| eventLogsOrganization | EventLog[]            @relation("EventOrganization") |
| eventLogsBranch | EventLog[]            @relation("EventBranch") |
| @@index([managerEmployeeId]) | — |
| @@map("organization") | — |

## Position

数据库表：`position`。

| 字段或约束 | 类型/定义 |
|---|---|
| deletedAt | DateTime? |
| id | String   @id @default(uuid()) |
| organizationId | String   @map("orgId") |
| code | String |
| name | String |
| categoryCode | String |
| level | Int      @default(0) |
| responsibilities | String? |
| status | String   @default("ENABLED") |
| version | Int      @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| organization | Organization         @relation(fields: [organizationId], references: [id]) |
| assignments | EmployeeAssignment[] |
| @@unique([organizationId, | code]) |
| @@index([organizationId, | status]) |
| @@map("position") | — |

## Employee

数据库表：`employee`。

| 字段或约束 | 类型/定义 |
|---|---|
| inventoryReceipts | InventoryMovement[] |
| id | String              @id @default(uuid()) |
| employeeNo | String // Unique among non-LEAVED employees; partial index in migration. |
| name | String |
| idCard | String?             @unique |
| licenseNo | String?             @unique |
| phone | String |
| email | String? |
| type | String // PARTNER \| SENIOR_LAWYER \| JUNIOR_LAWYER \| ASSISTANT \| SALES \| ADMIN \| HR \| FINANCE \| OPERATOR |
| professionalDirections | String[]            @default([]) |
| status | String              @default("PROBATION") // PROBATION \| FORMAL \| LEAVED |
| entryDate | DateTime |
| formalDate | DateTime? |
| leaveDate | DateTime? |
| deletedAt | DateTime? |
| version | Int                 @default(1) |
| createdAt | DateTime            @default(now()) |
| updatedAt | DateTime            @updatedAt |
| user | User? |
| managedOrganizations | Organization[]           @relation("OrganizationManager") |
| leads | Lead[]                   @relation("LeadAssignee") |
| cases | Case[]                   @relation("CaseLawyer") |
| performance | Performance[] |
| assignments | EmployeeAssignment[] |
| professionalTeams | ProfessionalTeamMember[] |
| dataScopeTargets | DataScopeTarget[] |
| reportingLines | EmployeeReportingLine[]  @relation("ReportingLineEmployee") |
| directReports | EmployeeReportingLine[]  @relation("ReportingLineManager") |
| negotiations | Negotiation[] |
| @@index([employeeNo]) | — |
| @@map("employee") | — |

## EmployeeAssignment

数据库表：`employee_assignment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| employeeId | String |
| organizationId | String |
| positionId | String |
| assignmentType | String |
| startedAt | DateTime |
| endedAt | DateTime? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| employee | Employee     @relation(fields: [employeeId], references: [id], onDelete: Restrict) |
| organization | Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict) |
| position | Position     @relation(fields: [positionId], references: [id], onDelete: Restrict) |
| @@index([employeeId, | endedAt]) |
| @@index([organizationId, | endedAt]) |
| @@index([positionId, | endedAt]) |
| @@map("employee_assignment") | — |

## ProfessionalTeam

数据库表：`professional_team`。

| 字段或约束 | 类型/定义 |
|---|---|
| deletedAt | DateTime? |
| qualityPolicies | QualitySamplingPolicy[] |
| sopTemplates | SopTemplate[] |
| id | String   @id @default(uuid()) |
| code | String   @unique |
| name | String |
| categoryCode | String |
| homeOrganizationId | String |
| description | String? |
| status | String   @default("ENABLED") |
| version | Int      @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| homeOrganization | Organization             @relation(fields: [homeOrganizationId], references: [id], onDelete: Restrict) |
| members | ProfessionalTeamMember[] |
| dataScopes | DataScope[] |
| dataScopeTargets | DataScopeTarget[] |
| eventLogs | EventLog[] |
| @@index([homeOrganizationId, | status]) |
| @@index([categoryCode, | status]) |
| @@map("professional_team") | — |

## ProfessionalTeamMember

数据库表：`professional_team_member`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| professionalTeamId | String |
| employeeId | String |
| memberRole | String |
| startedAt | DateTime |
| endedAt | DateTime? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| professionalTeam | ProfessionalTeam @relation(fields: [professionalTeamId], references: [id], onDelete: Restrict) |
| employee | Employee         @relation(fields: [employeeId], references: [id], onDelete: Restrict) |
| @@index([professionalTeamId, | endedAt]) |
| @@index([employeeId, | endedAt]) |
| @@map("professional_team_member") | — |

## User

数据库表：`user`。

| 字段或约束 | 类型/定义 |
|---|---|
| assessments | SatisfactionAssessment[] @relation("AssessmentCreator") |
| specialAnalyses | SpecialAnalysis[] @relation("AnalysisCreator") |
| analysisRevisions | AnalysisRevision[] @relation("AnalysisRevisionCreator") |
| analysisCloseRequests | AnalysisCloseRequest[] @relation("AnalysisCloseCreator") |
| analysisCloseReviews | AnalysisCloseRequest[] @relation("AnalysisCloseReviewer") |
| sopReminderEmissions | SopReminderEmission[] @relation("SopReminderRecipient") |
| qualityPolicies | QualitySamplingPolicy[] |
| qualityRuns | QualitySamplingRun[] |
| qualityInspections | QualitySamplingItem[] @relation("QualityInspector") |
| qualityCreatedItems | QualitySamplingItem[] @relation("QualityItemCreator") |
| qualityCreatedIssues | QualityIssue[] @relation("QualityIssueCreator") |
| qualityAssignedIssues | QualityIssue[] @relation("QualityIssueAssignee") |
| qualityRevisions | IssueRevision[] |
| sopSubmissions | SopSubmission[] @relation("SopSubmissionAuthor") |
| sopReviewsAssigned | QualityReview[] @relation("SopReviewAssignee") |
| sopReviewsCreated | QualityReview[] @relation("SopReviewCreator") |
| sopGuidance | ExpertGuidance[] @relation("SopGuidanceAuthor") |
| sopAssignedTasks | CaseTask[] @relation("SopAssignee") |
| sopTaskAccesses | SopTaskAccess[] @relation("SopAccessPrincipal") |
| sopTaskAccessGrants | SopTaskAccess[] @relation("SopAccessIssuer") |
| driveShortcuts | DriveShortcut[] |
| driveVisits | DriveVisit[] |
| driveNodes | DriveNode[] |
| collabWorkspaces | CollabWorkspace[] @relation("CollabOwner") |
| id | String            @id @default(uuid()) |
| username | String            @unique |
| appearance | Json              @default("{}") |
| password | String // bcrypt hash |
| status | String            @default("ENABLED") // ENABLED \| DISABLED |
| employeeId | String?           @unique |
| lastLoginAt | DateTime? |
| mustChangePassword | Boolean           @default(false) |
| credentialVersion | Int               @default(1) |
| passwordChangedAt | DateTime? |
| failedLoginCount | Int               @default(0) |
| lockedUntil | DateTime? |
| createdAt | DateTime          @default(now()) |
| updatedAt | DateTime          @updatedAt |
| employee | Employee?              @relation(fields: [employeeId], references: [id]) |
| userRoles | UserRole[]             @relation("AssignedUserRoles") |
| roleGrantsGiven | UserRole[]             @relation("RoleGrantedBy") |
| roleGrantsRevoked | UserRole[]             @relation("RoleRevokedBy") |
| permissionGrants | UserPermissionGrant[]  @relation("PermissionGrantUser") |
| permissionGrantsGiven | UserPermissionGrant[]  @relation("PermissionGrantedBy") |
| permissionGrantsRevoked | UserPermissionGrant[]  @relation("PermissionRevokedBy") |
| loginLogs | LoginLog[] |
| systemInitialization | SystemInitialization?  @relation("FirstSuperAdmin") |
| adminOperationsRequested | AdminOperation[]       @relation("AdminOperationRequester") |
| adminOperationReviews | AdminOperationReview[] @relation("AdminOperationReviewer") |
| mfaFactors | MfaFactor[] |
| authChallenges | AuthChallenge[] |
| authSessions | AuthSession[] |
| stepUpGrants | StepUpGrant[] |
| eventLogsOperated | EventLog[]             @relation("EventOperator") |
| @@map("user") | — |
| sopSourceFiles | SopSourceFile[] |
| sopContinuations | SopContinuation[] |

## MfaFactor

数据库表：`mfa_factor`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| userId | String |
| type | String    @default("TOTP") |
| encryptedSecret | String |
| secretIv | String |
| secretAuthTag | String |
| keyVersion | Int       @default(1) |
| verifiedAt | DateTime? @db.Timestamptz(3) |
| lastAcceptedCounter | BigInt? |
| disabledAt | DateTime? @db.Timestamptz(3) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| updatedAt | DateTime  @updatedAt @db.Timestamptz(3) |
| user | User              @relation(fields: [userId], references: [id], onDelete: Restrict) |
| recoveryCodes | MfaRecoveryCode[] |
| @@index([userId, | verifiedAt, disabledAt]) |
| @@map("mfa_factor") | — |

## MfaRecoveryCode

数据库表：`mfa_recovery_code`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| factorId | String |
| codeHash | String    @unique |
| usedAt | DateTime? @db.Timestamptz(3) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| factor | MfaFactor @relation(fields: [factorId], references: [id], onDelete: Restrict) |
| @@index([factorId, | usedAt]) |
| @@map("mfa_recovery_code") | — |

## AuthChallenge

数据库表：`auth_challenge`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| userId | String |
| type | String |
| tokenHash | String    @unique |
| failedAttempts | Int       @default(0) |
| maxAttempts | Int       @default(5) |
| expiresAt | DateTime  @db.Timestamptz(3) |
| consumedAt | DateTime? @db.Timestamptz(3) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| user | User @relation(fields: [userId], references: [id], onDelete: Restrict) |
| @@index([userId, | type, createdAt]) |
| @@index([expiresAt, | consumedAt]) |
| @@map("auth_challenge") | — |

## AuthSession

数据库表：`auth_session`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| userId | String |
| credentialVersion | Int |
| assuranceLevel | String |
| refreshTokenHash | String    @unique |
| previousRefreshTokenHash | String?   @unique |
| previousRefreshRotatedAt | DateTime? @db.Timestamptz(3) |
| refreshGeneration | Int       @default(1) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| lastSeenAt | DateTime  @default(now()) @db.Timestamptz(3) |
| expiresAt | DateTime  @db.Timestamptz(3) |
| revokedAt | DateTime? @db.Timestamptz(3) |
| revokedReason | String? |
| userAgentHash | String? |
| ipPrefix | String? |
| stepUpFailedAttempts | Int       @default(0) |
| stepUpBlockedUntil | DateTime? @db.Timestamptz(3) |
| user | User          @relation(fields: [userId], references: [id], onDelete: Restrict) |
| stepUpGrants | StepUpGrant[] |
| @@index([userId, | expiresAt]) |
| @@index([revokedAt, | expiresAt]) |
| @@map("auth_session") | — |

## StepUpGrant

数据库表：`step_up_grant`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| sessionId | String |
| userId | String |
| purpose | String |
| targetDigest | String |
| tokenHash | String    @unique |
| expiresAt | DateTime  @db.Timestamptz(3) |
| consumedAt | DateTime? @db.Timestamptz(3) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| session | AuthSession @relation(fields: [sessionId], references: [id], onDelete: Restrict) |
| user | User        @relation(fields: [userId], references: [id], onDelete: Restrict) |
| @@index([sessionId, | expiresAt]) |
| @@index([userId, | createdAt]) |
| @@index([expiresAt, | consumedAt]) |
| @@map("step_up_grant") | — |

## Role

数据库表：`role`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| name | String   @unique |
| code | String   @unique |
| type | String // SYSTEM \| BUSINESS |
| description | String? |
| status | String   @default("ENABLED") |
| version | Int      @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| userRoles | UserRole[] |
| permissions | RolePermission[] |
| dataScopes | RoleDataScope[] |
| fieldPermissions | FieldPermission[] |
| @@map("role") | — |

## UserRole

数据库表：`user_role`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| userId | String |
| roleId | String |
| source | String    @default("PERMANENT") |
| validFrom | DateTime  @default(now()) @db.Timestamptz(3) |
| validUntil | DateTime? @db.Timestamptz(3) |
| reason | String? |
| grantedByUserId | String? |
| revokedAt | DateTime? @db.Timestamptz(3) |
| revokedByUserId | String? |
| revokeReason | String? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| updatedAt | DateTime  @updatedAt @db.Timestamptz(3) |
| user | User  @relation("AssignedUserRoles", fields: [userId], references: [id], onDelete: Restrict) |
| role | Role  @relation(fields: [roleId], references: [id], onDelete: Restrict) |
| grantedBy | User? @relation("RoleGrantedBy", fields: [grantedByUserId], references: [id], onDelete: Restrict) |
| revokedBy | User? @relation("RoleRevokedBy", fields: [revokedByUserId], references: [id], onDelete: Restrict) |
| @@index([userId, | validFrom, validUntil]) |
| @@index([roleId, | validFrom, validUntil]) |
| @@map("user_role") | — |

## AdminOperation

数据库表：`admin_operation`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| operationNo | String    @unique |
| operationType | String |
| riskLevel | String |
| reviewMode | String |
| status | String |
| requesterUserId | String |
| targetType | String |
| targetId | String |
| reason | String |
| payloadSnapshot | Json |
| payloadHash | String |
| expectedTargetVersion | Int |
| idempotencyKey | String |
| secondConfirmationAt | DateTime? @db.Timestamptz(3) |
| relatedOperationId | String? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| updatedAt | DateTime  @updatedAt @db.Timestamptz(3) |
| requester | User                      @relation("AdminOperationRequester", fields: [requesterUserId], references: [id], onDelete: Restrict) |
| relatedOperation | AdminOperation?           @relation("RelatedAdminOperation", fields: [relatedOperationId], references: [id], onDelete: Restrict) |
| relatedOperations | AdminOperation[]          @relation("RelatedAdminOperation") |
| reviews | AdminOperationReview[] |
| executions | AdminOperationExecution[] |
| @@unique([requesterUserId, | idempotencyKey]) |
| @@index([requesterUserId, | createdAt]) |
| @@index([status, | createdAt]) |
| @@index([operationType, | createdAt]) |
| @@index([targetType, | targetId]) |
| @@map("admin_operation") | — |

## AdminOperationReview

数据库表：`admin_operation_review`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| operationId | String |
| reviewerUserId | String |
| decision | String |
| comment | String? |
| operationVersion | Int |
| createdAt | DateTime @default(now()) @db.Timestamptz(3) |
| operation | AdminOperation @relation(fields: [operationId], references: [id], onDelete: Restrict) |
| reviewer | User           @relation("AdminOperationReviewer", fields: [reviewerUserId], references: [id], onDelete: Restrict) |
| @@index([operationId, | createdAt]) |
| @@index([reviewerUserId, | createdAt]) |
| @@map("admin_operation_review") | — |

## AdminOperationExecution

数据库表：`admin_operation_execution`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| operationId | String |
| attemptNo | Int |
| executorType | String |
| status | String |
| beforeSnapshot | Json? |
| afterSnapshot | Json? |
| resultCode | String? |
| errorMessage | String? |
| startedAt | DateTime  @default(now()) @db.Timestamptz(3) |
| finishedAt | DateTime? @db.Timestamptz(3) |
| operation | AdminOperation @relation(fields: [operationId], references: [id], onDelete: Restrict) |
| @@unique([operationId, | attemptNo]) |
| @@index([status, | startedAt]) |
| @@map("admin_operation_execution") | — |

## Permission

数据库表：`permission`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| code | String   @unique |
| name | String |
| parentId | String? |
| type | String // MENU \| ACTION \| SPECIAL |
| resource | String |
| action | String |
| riskLevel | String |
| path | String? |
| sort | Int      @default(0) |
| status | String   @default("ENABLED") |
| version | Int      @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| parent | Permission?           @relation("PermHierarchy", fields: [parentId], references: [id], onDelete: Restrict) |
| children | Permission[]          @relation("PermHierarchy") |
| roles | RolePermission[] |
| userGrants | UserPermissionGrant[] |
| @@map("permission") | — |

## RolePermission

数据库表：`role_permission`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| roleId | String |
| permissionId | String |
| role | Role       @relation(fields: [roleId], references: [id], onDelete: Restrict) |
| permission | Permission @relation(fields: [permissionId], references: [id], onDelete: Restrict) |
| @@unique([roleId, | permissionId]) |
| @@map("role_permission") | — |

## DataScope

数据库表：`data_scope`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| name | String |
| scopeType | String |
| includeDescendants | Boolean  @default(false) |
| organizationId | String? |
| professionalTeamId | String? |
| status | String   @default("ENABLED") |
| version | Int      @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| organization | Organization?         @relation(fields: [organizationId], references: [id], onDelete: Restrict) |
| professionalTeam | ProfessionalTeam?     @relation(fields: [professionalTeamId], references: [id], onDelete: Restrict) |
| targets | DataScopeTarget[] |
| roleBindings | RoleDataScope[] |
| userGrants | UserPermissionGrant[] |
| @@index([scopeType, | status]) |
| @@map("data_scope") | — |

## DataScopeTarget

数据库表：`data_scope_target`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String  @id @default(uuid()) |
| dataScopeId | String |
| organizationId | String? |
| professionalTeamId | String? |
| employeeId | String? |
| dataScope | DataScope         @relation(fields: [dataScopeId], references: [id], onDelete: Restrict) |
| organization | Organization?     @relation(fields: [organizationId], references: [id], onDelete: Restrict) |
| professionalTeam | ProfessionalTeam? @relation(fields: [professionalTeamId], references: [id], onDelete: Restrict) |
| employee | Employee?         @relation(fields: [employeeId], references: [id], onDelete: Restrict) |
| @@index([dataScopeId]) | — |
| @@map("data_scope_target") | — |

## RoleDataScope

数据库表：`role_data_scope`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| roleId | String |
| resource | String |
| dataScopeId | String |
| role | Role      @relation(fields: [roleId], references: [id], onDelete: Restrict) |
| dataScope | DataScope @relation(fields: [dataScopeId], references: [id], onDelete: Restrict) |
| @@unique([roleId, | resource, dataScopeId]) |
| @@index([roleId, | resource]) |
| @@map("role_data_scope") | — |

## FieldPermission

数据库表：`field_permission`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String  @id @default(uuid()) |
| roleId | String |
| resource | String |
| fieldCode | String |
| readLevel | String |
| canWrite | Boolean @default(false) |
| canExport | Boolean @default(false) |
| version | Int     @default(1) |
| role | Role @relation(fields: [roleId], references: [id], onDelete: Restrict) |
| @@unique([roleId, | resource, fieldCode]) |
| @@map("field_permission") | — |

## UserPermissionGrant

数据库表：`user_permission_grant`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| userId | String |
| permissionId | String |
| dataScopeId | String |
| validFrom | DateTime  @db.Timestamptz(3) |
| validUntil | DateTime  @db.Timestamptz(3) |
| reason | String |
| grantedByUserId | String |
| revokedAt | DateTime? @db.Timestamptz(3) |
| revokedByUserId | String? |
| revokeReason | String? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| updatedAt | DateTime  @updatedAt @db.Timestamptz(3) |
| user | User       @relation("PermissionGrantUser", fields: [userId], references: [id], onDelete: Restrict) |
| permission | Permission @relation(fields: [permissionId], references: [id], onDelete: Restrict) |
| dataScope | DataScope  @relation(fields: [dataScopeId], references: [id], onDelete: Restrict) |
| grantedBy | User       @relation("PermissionGrantedBy", fields: [grantedByUserId], references: [id], onDelete: Restrict) |
| revokedBy | User?      @relation("PermissionRevokedBy", fields: [revokedByUserId], references: [id], onDelete: Restrict) |
| @@index([userId, | validFrom, validUntil]) |
| @@map("user_permission_grant") | — |

## EmployeeReportingLine

数据库表：`employee_reporting_line`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| employeeId | String |
| managerEmployeeId | String |
| startedAt | DateTime  @db.Timestamptz(3) |
| endedAt | DateTime? @db.Timestamptz(3) |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| updatedAt | DateTime  @updatedAt @db.Timestamptz(3) |
| employee | Employee @relation("ReportingLineEmployee", fields: [employeeId], references: [id], onDelete: Restrict) |
| manager | Employee @relation("ReportingLineManager", fields: [managerEmployeeId], references: [id], onDelete: Restrict) |
| @@index([employeeId, | endedAt]) |
| @@index([managerEmployeeId, | endedAt]) |
| @@map("employee_reporting_line") | — |

## LoginLog

数据库表：`login_log`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| userId | String? |
| usernameSnapshot | String |
| outcome | String |
| reasonCode | String? |
| ip | String? |
| userAgent | String? |
| createdAt | DateTime @default(now()) |
| user | User? @relation(fields: [userId], references: [id], onDelete: SetNull) |
| @@map("login_log") | — |

## SystemInitialization

数据库表：`system_initialization`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String       @id |
| version | Int          @default(1) |
| rootOrganizationId | String       @unique |
| superAdminUserId | String       @unique |
| completedAt | DateTime |
| rootOrganization | Organization @relation("RootOrganization", fields: [rootOrganizationId], references: [id], onDelete: Restrict) |
| superAdminUser | User         @relation("FirstSuperAdmin", fields: [superAdminUserId], references: [id], onDelete: Restrict) |
| @@map("system_initialization") | — |

## Channel

数据库表：`channel`。

| 字段或约束 | 类型/定义 |
|---|---|
| deletedAt | DateTime? |
| createdBy | String? |
| updatedBy | String? |
| branchId | String? |
| version | Int @default(1) |
| @@index([createdBy]) | — |
| @@index([branchId]) | — |
| id | String   @id @default(uuid()) |
| code | String   @unique |
| name | String |
| type | String // SEARCH \| SHORT_VIDEO \| LIVE \| INFO_FLOW \| WECHAT \| REFERRAL \| NATURAL \| OFFLINE \| OTHER |
| accountInfo | String? |
| cost | Decimal? @default(0) @db.Decimal(18, 2) |
| status | String   @default("ENABLED") |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| leads | Lead[] |
| campaigns | Campaign[] |
| costEntries | CostEntry[] |
| @@map("channel") | — |

## Lead

数据库表：`lead`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| leadNo | String    @unique |
| name | String |
| phone | String |
| phoneHash | String |
| wechat | String? |
| wechatHash | String? |
| channelId | String? |
| sourceDetail | String? // 具体来源，如"百度推广-关键词XX" |
| sourceType | String    @default("MANUAL") // MANUAL \| CAMPAIGN \| REFERRAL \| NATURAL \| OFFLINE |
| campaignId | String? |
| referralCustomerId | String? |
| intentionLevel | Int       @default(3) // 1-5星 |
| status | String    @default("NEW") // NEW \| ASSIGNED \| CONTACTED \| SCREENED \| INVITED \| VISITED \| CONVERTED \| LOST \| NURTURE |
| branchId | String? |
| professionalTeamId | String? |
| assignedTo | String? // 负责人ID |
| poolStatus | String    @default("PUBLIC") // PUBLIC \| PRIVATE \| RECYCLED |
| firstResponseSeconds | Int? |
| assignedAt | DateTime? |
| isValid | Boolean   @default(true) |
| invalidReason | String? |
| tags | String? // JSON数组，客户标签 |
| createdBy | String |
| updatedBy | String? |
| version | Int       @default(1) |
| deletedAt | DateTime? |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| channel | Channel?         @relation(fields: [channelId], references: [id]) |
| campaign | Campaign?        @relation(fields: [campaignId], references: [id]) |
| assignee | Employee?        @relation("LeadAssignee", fields: [assignedTo], references: [id]) |
| referralCustomer | Customer?        @relation("LeadReferralCustomer", fields: [referralCustomerId], references: [id]) |
| followRecords | LeadFollow[] |
| customer | Customer?        @relation("CustomerSourceLead") |
| poolRecords | LeadPoolRecord[] |
| appointments | Appointment[] |
| @@index([status]) | — |
| @@index([assignedTo]) | — |
| @@index([channelId]) | — |
| @@index([phoneHash]) | — |
| @@index([poolStatus]) | — |
| @@index([campaignId]) | — |
| @@index([branchId]) | — |
| @@index([professionalTeamId]) | — |
| @@map("lead") | — |
| sopInstances | SopInstance[] |

## LeadFollow

数据库表：`lead_follow`。

| 字段或约束 | 类型/定义 |
|---|---|
| serialNo | Int       @unique @default(autoincrement()) |
| profile | Json      @default("{}") |
| enteredAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| deletedAt | DateTime? |
| id | String    @id @default(uuid()) |
| leadId | String |
| type | String // PHONE \| WECHAT \| VISIT \| ONLINE \| OTHER |
| content | String // 跟进内容 |
| nextPlan | String? // 下次计划 |
| nextTime | DateTime? // 下次跟进时间 |
| createdBy | String // 跟进人 |
| updatedBy | String? // 更新人 |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) |
| lead | Lead @relation(fields: [leadId], references: [id], onDelete: Cascade) |
| @@index([leadId]) | — |
| @@map("lead_follow") | — |

## Customer

数据库表：`customer`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| customerNo | String    @unique |
| name | String |
| phone | String |
| phoneHash | String |
| wechat | String? |
| email | String? |
| address | String? |
| status | String    @default("POTENTIAL") // POTENTIAL \| INTENT \| SIGNED \| INACTIVE |
| customerType | String    @default("INDIVIDUAL") // INDIVIDUAL \| ENTERPRISE |
| sourceLeadId | String?   @unique // 关联线索 |
| tags | String? // JSON数组 |
| remark | String? |
| createdBy | String |
| updatedBy | String? |
| version | Int       @default(1) |
| deletedAt | DateTime? |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| sourceLead | Lead?                @relation("CustomerSourceLead", fields: [sourceLeadId], references: [id]) |
| referrals | Lead[]               @relation("LeadReferralCustomer") |
| contacts | Contact[] |
| contracts | Contract[] |
| cases | Case[] |
| payments | Payment[] |
| negotiations | Negotiation[] |
| analysisEngagements | AnalysisEngagement[] |
| invoiceRequests | InvoiceRequest[] |
| refundRequests | RefundRequest[] |
| @@index([status]) | — |
| @@index([phoneHash]) | — |
| @@map("customer") | — |

## Campaign

数据库表：`campaign`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| code | String   @unique |
| name | String |
| channelId | String? |
| status | String   @default("ENABLED") // ENABLED \| DISABLED |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| channel | Channel? @relation(fields: [channelId], references: [id]) |
| leads | Lead[] |
| @@map("campaign") | — |

## LeadPoolRecord

数据库表：`lead_pool_record`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| leadId | String |
| action | String // CLAIM \| ASSIGN \| REASSIGN \| RECYCLE |
| fromEmployeeId | String? |
| toEmployeeId | String? |
| reason | String? |
| operatedBy | String |
| createdAt | DateTime @default(now()) |
| lead | Lead @relation(fields: [leadId], references: [id], onDelete: Cascade) |
| @@index([leadId, | createdAt]) |
| @@map("lead_pool_record") | — |

## Appointment

数据库表：`appointment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| appointmentNo | String   @unique |
| leadId | String |
| scheduledAt | DateTime |
| channel | String // ONSITE \| ONLINE |
| negotiatorEmployeeId | String? |
| status | String   @default("PENDING") // PENDING\|CONFIRMED\|VISITED\|NOSHOW\|CANCELLED\|RESCHEDULED |
| rescheduledFromId | String? |
| remark | String? |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| lead | Lead          @relation(fields: [leadId], references: [id], onDelete: Cascade) |
| rescheduledFrom | Appointment?  @relation("AppointmentReschedule", fields: [rescheduledFromId], references: [id]) |
| rescheduledTo | Appointment[] @relation("AppointmentReschedule") |
| @@index([leadId, | scheduledAt]) |
| @@index([status, | scheduledAt]) |
| @@map("appointment") | — |

## Contact

数据库表：`contact`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| customerId | String |
| name | String |
| phone | String |
| phoneHash | String |
| wechat | String? |
| relation | String? |
| isPrimary | Boolean   @default(false) |
| createdBy | String |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| deletedAt | DateTime? |
| customer | Customer @relation(fields: [customerId], references: [id], onDelete: Cascade) |
| @@unique([customerId, | phoneHash]) |
| @@index([customerId]) | — |
| @@map("contact") | — |

## Negotiation

数据库表：`negotiation`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| negotiationNo | String    @unique |
| customerId | String |
| leadId | String? |
| appointmentId | String? |
| negotiatorEmployeeId | String |
| quotedAmount | Decimal?  @db.Decimal(18, 2) |
| customerConcerns | String? |
| competitorInfo | String? |
| status | String    @default("NEGOTIATING") // NEGOTIATING\|SIGNED\|UNSIGNED |
| unsignedReason | String? |
| signedAt | DateTime? |
| remark | String? |
| branchId | String? |
| professionalTeamId | String? |
| createdBy | String |
| updatedBy | String? |
| version | Int       @default(1) |
| deletedAt | DateTime? |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| customer | Customer   @relation(fields: [customerId], references: [id]) |
| negotiator | Employee   @relation(fields: [negotiatorEmployeeId], references: [id]) |
| contracts | Contract[] |
| @@index([customerId]) | — |
| @@index([status]) | — |
| @@index([negotiatorEmployeeId]) | — |
| @@index([branchId, | createdAt]) |
| @@map("negotiation") | — |

## ContractTemplate

数据库表：`contract_template`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| code | String   @unique |
| contractType | String // FIRST_SIGN\|FORMAL\|SUPPLEMENT\|RISK_NOTICE |
| name | String |
| content | String |
| version | Int      @default(1) |
| enabled | Boolean  @default(true) |
| createdBy | String |
| updatedBy | String? |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| @@map("contract_template") | — |

## ContractNumberSequence

数据库表：`contract_number_sequence`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| scopeKey | String @unique // {contractType}\|{branchCode}\|{teamCode}\|{yyyy} |
| lastSerial | Int    @default(0) |
| @@map("contract_number_sequence") | — |

## Contract

数据库表：`contract`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| contractNo | String    @unique |
| contractType | String // FIRST_SIGN\|FORMAL\|SUPPLEMENT\|RISK_NOTICE |
| title | String |
| customerId | String |
| sourceType | String    @default("CUSTOMER") // CUSTOMER\|NEGOTIATION\|ANALYSIS\|CASE |
| sourceId | String? |
| negotiationId | String? |
| parentContractId | String? |
| templateCode | String? |
| templateVersion | Int? |
| branchId | String? |
| professionalTeamId | String? |
| amount | Decimal   @default(0) @db.Decimal(18, 2) |
| receivedAmount | Decimal   @default(0) @db.Decimal(18, 2) |
| status | String    @default("DRAFT") // DRAFT\|PENDING_APPROVAL\|PENDING_SIGN\|SIGNED\|EFFECTIVE\|TERMINATED\|VOID |
| submittedBy | String? |
| submittedAt | DateTime? |
| approvedBy | String? |
| approvedAt | DateTime? |
| approvalComment | String? |
| signDate | DateTime? |
| esignLinkId | String? |
| esignSerialNo | String? |
| esignStatus | String? |
| esignCallbackPayload | Json? |
| effectiveDate | DateTime? |
| terminatedAt | DateTime? |
| terminateReason | String? |
| voidedAt | DateTime? |
| voidReason | String? |
| startDate | DateTime? |
| endDate | DateTime? |
| paymentTerms | String? |
| terms | String? |
| createdBy | String |
| updatedBy | String? |
| version | Int       @default(1) |
| deletedAt | DateTime? |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| customer | Customer            @relation(fields: [customerId], references: [id]) |
| negotiation | Negotiation?        @relation(fields: [negotiationId], references: [id]) |
| parentContract | Contract?           @relation("ContractSupplement", fields: [parentContractId], references: [id]) |
| supplements | Contract[]          @relation("ContractSupplement") |
| paymentPlans | PaymentPlan[] |
| payments | Payment[] |
| case | Case? |
| analysisEngagement | AnalysisEngagement? |
| invoiceRequests | InvoiceRequest[] |
| refundRequests | RefundRequest[] |
| @@index([status]) | — |
| @@index([customerId]) | — |
| @@index([contractType, | status]) |
| @@index([branchId, | createdAt]) |
| @@index([professionalTeamId]) | — |
| @@map("contract") | — |

## PaymentPlan

数据库表：`payment_plan`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| planNo | String   @unique |
| contractId | String |
| period | Int |
| dueDate | DateTime |
| amount | Decimal  @db.Decimal(18, 2) |
| receivedAmount | Decimal  @default(0) @db.Decimal(18, 2) |
| status | String   @default("PENDING") // PENDING\|PARTIAL\|RECEIVED\|CANCELLED\|OVERDUE |
| version | Int      @default(1) |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| contract | Contract        @relation(fields: [contractId], references: [id]) |
| payments | Payment[] |
| refundRequests | RefundRequest[] |
| @@index([contractId, | period]) |
| @@index([status, | dueDate]) |
| @@map("payment_plan") | — |

## AnalysisEngagement

数据库表：`analysis_engagement`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| engagementNo | String   @unique |
| customerId | String |
| contractId | String   @unique |
| status | String   @default("PENDING") // PENDING\|IN_PROGRESS\|COMPLETED |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| customer | Customer @relation(fields: [customerId], references: [id]) |
| contract | Contract @relation(fields: [contractId], references: [id]) |
| @@index([customerId]) | — |
| @@map("analysis_engagement") | — |
| sopInstances | SopInstance[] |

## Payment

数据库表：`payment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| paymentNo | String    @unique |
| contractId | String |
| paymentPlanId | String? |
| customerId | String |
| amount | Decimal   @db.Decimal(18, 2) |
| method | String? |
| account | String? |
| paidAt | DateTime? |
| status | String    @default("PENDING") // PENDING\|CONFIRMED\|REFUNDED\|VOIDED |
| confirmedBy | String? |
| confirmedAt | DateTime? |
| voidedBy | String? |
| voidedAt | DateTime? |
| voidReason | String? |
| remark | String? |
| invoiceNo | String? |
| invoiceStatus | String    @default("NOT_ISSUED") |
| voucherFiles | Json      @default("[]") |
| createdBy | String |
| updatedBy | String? |
| version | Int       @default(1) |
| deletedAt | DateTime? |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| contract | Contract        @relation(fields: [contractId], references: [id]) |
| paymentPlan | PaymentPlan?    @relation(fields: [paymentPlanId], references: [id]) |
| customer | Customer        @relation(fields: [customerId], references: [id]) |
| refundRequests | RefundRequest[] |
| refundAllocations | RefundAllocation[] |
| @@index([contractId]) | — |
| @@index([paymentPlanId]) | — |
| @@index([status]) | — |
| @@index([customerId]) | — |
| @@map("payment") | — |

## InvoiceRequest

数据库表：`invoice_request`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| requestNo | String    @unique |
| contractId | String |
| customerId | String |
| amount | Decimal   @db.Decimal(18, 2) |
| reason | String? |
| status | String    @default("PENDING") // PENDING\|APPROVED\|REJECTED\|COMPLETED |
| approvedBy | String? |
| approvedAt | DateTime? |
| approvalComment | String? |
| invoiceNo | String? |
| completedBy | String? |
| completedAt | DateTime? |
| createdBy | String |
| updatedBy | String? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| contract | Contract @relation(fields: [contractId], references: [id]) |
| customer | Customer @relation(fields: [customerId], references: [id]) |
| @@index([contractId]) | — |
| @@index([customerId]) | — |
| @@index([status]) | — |
| @@map("invoice_request") | — |

## RefundRequest

数据库表：`refund_request`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| requestNo | String    @unique |
| type | String // REFUND\|WAIVER |
| contractId | String |
| customerId | String |
| paymentId | String? |
| planId | String? |
| amount | Decimal   @db.Decimal(18, 2) |
| reason | String |
| status | String    @default("PENDING") // PENDING\|APPROVED\|REJECTED\|EXECUTED |
| approvedBy | String? |
| approvedAt | DateTime? |
| approvalComment | String? |
| executedBy | String? |
| executedAt | DateTime? |
| sourceRecordId | String?   @unique |
| actualAmount | Decimal?  @db.Decimal(18, 2) |
| paidAt | DateTime? |
| voucherFiles | Json      @default("[]") |
| recipientName | String? |
| recipientBank | String? |
| recipientAccount | String? |
| createdBy | String |
| updatedBy | String? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| contract | Contract     @relation(fields: [contractId], references: [id]) |
| customer | Customer     @relation(fields: [customerId], references: [id]) |
| payment | Payment?     @relation(fields: [paymentId], references: [id]) |
| plan | PaymentPlan? @relation(fields: [planId], references: [id]) |
| sourceRecord | CollabRecord? @relation(fields: [sourceRecordId], references: [id], onDelete: Restrict) |
| allocations | RefundAllocation[] |
| @@index([contractId]) | — |
| @@index([paymentId]) | — |
| @@index([planId]) | — |
| @@index([status]) | — |
| @@map("refund_request") | — |

## RefundAllocation

数据库表：`refund_allocation`。

| 字段或约束 | 类型/定义 |
|---|---|
| refundId | String |
| paymentId | String |
| amount | Decimal @db.Decimal(18, 2) |
| refund | RefundRequest @relation(fields: [refundId], references: [id], onDelete: Restrict) |
| payment | Payment @relation(fields: [paymentId], references: [id], onDelete: Restrict) |
| @@id([refundId, | paymentId]) |
| @@map("refund_allocation") | — |

## CostEntry

数据库表：`cost_entry`。

| 字段或约束 | 类型/定义 |
|---|---|
| sourceApprovalId | String?           @unique |
| sourceApproval | ApprovalInstance? @relation(fields: [sourceApprovalId], references: [id], onDelete: Restrict) |
| id | String            @id @default(uuid()) |
| category | String // CHANNEL\|EVIDENCE\|CASE_HANDLING\|LABOR\|OFFICE |
| amount | Decimal           @db.Decimal(18, 2) |
| occurredAt | DateTime |
| note | String? |
| channelId | String? |
| caseId | String? |
| createdBy | String |
| updatedBy | String? |
| version | Int               @default(1) |
| deletedAt | DateTime? |
| createdAt | DateTime          @default(now()) |
| updatedAt | DateTime          @updatedAt |
| channel | Channel? @relation(fields: [channelId], references: [id]) |
| case | Case?    @relation(fields: [caseId], references: [id]) |
| @@index([category]) | — |
| @@index([channelId]) | — |
| @@index([caseId]) | — |
| @@map("cost_entry") | — |

## Case

数据库表：`case`。

| 字段或约束 | 类型/定义 |
|---|---|
| lifecycleLinks | CollabLifecycleLink[] |
| deletedAt | DateTime? |
| assessments | SatisfactionAssessment[] |
| specialAnalyses | SpecialAnalysis[] |
| qualitySamples | QualitySamplingItem[] |
| qualityIssues | QualityIssue[] |
| sopInstances | SopInstance[] |
| createdBy | String? // U5-B: unknown historical creators remain null |
| branchId | String? |
| updatedBy | String? |
| id | String    @id @default(uuid()) |
| caseNo | String    @unique |
| contractDisplayId | Int @unique @default(autoincrement()) |
| title | String |
| customerId | String |
| contractId | String?   @unique |
| lawyerId | String? // 主办律师 |
| teamIds | String? // 协办团队，JSON数组 |
| intakeData | Json? // SPEC-CASE-20260914: validated case intake information |
| caseType | String // 案由/案件类型 |
| status | String    @default("PENDING") // PENDING \| ACCEPTED \| PROCESSING \| CLOSED \| ARCHIVED |
| priority | String    @default("NORMAL") // LOW \| NORMAL \| HIGH \| URGENT |
| fee | Decimal   @default(0) @db.Decimal(18, 2) |
| description | String? |
| result | String? // 案件结果 |
| satisfaction | Int? // 满意度 1-5 |
| isReferrable | Boolean   @default(false) // 是否可转介绍 |
| closedAt | DateTime? |
| version | Int       @default(1) // SPEC-035 乐观锁（updateCase updateMany {id, version}） |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| customer | Customer        @relation(fields: [customerId], references: [id]) |
| contract | Contract?       @relation(fields: [contractId], references: [id]) |
| lawyer | Employee?       @relation("CaseLawyer", fields: [lawyerId], references: [id]) |
| tasks | CaseTask[] |
| communications | Communication[] |
| costEntries | CostEntry[] |
| files | CaseFile[] |
| @@index([status]) | — |
| @@index([lawyerId]) | — |
| @@index([createdBy]) | — |
| @@index([branchId]) | — |
| @@map("case") | — |

## CaseFile

数据库表：`case_file`。

| 字段或约束 | 类型/定义 |
|---|---|
| assessments | SatisfactionAssessment[] |
| qualityAttachments | IssueAttachment[] |
| sopAttachments | SubmissionAttachment[] |
| id | String   @id @default(uuid()) |
| caseId | String |
| fileName | String // 原始文件名（元数据，落盘用 UUID） |
| category | String? // 合同附件 / 收款凭证 / 退款凭证 |
| fileType | String // MIME 类型 |
| filePath | String // 相对存储路径 var/storage/case-files/<uuid> |
| fileSize | Int // 字节数 |
| uploadedBy | String |
| createdAt | DateTime @default(now()) |
| case | Case @relation(fields: [caseId], references: [id], onDelete: Cascade) |
| @@index([caseId]) | — |
| @@map("case_file") | — |

## CaseTask

数据库表：`case_task`。

| 字段或约束 | 类型/定义 |
|---|---|
| reminderEmissions | SopReminderEmission[] |
| activeSubmissionId | String? @unique |
| activeSubmission | SopSubmission? @relation("SopCurrentSubmission", fields: [activeSubmissionId], references: [id], onDelete: Restrict) |
| submissions | SopSubmission[] @relation("SopTaskSubmissions") |
| guidance | ExpertGuidance[] |
| sopInstanceId | String? |
| nodeCode | String? |
| nodeSnapshot | Json? |
| createdBy | String? |
| updatedBy | String? |
| assigneeUserId | String? |
| version | Int @default(1) |
| sopInstance | SopInstance? @relation(fields: [sopInstanceId], references: [id], onDelete: Restrict) |
| assignee | User? @relation("SopAssignee", fields: [assigneeUserId], references: [id], onDelete: Restrict) |
| sopAccesses | SopTaskAccess[] |
| @@unique([sopInstanceId, | nodeCode]) |
| @@index([assigneeUserId, | status, dueDate]) |
| @@index([createdBy]) | — |
| id | String    @id @default(uuid()) |
| caseId | String? |
| name | String // 任务名称 |
| nodeType | String // 立案准备 \| 材料收集 \| 立案提交 \| 开庭 \| 文书提交 \| 裁判反馈 \| 执行 \| 结案 |
| status | String    @default("PENDING") // PENDING \| IN_PROGRESS \| COMPLETED \| OVERDUE |
| dueDate | DateTime? |
| completedAt | DateTime? |
| remark | String? |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| case | Case? @relation(fields: [caseId], references: [id], onDelete: Cascade) |
| @@index([caseId]) | — |
| @@map("case_task") | — |

## Communication

数据库表：`communication`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| caseId | String |
| type | String // PHONE \| MEETING \| WECHAT \| EMAIL \| OTHER |
| content | String |
| isKey | Boolean  @default(false) // 是否关键沟通 |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| case | Case @relation(fields: [caseId], references: [id], onDelete: Cascade) |
| @@index([caseId]) | — |
| @@map("communication") | — |

## Performance

数据库表：`performance`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| createdBy | String? |
| updatedBy | String? |
| version | Int       @default(1) |
| employeeId | String |
| period | String // 考核周期，如"2026-04" |
| type | String // MONTHLY \| QUARTERLY \| YEARLY |
| kpiData | String // KPI数据，JSON |
| score | Decimal?  @db.Decimal(18, 2) // 绩效分数 |
| bonus | Decimal?  @db.Decimal(18, 2) // 奖金 |
| remark | String? |
| status | String    @default("PENDING") // PENDING \| SELF_REVIEWED \| MANAGER_REVIEWED \| CONFIRMED |
| goal | String? |
| selfScore | Int? |
| selfComment | String? |
| managerScore | Int? |
| managerComment | String? |
| reviewerId | String? // 主管评人 |
| reviewedAt | DateTime? |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| employee | Employee @relation(fields: [employeeId], references: [id]) |
| @@unique([employeeId, | period, type]) |
| @@index([createdBy]) | — |
| @@map("performance") | — |

## ApprovalDefinition

数据库表：`approval_definition`。

| 字段或约束 | 类型/定义 |
|---|---|
| syncRule | ApprovalSyncRule? |
| ownerUserId | String? // null = 公共类型；个人类型仅所有者可申请 |
| id | String            @id @default(uuid()) |
| code | String            @unique |
| name | String |
| businessType | String // EXPENSE\|CONTRACT_CHANGE\|SEAL\|LEAVE\|TRANSFER |
| formSchema | Json // 表单字段+校验规格 |
| approverRule | Json // {type:'USER',userIds:[...]} \| {type:'ROLE',roleCodes:[...]} |
| nodeSchema | Json? // 多级节点链；缺省=顶层 approverRule 单节点 |
| version | Int               @default(1) |
| status | String            @default("ACTIVE") // ACTIVE\|DISABLED |
| createdBy | String |
| createdAt | DateTime          @default(now()) |
| updatedAt | DateTime          @updatedAt |
| instances | ApprovalInstance[] |
| @@map("approval_definition") | — |

## ApprovalInstance

数据库表：`approval_instance`。

| 字段或约束 | 类型/定义 |
|---|---|
| analysisClose | AnalysisCloseRequest? |
| qualityReview | QualityReview? |
| syncRecord | ApprovalSyncRecord? |
| payrollBatch | PayrollBatch? |
| costEntry | CostEntry? |
| formSnapshot | Json? // 类型名称、字段标签快照，供归档 |
| requestKey | String?              @unique |
| requestHash | String? |
| attachments | ApprovalAttachment[] |
| id | String               @id @default(uuid()) |
| definitionId | String |
| definitionVersion | Int |
| businessType | String // EXPENSE\|CONTRACT_CHANGE\|SEAL\|LEAVE\|TRANSFER |
| title | String |
| content | Json // 表单值快照 |
| currentNode | Int                  @default(0) // 当前活动节点下标 |
| applicantId | String |
| status | String               @default("PENDING") // PENDING\|APPROVED\|REJECTED\|WITHDRAWN |
| decidedBy | String? |
| decidedAt | DateTime? |
| version | Int                  @default(1) |
| createdBy | String |
| createdAt | DateTime             @default(now()) |
| updatedAt | DateTime             @updatedAt |
| definition | ApprovalDefinition @relation(fields: [definitionId], references: [id]) |
| tasks | ApprovalTask[] |
| @@index([applicantId]) | — |
| @@index([businessType, | status]) |
| @@map("approval_instance") | — |

## ApprovalTask

数据库表：`approval_task`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| instanceId | String |
| nodeName | String    @default("审批") |
| assigneeId | String |
| status | String    @default("PENDING") // PENDING\|APPROVED\|REJECTED\|CANCELLED |
| remark | String? |
| processedBy | String? |
| processedAt | DateTime? |
| version | Int       @default(1) |
| createdAt | DateTime  @default(now()) |
| updatedAt | DateTime  @updatedAt |
| instance | ApprovalInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade) |
| @@index([assigneeId, | status]) |
| @@map("approval_task") | — |

## CallbackAction

数据库表：`callback_action`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| instanceId | String |
| action | String // APPROVE\|REJECT |
| callbackKey | String   @unique |
| status | String   @default("RESPONDED") |
| result | Json |
| createdAt | DateTime @default(now()) |
| @@index([instanceId]) | — |
| @@map("callback_action") | — |

## EventLog

数据库表：`event_log`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| eventType | String |
| eventVersion | Int |
| sourceModule | String |
| objectType | String |
| objectId | String |
| orderingKey | String |
| operatorUserId | String? |
| organizationId | String? |
| branchId | String? |
| teamId | String? |
| payload | Json |
| traceId | String |
| occurredAt | DateTime  @db.Timestamptz(3) |
| dispatchedAt | DateTime? @db.Timestamptz(3) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| operator | User?             @relation("EventOperator", fields: [operatorUserId], references: [id], onDelete: Restrict) |
| organization | Organization?     @relation("EventOrganization", fields: [organizationId], references: [id], onDelete: Restrict) |
| branch | Organization?     @relation("EventBranch", fields: [branchId], references: [id], onDelete: Restrict) |
| team | ProfessionalTeam? @relation(fields: [teamId], references: [id], onDelete: Restrict) |
| deliveries | EventDelivery[] |
| @@index([dispatchedAt, | createdAt]) |
| @@index([eventType, | eventVersion, createdAt]) |
| @@index([objectType, | objectId, occurredAt]) |
| @@index([traceId]) | — |
| @@map("event_log") | — |

## EventSubscription

数据库表：`event_subscription`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| code | String   @unique |
| eventType | String |
| eventVersion | Int |
| handlerCode | String |
| status | String   @default("ENABLED") |
| filterJson | Json? |
| createdAt | DateTime @default(now()) @db.Timestamptz(3) |
| updatedAt | DateTime @updatedAt @db.Timestamptz(3) |
| deliveries | EventDelivery[] |
| @@index([status, | eventType, eventVersion]) |
| @@map("event_subscription") | — |

## EventDelivery

数据库表：`event_delivery`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String    @id @default(uuid()) |
| eventId | String |
| subscriptionId | String |
| handlerCode | String |
| orderingKey | String |
| status | String    @default("PENDING") |
| attemptCount | Int       @default(0) |
| manualRetryCount | Int       @default(0) |
| nextAttemptAt | DateTime? @db.Timestamptz(3) |
| lockedBy | String? |
| lockedUntil | DateTime? @db.Timestamptz(3) |
| lastErrorCode | String? |
| lastErrorReference | String? |
| version | Int       @default(0) |
| startedAt | DateTime? @db.Timestamptz(3) |
| completedAt | DateTime? @db.Timestamptz(3) |
| createdAt | DateTime  @default(now()) @db.Timestamptz(3) |
| updatedAt | DateTime  @updatedAt @db.Timestamptz(3) |
| event | EventLog          @relation(fields: [eventId], references: [id], onDelete: Restrict) |
| subscription | EventSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Restrict) |
| handlerLogs | EventHandlerLog[] |
| @@unique([eventId, | handlerCode], map: "event_delivery_event_handler_key") |
| @@index([status, | nextAttemptAt, createdAt]) |
| @@index([handlerCode, | orderingKey, status, createdAt]) |
| @@map("event_delivery") | — |

## EventHandlerLog

数据库表：`event_handler_log`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| deliveryId | String |
| attemptNumber | Int |
| workerId | String |
| outcome | String |
| errorCode | String? |
| errorReference | String? |
| durationMs | Int |
| startedAt | DateTime @db.Timestamptz(3) |
| completedAt | DateTime @db.Timestamptz(3) |
| delivery | EventDelivery @relation(fields: [deliveryId], references: [id], onDelete: Restrict) |
| @@unique([deliveryId, | attemptNumber], map: "event_handler_log_delivery_attempt_key") |
| @@index([outcome, | completedAt]) |
| @@map("event_handler_log") | — |

## EventWorkerRuntimeStatus

数据库表：`event_worker_runtime_status`。

| 字段或约束 | 类型/定义 |
|---|---|
| slot | String    @id |
| configuredEnabled | Boolean |
| state | String |
| processStartedAt | DateTime  @db.Timestamptz(3) |
| lastHeartbeatAt | DateTime? @db.Timestamptz(3) |
| lastSuccessfulTickAt | DateTime? @db.Timestamptz(3) |
| lastStoppedAt | DateTime? @db.Timestamptz(3) |
| version | Int       @default(1) |
| updatedAt | DateTime  @updatedAt @db.Timestamptz(3) |
| @@map("event_worker_runtime_status") | — |

## Notification

数据库表：`notification`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| userId | String |
| type | String // SYSTEM \| TASK \| REMINDER \| APPROVAL |
| title | String |
| content | String |
| isRead | Boolean  @default(false) |
| relatedId | String? // 关联的业务ID |
| relatedType | String? // 关联的业务类型 |
| deduplicationKey | String?  @unique |
| routeUrl | String? |
| createdAt | DateTime @default(now()) |
| @@index([userId, | isRead]) |
| @@map("notification") | — |

## OperationLog

数据库表：`operation_log`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| userId | String? |
| action | String // CREATE \| UPDATE \| DELETE \| ASSIGN \| TRANSFER \| APPROVE |
| targetType | String // LEAD \| CUSTOMER \| CONTRACT \| CASE \| PAYMENT \| EMPLOYEE |
| targetId | String |
| oldValues | String? // 修改前数据，JSON |
| newValues | String? // 修改后数据，JSON |
| ip | String? |
| createdAt | DateTime @default(now()) |
| @@index([targetType, | targetId]) |
| @@map("operation_log") | — |

## ApprovalAttachment

数据库表：`approval_attachment`。

| 字段或约束 | 类型/定义 |
|---|---|
| payrollBatches | PayrollBatch[] |
| id | String               @id @default(uuid()) |
| ownerUserId | String |
| instanceId | String? |
| fileName | String |
| mimeType | String |
| fileSize | Int |
| sha256 | String |
| bytes | Bytes |
| sourceId | String? |
| source | ApprovalAttachment?  @relation("AttachmentOriginal", fields: [sourceId], references: [id], onDelete: Restrict) |
| revisions | ApprovalAttachment[] @relation("AttachmentOriginal") |
| createdAt | DateTime             @default(now()) |
| instance | ApprovalInstance?    @relation(fields: [instanceId], references: [id], onDelete: Restrict) |
| @@index([instanceId]) | — |
| @@index([ownerUserId, | createdAt]) |
| @@map("approval_attachment") | — |

## ApprovalSyncRule

数据库表：`approval_sync_rule`。

| 字段或约束 | 类型/定义 |
|---|---|
| definitionId | String             @id |
| target | String |
| definition | ApprovalDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict) |
| updatedAt | DateTime           @updatedAt |
| @@map("approval_sync_rule") | — |

## ApprovalSyncRecord

数据库表：`approval_sync_record`。

| 字段或约束 | 类型/定义 |
|---|---|
| instanceId | String           @id |
| target | String |
| status | String |
| targetId | String? |
| reason | String? |
| attempts | Int              @default(0) |
| instance | ApprovalInstance @relation(fields: [instanceId], references: [id], onDelete: Restrict) |
| updatedAt | DateTime         @updatedAt |
| @@index([target, | status]) |
| @@map("approval_sync_record") | — |

## PayrollBatch

数据库表：`payroll_batch`。

| 字段或约束 | 类型/定义 |
|---|---|
| workflowInstanceId | String? @unique |
| workflow | WorkflowInstance? @relation(fields:[workflowInstanceId],references:[id],onDelete:Restrict) |
| id | String             @id @default(uuid()) |
| ownerUserId | String |
| title | String |
| period | String |
| attachmentId | String |
| attachment | ApprovalAttachment @relation(fields: [attachmentId], references: [id], onDelete: Restrict) |
| instanceId | String?            @unique |
| instance | ApprovalInstance?  @relation(fields: [instanceId], references: [id], onDelete: Restrict) |
| version | Int                @default(1) |
| createdAt | DateTime           @default(now()) |
| updatedAt | DateTime           @updatedAt |
| @@index([ownerUserId, | createdAt]) |
| @@map("payroll_batch") | — |

## InventoryItem

数据库表：`inventory_item`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String               @id @default(uuid()) |
| code | String               @unique |
| name | String |
| kind | String |
| category | String |
| unit | String |
| specification | String? |
| location | String? |
| stock | Decimal              @default(0) @db.Decimal(18, 3) |
| minimumStock | Decimal              @default(0) @db.Decimal(18, 3) |
| status | String               @default("ENABLED") |
| version | Int                  @default(1) |
| createdBy | String |
| createdAt | DateTime             @default(now()) |
| updatedAt | DateTime             @updatedAt |
| movements | InventoryMovement[] |
| stocktakes | InventoryStocktake[] |
| @@index([kind, | status]) |
| @@map("inventory_item") | — |

## InventoryMovement

数据库表：`inventory_movement`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String        @id @default(uuid()) |
| documentNo | String        @unique |
| requestKey | String        @unique |
| requestHash | String |
| itemId | String |
| item | InventoryItem @relation(fields: [itemId], references: [id], onDelete: Restrict) |
| action | String |
| itemKind | String |
| itemName | String |
| itemSpecification | String? |
| unit | String |
| quantity | Decimal       @db.Decimal(18, 3) |
| beforeStock | Decimal       @db.Decimal(18, 3) |
| afterStock | Decimal       @db.Decimal(18, 3) |
| employeeId | String? |
| employee | Employee?     @relation(fields: [employeeId], references: [id], onDelete: Restrict) |
| employeeName | String? |
| organizationId | String? |
| organization | Organization? @relation(fields: [organizationId], references: [id], onDelete: Restrict) |
| organizationPath | String? |
| source | String? |
| reason | String? |
| occurredAt | DateTime |
| createdBy | String |
| createdAt | DateTime      @default(now()) |
| @@index([itemId, | occurredAt]) |
| @@index([action, | itemKind, occurredAt]) |
| @@map("inventory_movement") | — |

## InventoryStocktake

数据库表：`inventory_stocktake`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String        @id @default(uuid()) |
| documentNo | String        @unique |
| requestKey | String        @unique |
| requestHash | String |
| itemId | String |
| item | InventoryItem @relation(fields: [itemId], references: [id], onDelete: Restrict) |
| itemName | String |
| unit | String |
| bookStock | Decimal       @db.Decimal(18, 3) |
| actualStock | Decimal       @db.Decimal(18, 3) |
| difference | Decimal       @db.Decimal(18, 3) |
| reason | String? |
| occurredAt | DateTime |
| createdBy | String |
| createdAt | DateTime      @default(now()) |
| @@index([itemId, | occurredAt]) |
| @@map("inventory_stocktake") | — |

## CollabWorkspace

数据库表：`collab_workspace`。

| 字段或约束 | 类型/定义 |
|---|---|
| moduleGroup | String? |
| moduleParentId | String? |
| @@unique([moduleParentId, | moduleGroup]) |
| driveShortcuts | DriveShortcut[] |
| driveNodes | DriveNode[] |
| organization | Organization    @relation("CollabOrganization", fields: [organizationId], references: [id], onDelete: Restrict, onUpdate: NoAction, map: "collab_workspace_org_fk") |
| owner | User            @relation("CollabOwner", fields: [ownerId], references: [id], onDelete: Restrict, onUpdate: NoAction, map: "collab_workspace_owner_fk") |
| id | String          @id @default(uuid()) |
| organizationId | String |
| name | String |
| ownerId | String |
| version | Int             @default(1) |
| createdAt | DateTime        @default(now()) |
| bases | CollabBase[] |
| members | CollabMember[] |
| @@index([organizationId]) | — |
| @@map("collab_workspace") | — |

## CollabMember

数据库表：`collab_member`。

| 字段或约束 | 类型/定义 |
|---|---|
| canManageAccess | Boolean         @default(false) |
| id | String          @id @default(uuid()) |
| workspaceId | String |
| principalType | String          @default("USER") |
| principalId | String |
| role | String          @default("READER") |
| canCreate | Boolean         @default(false) |
| rowScope | String          @default("SELF") |
| hiddenFields | String[]        @default([]) |
| readonlyFields | String[]        @default([]) |
| version | Int             @default(1) |
| workspace | CollabWorkspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade) |
| @@unique([workspaceId, | principalType, principalId]) |
| @@map("collab_member") | — |

## CollabBase

数据库表：`collab_base`。

| 字段或约束 | 类型/定义 |
|---|---|
| moduleSource | String? |
| driveNode | DriveNode? |
| accessPolicy | Json? |
| accessVersion | Int              @default(1) |
| id | String           @id @default(uuid()) |
| workspaceId | String |
| name | String |
| version | Int              @default(1) |
| workspace | CollabWorkspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade) |
| tables | CollabTable[] |
| events | CollabEvent[] |
| presence | CollabPresence[] |
| @@unique([workspaceId, | name]) |
| @@unique([workspaceId, | id]) |
| @@map("collab_base") | — |

## DriveNode

数据库表：`drive_node`。

| 字段或约束 | 类型/定义 |
|---|---|
| shortcutTargets | DriveShortcut[] @relation("ShortcutTarget") |
| shortcutChildren | DriveShortcut[] @relation("ShortcutParent") |
| visits | DriveVisit[] |
| id | String          @id @default(uuid()) |
| workspaceId | String |
| parentId | String? |
| kind | String |
| folderName | String? |
| baseId | String?         @unique |
| ownerId | String |
| accessPolicy | Json? |
| deletedAt | DateTime? |
| deletedBy | String? |
| version | Int             @default(1) |
| createdAt | DateTime? |
| cataloguedAt | DateTime        @default(now()) |
| updatedAt | DateTime        @updatedAt |
| workspace | CollabWorkspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade) |
| owner | User            @relation(fields: [ownerId], references: [id], onDelete: Restrict) |
| base | CollabBase?     @relation(fields: [workspaceId, baseId], references: [workspaceId, id], onDelete: Cascade) |
| parent | DriveNode?      @relation("DriveTree", fields: [workspaceId, parentId], references: [workspaceId, id], onDelete: Restrict) |
| children | DriveNode[]     @relation("DriveTree") |
| @@unique([workspaceId, | id]) |
| @@unique([workspaceId, | baseId]) |
| @@index([workspaceId, | ownerId]) |
| @@map("drive_node") | — |

## DriveShortcut

数据库表：`drive_shortcut`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String          @id @default(uuid()) |
| workspaceId | String |
| parentId | String? |
| targetId | String |
| ownerId | String |
| createdAt | DateTime        @default(now()) |
| deletedAt | DateTime? |
| workspace | CollabWorkspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade) |
| parent | DriveNode?      @relation("ShortcutParent", fields: [workspaceId, parentId], references: [workspaceId, id], onDelete: Restrict) |
| target | DriveNode       @relation("ShortcutTarget", fields: [workspaceId, targetId], references: [workspaceId, id], onDelete: Cascade) |
| owner | User            @relation(fields: [ownerId], references: [id], onDelete: Cascade) |
| @@index([workspaceId, | parentId]) |
| @@map("drive_shortcut") | — |

## DriveVisit

数据库表：`drive_visit`。

| 字段或约束 | 类型/定义 |
|---|---|
| userId | String |
| nodeId | String |
| workspaceId | String |
| visitedAt | DateTime  @default(now()) |
| user | User      @relation(fields: [userId], references: [id], onDelete: Cascade) |
| node | DriveNode @relation(fields: [workspaceId, nodeId], references: [workspaceId, id], onDelete: Cascade) |
| @@id([userId, | nodeId]) |
| @@index([userId, | workspaceId, visitedAt]) |
| @@map("drive_visit") | — |

## CollabTable

数据库表：`collab_table`。

| 字段或约束 | 类型/定义 |
|---|---|
| inventoryKind | String? |
| lifecycleKind | String? |
| accessPolicy | Json? |
| accessVersion | Int               @default(1) |
| id | String            @id @default(uuid()) |
| baseId | String |
| name | String |
| source | String            @default("CUSTOM") |
| position | Int               @default(0) |
| schemaVersion | Int               @default(1) |
| archived | Boolean           @default(false) |
| createdBy | String |
| createdAt | DateTime          @default(now()) |
| base | CollabBase        @relation(fields: [baseId], references: [id], onDelete: Cascade) |
| fields | CollabField[] |
| views | CollabView[] |
| extensions | CollabExtension[] |
| records | CollabRecord[] |
| comments | CollabComment[] |
| rules | CollabRule[] |
| @@unique([baseId, | name]) |
| @@map("collab_table") | — |

## CollabField

数据库表：`collab_field`。

| 字段或约束 | 类型/定义 |
|---|---|
| relations | CollabRelation[] |
| id | String           @id @default(uuid()) |
| tableId | String |
| name | String |
| type | String           @default("TEXT") |
| options | Json             @default("{}") |
| required | Boolean          @default(false) |
| defaultValue | Json? |
| position | Int              @default(0) |
| archived | Boolean          @default(false) |
| table | CollabTable      @relation(fields: [tableId], references: [id], onDelete: Cascade) |
| @@unique([tableId, | name]) |
| @@map("collab_field") | — |

## CollabView

数据库表：`collab_view`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String      @id @default(uuid()) |
| tableId | String |
| name | String |
| type | String      @default("GRID") |
| ownerId | String |
| shared | Boolean     @default(false) |
| isDefault | Boolean     @default(false) |
| position | Int         @default(0) |
| version | Int         @default(1) |
| config | Json        @default("{}") |
| table | CollabTable @relation(fields: [tableId], references: [id], onDelete: Cascade) |
| @@index([tableId, | ownerId]) |
| @@map("collab_view") | — |

## CollabRecord

数据库表：`collab_record`。

| 字段或约束 | 类型/定义 |
|---|---|
| financialRefund | RefundRequest? |
| lifecycleLink | CollabLifecycleLink? @relation("LifecycleRecord") |
| lifecycleChildren | CollabLifecycleLink[] @relation("LifecycleParent") |
| outgoingRelations | CollabRelation[] @relation("CollabSource") |
| incomingRelations | CollabRelation[] @relation("CollabTarget") |
| id | String           @id @default(uuid()) |
| tableId | String |
| values | Json             @default("{}") |
| createdBy | String |
| updatedBy | String |
| ownerId | String |
| version | Int              @default(1) |
| archived | Boolean          @default(false) |
| createdAt | DateTime         @default(now()) |
| updatedAt | DateTime         @updatedAt |
| table | CollabTable      @relation(fields: [tableId], references: [id], onDelete: Cascade) |
| revisions | CollabRevision[] |
| @@index([values(ops: | JsonbPathOps)], type: Gin, map: "collab_record_values_path_gin") |
| @@index([tableId, | archived, createdAt, id]) |
| @@index([tableId, | ownerId]) |
| @@index([tableId, | createdBy, archived, createdAt, id], map: "collab_record_creator_page_idx") |
| @@map("collab_record") | — |

## CollabRelation

数据库表：`collab_relation`。

| 字段或约束 | 类型/定义 |
|---|---|
| field | CollabField  @relation(fields: [fieldId], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "collab_relation_field_fk") |
| source | CollabRecord @relation("CollabSource", fields: [sourceRecordId], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "collab_relation_source_fk") |
| target | CollabRecord @relation("CollabTarget", fields: [targetRecordId], references: [id], onDelete: Restrict, onUpdate: NoAction, map: "collab_relation_target_fk") |
| id | String       @id @default(uuid()) |
| fieldId | String |
| sourceRecordId | String |
| targetRecordId | String |
| @@unique([fieldId, | sourceRecordId, targetRecordId]) |
| @@index([targetRecordId]) | — |
| @@map("collab_relation") | — |

## CollabRevision

数据库表：`collab_revision`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String       @id @default(uuid()) |
| recordId | String |
| version | Int |
| actorId | String |
| changes | Json |
| createdAt | DateTime     @default(now()) |
| record | CollabRecord @relation(fields: [recordId], references: [id], onDelete: Cascade) |
| @@unique([recordId, | version]) |
| @@map("collab_revision") | — |

## CollabMutation

数据库表：`collab_mutation`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| actorId | String |
| key | String |
| fingerprint | String |
| result | Json |
| createdAt | DateTime @default(now()) |
| @@unique([actorId, | key]) |
| @@map("collab_mutation") | — |

## CollabEvent

数据库表：`collab_event`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | BigInt     @id @default(autoincrement()) |
| baseId | String |
| kind | String |
| createdAt | DateTime   @default(now()) |
| base | CollabBase @relation(fields: [baseId], references: [id], onDelete: Cascade) |
| @@index([baseId, | id]) |
| @@map("collab_event") | — |

## CollabPresence

数据库表：`collab_presence`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String     @id @default(uuid()) |
| baseId | String |
| userId | String |
| connectionId | String |
| seenAt | DateTime   @default(now()) |
| base | CollabBase @relation(fields: [baseId], references: [id], onDelete: Cascade) |
| @@unique([baseId, | connectionId]) |
| @@index([baseId, | seenAt]) |
| @@map("collab_presence") | — |

## CollabComment

数据库表：`collab_comment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String       @id @default(uuid()) |
| recordId | String |
| tableId | String |
| actorId | String |
| content | String |
| mentions | String[]     @default([]) |
| createdAt | DateTime     @default(now()) |
| updatedAt | DateTime     @default(now()) @updatedAt |
| deletedAt | DateTime? |
| version | Int          @default(1) |
| table | CollabTable @relation(fields: [tableId], references: [id], onDelete: Cascade) |
| @@index([recordId, | createdAt]) |
| @@index([tableId, | recordId, createdAt]) |
| @@map("collab_comment") | — |

## CalendarEvent

数据库表：`calendar_event`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| ownerId | String |
| title | String |
| description | String @default("") |
| location | String @default("") |
| startAt | DateTime |
| endAt | DateTime |
| important | Boolean @default(false) |
| visibility | String @default("PRIVATE") |
| tableId | String? |
| recordId | String? |
| version | Int @default(1) |
| cancelledAt | DateTime? |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| invitations | CalendarInvitation[] |
| reminders | CalendarReminder[] |
| @@index([startAt, | endAt]) |
| @@index([ownerId]) | — |
| @@map("calendar_event") | — |

## CalendarInvitation

数据库表：`calendar_invitation`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| eventId | String |
| userId | String |
| status | String @default("PENDING") |
| respondedAt | DateTime? |
| event | CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade) |
| @@unique([eventId, | userId]) |
| @@index([userId, | status]) |
| @@map("calendar_invitation") | — |

## CalendarReminder

数据库表：`calendar_reminder`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| eventId | String |
| minutesBefore | Int |
| dueAt | DateTime |
| processedAt | DateTime? |
| event | CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade) |
| @@unique([eventId, | minutesBefore]) |
| @@index([processedAt, | dueAt]) |
| @@map("calendar_reminder") | — |

## CollabAttachment

数据库表：`collab_attachment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| tableId | String |
| ownerId | String |
| name | String |
| mimeType | String |
| size | Int |
| storageKey | String   @unique |
| createdAt | DateTime @default(now()) |
| @@index([tableId]) | — |
| @@map("collab_attachment") | — |

## CollabRule

数据库表：`collab_rule`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String      @id @default(uuid()) |
| tableId | String |
| name | String |
| ownerId | String |
| enabled | Boolean     @default(false) |
| version | Int         @default(1) |
| trigger | String |
| condition | Json        @default("{}") |
| action | Json |
| table | CollabTable @relation(fields: [tableId], references: [id], onDelete: Cascade) |
| runs | CollabRun[] |
| @@map("collab_rule") | — |

## CollabRun

数据库表：`collab_run`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String     @id @default(uuid()) |
| ruleId | String |
| recordId | String |
| recordVersion | Int |
| ruleVersion | Int |
| status | String |
| attempts | Int        @default(0) |
| error | String? |
| createdAt | DateTime   @default(now()) |
| rule | CollabRule @relation(fields: [ruleId], references: [id], onDelete: Cascade) |
| @@unique([ruleId, | recordId, recordVersion, ruleVersion]) |
| @@map("collab_run") | — |

## CollabPreference

数据库表：`collab_preference`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| userId | String |
| tableId | String |
| viewId | String |
| @@unique([userId, | tableId]) |
| @@map("collab_preference") | — |

## CollabExtension

数据库表：`collab_extension`。

| 字段或约束 | 类型/定义 |
|---|---|
| tableId | String |
| recordId | String |
| values | Json                      @default("{}") |
| version | Int                       @default(1) |
| updatedBy | String |
| updatedAt | DateTime                  @updatedAt |
| table | CollabTable               @relation(fields: [tableId], references: [id], onDelete: Cascade) |
| revisions | CollabExtensionRevision[] |
| @@id([tableId, | recordId]) |
| @@index([values], | type: Gin, map: "collab_extension_values_gin") |
| @@map("collab_extension") | — |

## CollabExtensionRevision

数据库表：`collab_extension_revision`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String          @id @default(uuid()) |
| tableId | String |
| recordId | String |
| version | Int |
| actorId | String |
| changes | Json |
| createdAt | DateTime        @default(now()) |
| extension | CollabExtension @relation(fields: [tableId, recordId], references: [tableId, recordId], onDelete: Cascade) |
| @@unique([tableId, | recordId, version]) |
| @@map("collab_extension_revision") | — |

## DomainMutation

数据库表：`domain_mutation`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String   @id @default(uuid()) |
| actorId | String |
| key | String |
| operation | String |
| requestHash | String |
| targetId | String |
| createdAt | DateTime @default(now()) |
| @@unique([actorId, | key]) |
| @@index([targetId]) | — |
| @@map("domain_mutation") | — |

## SopTemplate

数据库表：`sop_template`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| code | String @unique |
| name | String |
| organizationId | String |
| professionalTeamId | String |
| caseType | String |
| createdBy | String |
| updatedBy | String? |
| version | Int @default(1) |
| activeVersionId | String? @unique |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| organization | Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict) |
| professionalTeam | ProfessionalTeam @relation(fields: [professionalTeamId], references: [id], onDelete: Restrict) |
| versions | SopTemplateVersion[] @relation("SopVersions") |
| activeVersion | SopTemplateVersion? @relation("SopActiveVersion", fields: [activeVersionId], references: [id], onDelete: Restrict) |
| @@index([organizationId, | professionalTeamId]) |
| @@index([createdBy]) | — |
| @@map("sop_template") | — |

## SopTemplateVersion

数据库表：`sop_template_version`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| templateId | String |
| number | Int |
| content | Json |
| contentHash | String |
| status | String @default("DRAFT") |
| version | Int @default(1) |
| createdBy | String |
| updatedBy | String? |
| publishedOperationId | String? @unique |
| disabledOperationId | String? @unique |
| publishedAt | DateTime? |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| template | SopTemplate @relation("SopVersions", fields: [templateId], references: [id], onDelete: Restrict) |
| activeFor | SopTemplate? @relation("SopActiveVersion") |
| instances | SopInstance[] |
| @@unique([templateId, | number]) |
| @@index([status]) | — |
| @@map("sop_template_version") | — |

## SopInstance

数据库表：`sop_instance`。

| 字段或约束 | 类型/定义 |
|---|---|
| batchKey | String @default("PRIMARY") |
| tasks | CaseTask[] |
| @@unique([caseId, | templateVersionId, batchKey]) |
| id | String @id @default(uuid()) |
| caseId | String? |
| leadId | String? |
| analysisEngagementId | String? |
| templateVersionId | String |
| createdBy | String |
| version | Int @default(1) |
| status | String @default("ACTIVE") |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| case | Case? @relation(fields: [caseId], references: [id], onDelete: Restrict) |
| templateVersion | SopTemplateVersion @relation(fields: [templateVersionId], references: [id], onDelete: Restrict) |
| @@index([caseId]) | — |
| @@map("sop_instance") | — |
| lead | Lead? @relation(fields:[leadId],references:[id],onDelete:Restrict) |
| analysisEngagement | AnalysisEngagement? @relation(fields:[analysisEngagementId],references:[id],onDelete:Restrict) |
| sourceFiles | SopSourceFile[] |
| outgoingContinuations | SopContinuation[] @relation("SopContinuationSource") |
| incomingContinuations | SopContinuation[] @relation("SopContinuationTarget") |
| @@unique([leadId,templateVersionId,batchKey]) | — |
| @@unique([analysisEngagementId,templateVersionId,batchKey]) | — |

## SopTaskAccess

数据库表：`sop_task_access`。

| 字段或约束 | 类型/定义 |
|---|---|
| employmentStamp | String? |
| id | String @id @default(uuid()) |
| taskId | String |
| principalUserId | String |
| grantedBy | String |
| validFrom | DateTime @default(now()) |
| validUntil | DateTime? |
| revokedAt | DateTime? |
| revokeReason | String? |
| canExecute | Boolean @default(true) |
| createdAt | DateTime @default(now()) |
| task | CaseTask @relation(fields: [taskId], references: [id], onDelete: Restrict) |
| principal | User @relation("SopAccessPrincipal", fields: [principalUserId], references: [id], onDelete: Restrict) |
| issuer | User @relation("SopAccessIssuer", fields: [grantedBy], references: [id], onDelete: Restrict) |
| @@index([principalUserId, | revokedAt, validUntil]) |
| @@map("sop_task_access") | — |

## SopSubmission

数据库表：`sop_submission`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| taskId | String |
| number | Int |
| taskVersion | Int |
| report | String |
| nodeSnapshot | Json |
| materialChecklist | Json |
| contentHash | String |
| submittedBy | String |
| executorUserId | String? |
| createdAt | DateTime @default(now()) |
| task | CaseTask @relation("SopTaskSubmissions", fields: [taskId], references: [id], onDelete: Restrict) |
| currentForTask | CaseTask? @relation("SopCurrentSubmission") |
| submitter | User @relation("SopSubmissionAuthor", fields: [submittedBy], references: [id], onDelete: Restrict) |
| attachments | SubmissionAttachment[] |
| review | QualityReview? |
| guidance | ExpertGuidance[] |
| @@unique([taskId, | number]) |
| @@index([submittedBy]) | — |
| @@map("sop_submission") | — |

## SubmissionAttachment

数据库表：`submission_attachment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| submissionId | String |
| fileId | String? |
| sourceFileId | String? |
| materialCode | String |
| sha256 | String |
| fileSize | Int |
| createdAt | DateTime @default(now()) |
| submission | SopSubmission @relation(fields: [submissionId], references: [id], onDelete: Restrict) |
| file | CaseFile? @relation(fields: [fileId], references: [id], onDelete: Restrict) |
| @@unique([submissionId, | materialCode, fileId]) |
| @@index([fileId]) | — |
| @@map("submission_attachment") | — |
| sourceFile | SopSourceFile? @relation(fields:[sourceFileId],references:[id],onDelete:Restrict) |
| @@unique([submissionId,materialCode,sourceFileId]) | — |

## QualityReview

数据库表：`quality_review`。

| 字段或约束 | 类型/定义 |
|---|---|
| workflowInstanceId | String? @unique |
| workflow | WorkflowInstance? @relation(fields:[workflowInstanceId],references:[id],onDelete:Restrict) |
| id | String @id @default(uuid()) |
| submissionId | String @unique |
| approvalInstanceId | String? @unique |
| reviewerUserId | String? |
| createdBy | String |
| status | String @default("WAITING_ASSIGNMENT") |
| checklist | Json |
| version | Int @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| submission | SopSubmission @relation(fields: [submissionId], references: [id], onDelete: Restrict) |
| approval | ApprovalInstance? @relation(fields: [approvalInstanceId], references: [id], onDelete: Restrict) |
| reviewer | User? @relation("SopReviewAssignee", fields: [reviewerUserId], references: [id], onDelete: Restrict) |
| creator | User @relation("SopReviewCreator", fields: [createdBy], references: [id], onDelete: Restrict) |
| @@index([reviewerUserId, | status]) |
| @@map("quality_review") | — |

## ExpertGuidance

数据库表：`expert_guidance`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| taskId | String |
| submissionId | String? |
| content | String |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| task | CaseTask @relation(fields: [taskId], references: [id], onDelete: Restrict) |
| submission | SopSubmission? @relation(fields: [submissionId], references: [id], onDelete: Restrict) |
| author | User @relation("SopGuidanceAuthor", fields: [createdBy], references: [id], onDelete: Restrict) |
| @@index([taskId, | createdAt]) |
| @@map("expert_guidance") | — |

## QualitySamplingPolicy

数据库表：`quality_sampling_policy`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| code | String |
| number | Int |
| name | String |
| organizationId | String |
| professionalTeamId | String? |
| mode | String |
| amount | Int |
| stratified | Boolean @default(false) |
| checklist | Json |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| organization | Organization @relation(fields:[organizationId],references:[id],onDelete:Restrict) |
| professionalTeam | ProfessionalTeam? @relation(fields:[professionalTeamId],references:[id],onDelete:Restrict) |
| creator | User @relation(fields:[createdBy],references:[id],onDelete:Restrict) |
| runs | QualitySamplingRun[] |
| @@unique([code,number]) | — |
| @@map("quality_sampling_policy") | — |

## QualitySamplingRun

数据库表：`quality_sampling_run`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| policyId | String |
| scopeHash | String |
| month | String |
| batchKey | String |
| reason | String? |
| seed | String |
| algorithm | String @default("HASH_SORT_V1") |
| candidateSnapshot | Json |
| candidateHash | String |
| exclusions | Json |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| policy | QualitySamplingPolicy @relation(fields:[policyId],references:[id],onDelete:Restrict) |
| creator | User @relation(fields:[createdBy],references:[id],onDelete:Restrict) |
| items | QualitySamplingItem[] |
| @@unique([policyId,scopeHash,month,batchKey]) | — |
| @@map("quality_sampling_run") | — |

## QualitySamplingItem

数据库表：`quality_sampling_item`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| runId | String |
| caseId | String |
| name | String |
| status | String @default("PENDING") |
| checklist | Json |
| inspectorUserId | String? |
| resultHash | String? |
| createdBy | String |
| updatedBy | String? |
| version | Int @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| run | QualitySamplingRun @relation(fields:[runId],references:[id],onDelete:Restrict) |
| case | Case @relation(fields:[caseId],references:[id],onDelete:Restrict) |
| inspector | User? @relation("QualityInspector",fields:[inspectorUserId],references:[id],onDelete:Restrict) |
| creator | User @relation("QualityItemCreator",fields:[createdBy],references:[id],onDelete:Restrict) |
| issues | QualityIssue[] |
| @@unique([runId,caseId]) | — |
| @@map("quality_sampling_item") | — |

## QualityIssue

数据库表：`quality_issue`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| inspectionId | String |
| caseId | String |
| checkCode | String |
| name | String |
| evidence | String |
| assigneeUserId | String? |
| dueAt | DateTime? |
| status | String @default("OPEN") |
| version | Int @default(1) |
| createdBy | String |
| updatedBy | String? |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| case | Case @relation(fields:[caseId],references:[id],onDelete:Restrict) |
| inspection | QualitySamplingItem @relation(fields:[inspectionId],references:[id],onDelete:Restrict) |
| creator | User @relation("QualityIssueCreator",fields:[createdBy],references:[id],onDelete:Restrict) |
| assignee | User? @relation("QualityIssueAssignee",fields:[assigneeUserId],references:[id],onDelete:Restrict) |
| revisions | IssueRevision[] |
| @@unique([inspectionId,checkCode]) | — |
| @@index([caseId,status]) | — |
| @@map("quality_issue") | — |

## IssueRevision

数据库表：`issue_revision`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| issueId | String |
| number | Int |
| action | String |
| content | String |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| issue | QualityIssue @relation(fields:[issueId],references:[id],onDelete:Restrict) |
| creator | User @relation(fields:[createdBy],references:[id],onDelete:Restrict) |
| attachments | IssueAttachment[] |
| @@unique([issueId,number]) | — |
| @@map("issue_revision") | — |

## IssueAttachment

数据库表：`issue_attachment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| revisionId | String |
| fileId | String |
| sha256 | String |
| fileSize | Int |
| revision | IssueRevision @relation(fields:[revisionId],references:[id],onDelete:Restrict) |
| file | CaseFile @relation(fields:[fileId],references:[id],onDelete:Restrict) |
| @@unique([revisionId,fileId]) | — |
| @@map("issue_attachment") | — |

## SatisfactionAssessment

数据库表：`satisfaction_assessment`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| caseId | String |
| score | Int? |
| scale | String @default("HUNDRED_V1") |
| source | String |
| evidence | String |
| evidenceFileId | String? |
| evidenceHash | String? |
| assessedAt | DateTime |
| correctionOfId | String? @unique |
| correctionReason | String? |
| number | Int @default(1) |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| case | Case @relation(fields:[caseId],references:[id],onDelete:Restrict) |
| file | CaseFile? @relation(fields:[evidenceFileId],references:[id],onDelete:Restrict) |
| correctionOf | SatisfactionAssessment? @relation("AssessmentCorrection",fields:[correctionOfId],references:[id],onDelete:Restrict) |
| correction | SatisfactionAssessment? @relation("AssessmentCorrection") |
| creator | User @relation("AssessmentCreator",fields:[createdBy],references:[id],onDelete:Restrict) |
| analysis | SpecialAnalysis? |
| @@index([caseId,createdAt]) | — |
| @@map("satisfaction_assessment") | — |

## SpecialAnalysis

数据库表：`special_analysis`。

| 字段或约束 | 类型/定义 |
|---|---|
| name | String @default("低满意度专项分析") |
| id | String @id @default(uuid()) |
| assessmentId | String @unique |
| caseId | String |
| status | String @default("OPEN") |
| content | String @default("") |
| conclusion | String @default("") |
| currentCloseId | String? @unique |
| createdBy | String |
| updatedBy | String? |
| version | Int @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| assessment | SatisfactionAssessment @relation(fields:[assessmentId],references:[id],onDelete:Restrict) |
| case | Case @relation(fields:[caseId],references:[id],onDelete:Restrict) |
| creator | User @relation("AnalysisCreator",fields:[createdBy],references:[id],onDelete:Restrict) |
| currentClose | AnalysisCloseRequest? @relation("CurrentAnalysisClose",fields:[currentCloseId],references:[id],onDelete:Restrict) |
| closes | AnalysisCloseRequest[] @relation("AnalysisCloses") |
| revisions | AnalysisRevision[] |
| @@index([caseId,status]) | — |
| @@map("special_analysis") | — |

## AnalysisRevision

数据库表：`analysis_revision`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| analysisId | String |
| number | Int |
| content | String |
| conclusion | String |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| analysis | SpecialAnalysis @relation(fields:[analysisId],references:[id],onDelete:Restrict) |
| creator | User @relation("AnalysisRevisionCreator",fields:[createdBy],references:[id],onDelete:Restrict) |
| @@unique([analysisId,number]) | — |
| @@map("analysis_revision") | — |

## AnalysisCloseRequest

数据库表：`analysis_close_request`。

| 字段或约束 | 类型/定义 |
|---|---|
| workflowInstanceId | String? @unique |
| workflow | WorkflowInstance? @relation(fields:[workflowInstanceId],references:[id],onDelete:Restrict) |
| id | String @id @default(uuid()) |
| analysisId | String |
| analysisVersion | Int |
| contentSnapshot | Json |
| contentHash | String |
| createdBy | String |
| reviewerUserId | String |
| approvalInstanceId | String? @unique |
| status | String @default("PENDING") |
| createdAt | DateTime @default(now()) |
| analysis | SpecialAnalysis @relation("AnalysisCloses",fields:[analysisId],references:[id],onDelete:Restrict) |
| currentFor | SpecialAnalysis? @relation("CurrentAnalysisClose") |
| creator | User @relation("AnalysisCloseCreator",fields:[createdBy],references:[id],onDelete:Restrict) |
| reviewer | User @relation("AnalysisCloseReviewer",fields:[reviewerUserId],references:[id],onDelete:Restrict) |
| approval | ApprovalInstance? @relation(fields:[approvalInstanceId],references:[id],onDelete:Restrict) |
| @@map("analysis_close_request") | — |

## SopReminderEmission

数据库表：`sop_reminder_emission`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| taskId | String |
| taskVersion | Int |
| kind | String |
| recipientId | String |
| dueAt | DateTime |
| createdAt | DateTime @default(now()) |
| task | CaseTask @relation(fields:[taskId],references:[id],onDelete:Restrict) |
| recipient | User @relation("SopReminderRecipient",fields:[recipientId],references:[id],onDelete:Restrict) |
| @@unique([taskId,taskVersion,kind,recipientId]) | — |
| @@map("sop_reminder_emission") | — |

## SopSourceFile

数据库表：`sop_source_file`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| instanceId | String |
| fileName | String |
| fileType | String |
| filePath | String @unique |
| fileSize | Int |
| sha256 | String |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| instance | SopInstance @relation(fields:[instanceId],references:[id],onDelete:Restrict) |
| creator | User @relation(fields:[createdBy],references:[id],onDelete:Restrict) |
| attachments | SubmissionAttachment[] |
| @@index([instanceId,createdAt]) | — |
| @@map("sop_source_file") | — |

## SopContinuation

数据库表：`sop_continuation`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| sourceInstanceId | String |
| targetInstanceId | String |
| sourceVersion | Int |
| targetVersion | Int |
| reason | String |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| source | SopInstance @relation("SopContinuationSource",fields:[sourceInstanceId],references:[id],onDelete:Restrict) |
| target | SopInstance @relation("SopContinuationTarget",fields:[targetInstanceId],references:[id],onDelete:Restrict) |
| creator | User @relation(fields:[createdBy],references:[id],onDelete:Restrict) |
| @@unique([sourceInstanceId,targetInstanceId]) | — |
| @@map("sop_continuation") | — |

## CollabRecordOperation

数据库表：`collab_record_operation`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| tableId | String |
| recordId | String |
| actorId | String |
| kind | String |
| before | Json |
| after | Json |
| expectedVersion | Int |
| schemaVersion | Int |
| undone | Boolean @default(false) |
| createdAt | DateTime @default(now()) |
| @@index([tableId, | actorId, createdAt]) |
| @@map("collab_record_operation") | — |

## CollabLifecycleLink

数据库表：`collab_lifecycle_link`。

| 字段或约束 | 类型/定义 |
|---|---|
| recordId | String @id |
| tableId | String |
| caseId | String |
| parentRecordId | String? |
| kind | String |
| status | String @default("OPEN") |
| record | CollabRecord @relation("LifecycleRecord", fields: [recordId], references: [id], onDelete: Cascade) |
| parent | CollabRecord? @relation("LifecycleParent", fields: [parentRecordId], references: [id], onDelete: Restrict) |
| case | Case @relation(fields: [caseId], references: [id], onDelete: Restrict) |
| @@unique([tableId, | caseId]) |
| @@index([parentRecordId]) | — |
| @@map("collab_lifecycle_link") | — |

## WorkflowDefinition

数据库表：`workflow_definition`。

| 字段或约束 | 类型/定义 |
|---|---|
| managedType | String? |
| id | String @id @default(uuid()) |
| name | String |
| draft | Json |
| published | Json? |
| version | Int @default(0) |
| revision | Int @default(1) |
| enabled | Boolean @default(false) |
| createdBy | String |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| instances | WorkflowInstance[] |
| @@map("workflow_definition") | — |

## WorkflowInstance

数据库表：`workflow_instance`。

| 字段或约束 | 类型/定义 |
|---|---|
| businessType | String @default("CUSTOM") |
| decidedBy | String? |
| qualityReview | QualityReview? |
| analysisClose | AnalysisCloseRequest? |
| payrollBatch | PayrollBatch? |
| id | String @id @default(uuid()) |
| definitionId | String |
| definitionVersion | Int |
| title | String |
| snapshot | Json |
| content | Json |
| selections | Json |
| applicantId | String |
| currentNode | String |
| status | String @default("PENDING") |
| version | Int @default(1) |
| visit | Int @default(1) |
| targetRecordId | String? |
| syncStatus | String @default("NONE") |
| syncError | String? |
| requestKey | String @unique |
| requestHash | String |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| finishedAt | DateTime? |
| definition | WorkflowDefinition @relation(fields:[definitionId],references:[id],onDelete:Restrict) |
| tasks | WorkflowTask[] |
| logs | WorkflowLog[] |
| deliveries | WorkflowDelivery[] |
| @@index([applicantId,createdAt]) | — |
| @@index([status,updatedAt]) | — |
| @@map("workflow_instance") | — |

## WorkflowTask

数据库表：`workflow_task`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| instanceId | String |
| nodeId | String |
| visit | Int |
| assigneeId | String |
| status | String @default("PENDING") |
| position | Int @default(0) |
| remark | String? |
| dueAt | DateTime? |
| processedAt | DateTime? |
| createdAt | DateTime @default(now()) |
| instance | WorkflowInstance @relation(fields:[instanceId],references:[id],onDelete:Cascade) |
| @@index([assigneeId,status]) | — |
| @@index([status,dueAt]) | — |
| @@index([instanceId,nodeId,visit]) | — |
| @@map("workflow_task") | — |

## WorkflowLog

数据库表：`workflow_log`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| instanceId | String |
| nodeId | String |
| actorId | String? |
| action | String |
| remark | String? |
| changes | Json? |
| requestKey | String? @unique |
| createdAt | DateTime @default(now()) |
| instance | WorkflowInstance @relation(fields:[instanceId],references:[id],onDelete:Cascade) |
| @@index([instanceId,createdAt]) | — |
| @@map("workflow_log") | — |

## WorkflowDelivery

数据库表：`workflow_delivery`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| instanceId | String |
| hook | String |
| status | String @default("PENDING") |
| attempts | Int @default(0) |
| nextAt | DateTime @default(now()) |
| error | String? |
| createdAt | DateTime @default(now()) |
| instance | WorkflowInstance @relation(fields:[instanceId],references:[id],onDelete:Cascade) |
| @@unique([instanceId,hook]) | — |
| @@index([status,nextAt]) | — |
| @@map("workflow_delivery") | — |

## WorkflowFile

数据库表：`workflow_file`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| ownerId | String |
| name | String |
| mime | String |
| bytes | Bytes |
| createdAt | DateTime @default(now()) |
| @@index([ownerId,createdAt]) | — |
| @@map("workflow_file") | — |

## AnalyticsDashboard

数据库表：`analytics_dashboard`。

| 字段或约束 | 类型/定义 |
|---|---|
| id | String @id @default(uuid()) |
| ownerId | String |
| name | String |
| shared | Boolean @default(false) |
| widgets | Json @default("[]") |
| refreshSeconds | Int @default(0) |
| version | Int @default(1) |
| createdAt | DateTime @default(now()) |
| updatedAt | DateTime @updatedAt |
| @@index([ownerId]) | — |
| @@map("analytics_dashboard") | — |

## 迁移顺序

- `20260712232134_postgresql_baseline`
- `20260715120000_system_bootstrap_trust_root`
- `20260718120000_organization_personnel_expand`
- `20260718180000_employee_assignment_contract`
- `20260718210000_authorization_expand`
- `20260718220000_authorization_contract`
- `20260721120000_admin_governance_expand`
- `20260721230000_identity_security_mfa_step_up`
- `20260722010000_step_up_rate_limit`
- `20260722120000_reliable_event_center`
- `20260722143000_event_dispatch_quarantine`
- `20260723090000_event_worker_runtime_status`
- `20260728090000_lead_crm_customer_expand`
- `20260729090000_leadfollow_updated_by`
- `20260730090000_crm_permission_provision`
- `20260730090002_lead_first_response_subscription_provision`
- `20260730120000_negotiation_contract_payment_expand`
- `20260730150000_contract_permission_provision`
- `20260731090000_contract_template_provision`
- `20260731210000_finance_operations_expand`
- `20260731213000_finance_permission_provision`
- `20260801100000_approval_center_expand`
- `20260801120000_approval_provision`
- `20260802100000_approval_multilevel_expand`
- `20260802110000_approval_multilevel_provision`
- `20260802120000_schema_drift_reconcile`
- `20260805100000_case_permission_provision`
- `20260805110000_case_version_column`
- `20260805120000_performance_provision`
- `20260805130000_case_file`
- `20260805130010_case_file_permission_provision`
- `20260805140000_performance_review`
- `20260805140010_performance_update_provision`
- `20260806100000_permission_provision_gap`
- `20260911090000_organization_manager`
- `20260911160000_organization_sort_unique`
- `20260911180000_approval_materials`
- `20260911193000_master_data_delete_number_reuse`
- `20260911223000_finance_approval_payroll`
- `20260911233000_inventory_management`
- `20260912010000_harness_permissions`
- `20260912020000_cloud_knowledge_label`
- `20260914090000_case_intake`
- `20260914150000_case_delete_permission`
- `20260914170000_customer_delete_permission`
- `20260914220000_collaborative_workspace`
- `20260915040000_collaboration_creator_query_index`
- `20260915050000_collaboration_containment_index`
- `20260915080000_collaboration_resource_access`
- `20260915093000_workspace_position_permissions`
- `20260915103000_workspace_business_extensions`
- `20260915110000_collaboration_synchronous_search_index`
- `20260915120000_cloud_drive_catalog`
- `20260915130000_drive_lifecycle`
- `20260915140000_drive_shortcuts_visits`
- `20260915210000_case_creator_organization`
- `20260915233000_finance_domain_mutation`
- `20260916003000_performance_identity`
- `20260916013000_channel_identity`
- `20260916020000_channel_permission_provision`
- `20260917010000_sop_templates`
- `20260917020000_sop_execution`
- `20260917021000_sop_task_updater`
- `20260917030000_sop_submissions`
- `20260917040000_quality_sampling_issues`
- `20260917050000_quality_analysis_reminders`
- `20260917060000_sop_real_sources`
- `20260919000000_user_password_reset`
- `20260927120000_master_data_deletion`
- `20260927121000_position_delete_permission`
- `20261013090000_collab_module_source`
- `20261016090000_contract_grid_permissions`
- `20261016110000_crm_worksheet_mutations`
- `20261016140000_worksheet_recovery`
- `20261016150000_channel_recovery`
- `20261019090000_delivery_lifecycle`
- `20261019153000_case_intake_standard`
- `20261019154500_case_field_order`
- `20261019160000_case_attachment_fields`
- `20261021090000_finance_worksheet_links`
- `20261022090000_follow_worksheet`
- `20261023090000_module_inventory_worksheets`
- `20261027090000_administrative_seal_review`
- `20261027170000_hr_worksheet_permissions`
- `20261029090000_visual_workflows`
- `20261030103000_unified_approval_engine`
- `20261104090000_comments_calendar`
- `20261104120000_personal_appearance`
- `20261105090000_analytics_dashboards`
