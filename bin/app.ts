#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { GithubCodeScanningMonitorStack } from '../lib/github-code-scanning-monitor-stack';

const app = new App();

new GithubCodeScanningMonitorStack(app, 'GithubCodeScanningMonitorStack', {
  githubOwner: app.node.tryGetContext('githubOwner') || 'my-org',
  githubRepo: app.node.tryGetContext('githubRepo') || 'my-repo',
  githubBranch: app.node.tryGetContext('githubBranch') || 'main',
  codestarConnectionArn: app.node.tryGetContext('codestarConnectionArn') || 'arn:aws:codestar-connections:region:account-id:connection/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
});
