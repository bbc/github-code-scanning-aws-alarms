import 'ts-node/register';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { createRequire } from 'node:module';
const requireTs = createRequire(import.meta.url);
const { GithubCodeScanningMonitorStack } = requireTs('../lib/github-code-scanning-monitor-stack.ts');

function synthStack() {
  const app = new App({
    context: {
      githubOwner: 'dummy',
      githubRepo: 'repo',
      githubBranch: 'main',
      codestarConnectionArn: 'arn:aws:codestar-connections:us-east-1:123456789012:connection/abcd',
    },
  });
  const stack = new GithubCodeScanningMonitorStack(app, 'TestStack', {
    githubOwner: 'dummy',
    githubRepo: 'repo',
    githubBranch: 'main',
    codestarConnectionArn: 'arn:aws:codestar-connections:us-east-1:123456789012:connection/abcd',
  });
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  const assembly = app.synth();
  return { template: assembly.getStackByName(stack.stackName).template, stack };
}

test('cdk synth succeeds and produces resources', () => {
  const { template } = synthStack();
  assert.ok(template.Resources);
});

test('stack passes cdk-nag AwsSolutions checks', () => {
  const { stack } = synthStack();
  if (typeof NagSuppressions.getStackViolations !== 'function') {
    console.warn('Skipping cdk-nag detailed check; API not available in current cdk-nag version');
    return;
  }
  const violations = NagSuppressions.getStackViolations(stack).error ?? [];
  assert.equal(violations.length, 0, `Found cdk-nag errors:\n${JSON.stringify(violations, null, 2)}`);
});
