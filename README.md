# GitHub Code Scanning Monitor – AWS CDK Stack

A reusable AWS CDK v2 stack that sets up an automated pipeline to monitor GitHub Code Scanning alerts for one **or many** repositories.

When new alerts are detected the stack:

* Publishes a **CloudWatch custom metric** (`GitHub/CodeScanning / NewAlerts`).
* Raises a **CloudWatch alarm** (`<owner>/<repo>-NewAlerts`) when the metric is > 0.
* Optionally notifies an **SNS topic** (and email subscription) with the full alert JSON.
* Persists the latest alerts JSON to a dedicated S3 bucket so every run is diffed against the previous one.

## Prerequisites

* **AWS CDK v2** installed (`npm i -g aws-cdk`)
* AWS account **bootstrapped** for CDK assets – run once per account/region:

```bash
cdk bootstrap aws://<account>/<region>
```

* A **GitHub Access Token** with the `Code scanning alerts` read permission.  ([GitHub docs](https://docs.github.com/en/rest/code-scanning/code-scanning?apiVersion=2022-11-28#list-code-scanning-alerts-for-a-repository--fine-grained-access-tokens))
  After deployment you will store it in the generated Secrets Manager secret.

## Quick-start

### 1. Install dependencies

```bash
pnpm install   # or npm install / yarn install
```

### 2. Deploy the stack

Deploy by supplying parameters via CLI **context** flags (or `cdk.json`):

```bash
pnpm cdk deploy \
  -c repos='[{"owner":"my-org","repo":"service-a","branch":"main"},{"owner":"my-org","repo":"service-b","branch":"main"}]' \
  -c scheduleExpression='rate(1 day)' \
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

The pipeline triggers on the EventBridge schedule.  
You can also **manually release** the pipeline or hook it to an EventBridge schedule if desired.

## How it works

```
┌─────────────┐   (EventBridge schedule)
│ CodePipeline│◀────────────────────────────┐
└─────────────┘                            │
      │ ScanRepos stage (parallel CodeBuild actions – one per repo)
      ▼
┌────────────────────┐
│ CodeBuild project  │→ Fetch old alerts from S3→ GitHub API diff → write metric/alarm → upload latest.json
└────────────────────┘
```

There is **no Source stage**; the build steps call the GitHub REST API directly, so only a placeholder artifact is passed to satisfy CodePipeline’s requirements.

## Stack Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `repos` | `Array<{ owner: string; repo: string; branch: string; }>` | ✓ | Repositories to monitor. |
| `notificationEmail` | `string` |  | Optional email address for SNS notifications. |
| `scheduleExpression` | `string` |  | Optional EventBridge schedule expression that triggers the pipeline. |

## Cleaning up

```bash
pnpm cdk destroy
```

The S3 bucket and secret are retained by default; delete manually if no longer needed.
