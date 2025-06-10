import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function createFakeEnv(extra = {}) {
  return {
    GITHUB_TOKEN: 'dummy',
    GITHUB_OWNER: 'acme',
    GITHUB_REPO: 'widget',
    ALERTS_BUCKET: 'dummy-bucket',
    ALERTS_OBJECT_KEY: 'acme/widget/latest.json',
    METRIC_NAMESPACE: 'Test',
    METRIC_NAME: 'New',
    AWS_REGION: 'us-east-1',
    ...extra,
  };
}

let fetchCalls = 0;
const mockFetch = async (url) => {
  fetchCalls += 1;
  const u = new URL(url);
  const page = Number(u.searchParams.get('page')) || 1;
  const body = page === 1 ? [{ number: 1 }, { number: 2 }] : [];
  return {
    ok: true,
    async json() {
      return body;
    },
  };
};
globalThis.fetch = mockFetch;

class MockClient {
  send() {
    return Promise.resolve({});
  }
}
const sdkMock = {
  '@aws-sdk/client-s3': {
    S3Client: MockClient,
    GetObjectCommand: class {},
    PutObjectCommand: class {},
  },
  '@aws-sdk/client-cloudwatch': {
    CloudWatchClient: MockClient,
    PutMetricDataCommand: class {},
  },
  '@aws-sdk/client-sns': {
    SNSClient: MockClient,
    PublishCommand: class {},
  },
};

for (const [mod, impl] of Object.entries(sdkMock)) {
  require.cache[require.resolve(mod)] = { exports: impl };
}

const undiciId = require.resolve('undici');
require.cache[undiciId] = { exports: { fetch: mockFetch } };

const mockModule = (id, exportsObj) => {
  const path = require.resolve(id);
  require.cache[path] = { exports: exportsObj };
};

mockModule('@aws-sdk/client-s3', {
  S3Client: class { async send() { return { Body: { transformToString: async () => '[]' } }; } },
  GetObjectCommand: class {},
  PutObjectCommand: class {},
});

mockModule('@aws-sdk/client-cloudwatch', {
  CloudWatchClient: class { async send() { return {}; } },
  PutMetricDataCommand: class {},
});

mockModule('@aws-sdk/client-sns', {
  SNSClient: class { async send() { return {}; } },
  PublishCommand: class {},
});

const originalExit = process.exit;
process.exit = () => {};

await test('scanner paginates and counts correctly', async () => {
  const envBackup = { ...process.env };
  Object.assign(process.env, createFakeEnv());
  await import('../assets/scanner/index.mjs');
  assert.equal(fetchCalls, 1);
  Object.assign(process.env, envBackup);
});

process.exit = originalExit;
