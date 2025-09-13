// CloudFront invalidation utility using AWS SDK v3
// Invalidates cache paths on write operations to keep CDN fresh.

import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

const cloudFrontClient = new CloudFrontClient({
  region: process.env.AWS_DEFAULT_REGION || 'eu-west-2'
});

/**
 * Invalidate CloudFront cache paths.
 * @param {string[]} paths - Array of path patterns (e.g., ['/products*', '/comments/123*'])
 */
export async function invalidatePaths(paths) {
  if (!process.env.CLOUDFRONT_DISTRIBUTION_ID) {
    return; // No distribution configured; skip
  }

  const unique = Array.from(new Set(paths.map(p => (p.startsWith('/') ? p : `/${p}`))));
  if (unique.length === 0) return;

  const callerReference = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const command = new CreateInvalidationCommand({
    DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: callerReference,
      Paths: {
        Quantity: unique.length,
        Items: unique
      }
    }
  });

  try {
    await cloudFrontClient.send(command);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[CloudFront] Invalidation failed:', error?.message || error);
  }
}


