# GitHub + Netlify Setup Guide
## Lone Star Command Center

Follow these steps **once** and you'll never lose the site to a drag-and-drop wipe again.

---

## Step 1 — Create a GitHub Account

1. Go to **https://github.com**
2. Click **Sign up**
3. Use your email: `drstutz@fschiro.com`
4. Choose a username (e.g., `lonestar-chiro` or `drstutz`)
5. Complete email verification

---

## Step 2 — Create the Repository

1. After logging in, click the **+** icon (top right) → **New repository**
2. Repository name: `lonestar-command-center`
3. Set to **Private** (recommended for internal tools)
4. Check **"Add a README file"**
5. Click **Create repository**

---

## Step 3 — Upload the Files

1. Inside your new repo, click **Add file** → **Upload files**
2. Drag and drop ALL of these files at once:
   - `index.html`
   - `maddy-cc-v2.html`
   - `sabrina-cc-v2.html`
   - `drstutz-cc-v2.html`
   - `d1-recon.html`
   - `_redirects`
3. In the **"Commit changes"** section at the bottom, type: `Initial site upload`
4. Click **Commit changes**

---

## Step 4 — Connect GitHub to Netlify

1. Go to **https://app.netlify.com** and log in
2. In the top nav, click your site name or go to **Sites**
3. Find **lonestarcommand** and click it
4. Go to **Site configuration** → **Build & deploy** → **Continuous deployment**
5. Click **Link to Git provider** → choose **GitHub**
6. Authorize Netlify to access your GitHub account
7. Search for and select `lonestar-command-center`
8. Settings:
   - **Branch to deploy:** `main`
   - **Build command:** *(leave blank)*
   - **Publish directory:** `/` (or leave blank)
9. Click **Deploy site**

---

## Step 5 — Verify It Works

1. Netlify will auto-deploy. Wait ~30 seconds.
2. Visit **https://lonestarcommand.netlify.app** — you should see the homepage.
3. Test each route:
   - `/maddy-cc-v2`
   - `/sabrina-cc-v2`
   - `/drstutz-cc-v2`
   - `/d1-recon`

---

## Going Forward — How to Update the Site

Whenever you need to update a page:

1. Go to your GitHub repo
2. Click the file you want to update
3. Click the **pencil (edit) icon**
4. Make your changes and click **Commit changes**
5. Netlify will auto-deploy within ~30 seconds

**No more drag-and-drop. No more accidental wipes.**

---

## If Something Goes Wrong

- Netlify deploy logs: **app.netlify.com → your site → Deploys**
- To roll back to a previous version: click any past deploy → **Publish deploy**
