# Maker Deploy Template

## Purpose
Deployment configuration and CI/CD setup.

## Variables
- `{{platform}}` — Target platform (Vercel, Railway, AWS, etc.)
- `{{app_type}}` — Type of app (web, API, static, etc.)
- `{{needs}}` — Special requirements (database, cron jobs, etc.)

## Response Structure

### 1. Platform-Specific Setup
Step-by-step instructions for the chosen platform.

### 2. Configuration Files
All necessary config files (Dockerfile, vercel.json, etc.)

### 3. Environment Variables
What needs to be set.

### 4. CI/CD Pipeline
GitHub Actions or similar configuration.

### Example: Next.js on Vercel

**Setup:**
```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Link project
vercel

# 3. Deploy
vercel --prod
```

**Configuration:**
```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm ci",
  "env": {
    "NEXT_PUBLIC_API_URL": "https://api.example.com"
  }
}
```

**Environment Variables:**
```
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=your-secret-here
NEXT_PUBLIC_APP_URL=https://yourapp.vercel.app
```

**CI/CD:**
```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
          vercel-args: '--prod'
```
