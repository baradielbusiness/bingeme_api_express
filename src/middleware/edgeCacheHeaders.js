// Middleware to set CDN caching headers per route
// - Controls CDN TTL via s-maxage
// - Ensures per-user variations via Vary: X-User-Cache-Key

const routeCacheConfig = [
  // Products lists/details
  { pattern: /^\/products(\/.*)?$/, ttlSeconds: Number(process.env.CF_TTL_PRODUCTS || 3600), varyUser: true },

  // User module: posts, updates, profile settings, restrictions
  { pattern: /^\/user\/posts$/, ttlSeconds: Number(process.env.CF_TTL_USER_POSTS || 3600), varyUser: true },
  { pattern: /^\/posts$/, ttlSeconds: Number(process.env.CF_TTL_POSTS || process.env.CF_TTL_USER_POSTS || 3600), varyUser: true },

  { pattern: /^\/user\/updates$/, ttlSeconds: Number(process.env.CF_TTL_USER_UPDATES || 3600), varyUser: true },
  { pattern: /^\/updates$/, ttlSeconds: Number(process.env.CF_TTL_UPDATES || process.env.CF_TTL_USER_UPDATES || 3600), varyUser: true },

  { pattern: /^\/user\/profile$/, ttlSeconds: Number(process.env.CF_TTL_USER_PROFILE || 1800), varyUser: true },
  { pattern: /^\/user\/restrictions$/, ttlSeconds: Number(process.env.CF_TTL_USER_RESTRICTIONS || 1800), varyUser: true },

  // User profile by slug (within /user router)
  { pattern: /^\/user\/[^/]+$/, ttlSeconds: Number(process.env.CF_TTL_USER_SLUG || 1800), varyUser: true },

  // Comments
  { pattern: /^\/user\/comments\/\d+$/, ttlSeconds: Number(process.env.CF_TTL_COMMENTS || 7200), varyUser: true },
  { pattern: /^\/comments\/\d+$/, ttlSeconds: Number(process.env.CF_TTL_COMMENTS || 7200), varyUser: true },

  // Posts module specifics
  { pattern: /^\/posts\/create$/, ttlSeconds: Number(process.env.CF_TTL_POSTS_CREATE || 1800), varyUser: true },
  { pattern: /^\/posts\/[^/]+\/\d+$/, ttlSeconds: Number(process.env.CF_TTL_POST_DETAIL || 3600), varyUser: true },

  // Pages
  { pattern: /^\/pages\/[^/]+$/, ttlSeconds: Number(process.env.CF_TTL_PAGES_SLUG || 1800), varyUser: true },
  { pattern: /^\/p\/[^/]+$/, ttlSeconds: Number(process.env.CF_TTL_PAGES_SLUG || 1800), varyUser: true },

  // Notifications
  { pattern: /^\/notifications\/?$/, ttlSeconds: Number(process.env.CF_TTL_NOTIFICATIONS || 600), varyUser: true },
  { pattern: /^\/(notification|notifications)\/settings$/, ttlSeconds: Number(process.env.CF_TTL_NOTIFICATION_SETTINGS || 600), varyUser: true },

  // Live
  { pattern: /^\/live\/filter$/, ttlSeconds: Number(process.env.CF_TTL_LIVE_FILTER || 300), varyUser: true },

  // Dashboard
  { pattern: /^\/dashboard\/?$/, ttlSeconds: Number(process.env.CF_TTL_DASHBOARD || 600), varyUser: true },
  { pattern: /^\/dashboard\/posts-report$/, ttlSeconds: Number(process.env.CF_TTL_DASHBOARD_POSTS_REPORT || 600), varyUser: true },
  { pattern: /^\/dashboard\/income-chart$/, ttlSeconds: Number(process.env.CF_TTL_DASHBOARD_INCOME_CHART || 600), varyUser: true },

  // Creator
  { pattern: /^\/creator\/settings$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_SETTINGS || 900), varyUser: true },
  { pattern: /^\/creator\/block-countries$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_BLOCK_COUNTRIES || 900), varyUser: true },
  { pattern: /^\/creator\/subscription-setting$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_SUBSCRIPTION_SETTING || 900), varyUser: true },
  { pattern: /^\/creator\/agreement$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_AGREEMENT || 900), varyUser: true },
  { pattern: /^\/creator\/agreement-pdf$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_AGREEMENT_PDF || 900), varyUser: true },
  { pattern: /^\/creator\/dashboard$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_DASHBOARD || 600), varyUser: true },
  { pattern: /^\/creator\/payment-received$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_PAYMENTS_RECEIVED || 600), varyUser: true },
  { pattern: /^\/creator\/withdrawals$/, ttlSeconds: Number(process.env.CF_TTL_CREATOR_WITHDRAWALS || 600), varyUser: true },

  // Verification
  { pattern: /^\/verification\/account$/, ttlSeconds: Number(process.env.CF_TTL_VERIFICATION_ACCOUNT || 900), varyUser: true },
  { pattern: /^\/verification\/conversations$/, ttlSeconds: Number(process.env.CF_TTL_VERIFICATION_CONVERSATIONS || 900), varyUser: true },

  // Sales and referrals
  { pattern: /^\/sales\/?$/, ttlSeconds: Number(process.env.CF_TTL_SALES || 600), varyUser: true },
  { pattern: /^\/referrals\/?$/, ttlSeconds: Number(process.env.CF_TTL_REFERRALS || 600), varyUser: true },

  // Payout
  { pattern: /^\/payout\/?$/, ttlSeconds: Number(process.env.CF_TTL_PAYOUT || 900), varyUser: true },
  { pattern: /^\/payout\/conversations$/, ttlSeconds: Number(process.env.CF_TTL_PAYOUT_CONVERSATIONS || 900), varyUser: true },

  // Privacy
  { pattern: /^\/privacy\/security$/, ttlSeconds: Number(process.env.CF_TTL_PRIVACY_SECURITY || 900), varyUser: true },
  { pattern: /^\/privacy\/account\/delete$/, ttlSeconds: Number(process.env.CF_TTL_PRIVACY_ACCOUNT_DELETE || 300), varyUser: true },
  { pattern: /^\/privacy\/account\/retrieve$/, ttlSeconds: Number(process.env.CF_TTL_PRIVACY_ACCOUNT_RETRIEVE || 300), varyUser: true }
];

const setEdgeCacheHeaders = (req, res, next) => {
  if (req.method !== 'GET') return next();
  const matched = routeCacheConfig.find(entry => entry.pattern.test(req.path));
  if (!matched) return next();
  res.set('Cache-Control', `private, max-age=0, s-maxage=${matched.ttlSeconds}`);
  const varyHeaders = ['Accept-Encoding'];
  if (matched.varyUser) varyHeaders.push('X-User-Cache-Key');
  res.set('Vary', varyHeaders.join(', '));
  return next();
};

export default setEdgeCacheHeaders;


