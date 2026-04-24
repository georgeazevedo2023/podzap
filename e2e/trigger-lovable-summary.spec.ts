import { test, expect } from './fixtures';

test('trigger summary for Mestres do Lovable via API', async ({
  authedPage: page,
}) => {
  test.setTimeout(60_000);
  const groupId = 'a1dc1fad-4b71-4df3-abb2-154b730b1e8e';
  const now = new Date();
  const res = await page.request.post('/api/summaries/generate', {
    data: {
      groupId,
      tone: 'fun',
      voiceMode: 'duo',
      periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: now.toISOString(),
    },
  });
  const body = await res.json();
  // eslint-disable-next-line no-console
  console.log('status:', res.status(), 'body:', JSON.stringify(body));
  expect(res.status()).toBeLessThan(300);
});
