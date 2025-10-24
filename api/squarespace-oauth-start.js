// api/squarespace-oauth-start.js - Redirect user to Squarespace OAuth authorization
export default async function handler(req, res) {
  const clientId = process.env.SQUARESPACE_CLIENT_ID;
  const redirectUri = `${req.headers.origin || 'https://membershiprenewal.campusstores.ca'}/api/squarespace-oauth-callback`;

  if (!clientId) {
    res.status(500).send('Squarespace Client ID not configured');
    return;
  }

  // Build OAuth authorization URL
  const authUrl = new URL('https://login.squarespace.com/api/1/login/oauth/provider/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'website.orders.read');
  authUrl.searchParams.set('state', generateRandomState());
  authUrl.searchParams.set('access_type', 'offline'); // Request refresh token

  console.log('🔐 Redirecting to Squarespace OAuth...');
  console.log('📍 Redirect URI:', redirectUri);

  // Redirect user to Squarespace authorization page
  res.redirect(authUrl.toString());
}

// Generate random state for CSRF protection
function generateRandomState() {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}
