import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { fetch } from 'undici';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

async function main() {
  const {
    GITHUB_TOKEN,
    GITHUB_OWNER,
    GITHUB_REPO,
    ALERTS_BUCKET,
    ALERTS_OBJECT_KEY,
    METRIC_NAMESPACE,
    METRIC_NAME,
    SNS_TOPIC_ARN,
    AWS_REGION,
  } = process.env;

  if (!GITHUB_TOKEN) {
    throw new Error('Missing GITHUB_TOKEN');
  }

  const s3 = new S3Client({ region: AWS_REGION });
  const cw = new CloudWatchClient({ region: AWS_REGION });
  const sns = new SNSClient({ region: AWS_REGION });

  let previousAlerts = [];
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: ALERTS_BUCKET, Key: ALERTS_OBJECT_KEY })
    );
    const body = await obj.Body.transformToString();
    previousAlerts = JSON.parse(body);
  } catch (_) {
    // ignore not found
  }

  const headers = {
    Authorization: `token ${GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  };

  const currentAlerts = [];
  let page = 1;
  while (true) {
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/code-scanning/alerts?state=open&per_page=100&page=${page}`;
    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}`);
    }
    const batch = await res.json();
    currentAlerts.push(...batch);
    if (batch.length < 100) {
      break;
    }
    page += 1;
  }

  const oldIds = new Set(previousAlerts.map((a) => a.number));
  const newAlerts = currentAlerts.filter((a) => !oldIds.has(a.number));

  await cw.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: [
        { MetricName: METRIC_NAME, Value: newAlerts.length, Unit: 'Count' },
      ],
    })
  );

  if (newAlerts.length > 0 && SNS_TOPIC_ARN) {
    const msg = {
      default: JSON.stringify(newAlerts, null, 2),
      email: `${newAlerts.length} new alerts in ${GITHUB_OWNER}/${GITHUB_REPO}`,
    };
    await sns.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: `GitHub Code Scanning Alerts - ${GITHUB_OWNER}/${GITHUB_REPO}`,
        Message: JSON.stringify(msg),
        MessageStructure: 'json',
      })
    );
  }

  const tmpFile = '/tmp/current-alerts.json';
  await writeFile(tmpFile, JSON.stringify(currentAlerts, null, 2));
  await s3.send(
    new PutObjectCommand({
      Bucket: ALERTS_BUCKET,
      Key: ALERTS_OBJECT_KEY,
      Body: await readFile(tmpFile),
    })
  );

  console.log(`Completed scan. Total: ${currentAlerts.length}, new: ${newAlerts.length}`);
}

main().catch((err) => {
  console.error('Scanner error', err);
  process.exit(1);
});
