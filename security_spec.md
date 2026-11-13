# Firestore Security Specification — CIRCLE Workspace Backup

## 1. Data Invariants
1. **Default-Deny Baseline**: Every unspecified document path is strictly denied (`allow read, write: if false`).
2. **Verified Identity**: Only authenticated users with `request.auth.token.email_verified == true` may read or write backup snapshots.
3. **Strict Ownership & Admin Scope**:
   - Every `/workspaceBackups/{backupId}` document MUST bind `ownerUid == request.auth.uid` on creation and preserve `ownerUid` and `createdAt` immutably on update.
   - Only the snapshot owner (`existing().ownerUid == request.auth.uid`) or a verified admin (`isAdmin()`, including bootstrapped admin `bangepunk09@gmail.com` with `email_verified == true`) may read, list, update, or delete backups.
4. **Master Gate on Chunks**: Every `/workspaceBackups/{backupId}/chunks/{chunkId}` operation verifies parent backup ownership via `get(/databases/$(database)/documents/workspaceBackups/$(backupId)).data.ownerUid == request.auth.uid` (or `isAdmin()`), and validates `incoming().backupId == backupId` and `incoming().ownerUid == request.auth.uid`.
5. **No JSON Strings / Native Maps & Lists**: Chunks store native Firestore maps (`payload is map`) and lists without `JSON.stringify`.
6. **Temporal Integrity**: `createdAt == request.time` on create; `updatedAt == request.time` on create and update.

## 2. "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: `request.auth == null` on `/workspaceBackups/bk_1`.
2. **Unverified email spoofing**: `request.auth.token.email == 'bangepunk09@gmail.com'` with `request.auth.token.email_verified == false`.
3. **Identity spoofing on create**: `ownerUid: 'other_user_uid'` when `request.auth.uid == 'attacker_uid'`.
4. **Shadow/ghost field injection on create**: Extra key `isAdmin: true` in `/workspaceBackups/bk_1` (`keys().hasOnly(...)` rejects).
5. **Shadow/ghost field injection on update**: Updating `ownerUid` or `createdAt` alongside `label`.
6. **Oversized document ID poisoning**: `backupId` with 200 characters or invalid symbols (`../bad$id`).
7. **Oversized string poisoning**: `workspaceName` > 120 chars or `label` > 120 chars.
8. **Invalid section enum on chunk**: `section: 'arbitrary_exec'` not in allowlist.
9. **Orphaned chunk / cross-tenant chunk injection**: Writing to `/workspaceBackups/victim_backup/chunks/c_1` where parent `ownerUid != request.auth.uid`.
10. **Client-forged timestamp**: `createdAt: '2026-01-01T00:00:00Z'` instead of `request.time`.
11. **Blanket query scraping**: `list` query on `/workspaceBackups` without `where('ownerUid', '==', uid)` by non-admin.
12. **Privilege escalation on `/admins/{uid}`**: Authenticated non-admin attempting to create `/admins/$(request.auth.uid)`.
