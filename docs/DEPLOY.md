# Deploying plato to AWS

This guide covers production deployment to AWS via SAM, optional CI/CD from a private fork, custom domain setup, and backup procedures.

For a quick local development setup, see the [main README](../README.md#quick-start).

## Prerequisites

- AWS SAM CLI
- An AWS account with permissions for Lambda, DynamoDB, API Gateway, IAM, S3, and SES
- A verified SES sender email/domain
- An Anthropic API key or Amazon Bedrock access

## 1. SSM parameters

Create these in AWS Systems Manager Parameter Store before deploying. Replace `{stage}` with your stage name (e.g., `prod`, `playground`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `/plato/{stage}/jwt-secret` | SecureString | JWT signing secret |
| `/plato/{stage}/ses-from-email` | String | Verified SES sender email |
| `/plato/{stage}/app-url` | String | Public URL (for invite/reset links) |
| `/plato/{stage}/admin-email` | String | Bootstrap admin email (optional — setup UI handles this) |
| `/plato/{stage}/admin-password` | SecureString | Bootstrap admin password (optional) |

## 2. Configure SAM

Copy the example config and customize it for your AWS account:

```bash
cd server
cp samconfig.toml.example samconfig.toml
# Edit samconfig.toml — set your region, stack name, and AWS profile
```

`samconfig.toml` is gitignored so your local config stays out of version control.

## 3. Deploy manually

```bash
# Build client
cd client && npm ci && npm run build && cd ..

# Build server
cd server && sam build

# Bundle client SPA into Lambda artifacts
cp -r ../client/dist .aws-sam/build/PlatoStreamFunction/client-dist
cp -r ../client/dist .aws-sam/build/PlatoApiFunction/client-dist

# Bundle content source files (prompts, lessons) for seeding
mkdir -p .aws-sam/build/PlatoApiFunction/client-content .aws-sam/build/PlatoStreamFunction/client-content
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoApiFunction/client-content/
cp -r ../client/prompts ../client/data .aws-sam/build/PlatoStreamFunction/client-content/

# Generate version.json from the latest Beta-RC-* tag
VERSION=$(git describe --tags --abbrev=0 --match='Beta-RC-*' 2>/dev/null || echo 'Beta-RC-0')
echo "{\"version\":\"${VERSION}\"}" > .aws-sam/build/PlatoApiFunction/version.json
cp .aws-sam/build/PlatoApiFunction/version.json .aws-sam/build/PlatoStreamFunction/version.json

# Deploy (default stage is prod)
sam deploy
# Or deploy a specific stage
sam deploy --parameter-overrides Stage=playground --stack-name plato-playground
```

The `Stage` parameter controls DynamoDB table name prefixes and SSM parameter paths. See `server/template.yaml` for the full infrastructure definition.

## 4. Set up CI/CD (recommended)

For production deployments, we recommend automating deploys from a **private fork** via GitHub Actions. This keeps your AWS credentials and deploy config out of the public repo. The flow here uses `repository_dispatch`: pushing to the public repo fires a dispatch event to the private fork, which runs the actual deploy. No manual pushing to the deploy remote, and the deploy workflows never need to exist in the public repo.

**Create a private fork:**

```bash
gh repo fork 1111philo/plato --fork-name my-plato --org my-org --clone=false
gh repo edit my-org/my-plato --visibility private --accept-visibility-change-consequences
```

**Set up OIDC authentication** (no static AWS keys needed):

1. Ensure your AWS account has a GitHub OIDC provider (one-time setup):
   ```bash
   aws iam create-open-id-connect-provider \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com \
     --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
   ```

2. Create an IAM role that GitHub Actions can assume. The trust policy should allow your private fork repo:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": {
         "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
       },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
         "StringLike": { "token.actions.githubusercontent.com:sub": "repo:my-org/my-plato:*" }
       }
     }]
   }
   ```

3. Attach a permissions policy to the role with access to CloudFormation, Lambda, S3, API Gateway, DynamoDB, IAM (for role creation), and SSM (parameter reads).

**Create a dispatch token:** In GitHub, generate a fine-grained personal access token with `contents:write` permission scoped to your private fork. Add it to the **public repo** as a secret named `DEPLOY_DISPATCH_TOKEN`. The public repo's trigger workflow uses this token to fire dispatch events at the private fork.

**The trigger workflow** lives in the public repo at `.github/workflows/trigger-deploy.yml` (already included in this project). On push to `main` or `playground`, it fires a `deploy-prod` or `deploy-playground` `repository_dispatch` event at the private fork with the commit SHA as payload.

**Add a deploy workflow** to your private fork at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to AWS

on:
  repository_dispatch:
    types: [deploy-prod]
  workflow_dispatch:
    inputs:
      ref:
        description: 'Ref on the public repo to deploy (branch / tag / SHA)'
        required: false
        default: 'main'

env:
  SOURCE_REPO: my-org/my-plato-source  # your public repo
  SOURCE_REF: ${{ github.event.client_payload.sha || inputs.ref || 'main' }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: ${{ env.SOURCE_REPO }}
          ref: ${{ env.SOURCE_REF }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: cd server && npm ci && npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          repository: ${{ env.SOURCE_REPO }}
          ref: ${{ env.SOURCE_REF }}
          fetch-depth: 0  # need history + tags so we can read the latest Beta-RC-* tag
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: aws-actions/setup-sam@v2
        with:
          use-installer: true
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_DEPLOY_ROLE
          aws-region: YOUR_REGION
      - run: cd client && npm ci && npm run build
      - run: cd server && sam build
      - run: |
          cp -r client/dist server/.aws-sam/build/PlatoApiFunction/client-dist
          cp -r client/dist server/.aws-sam/build/PlatoStreamFunction/client-dist
      - run: |
          mkdir -p server/.aws-sam/build/PlatoApiFunction/client-content server/.aws-sam/build/PlatoStreamFunction/client-content
          cp -r client/prompts client/data server/.aws-sam/build/PlatoApiFunction/client-content/
          cp -r client/prompts client/data server/.aws-sam/build/PlatoStreamFunction/client-content/
      - name: Generate version.json from latest tag
        run: |
          VERSION=$(git describe --tags --abbrev=0 --match='Beta-RC-*' 2>/dev/null || echo 'Beta-RC-0')
          echo "{\"version\":\"${VERSION}\"}" > server/.aws-sam/build/PlatoApiFunction/version.json
          cp server/.aws-sam/build/PlatoApiFunction/version.json server/.aws-sam/build/PlatoStreamFunction/version.json
      - run: >
          cd server && sam deploy
          --config-env ci
          --stack-name plato
          --region YOUR_REGION
          --s3-bucket YOUR_SAM_S3_BUCKET
          --s3-prefix plato
          --capabilities CAPABILITY_IAM
          --no-confirm-changeset
          --no-fail-on-empty-changeset
          --parameter-overrides Stage=prod
```

