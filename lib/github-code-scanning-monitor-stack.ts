import { 
  Stack, 
  type StackProps, 
  Duration, 
  RemovalPolicy, 
  aws_s3 as s3, 
  aws_codepipeline as codepipeline, 
  aws_codepipeline_actions as actions, 
  aws_codebuild as codebuild, 
  aws_secretsmanager as secretsmanager, 
  aws_cloudwatch as cloudwatch, 
  aws_sns as sns, 
  aws_sns_subscriptions as subscriptions, 
  aws_cloudwatch_actions as cw_actions, 
  CfnOutput, 
  aws_s3_assets as assets,
  aws_events as events,
  aws_events_targets as targets
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface RepoTarget {
  owner: string;
  repo: string;
  branch: string;
}

export interface GithubCodeScanningMonitorStackProps extends StackProps {
  repos: RepoTarget[];
  notificationEmail?: string;
  scheduleExpression?: string;
}

export class GithubCodeScanningMonitorStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubCodeScanningMonitorStackProps) {
    super(scope, id, props);

    const {
      repos,
      notificationEmail,
      scheduleExpression,
    } = props;

    const accountId = Stack.of(this).account;
    const bucketName = /^[0-9]{12}$/.test(accountId) ? `github-scanning-alerts-${accountId}` : undefined;
    const alertsBucket = new s3.Bucket(this, 'AlertsBucket', {
      ...(bucketName ? { bucketName } : {}),
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const githubTokenSecret = new secretsmanager.Secret(this, 'GithubTokenSecret', {
      description: "GitHub PAT for GitHub code scanning monitor",
      secretName: `github-scanning-alerts-${accountId}-github-pat`,
    });

    const metricNamespace = 'GitHub/CodeScanning';
    const metricName = 'NewAlerts';

    let alertTopic: sns.Topic | undefined;
    if (notificationEmail) {
      alertTopic = new sns.Topic(this, 'AlertTopic', {
        displayName: "GitHub Code Scanning Alerts",
      });
      alertTopic.addSubscription(new subscriptions.EmailSubscription(notificationEmail));
    }

    const scannerAsset = new assets.Asset(this, 'ScannerAsset', {
      path: require('node:path').join(__dirname, '..', 'assets', 'scanner'),
    });

    const pipeline = new codepipeline.Pipeline(this, 'GithubAlertMonitorPipeline', {
      pipelineName: "github-code-scanning-monitor",
      pipelineType: codepipeline.PipelineType.V2,
      crossAccountKeys: false,
    });

    const placeholderArtifact = new codepipeline.Artifact('Placeholder');
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new actions.S3SourceAction({
          actionName: 'DummySource',
          bucket: alertsBucket, 
          bucketKey: 'placeholder.zip', 
          output: placeholderArtifact,
          trigger: actions.S3Trigger.NONE,
        }),
      ],
    });

    const scanStage = pipeline.addStage({ stageName: 'ScanRepos' });

    repos.forEach((target, idx) => {
      const { owner, repo, branch } = target;

      const project = new codebuild.PipelineProject(this, `ScanDiffProject_${idx}`, {
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          privileged: false,
        },
        environmentVariables: {
          GITHUB_OWNER: { value: owner },
          GITHUB_REPO: { value: repo },
          GITHUB_BRANCH: { value: branch },
          METRIC_NAMESPACE: { value: metricNamespace },
          METRIC_NAME: { value: metricName },
          ALERTS_OBJECT_KEY: { value: `${owner}/${repo}/latest.json` },
          ALERTS_BUCKET: { value: alertsBucket.bucketName },
          GITHUB_TOKEN: { value: githubTokenSecret.secretArn, type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER },
          SCANNER_BUCKET: { value: scannerAsset.s3BucketName },
          SCANNER_KEY: { value: scannerAsset.s3ObjectKey },
          ...(notificationEmail && alertTopic ? { SNS_TOPIC_ARN: { value: alertTopic.topicArn } } : {}),
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              'runtime-versions': { nodejs: '22' },
              commands: [
                'npm install -g jq',
                'npm install @aws-sdk/client-s3 @aws-sdk/client-cloudwatch @aws-sdk/client-sns undici'
              ]
            },
            pre_build: {
              commands: [
                'echo "Fetching previous alerts (if any)"',
                'aws s3 cp s3://$ALERTS_BUCKET/$ALERTS_OBJECT_KEY old_alerts.json || echo "[]" > old_alerts.json'
              ]
            },
            build: {
              commands: [
                'echo "Downloading scanner script asset"',
                'aws s3 cp s3://$SCANNER_BUCKET/$SCANNER_KEY scanner.mjs'
              ]
            },
            post_build: {
              commands: [
                'node --no-warnings=Experimental scanner.mjs',
                'aws s3 cp /tmp/current-alerts.json s3://$ALERTS_BUCKET/$ALERTS_OBJECT_KEY',
                'echo "Stored latest alerts JSON to S3"'
              ]
            }
          },
          artifacts: {
            files: ['new_alerts.json'],
            discardPaths: 'yes',
          },
        }),
      });

      githubTokenSecret.grantRead(project);
      alertsBucket.grantReadWrite(project);
      scannerAsset.grantRead(project);

      scanStage.addAction(new actions.CodeBuildAction({
        actionName: `${owner}_${repo}`.replace(/[^A-Za-z0-9]/g, '_').slice(0, 50),
        project,
        input: placeholderArtifact,
      }));

      const metric = new cloudwatch.Metric({
        namespace: metricNamespace,
        metricName: metricName,
        period: Duration.minutes(5),
        statistic: 'Maximum',
        dimensionsMap: { Repo: `${owner}/${repo}` },
      });

      const alarm = new cloudwatch.Alarm(this, `NewAlertsAlarm${idx}`, {
        metric,
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `Alarm if new GitHub code scanning alerts are detected for ${owner}/${repo}`,
      });

      if (notificationEmail && alertTopic) {
        alarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));
      }

      new CfnOutput(this, `BuildProjectName${idx}`, { value: project.projectName });
      new CfnOutput(this, `AlarmName${idx}`, { value: alarm.alarmName });
    });

    if (scheduleExpression) {
      const rule = new events.Rule(this, 'PipelineScheduleRule', {
        schedule: events.Schedule.expression(scheduleExpression),
      });
      rule.addTarget(new targets.CodePipeline(pipeline));
    }

    new CfnOutput(this, 'AlertsBucketName', {
      value: alertsBucket.bucketName,
    });
  }
}