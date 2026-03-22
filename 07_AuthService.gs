// ============================================================
// 07_AuthService.gs — SURGICAL EDITS FOR STEP 4
// ============================================================
// These are find-and-replace instructions. Use Ctrl+H in the
// Apps Script editor to apply each one.
//
// EDIT 1: In getUserByEmailCached(), remove the _rowIndex line
//   FIND:
//     if (!user._rowIndex) {
//       user._rowIndex = findUserRowIndex(user.user_id);
//     }
//   REPLACE WITH: (nothing — delete these 3 lines)
//
// EDIT 2: In changePassword(), remove the _rowIndex check
//   FIND:
//     if (!user._rowIndex) {
//       user._rowIndex = findUserRowIndex(userId);
//       if (!user._rowIndex) {
//         return { success: false, error: 'Unable to locate user record for update' };
//       }
//     }
//   REPLACE WITH: (nothing — delete these 5 lines)
//
// EDIT 3: In updateUser(), remove the _rowIndex line
//   FIND:
//     if (!user._rowIndex) {
//       user._rowIndex = findUserRowIndex(userId);
//     }
//   REPLACE WITH: (nothing — delete these 3 lines)
//
// EDIT 4: Delete the findUserRowIndex function entirely
//   FIND:
//     /** Legacy stub - no longer needed in Firestore-only mode */
//     function findUserRowIndex(userId) {
//       return null;
//     }
//   REPLACE WITH: (nothing — delete these 4 lines)
//
// EDIT 5: Delete the updateUserIndex stub at the bottom
//   FIND:
//     /** Legacy stub - no longer needed in Firestore-only mode */
//     function updateUserIndex() {}
//   REPLACE WITH: (nothing — delete these 2 lines)
//
// That's it — 5 deletions, no new code needed.
// After these edits, re-run validateStep4() to confirm CHECK 5 passes.
