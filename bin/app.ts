#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { GithubCodeScanningMonitorStack } from '../lib/github-code-scanning-monitor-stack';

const app = new App();

new GithubCodeScanningMonitorStack(app, 'GithubCodeScanningMonitorStack', {
  repos: app.node.tryGetContext('repos') || [
    {
      owner: 'bbc',
      repo: 'github-code-scanning-aws-alarms',
      branch: 'main',
    }
  ],
  notificationEmail: app.node.tryGetContext('notificationEmail'),
  scheduleExpression: app.node.tryGetContext('scheduleExpression'),
});