Replace `YOUR_ACCOUNT_ID`, `YOUR_DEPLOY_ROLE`, `YOUR_REGION`, `YOUR_SAM_S3_BUCKET`, and `SOURCE_REPO` with your values. The S3 bucket is the one SAM creates on first manual deploy (named `aws-sam-cli-managed-default-samclisourcebucket-*`).

**Pre-deploy backups:** Add a step before `sam deploy` to back up your DynamoDB tables. For example, loop over your table names and call `aws dynamodb create-backup` for each, then prune old backups (keeping the last 5 per table).

**Multiple environments:** For a staging environment (e.g., `playground`), add a second workflow to the private fork that listens on `repository_dispatch` type `deploy-playground` and deploys with `--stack-name plato-playground --parameter-overrides Stage=playground`. Each stage gets its own DynamoDB tables and SSM parameters. The trigger workflow in the public repo already fires `deploy-playground` on push to the `playground` branch.

**Workflow:** Push or merge to the public repo's `main` or `playground` — the trigger workflow fires the dispatch, the private fork's deploy workflow picks it up, checks out the public repo at that SHA, runs tests, and deploys. Tests run first — deploy only happens if they pass. For re-deploying a specific SHA manually, use `workflow_dispatch` on the private fork's deploy workflow with an optional `ref` input.

## Custom domain (optional)

To serve the app from a custom domain:

1. Create a CloudFront distribution with the Lambda Function URL as a **Custom Origin** (HTTPS-only)
2. Set the Origin Request Policy to **AllViewerExceptHostHeader** (required for Lambda Function URLs)
3. Set the Cache Policy to **CachingDisabled** (the Lambda handles caching headers)
4. Add your domain as a CloudFront alternate domain name and attach an ACM certificate (must be in us-east-1)
5. Point your DNS (CNAME or alias) to the CloudFront distribution domain

## Backups

Production DynamoDB tables are protected by two backup layers:

- **Point-in-Time Recovery (PITR)** — enabled on all 5 prod tables, allowing restore to any second in the last 35 days. Handles accidental deletes, data corruption, or bugs discovered after the fact.
- **Pre-deploy snapshots** — the CI/CD deploy workflow automatically creates on-demand backups of all prod tables before each deploy. Old backups are pruned to keep the last 5 per table. These provide named restore points tied to specific deploys.

To restore from a pre-deploy snapshot, use the AWS Console (DynamoDB > Backups) or the CLI:

```bash
aws dynamodb restore-table-from-backup \
  --target-table-name plato-users-restored \
  --backup-arn arn:aws:dynamodb:us-east-2:ACCOUNT:table/plato-users/backup/BACKUP_ID
```

To restore from PITR:

```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name plato-users \
  --target-table-name plato-users-restored \
  --restore-date-time 2026-04-01T12:00:00Z
```

In both cases, DynamoDB restores to a new table — rename or swap as needed.
