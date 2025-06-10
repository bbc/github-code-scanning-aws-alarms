# GitHub Code Scanning Monitor – AWS CDK Stack

A reusable AWS CDK v2 stack that sets up an automated pipeline to monitor GitHub Code Scanning alerts for any repository.  
When new alerts are detected the stack:

* Publishes a **CloudWatch custom metric** (`GitHub/CodeScanning / NewAlerts`).
* Raises a **CloudWatch alarm** (name: `<repo>-NewAlerts`) when the metric is > 0.
* Optionally notifies an **SNS topic** (and email subscription) with the full alert JSON.
* Persists the latest alerts JSON to a dedicated S3 bucket so every run is diffed against the previous one.

## Prerequisites

* **AWS CDK v2** installed (`npm i -g aws-cdk`)
* AWS account **bootstrapped** for CDK assets – run once per account/region:

```bash
cdk bootstrap aws://<account>/<region>
```

* A **GitHub CodeStar Connection** created in the AWS Console.  
  Note the **connection ARN** – you will pass this to the stack.
* A **GitHub Access Token** with the `Code scanning alerts` read permission.  ([GitHub docs](https://docs.github.com/en/rest/code-scanning/code-scanning?apiVersion=2022-11-28#list-code-scanning-alerts-for-a-repository--fine-grained-access-tokens))
  After deployment you will store it in the generated Secrets Manager secret.

## Quick Start

### 1. Install dependencies

```bash
pnpm install   # or npm install / yarn install
```

### 2. Deploy the stack

Deploy by supplying parameters via CLI **context** flags (or `cdk.json`):

> *Note*: The `scheduleExpression` parameter is optional.  If provided the pipeline will be triggered on this schedule in addition to the normal CodeStar source trigger. The `notificationEmail` parameter is also optional. If provided an SNS topic will be created and an email subscription will be added.

```bash
pnpm cdk deploy \
  -c scheduleExpression='rate(1 day)' \
  -c githubOwner=my-org \
  -c githubRepo=my-repo \
  -c githubBranch=main \
  -c codestarConnectionArn=arn:aws:codestar-connections:us-east-1:123456789012:connection/abcd1234 \
  -c notificationEmail=security@my-org.com
```

You can also run `pnpm cdk synth` first to inspect the generated CloudFormation template.

### 3. Populate the secret

After deploy, locate the **Secrets Manager secret** named:

```
github-scanning-alerts-<accountId>-github-pat
```

Put your PAT value in the secret (plain text).  The pipeline’s next run will pick it up.

### 4. Trigger the pipeline / schedule

The CodePipeline triggers on pushed commits to the specified branch.  
You can also **manually release** the pipeline or hook it to an EventBridge schedule if desired.

## How it works

| Stage | Details |
|-------|---------|
| **Source** | Pulls the repository via CodeStar Connection. |
| **ScanComparison** | CodeBuild downloads a packaged `scanner.mjs` asset, installs AWS SDK v3 deps, fetches alerts via GitHub API, diffs against `s3://github-scanning-alerts-<accountId>/<org>/<repo>/latest.json`. Writes new metric & uploads fresh JSON. |
| **Alarm & Notifications** | `NewAlerts` CloudWatch alarm evaluates the custom metric; if > 0 it and/or the build step publish to the SNS topic. |

## Cleaning up

```bash
pnpm cdk destroy
```

The S3 bucket and secret are retained by default (for audit).  Delete them manually if you no longer need the data.

## Stack Props Reference

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `githubOwner` | `string` | ✓ | GitHub organisation/user. |
| `githubRepo` | `string` | ✓ | Repository name. |
| `githubBranch` | `string` | ✓ | Branch to monitor (e.g. `main`). |
| `codestarConnectionArn` | `string` | ✓ | Existing AWS CodeStar connection ARN for GitHub. |
| `notificationEmail` | `string` |  | Optional email address for SNS notifications. |
| `scheduleExpression` | `string` |  | Optional EventBridge schedule expression for pipeline. |

