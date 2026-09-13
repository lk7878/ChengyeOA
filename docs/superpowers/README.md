# Superpowers Engineering Records

This directory holds the approved engineering decisions and operator records for Chengye OA.

| Area | Authoritative record |
| --- | --- |
| 云端服务与 Windows 客户端部署规格（文档已完善，部署待实施） | [SPEC-DEPLOY-20260914](specs/2026-09-14-production-deployment.md) |
| 部署分阶段计划及验收 | [P0～P3 部署计划](plans/2026-09-14-production-deployment.md) |
| Implemented baseline | `specs/2026-07-12-engineering-baseline-postgresql-migration-design.md` |
| Approved SPEC-002 design | `specs/2026-07-15-system-bootstrap-super-admin-trust-root-design.md` |
| Approved SPEC-003 organization and personnel design | `specs/2026-07-18-organization-personnel-master-data-design.md` |
| SPEC-003 implementation plan | `plans/2026-07-18-organization-personnel-master-data-implementation.md` |
| Approved SPEC-004 authorization design | `specs/2026-07-18-rbac-data-scope-sensitive-permissions-design.md` |
| SPEC-004 implementation plan | `plans/2026-07-18-rbac-data-scope-sensitive-permissions-implementation.md` |
| Approved SPEC-005 administrator governance design | `specs/2026-07-21-admin-governance-super-admin-review-design.md` |
| SPEC-005 implementation plan | `plans/2026-07-21-admin-governance-super-admin-review-implementation.md` |
| SPEC-005 operations | `runbooks/admin-governance-super-admin-review.md` |
| SPEC-005 closeout evidence | `reports/spec-005-closeout.md` |
| Cross-device migration handoff | `handoffs/2026-07-21-cross-device-migration-handoff.md` |
| SPEC-004 restart handoff | `handoffs/2026-07-19-spec-004-authorization-handoff.md` |
| SPEC-004 operations | `runbooks/rbac-data-scope-sensitive-permissions.md` |
| SPEC-004 closeout evidence | `reports/spec-004-closeout.md` |
| SPEC-003 restart handoff | `handoffs/2026-07-18-spec-003-organization-personnel-handoff.md` |
| SPEC-003 operations | `runbooks/organization-personnel-master-data.md` |
| SPEC-003 closeout evidence | `reports/spec-003-closeout.md` |
| Approved SEC-SPEC-001 dependency security design | `specs/2026-07-16-dependency-security-supply-chain-governance-design.md` |
| SEC-SPEC-001 implementation plan | `plans/2026-07-16-dependency-security-supply-chain-governance-implementation.md` |
| SEC-SPEC-001 closeout evidence | `reports/sec-spec-001-closeout.md` |
| SPEC-002 implementation plan | `plans/2026-07-15-system-bootstrap-super-admin-trust-root-implementation.md` |
| Completed implementation plan | `plans/2026-07-14-empty-postgresql-baseline-implementation.md` |
| Closeout evidence | `reports/spec-001-closeout.md` |
| Repository boundary | `adr/0001-project-repository-boundary.md` |
| Database boundary | `adr/0002-postgresql-and-canonical-prisma.md` |
| Local setup | `runbooks/local-development.md` |
| Backup and restore | `runbooks/postgresql-backup-restore.md` |
| System bootstrap and super-admin recovery | `runbooks/system-bootstrap-and-super-admin-recovery.md` |
| Dependency security operations | `runbooks/dependency-security.md` |
| Historical source audit | `runbooks/sqlite-to-postgresql-migration.md` |

SPEC-001, SPEC-002, SPEC-003, SPEC-004, SPEC-005, and SEC-SPEC-001 local implementation and acceptance are complete. Remote CI execution, including the independent dependency-security job, and Inno Setup installer compilation remain release gates and are not recorded as passed.

Never commit local environment files, database artifacts, backup files, audit exports, logs, or generated distributions.

历史 V1.1.0 本机智能化集成：规格 specs/2026-09-12-harness-integration.md；实施验收 plans/2026-09-12-harness-integration.md。最新部署目标见上表及[统一桌面规格](specs/2026-09-13-unified-desktop-local-harness.md)：OA 当前显示 V1.2.1，统一桌面目标 V1.3.0 尚未完整交付，不能以历史版本说明推断生产就绪。
