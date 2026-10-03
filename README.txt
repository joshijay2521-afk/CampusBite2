CAMPUSBITE — HOSTING READY
==========================

This package contains the polished CampusBite storefront + admin dashboard.

LOCAL TEST
----------
1. Install Node.js 18+ (22 LTS recommended).
2. Open this folder in a terminal.
3. Run: npm install
4. Run: npm start
5. Open the URL printed in the terminal (usually http://localhost:3001).
6. Admin: add /admin to that same URL.

Default local admin login:
Username: admin
Password: set ADMIN_PASSWORD in your environment

IMPORTANT: change the admin login before making the store public.

PUBLIC HOSTING / PERSISTENT DATA
--------------------------------
The app supports PostgreSQL automatically when DATABASE_URL is present.
This is the recommended mode for a real public store because orders, stock,
chat and banner settings should not depend on a server's temporary disk.

Set these environment variables on your host:
DATABASE_URL=your PostgreSQL connection string
ADMIN_USERNAME=your initial admin username
ADMIN_PASSWORD=your initial admin password

On first start, CampusBite creates its tables automatically and imports the
included JSON seed data if the database is empty.

If DATABASE_URL is not set, the app uses ./data/*.json. This mode is excellent
for local testing and for hosting plans with a genuinely persistent disk, but
it should NOT be used as the only storage on an ephemeral/free web service.

RENDER
------
Build command: npm install
Start command: npm start
Health check: /api/health
The included render.yaml already contains these settings.
Render web services must listen on 0.0.0.0 and the platform supplies PORT;
this package does that automatically.

SUPABASE / OTHER POSTGRES
--------------------------
Use a PostgreSQL connection string from your provider as DATABASE_URL.
For Supabase, use the connection string from the project's Connect panel.
No frontend database key is needed because database access stays on the server.

FEATURES INCLUDED
-----------------
• Colorful CampusBite storefront
• Responsive mobile layout
• Product categories and search suggestions
• Cart and quantity controls
• COD checkout
• Automatic stock deduction
• Admin-controlled delivery ON/OFF, delivery fee and free-delivery threshold
• Admin coupon create/edit/activate/pause/delete with percentage or fixed discounts
• Coupon minimum order, maximum discount, usage limit and expiry controls
• Product MRP + sale price discount controls; discounts can be removed
• Order IDs and order timeline
• Order tracking by order ID + phone
• My Orders history
• Customer ↔ admin chat
• Admin dashboard
• Product/stock management
• Banner upload + text ON/OFF + preview
• Admin username/password change
• Login sessions with expiry
• Basic rate limiting and input limits
• Health endpoint for hosting
• PostgreSQL persistence when DATABASE_URL is configured
• JSON fallback for local testing

BEFORE REAL LAUNCH
------------------
1. Change the admin credentials.
2. Configure DATABASE_URL and verify persistence with a test order.
3. Test checkout, stock, status updates, chat and banner upload on the live URL.
4. Keep the database connection string only in hosting environment variables.
5. Confirm your college's permission and applicable food/business requirements.
6. Start with COD; add a payment gateway only when you are ready for the
   required merchant/KYC/compliance setup.

BACKUP
------
For PostgreSQL mode, back up the database using your provider's backup/export
features. For local JSON mode, back up the data folder.

The project intentionally does not store payment-card data.


GITHUB — ONE-CLICK UPLOAD
-------------------------
The file PUSH_TO_GITHUB.bat is included specifically for the existing
repository:
https://github.com/joshijay2521-afk/CampusBite

Open this project folder and double-click PUSH_TO_GITHUB.bat.
It initializes Git, sets the correct repository, commits the files, and
pushes them to the main branch. You do NOT need to type the Git commands
manually.

If GitHub opens a sign-in/authentication prompt, complete it and run the
BAT file again if necessary.

IMPORTANT
---------
Keep this folder structure exactly as it is. The folder you open in VS Code
must be the one where server.js, package.json, public, and data are visible.


BOOTSTRAP ADMIN (change after first login)
Username: admin
Password: CampusBite@2026!
Use Admin → Admin Login to change these credentials after deployment.


FINAL V4 NOTES
- Existing Supabase database/data is preserved.
- Admin recovery uses ADMIN_USERNAME/ADMIN_PASSWORD only when bootstrapMigrated is false, then stores a password hash in the database.
- Permanent order deletion is allowed only for Delivered or Cancelled orders, enforced on the server.
- Permanent product deletion is admin-authenticated.
- Netlify requires the real Render service hostname in netlify.toml before deployment.
