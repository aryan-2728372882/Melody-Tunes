# Vercel Deployment & Auto-Update Guide

This guide explains how to set up automatic deployments from GitHub to Vercel, ensuring your website always has the latest updates.

## What's Been Configured

### 1. **vercel.json** 
- Configures Vercel build settings
- Sets up cache headers to prevent stale content
- HTML files: `Cache-Control: max-age=0, must-revalidate` (always fresh)
- Scripts/Styles: `Cache-Control: max-age=3600` (1 hour cache)
- Assets: `Cache-Control: max-age=31536000, immutable` (1 year cache)

### 2. **service-worker.js Updates**
- Changed HTML files from cache-first to **network-first strategy**
- Always tries to fetch latest HTML from server first
- Falls back to cached version only if offline
- Added cache busting with version timestamps

### 3. **GitHub Actions Workflow**
- Automatically deploys to Vercel when you push to `main` or `master`
- Triggers cache invalidation after deployment
- Located in: `.github/workflows/vercel-deploy.yml`

## Setup Instructions

### Step 1: Verify Vercel Account
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Ensure your repository is connected
3. Note your project name

### Step 2: Get Vercel Tokens

1. **VERCEL_TOKEN**
   - Go to https://vercel.com/account/tokens
   - Click "Create Token"
   - Name it: `GitHub Actions Auto Deploy`
   - Copy the token (you'll need it)

2. **VERCEL_ORG_ID**
   - Go to https://vercel.com/account
   - Find your "Team ID" or "User ID"
   - Copy this value

3. **VERCEL_PROJECT_ID**
   - Go to your project settings in Vercel
   - Find the "Project ID" in the settings page
   - Copy this value

### Step 3: Add Secrets to GitHub

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add three secrets:
   - `VERCEL_TOKEN` = (token from step 2)
   - `VERCEL_ORG_ID` = (org/user ID from step 2)
   - `VERCEL_PROJECT_ID` = (project ID from step 2)

### Step 4: Enable Vercel GitHub Integration (Optional)

1. In Vercel dashboard, go to your project
2. Click **Settings** → **Git**
3. Select **GitHub**
4. Ensure "Deploy on Push" is enabled
5. Select the branch (usually `main` or `master`)

## How It Works Now

```
You make changes locally
        ↓
git add . && git commit && git push
        ↓
GitHub receives push
        ↓
GitHub Actions workflow triggers
        ↓
Automatically deploys to Vercel
        ↓
Cache is invalidated
        ↓
CDN refreshes all nodes
        ↓
Users get latest version immediately
```

## Why Updates Weren't Showing Before

### Issue 1: Browser Caching
- Old cache headers allowed browsers to cache HTML for days
- **Fixed**: HTML now has `max-age=0, must-revalidate`

### Issue 2: Service Worker Caching
- Service worker was using "cache-first" strategy
- **Fixed**: Now uses "network-first" for HTML files

### Issue 3: CDN Caching
- Vercel's CDN wasn't invalidating after deploys
- **Fixed**: Automatic cache invalidation in workflow

### Issue 4: Manual Deployment
- Required manual Vercel redeploy after GitHub push
- **Fixed**: Automatic GitHub Actions workflow

## Testing the Setup

1. Make a small change to `index.html`
2. Commit and push:
   ```bash
   git add .
   git commit -m "test update"
   git push origin main
   ```
3. Go to GitHub Actions → Check the workflow status
4. Visit your Vercel deployment link
5. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
6. You should see the changes immediately

## Manual Deployment (If Needed)

If GitHub Actions fails:
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click on your project
3. Click **Redeploy** button
4. Select the latest commit

## Troubleshooting

### Deployment not triggering?
- Check GitHub Actions tab for errors
- Verify secrets are correctly set in GitHub
- Ensure workflow file is in `.github/workflows/` directory

### Updates still not showing?
```bash
# Force hard refresh in browser
Ctrl+Shift+R (Windows/Linux)
Cmd+Shift+R (Mac)

# Or clear service worker cache:
# Go to DevTools → Application → Service Workers → Unregister
```

### Check Vercel Deployment Status
```bash
# View deployment logs
vercel logs <project-name>

# Or in dashboard, click on recent deployments
```

## Version Management

Update the service worker version when deploying major updates:

In `service-worker.js`, line 3:
```javascript
const CACHE_VERSION = '2025-02-07-v1'; // Update this date
```

This forces cache invalidation for all users.

## Summary

✅ HTML files always fetch fresh from server  
✅ Automatic deployments on every GitHub push  
✅ CDN cache invalidation  
✅ Service Worker uses network-first strategy  
✅ Users always see latest version  
✅ Offline fallback to cached version  

Your website will now stay perfectly updated!
