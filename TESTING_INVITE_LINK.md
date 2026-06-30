# Testing the Invite Link Feature

## Setup

The local environment is already running:
- Backend: http://localhost:3000
- Frontend: http://localhost:5173

## Test Flow

### 1. Login as Admin

Navigate to http://localhost:5173 and login with admin credentials:
- Email: `admin@plato.dev`
- Password: `admin123`

### 2. Access Invite Users Modal

1. Click on "Users" in the admin navigation
2. Click the "Invite Users" button (top right)
3. You should see tabs: "Email", "Link" (and "Slack" if plugin is connected)

### 3. Test Link Tab - No Link Exists

Click the "Link" tab. You should see:
- Description: "Create a shareable invite link that anyone can use to sign up. The link expires after 7 days and can be regenerated anytime."
- **Security warning** (amber border): "Anyone with this link can create an account. Only share it in trusted channels."
- Button: "Generate Invite Link"

### 4. Generate Link

1. Click "Generate Invite Link"
2. The UI should update to show:
   - **Shareable Invite Link** input (read-only) with the full URL
   - **Copy button** next to the URL
   - **Usage stats**:
     - Created: [today's date]
     - Used by: 0 people
     - Expires: [7 days from now]
   - **Security warning** (same amber border)
   - **Actions**: "Delete Link" and "Regenerate Link" buttons

### 5. Test Copy Button

1. Click "Copy"
2. Button should change to "Copied!" for 2 seconds
3. Paste into a text editor to verify the URL copied correctly
   - Should be: `http://localhost:5173/signup?token=inv_[random string]`

### 6. Test Signup Flow

1. **Open an incognito window** or different browser
2. Paste the copied URL into the address bar
3. The signup form should appear with fields:
   - **Email** (new field!)
   - Name
   - Username (optional)
   - Password
   - Confirm password
4. Fill out the form with:
   - Email: `testuser@example.com`
   - Name: `Test User`
   - Password: `testpass123`
   - Confirm: `testpass123`
5. Click "Create account"
6. You should be auto-logged in and redirected to `/lessons`

### 7. Verify Usage Count

1. Go back to the admin window
2. Close and reopen the Invite Users modal (or refresh the page and reopen it)
3. Go to the Link tab
4. **Used by** should now show: **1 person**

### 8. Test Multiple Signups

Repeat step 6 with different emails:
- `testuser2@example.com`
- `testuser3@example.com`

Each time, the usage count should increment.

### 9. Test Regenerate Link

1. In the admin window, Link tab, click "Regenerate Link"
2. Confirm the dialog: "Regenerate invite link? The old link will stop working."
3. A new link should appear (different token)
4. Usage count should reset to 0

### 10. Test Old Link is Revoked

1. Try to use the **old link** (from step 5) in an incognito window
2. Signup should **fail** with "Invalid or expired invite"

### 11. Test Delete Link

1. In the admin window, Link tab, click "Delete Link"
2. Confirm the dialog: "Delete invite link? This cannot be undone."
3. UI should show the "no link" state again (back to step 3)

### 12. Test Email Required

1. Generate a new link
2. Open the signup URL in incognito
3. Try to submit the form **without entering an email**
4. Should show error: "Email, name and password are required."

## Expected Behavior Summary

✅ **Security**
- Links expire after 7 days (check expiry date)
- Old links stop working after regenerate
- Deleted links are immediately revoked
- Email is always required at signup (no anonymous accounts)
- Clear warnings about sharing risks

✅ **Functionality**
- Only one link can exist at a time
- Copy button works
- Usage count increments on each signup
- Any email address can be used (vs email invites that must match)
- Regenerate creates a new link and resets count
- Delete removes the link completely

✅ **UX**
- Tab is always visible (even without Slack plugin)
- Loading states on buttons ("Generating...", "Regenerating...")
- Copy button feedback ("Copied!")
- Confirmation dialogs for destructive actions
- Clear date formatting for created/expiry dates

## Code Quality Checks

✅ **Tests**: All 352 tests passing (`npm test`)
✅ **Documentation**: Added invite system section to `docs/ARCHITECTURE.md`
✅ **Accessibility**: Tabs have `aria-label`, buttons have proper labels
✅ **Security**: Audit logging for create/regenerate/delete operations
✅ **No breaking changes**: Existing email invites work unchanged

## Known Limitations

- No usage limit (maxUsages currently null/unlimited)
- No domain whitelist (any email domain accepted)
- One link per organization (not multiple labeled links)

These are intentional design decisions for v1 and can be extended later.
